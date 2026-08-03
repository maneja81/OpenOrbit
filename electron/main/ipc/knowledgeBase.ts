import { dialog, ipcMain, BrowserWindow, Notification } from "electron";
import { getDb } from "../db";
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import { getKnowledgeFilesDir } from "../appDirs";
import OpenAI from "openai";
import { getDecryptedChatApiKey, getConfiguredChatUrl } from "../ai/provider";
import { DEFAULT_MODEL } from "../ai/agents";
import { callDaemon } from "../ai/webSearchDaemon";
import { DOCUMENT_EXTRACTORS, extractDocumentText } from "../ai/documentExtract";
import { partitionLinksByDomain, type DiscoveredLinks } from "./knowledgeUrlDiscovery";
import { assertPublicHttpUrl } from "../net/urlSafety";
import { fetchSitemapUrls } from "./sitemapDiscovery";
import { getAllowedRoots, removeAllowedRoot } from "./filesystem";

// The app-level SELECT-then-INSERT dedup check below has a TOCTOU window (see migration
// v21) — this catches the DB-level unique index as the final backstop and turns it into
// the same friendly message the app-level check produces on the non-racy path.
function isContentHashConflict(e: unknown): boolean {
  return e instanceof Error && /UNIQUE constraint failed.*content_hash/i.test(e.message);
}

/** What a knowledge_files row actually is. 'file' and 'url' rows own a copy of their content in
 * app storage; a 'folder' row owns nothing — it is a handle to a path the user granted, read live
 * on demand, so its content and content_hash stay empty (see migration 33). */
export type KnowledgebaseKind = "file" | "url" | "folder";

export interface KnowledgebaseFileRecord {
  id: number;
  path: string;
  title: string;
  originalName: string;
  category: string;
  syncedAt: string | null;
  createdAt: string;
  sourceUrl: string | null;
  kind: KnowledgebaseKind;
}

// Maximum content length stored per row. A URL fetch that exceeds this is split across
// multiple rows/files (see splitContent) rather than truncated, so no content is lost.
const MAX_CONTENT_BYTES = 100_000;
// How far back from the byte cap splitContent will search for a paragraph/heading break
// before giving up and hard-cutting — keeps parts close to the cap without cutting mid-word.
const SPLIT_LOOKBACK_CHARS = 2000;

const KNOWLEDGEBASE_COLUMNS =
  `id, path, title, original_name AS originalName, category, synced_at AS syncedAt, ` +
  `created_at AS createdAt, NULLIF(source_url, '') AS sourceUrl, kind`;

const CATEGORIZE_INPUT_CHARS = 2000;

/** Classifies a file's extracted text into a short, freeform category label (e.g.
 * "Accounting", "Education", "Resumes") using the same OpenRouter client pattern as
 * ai/provider.ts. Never throws — any failure (no API key yet, network error, malformed
 * response) falls back to "Uncategorized" so categorization can never block adding a file. */
export async function categorizeContent(text: string, filename: string): Promise<string> {
  try {
    const apiKey = getDecryptedChatApiKey();
    const client = new OpenAI({ apiKey, baseURL: getConfiguredChatUrl() });
    const response = await client.chat.completions.create({
      model: DEFAULT_MODEL,
      messages: [
        {
          role: "user",
          content:
            `Classify this file into a short category label (1-3 words, e.g. "Accounting", ` +
            `"Education", "Resumes", "Legal", "Personal", "Work"). Reply with only the label, ` +
            `nothing else.\n\nFilename: ${filename}\n\nContent:\n${text.slice(0, CATEGORIZE_INPUT_CHARS)}`,
        },
      ],
    });
    const label = response.choices[0]?.message?.content?.trim();
    return label && label.length > 0 ? label : "Uncategorized";
  } catch {
    return "Uncategorized";
  }
}

/** Extract a title from the first markdown H1 heading, or fall back to the filename. */
function extractTitle(content: string, originalName: string): string {
  const match = content.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : path.basename(originalName, path.extname(originalName));
}

