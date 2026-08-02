/**
 * Shared document text-extraction pipeline — converts a file's raw bytes into plain
 * text based on its extension. Originally lived only in ipc/knowledgeBase.ts; pulled out
 * here so ai/tools/folderAccessTools.ts (reading files from user-granted folders) can
 * parse the same PDF/Word/Excel/etc. formats instead of decoding them as raw UTF-8 text.
 */

import fs from "fs/promises";
import path from "path";
import os from "os";
import crypto from "crypto";
import { execFile } from "child_process";
import type ExcelJS from "exceljs";

const readAsUtf8 = async (buf: Buffer) => buf.toString("utf8");

// Formats that are already plain text under the hood — no parsing needed, just
// decoded and stored as-is (same as .md/.txt/.csv below).
const PLAIN_TEXT_EXTENSIONS = [
  ".json",
  ".xml",
  ".yaml",
  ".yml",
  ".toml",
  ".ini",
  ".log",
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".py",
  ".java",
  ".go",
  ".rs",
  ".rb",
  ".php",
  ".sh",
  ".c",
  ".cpp",
  ".h",
  ".hpp",
  ".sql",
];

/** Renders every sheet as CSV-ish text, one section per sheet, so multi-sheet
 * workbooks stay readable and attributable when the model cites a sheet by name. */
async function extractSpreadsheet(buf: Buffer): Promise<string> {
  // exceljs is CJS with no synthesized named exports under dynamic import() — only
  // `default` (the whole module.exports object) is populated; { Workbook } would be undefined.
  const { default: ExcelJSModule } = await import("exceljs");
  const workbook = new ExcelJSModule.Workbook();
  // exceljs pulls in its own nested, older @types/node (via fast-csv) whose Buffer type
  // isn't generic — a real Buffer at runtime either way, just a type-package version
  // clash at compile time that `as unknown as Buffer` doesn't resolve, hence `any` here.
  await workbook.xlsx.load(buf as any); // eslint-disable-line @typescript-eslint/no-explicit-any
  const sections: string[] = [];
  workbook.eachSheet((sheet) => {
    const rows: string[] = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const cells = (row.values as ExcelJS.CellValue[])
        .slice(1)
        .map((v) => (v === null || v === undefined ? "" : String(v)));
      rows.push(cells.join(","));
    });
    sections.push(`## Sheet: ${sheet.name}\n${rows.join("\n")}`);
  });
  return sections.join("\n\n");
}

/** node-pptx-parser's API takes a file path, not a buffer, so the buffer is written to
 * a scratch temp file for the duration of the parse and removed immediately after. */
async function extractPptx(buf: Buffer): Promise<string> {
  // Same CJS/no-named-exports situation as exceljs above — only `default` is populated.
  const { default: PptxParser } = await import("node-pptx-parser");
  const tmpPath = path.join(os.tmpdir(), `knowledgebase-pptx-${crypto.randomUUID()}.pptx`);
  await fs.writeFile(tmpPath, buf);
  try {
    const slides = await new PptxParser(tmpPath).extractText();
    return slides.map((slide, i) => `## Slide ${i + 1}\n${slide.text.join("\n")}`).join("\n\n");
  } finally {
    await fs.unlink(tmpPath).catch(() => {
      // Scratch file already gone — nothing further to clean up.
    });
  }
}

/** Strips markup down to readable text — raw HTML is noisy to store and read back. */
async function extractHtml(buf: Buffer): Promise<string> {
  const { load } = await import("cheerio");
  const $ = load(buf.toString("utf8"));
  $("script, style").remove();
  // cheerio's .text() concatenates block elements with no separator (e.g. a heading
  // runs straight into the next paragraph) — add line breaks after each block so the
  // stored text reads like the original layout instead of one run-on line.
  $("p, div, li, h1, h2, h3, h4, h5, h6, br, tr").after("\n");
  return $("body").text().replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

/** Recursively collects every text node under an xml2js-parsed element, in document order. */
function collectXmlText(node: unknown, out: string[]): void {
  if (node === null || node === undefined) return;
  if (typeof node === "string") {
    out.push(node);
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) collectXmlText(item, out);
    return;
  }
  if (typeof node === "object") {
    // xml2js puts attributes under "$" — skip those, only walk element content.
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key !== "$") collectXmlText(value, out);
    }
  }
}

