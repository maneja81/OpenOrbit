/** Category filter tabs for the knowledge modal: "All" first, then every distinct
 * category actually present across `files`, deduped and alphabetically sorted. */
export function deriveCategoryTabs(files: KnowledgebaseFileRecord[]): string[] {
  const distinct = Array.from(new Set(files.map((f) => f.category))).sort((a, b) =>
    a.localeCompare(b)
  );
  return ["All", ...distinct];
}