function truncate(raw: string): string {
  return raw.length > MAX_CONTENT_BYTES ? raw.slice(0, MAX_CONTENT_BYTES) + "\n\n[…truncated]" : raw;
}

/** Copies `sourcePath` into the app-owned knowledge-files dir under a collision-proof name. */
async function copyIntoStorage(sourcePath: string): Promise<string> {
  const ext = path.extname(sourcePath);
  const destName = `${crypto.randomUUID()}${ext}`;
  const destPath = path.join(getKnowledgeFilesDir(), destName);
  await fs.copyFile(sourcePath, destPath);
  return destPath;
}

/** Writes fetched URL content into the app-owned knowledge-files dir under `${desiredBaseName}.md`
 * so files are identifiable/referenceable by name on disk. If that name is already taken by an
 * unrelated file (a genuine slug collision between two different URLs — not the expected/intentional
 * "part N" naming used by splitContent, whose caller already composes a unique-by-construction name),
 * a short content-hash fragment is appended to disambiguate, e.g. "about-a1b2c3.md". This is a
 * different suffix shape than the plain "-2"/"-3" part-number suffix so the two meanings — "unrelated
 * page that happens to share a slug" vs "part 2 of a long page" — are never visually confused. */
/** Finds a free on-disk filename for `desiredBaseName` without writing anything —
 * lets callers reserve a path, run a DB transaction against it, and only touch the
 * filesystem once that transaction has actually committed (see resyncUrlRow). */
async function reserveStoragePath(content: string, desiredBaseName: string): Promise<string> {
  const dir = getKnowledgeFilesDir();
  let candidate = `${desiredBaseName}.md`;
  for (let attempt = 0; attempt < 20; attempt++) {
    const destPath = path.join(dir, candidate);
    try {
      await fs.access(destPath);
      // Name taken — disambiguate with a short hash fragment of this content and retry.
      // The "-N" retry suffix (only appended from the 2nd retry on) is separated from the
      // hash fragment by its own dash so it can't visually run into the hex digits, and stays
      // distinct in shape from the plain "-2"/"-3" part-number suffix used for split content.
      const fragment = crypto.createHash("sha256").update(content).digest("hex").slice(0, 6);
      candidate = `${desiredBaseName}-${fragment}${attempt > 0 ? `-${attempt}` : ""}.md`;
    } catch {
      return destPath;
    }
  }
  throw new Error(`Could not find a free filename for "${desiredBaseName}" after 20 attempts`);
}

async function writeIntoStorage(content: string, desiredBaseName: string): Promise<string> {
  const destPath = await reserveStoragePath(content, desiredBaseName);
  await fs.writeFile(destPath, content, "utf8");
  return destPath;
}

/** Splits content that exceeds MAX_CONTENT_BYTES into multiple parts instead of truncating,
 * so long pages don't lose information. Returns [raw] unchanged for content within the cap —
 * zero behavior change for the common case. Each split point is chosen by searching backward
 * from the byte cap for the nearest paragraph break ("\n\n"), within a bounded lookback window,
 * so parts don't get cut mid-sentence/mid-word; falls back to a hard cut only when no such
 * break exists in that window (e.g. one long unbroken block of text). */
function splitContent(raw: string): string[] {
  if (raw.length <= MAX_CONTENT_BYTES) return [raw];
  const parts: string[] = [];
  let rest = raw;
  while (rest.length > MAX_CONTENT_BYTES) {
    const windowStart = Math.max(0, MAX_CONTENT_BYTES - SPLIT_LOOKBACK_CHARS);
    const breakPoint = rest.lastIndexOf("\n\n", MAX_CONTENT_BYTES);
    const cut = breakPoint >= windowStart ? breakPoint : MAX_CONTENT_BYTES;
    parts.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest.length > 0) parts.push(rest);
  return parts;
}

/** URL-sourced entries aren't classified by the LLM categorizer (see categorizeContent) —
 * they're always grouped under a fixed "Websites" category regardless of content. */
const WEBSITE_CATEGORY = "Websites";