/** .odt/.ods/.odp are all zip+XML (OpenDocument format) with body text under content.xml,
 * same technique as the pptx extractor above — no new dependency needed, jszip and
 * xml2js are already installed transitively via exceljs/node-pptx-parser. */
async function extractOpenDocument(buf: Buffer): Promise<string> {
  const { default: JSZip } = await import("jszip");
  const { parseStringPromise } = await import("xml2js");
  const zip = await JSZip.loadAsync(buf);
  const contentXml = await zip.file("content.xml")?.async("string");
  if (!contentXml) throw new Error("Not a valid OpenDocument file: missing content.xml");
  const parsed = await parseStringPromise(contentXml);
  const body = (parsed as Record<string, any>)?.["office:document-content"]?.["office:body"]; // eslint-disable-line @typescript-eslint/no-explicit-any
  const textNodes: string[] = [];
  collectXmlText(body, textNodes);
  return textNodes.map((t) => t.trim()).filter(Boolean).join("\n");
}

/** Unverified in this sandbox — no writer tool available to build a real .doc fixture
 * (OLE binary format, unlike the zip-based formats above). Wired up per word-extractor's
 * documented API; first real confirmation is expected to come from an actual .doc file. */
async function extractDoc(buf: Buffer): Promise<string> {
  const { default: WordExtractor } = await import("word-extractor");
  const doc = await new WordExtractor().extract(buf);
  return doc.getBody();
}

/** Runs the .xls parse in a separate child process (ai/xlsWorker.ts, its own build
 * entry — see electron.vite.config.ts) so node-xlrd's known uncaught-exception failure
 * mode can only take down that short-lived subprocess, never this one. */
async function extractXls(buf: Buffer): Promise<string> {
  const tmpPath = path.join(os.tmpdir(), `knowledgebase-xls-${crypto.randomUUID()}.xls`);
  await fs.writeFile(tmpPath, buf);
  try {
    const workerPath = path.join(__dirname, "xlsWorker.js");
    const { stdout } = await new Promise<{ stdout: string }>((resolve, reject) => {
      execFile(
        process.execPath,
        [workerPath, tmpPath],
        // process.execPath is the Electron binary itself, not plain Node — without this,
        // Electron treats the script path as another app to launch instead of running it.
        { env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } },
        (err, stdout, stderr) => {
          if (err) {
            reject(new Error(stderr.trim() || err.message));
          } else {
            resolve({ stdout });
          }
        }
      );
    });
    const { text } = JSON.parse(stdout) as { text: string };
    return text;
  } finally {
    await fs.unlink(tmpPath).catch(() => {
      // Scratch file already gone — nothing further to clean up.
    });
  }
}

// Extensions this pipeline can parse, each mapped to a text extractor.
export const DOCUMENT_EXTRACTORS: Record<string, (buf: Buffer) => Promise<string>> = {
  ".md": readAsUtf8,
  ".txt": readAsUtf8,
  ".csv": readAsUtf8,
  ...Object.fromEntries(PLAIN_TEXT_EXTENSIONS.map((ext) => [ext, readAsUtf8])),
  ".pdf": async (buf) => {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: buf });
    try {
      const result = await parser.getText();
      return result.text;
    } finally {
      await parser.destroy();
    }
  },
  ".docx": async (buf) => {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer: buf });
    return result.value;
  },
  // Modern XLSX only — exceljs can't read the legacy binary .xls format (Phase 3 item).
  ".xlsx": extractSpreadsheet,
  ".pptx": extractPptx,
  ".html": extractHtml,
  ".htm": extractHtml,
  ".odt": extractOpenDocument,
  ".ods": extractOpenDocument,
  ".odp": extractOpenDocument,
  ".doc": extractDoc,
  // Legacy binary .xls — runs in its own child process (ai/xlsWorker.ts) because
  // node-xlrd throws an uncaught synchronous exception from deep inside an fs.read
  // callback on malformed input (verified), which nothing in-process could ever catch.
  // Isolating it means the worst case is that one short-lived subprocess dying, not
  // the whole app.
  ".xls": extractXls,
};

/** Extracts plain text from `buf` using the extractor registered for `ext` (e.g. ".pdf",
 * case-insensitive). Throws if the extension has no registered extractor. */
export async function extractDocumentText(buf: Buffer, ext: string): Promise<string> {
  const extractor = DOCUMENT_EXTRACTORS[ext.toLowerCase()];
  if (!extractor) throw new Error(`Unsupported file type: ${ext}`);
  return extractor(buf);
}
