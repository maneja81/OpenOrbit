// word-extractor ships no type declarations and no @types/word-extractor package exists;
// this covers only the extract().getBody() call used in ipc/knowledgeBase.ts.
declare module "word-extractor" {
  export default class WordExtractor {
    extract(input: string | Buffer): Promise<{ getBody(): string }>;
  }
}