/** Granted folders follow the same fixed-category rule as URL entries: there is no content to
 * classify (the row is a handle, not a copy), so they're always grouped under "Folders". This is
 * what makes them appear as their own tab without deriveCategoryTabs needing to know they exist. */
const FOLDER_CATEGORY = "Folders";

/** Inserts the handle row for a granted folder. Nothing is copied and no text is extracted —
 * content and content_hash stay empty, which the partial unique index on content_hash explicitly
 * excludes (see migration 21), so any number of folder rows coexist. synced_at is stamped once at
 * insert because a folder is read live and never re-synced; leaving it NULL would render as
 * permanently stale (see the sync handler, which skips these rows). */
function insertFolderRow(root: string): void {
  // basename("/") is "", and a bare root is still a legitimate grant — fall back to the path
  // itself so the row never displays as a blank name.
  const name = path.basename(root) || root;
  getDb()
    .prepare(
      `INSERT INTO knowledge_files
       (path, title, original_name, content, category, synced_at, content_hash, source_url, kind)
       VALUES (?, ?, ?, '', ?, datetime('now'), '', '', 'folder')`
    )
    .run(root, name, name, FOLDER_CATEGORY);
}

/** Filesystem-safe originalName for a crawled page: the bare domain for the site's
 * root/home page (e.g. "chdsom.com.md"), or a path-derived slug for inner pages
 * (e.g. "/about-us" -> "about-us.md") — independent of the fetched <title>, which is
 * often generic ("Home") or missing. */
function slugifyUrlFilename(url: string): string {
  const parsed = new URL(url);
  const pathname = parsed.pathname.replace(/\/+$/, "");
  // Include search+hash in the slug too — otherwise URLs differing only by query string or
  // fragment (e.g. "/docs?v=1" vs "/docs?v=2") produce an identical displayed name with no
  // way to tell the rows apart in the widget/modal (only sourceUrl differs, not shown there).
  const suffixSlug = slugifyPart(parsed.search + parsed.hash);
  const suffix = suffixSlug ? `-${suffixSlug}` : "";
  if (!pathname) return `${parsed.hostname}${suffix}.md`;
  const slug = slugifyPart(pathname);
  return (slug || "page") + suffix + ".md";
}

function slugifyPart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

interface ExistingUrlRow {
  id: number;
  path: string;
  partIndex: number;
}

async function fetchAndSplit(sourceUrl: string): Promise<{ title: string; parts: string[] }> {
  await assertPublicHttpUrl(sourceUrl);
  const { title, content: fetchedContent } = await callDaemon<{ title: string; content: string }>("/fetch-web", {
    url: sourceUrl,
    readability: true,
  });
  const mdContent = `# ${title}\n\n${fetchedContent}`;
  return { title, parts: splitContent(mdContent) };
}

/** Re-fetches a URL-sourced entry's content and reconciles it against however many rows
 * currently exist for that source_url (there may be more than one — see splitContent):
 * existing parts are overwritten in place, new parts are inserted if the content grew,
 * and parts that no longer exist (content shrank) are deleted. Used by knowledgebase:sync and by
 * knowledgebase:addUrls (re-adding a URL that's already in the knowledge base). */
