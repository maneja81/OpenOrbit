/** How many attached folders the compact list will show before the rest fall behind
 * "Show more…". Folders are pinned above documents, so without a cap a user with many granted
 * folders would see nothing else in the card. */
const MAX_PINNED_FOLDERS = 3;

/** Picks what the Knowledge widget's compact list shows, capped at `max` — the rest are only
 * reachable via "Show more…". Attached folders come first, by name: they are few and stable, so
 * burying them under a churning list of recent documents would make them hard to find again.
 * Documents and URLs follow, newest first, exactly as before. */
export function selectRecentFiles(files: KnowledgebaseFileRecord[], max: number): KnowledgebaseFileRecord[] {
  const folders = files
    .filter((entry) => entry.kind === "folder")
    .sort((a, b) => a.title.localeCompare(b.title))
    .slice(0, MAX_PINNED_FOLDERS);
  const documents = files
    .filter((entry) => entry.kind !== "folder")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return [...folders, ...documents].slice(0, max);
}
