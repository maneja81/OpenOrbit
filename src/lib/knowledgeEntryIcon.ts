/** The leading icon for a knowledge-base entry, by what the entry actually is. Shared by the
 * widget's compact list and the modal's full list so the two can't drift — a folder reading as a
 * document in one of them would misrepresent what removing it does. */
export function entryIcon(kind: KnowledgebaseKind): string {
  if (kind === "folder") return "ti-folder";
  if (kind === "url") return "ti-world";
  return "ti-file-text";
}