async function resyncUrlRow(existingRows: ExistingUrlRow[], sourceUrl: string): Promise<void> {
  const sorted = [...existingRows].sort((a, b) => a.partIndex - b.partIndex);
  const { title, parts } = await fetchAndSplit(sourceUrl);
  const baseSlug = slugifyUrlFilename(sourceUrl).replace(/\.md$/, "");

  const updates: { id: number; path: string; content: string; contentHash: string; partIndex: number }[] = [];
  const inserts: { path: string; originalName: string; content: string; contentHash: string; partIndex: number }[] =
    [];
  const deletions: ExistingUrlRow[] = [];

  // Phase 1: figure out what needs to change and reserve any new on-disk paths, but don't
  // touch the filesystem yet — the DB transaction below is the source of truth, and disk
  // writes/deletes only happen once it has actually committed (see phase 3), so a failed
  // transaction never leaves disk and DB out of sync with each other.
  for (let i = 0; i < Math.max(parts.length, sorted.length); i++) {
    const partIndex = i + 1;
    if (i < parts.length && i < sorted.length) {
      const row = sorted[i];
      const partContent = parts[i];
      updates.push({
        id: row.id,
        path: row.path,
        content: partContent,
        contentHash: crypto.createHash("sha256").update(partContent).digest("hex"),
        partIndex,
      });
    } else if (i < parts.length) {
      const partContent = parts[i];
      const desiredName = i === 0 ? baseSlug : `${baseSlug}-${partIndex}`;
      const storedPath = await reserveStoragePath(partContent, desiredName);
      inserts.push({
        path: storedPath,
        originalName: path.basename(storedPath),
        content: partContent,
        contentHash: crypto.createHash("sha256").update(partContent).digest("hex"),
        partIndex,
      });
    } else {
      deletions.push(sorted[i]);
    }
  }

  const partCount = parts.length;
  const db = getDb();
  const applyResync = db.transaction(() => {
    for (const u of updates) {
      db.prepare(
        `UPDATE knowledge_files SET title = ?, content = ?, content_hash = ?, category = ?,
         part_index = ?, part_count = ?, synced_at = datetime('now') WHERE id = ?`
      ).run(title, u.content, u.contentHash, WEBSITE_CATEGORY, u.partIndex, partCount, u.id);
    }
    for (const ins of inserts) {
      db.prepare(
        `INSERT INTO knowledge_files
         (path, title, original_name, content, category, synced_at, content_hash, source_url, part_index, part_count)
         VALUES (?, ?, ?, ?, ?, datetime('now'), ?, ?, ?, ?)`
      ).run(ins.path, title, ins.originalName, ins.content, WEBSITE_CATEGORY, ins.contentHash, sourceUrl, ins.partIndex, partCount);
    }
    for (const d of deletions) {
      db.prepare("DELETE FROM knowledge_files WHERE id = ?").run(d.id);
    }
  });
  applyResync();

  // Phase 3: the transaction committed — now it's safe to mutate the filesystem to match.
  await Promise.all([
    ...updates.map((u) => fs.writeFile(u.path, u.content, "utf8")),
    ...inserts.map((ins) => fs.writeFile(ins.path, ins.content, "utf8")),
    ...deletions.map((d) =>
      fs.unlink(d.path).catch(() => {
        // Stored copy already missing — nothing further to clean up.
      })
    ),
  ]);
}

