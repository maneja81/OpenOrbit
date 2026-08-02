// mammoth ships no type declarations and no @types/mammoth package exists;
// this covers only the extractRawText() call used in ipc/knowledgeBase.ts.
declare module "mammoth" {
  export function extractRawText(input: { buffer: Buffer }): Promise<{ value: string; messages: unknown[] }>;
}