async function addUrl(url: string): Promise<KnowledgebaseFileRecord> {
  if (typeof url !== "string" || url.trim().length === 0) throw new Error("knowledgebase:addUrls requires a URL");
  await assertPublicHttpUrl(url.trim());
  const {
    url: finalUrl,
    title,
    content: fetchedContent,
  } = await callDaemon<{ url: string; title: string; content: string }>("/fetch-web", {
    url: url.trim(),
    readability: true,
  });
  // Defense-in-depth: the daemon may have followed a redirect we couldn't see coming —
  // refuse to persist content fetched from somewhere that ends up local/private.
  await assertPublicHttpUrl(finalUrl);

  const db = getDb();
  const existing = db
    .prepare("SELECT id, path, part_index AS partIndex FROM knowledge_files WHERE source_url = ?")
    .all(finalUrl) as ExistingUrlRow[];
  if (existing.length > 0) {
    await resyncUrlRow(existing, finalUrl);
    const repId = [...existing].sort((a, b) => a.partIndex - b.partIndex)[0].id;
    return db.prepare(`SELECT ${KNOWLEDGEBASE_COLUMNS} FROM knowledge_files WHERE id = ?`).get(repId) as KnowledgebaseFileRecord;
  }

  const mdContent = `# ${title}\n\n${fetchedContent}`;
  const wholeDocHash = crypto.createHash("sha256").update(mdContent).digest("hex");
  const duplicate = db
    .prepare("SELECT original_name AS originalName FROM knowledge_files WHERE content_hash = ?")
    .get(wholeDocHash) as { originalName: string } | undefined;
  if (duplicate) {
    throw new Error(`This content has already been added as "${duplicate.originalName}".`);
  }

  const parts = splitContent(mdContent);
  const baseSlug = slugifyUrlFilename(finalUrl).replace(/\.md$/, "");
  const partCount = parts.length;

  const written: { path: string; originalName: string; content: string; contentHash: string; partIndex: number }[] =
    [];
  for (let i = 0; i < parts.length; i++) {
    const partIndex = i + 1;
    const desiredName = i === 0 ? baseSlug : `${baseSlug}-${partIndex}`;
    const storedPath = await writeIntoStorage(parts[i], desiredName);
    written.push({
      path: storedPath,
      originalName: path.basename(storedPath),
      content: parts[i],
      contentHash: crypto.createHash("sha256").update(parts[i]).digest("hex"),
      partIndex,
    });
  }

  let firstId: number;
  try {
    const insertAll = db.transaction(() => {
      let insertedFirstId: number | null = null;
      for (const w of written) {
        const result = db
          .prepare(
            `INSERT INTO knowledge_files
             (path, title, original_name, content, category, synced_at, content_hash, source_url, part_index, part_count)
             VALUES (?, ?, ?, ?, ?, datetime('now'), ?, ?, ?, ?)`
          )
          .run(w.path, title, w.originalName, w.content, WEBSITE_CATEGORY, w.contentHash, finalUrl, w.partIndex, partCount);
        if (insertedFirstId === null) insertedFirstId = result.lastInsertRowid as number;
      }
      return insertedFirstId as number;
    });
    firstId = insertAll();
  } catch (e) {
    // The transaction never committed, so the files already written above are orphaned —
    // best-effort clean them up before surfacing the error.
    await Promise.all(written.map((w) => fs.unlink(w.path).catch(() => {})));
    if (isContentHashConflict(e)) {
      const winner = db
        .prepare("SELECT original_name AS originalName FROM knowledge_files WHERE content_hash = ?")
        .get(wholeDocHash) as { originalName: string } | undefined;
      throw new Error(`This content has already been added as "${winner?.originalName ?? "another item"}".`);
    }
    throw e;
  }
  return db.prepare(`SELECT ${KNOWLEDGEBASE_COLUMNS} FROM knowledge_files WHERE id = ?`).get(firstId) as KnowledgebaseFileRecord;
}

/** Brings the folder rows in line with `allowedRoots`, which stays the single source of truth for
 * what the app may read (assertAllowed re-reads it on every access, and list_granted_folders reads
 * it directly). Rows are a mirror, so any grant or revoke — from the widget, from Settings, or from
 * a path that never touches this file — self-heals on the next list rather than needing every write
 * site to dual-write. Purely a DB operation: it never touches the filesystem, so a granted folder
 * that is offline or deleted still reconciles cleanly and simply fails when actually browsed. */
export function reconcileFolderRows(): void {
  const db = getDb();
  const roots = getAllowedRoots();
  const existing = db.prepare("SELECT path FROM knowledge_files WHERE kind = 'folder'").all() as {
    path: string;
  }[];
  const existingPaths = new Set(existing.map((row) => row.path));
  const rootSet = new Set(roots);

  const missing = roots.filter((root) => !existingPaths.has(root));
  const orphaned = existing.filter((row) => !rootSet.has(row.path));
  if (missing.length === 0 && orphaned.length === 0) return;

  const applyReconcile = db.transaction(() => {
    for (const root of missing) insertFolderRow(root);
    const remove = db.prepare("DELETE FROM knowledge_files WHERE kind = 'folder' AND path = ?");
    for (const row of orphaned) remove.run(row.path);
  });
  applyReconcile();
}

export function registerKnowledgeBaseHandlers(): void {
  ipcMain.handle("knowledgebase:list", (): KnowledgebaseFileRecord[] => {
    reconcileFolderRows();
    const db = getDb();
    return db
      .prepare(`SELECT ${KNOWLEDGEBASE_COLUMNS} FROM knowledge_files ORDER BY title COLLATE NOCASE`)
      .all() as KnowledgebaseFileRecord[];
  });

  ipcMain.handle(
    "knowledgebase:pickAndAdd",
    async (event): Promise<{ added: KnowledgebaseFileRecord[]; failed: { path: string; error: string }[] }> => {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win) return { added: [], failed: [] };
      const result = await dialog.showOpenDialog(win, {
        properties: ["openFile", "multiSelections"],
        filters: [{ name: "Knowledge files", extensions: Object.keys(DOCUMENT_EXTRACTORS).map((ext) => ext.slice(1)) }],
      });
      if (result.canceled) return { added: [], failed: [] };
      const added: KnowledgebaseFileRecord[] = [];
      const failed: { path: string; error: string }[] = [];
      for (const filePath of result.filePaths) {
        try {
          added.push(await addFile(filePath));
        } catch (e) {
          failed.push({ path: filePath, error: e instanceof Error ? e.message : String(e) });
        }
      }
      return { added, failed };
    }
  );

  ipcMain.handle("knowledgebase:add", async (_event, filePath: string): Promise<KnowledgebaseFileRecord> => addFile(filePath));

  ipcMain.handle("knowledgebase:remove", async (_event, id: number): Promise<void> => {
    if (typeof id !== "number") throw new Error("knowledgebase:remove requires a numeric id");
    const db = getDb();
    const row = db.prepare("SELECT path, kind FROM knowledge_files WHERE id = ?").get(id) as
      | { path: string; kind: KnowledgebaseKind }
      | undefined;
    db.prepare("DELETE FROM knowledge_files WHERE id = ?").run(id);
    if (!row) return;
    // A folder row's path is a real directory the user granted, not an app-owned copy — removing
    // it here means "revoke access", never "delete from disk". Without this branch the row would
    // fall through to unlink(), which on a directory fails with EPERM and is then swallowed by the
    // catch below: the folder survives, but the grant is never revoked, so agents keep read access
    // to a folder the user just removed from the knowledge base.
    if (row.kind === "folder") {
      removeAllowedRoot(row.path);
      return;
    }
    await fs.unlink(row.path).catch(() => {
      // Stored copy already missing — nothing further to clean up.
    });
  });

  ipcMain.handle(
    "knowledgebase:sync",
    async (_event, id?: number): Promise<{ updated: string[]; missing: { name: string; error: string }[] }> => {
      const db = getDb();
      const ROW_COLUMNS =
        "id, path, original_name AS originalName, part_index AS partIndex, NULLIF(source_url, '') AS sourceUrl, kind";
      type SyncRow = {
        id: number;
        path: string;
        originalName: string;
        partIndex: number;
        sourceUrl: string | null;
        kind: KnowledgebaseKind;
      };
      let rows: SyncRow[];
      if (typeof id === "number") {
        const target = db.prepare(`SELECT ${ROW_COLUMNS} FROM knowledge_files WHERE id = ?`).get(id) as
          | SyncRow
          | undefined;
        // A folder is read live on every access, so there is nothing to re-sync. Returning early
        // (rather than falling through to extract()) keeps its synced_at stamp intact — the file
        // path below would hit EISDIR and mark the row permanently stale with an error the user
        // can't act on.
        if (target?.kind === "folder") return { updated: [], missing: [] };
        // A split URL-sourced row has siblings sharing its source_url — syncing "one" row
        // (e.g. via the widget's per-file resync button) must pull in the whole group,
        // otherwise reconciliation never sees the other parts and can't remove/grow them.
        rows =
          target?.sourceUrl != null
            ? (db.prepare(`SELECT ${ROW_COLUMNS} FROM knowledge_files WHERE source_url = ?`).all(target.sourceUrl) as typeof rows)
            : target
              ? [target]
              : [];
      } else {
        // Folder rows are excluded rather than filtered later: they hold no stored copy to
        // re-read, so extract() would throw EISDIR on every one and flag them all as stale.
        rows = db.prepare(`SELECT ${ROW_COLUMNS} FROM knowledge_files WHERE kind != 'folder'`).all() as typeof rows;
      }
      const updated: string[] = [];
      const missing: { name: string; error: string }[] = [];

      // URL-sourced rows sharing one source_url are one logical fetch (see splitContent) —
      // group them so a split page triggers exactly one re-fetch/re-split, not one per part.
      const urlGroups = new Map<string, typeof rows>();
      const fileRows: typeof rows = [];
      for (const row of rows) {
        if (row.sourceUrl) {
          const group = urlGroups.get(row.sourceUrl) ?? [];
          group.push(row);
          urlGroups.set(row.sourceUrl, group);
        } else {
          fileRows.push(row);
        }
      }

      for (const [sourceUrl, group] of urlGroups) {
        const label = group.slice().sort((a, b) => a.partIndex - b.partIndex)[0].originalName;
        try {
          await resyncUrlRow(
            group.map((r) => ({ id: r.id, path: r.path, partIndex: r.partIndex })),
            sourceUrl
          );
          updated.push(label);
        } catch (e) {
          for (const row of group) {
            db.prepare("UPDATE knowledge_files SET synced_at = NULL WHERE id = ?").run(row.id);
          }
          missing.push({ name: label, error: e instanceof Error ? e.message : String(e) });
        }
      }

      for (const row of fileRows) {
        try {
          const raw = await extract(row.path);
          const content = truncate(raw);
          const title = extractTitle(raw, row.originalName);
          const category = await categorizeContent(raw, row.originalName);
          db.prepare(
            "UPDATE knowledge_files SET title = ?, content = ?, category = ?, synced_at = datetime('now') WHERE id = ?"
          ).run(title, content, category, row.id);
          updated.push(row.originalName);
        } catch (e) {
          // Stored copy missing/unreadable — null out synced_at to signal stale, but keep
          // the real reason instead of discarding it, so the renderer can show something actionable.
          db.prepare("UPDATE knowledge_files SET synced_at = NULL WHERE id = ?").run(row.id);
          missing.push({ name: row.originalName, error: e instanceof Error ? e.message : String(e) });
        }
      }
      return { updated, missing };
    }
  );

  ipcMain.handle("knowledgebase:updateCategory", (_event, id: number, category: string): void => {
    if (typeof id !== "number") throw new Error("knowledgebase:updateCategory requires a numeric id");
    if (typeof category !== "string" || category.trim().length === 0) {
      throw new Error("knowledgebase:updateCategory requires a non-empty category");
    }
    getDb().prepare("UPDATE knowledge_files SET category = ? WHERE id = ?").run(category.trim(), id);
  });

  ipcMain.handle("knowledgebase:discoverLinks", async (_event, url: string): Promise<DiscoveredLinks> => {
    if (typeof url !== "string" || url.trim().length === 0) {
      throw new Error("knowledgebase:discoverLinks requires a URL");
    }
    await assertPublicHttpUrl(url.trim());
    const result = await callDaemon<{ url: string; title: string; links?: { href: string; text: string }[] }>(
      "/fetch-web",
      { url: url.trim(), includeLinks: true, readability: true }
    );
    await assertPublicHttpUrl(result.url);

    // External links always come from the page scan (sitemaps only cover their own domain).
    const { externalLinks } = partitionLinksByDomain(result.url, result.links ?? []);

    // Sitemaps are more complete/canonical than an incidental page scan — when one
    // exists for this domain, it replaces the same-domain link source entirely;
    // otherwise fall back to exactly today's page-scan behavior, unchanged.
    const sitemapUrls = await fetchSitemapUrls(result.url);
    const { sameDomainLinks } = sitemapUrls
      ? partitionLinksByDomain(result.url, sitemapUrls.map((u) => ({ href: u, text: "" })))
      : partitionLinksByDomain(result.url, result.links ?? []);

    return { seedUrl: result.url, title: result.title, sameDomainLinks, externalLinks };
  });

  ipcMain.handle(
    "knowledgebase:addUrls",
    async (_event, urls: string[]): Promise<{ added: KnowledgebaseFileRecord[]; failed: { url: string; error: string }[] }> => {
      const added: KnowledgebaseFileRecord[] = [];
      const failed: { url: string; error: string }[] = [];
      for (const url of urls) {
        try {
          added.push(await addUrl(url));
        } catch (e) {
          failed.push({ url, error: e instanceof Error ? e.message : String(e) });
        }
      }

      // Fired once the whole batch settles so the renderer (which no longer blocks its
      // modal on this call — see AddUrlModal) can refresh, and so the OS notification
      // below has a natural place to originate from.
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send("knowledgebase:urlsAddComplete", { added: added.length, failed: failed.length, failedDetails: failed });
      }
      if (Notification.isSupported()) {
        const total = urls.length;
        const body =
          failed.length === 0
            ? `${added.length} URL${added.length === 1 ? "" : "s"} saved.`
            : `${added.length} of ${total} URL${total === 1 ? "" : "s"} saved.`;
        new Notification({ title: "Knowledge base updated", body }).show();
      }

      return { added, failed };
    }
  );
}

async function extract(storedPath: string): Promise<string> {
  const ext = path.extname(storedPath).toLowerCase();
  const buf = await fs.readFile(storedPath);
  return extractDocumentText(buf, ext);
}

async function addFile(filePath: string): Promise<KnowledgebaseFileRecord> {
  if (typeof filePath !== "string") throw new Error("knowledgebase:add requires a file path");
  const ext = path.extname(filePath).toLowerCase();
  if (!DOCUMENT_EXTRACTORS[ext]) {
    throw new Error(`Unsupported file type "${ext}". Supported: ${Object.keys(DOCUMENT_EXTRACTORS).join(", ")}`);
  }
  // No allowedRoots gate here: the source is only ever an explicit user selection
  // (native file picker or drag-and-drop onto the widget), and the file is copied
  // once into app storage rather than kept as a live reference — unlike fs:readFile,
  // there's no ongoing access to grant, so the OS-level dialog/drop is the consent
  // (same reasoning fs:pickFolder already applies to folder selection).
  const resolvedPath = await fs.realpath(filePath);
  const stat = await fs.stat(resolvedPath);
  if (!stat.isFile()) throw new Error(`"${filePath}" is not a file`);

  const originalName = path.basename(resolvedPath);

  const fileBuf = await fs.readFile(resolvedPath);
  const contentHash = crypto.createHash("sha256").update(fileBuf).digest("hex");
  const db = getDb();
  const duplicate = db
    .prepare("SELECT original_name AS originalName FROM knowledge_files WHERE content_hash = ?")
    .get(contentHash) as { originalName: string } | undefined;
  if (duplicate) {
    throw new Error(`This file has already been added as "${duplicate.originalName}".`);
  }

  const raw = await DOCUMENT_EXTRACTORS[ext](fileBuf);
  const content = truncate(raw);
  const title = extractTitle(raw, originalName);
  const category = await categorizeContent(raw, originalName);
  const storedPath = await copyIntoStorage(resolvedPath);

  let result;
  try {
    result = db
      .prepare(
        `INSERT INTO knowledge_files (path, title, original_name, content, category, synced_at, content_hash)
         VALUES (?, ?, ?, ?, ?, datetime('now'), ?)`
      )
      .run(storedPath, title, originalName, content, category, contentHash);
  } catch (e) {
    if (isContentHashConflict(e)) {
      const winner = db
        .prepare("SELECT original_name AS originalName FROM knowledge_files WHERE content_hash = ?")
        .get(contentHash) as { originalName: string } | undefined;
      throw new Error(`This file has already been added as "${winner?.originalName ?? "another file"}".`);
    }
    throw e;
  }
  const id = result.lastInsertRowid as number;
  return db.prepare(`SELECT ${KNOWLEDGEBASE_COLUMNS} FROM knowledge_files WHERE id = ?`).get(id) as KnowledgebaseFileRecord;
}
