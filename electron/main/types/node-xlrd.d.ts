// node-xlrd ships no type declarations and no @types/node-xlrd package exists; this
// covers only the open()/sheet-cell-walk shape used in ai/xlsWorker.ts. Only ever
// imported inside that isolated child process — see xlsWorker.ts for why.
declare module "node-xlrd" {
  interface XlrdSheet {
    name: string;
    row: { count: number };
    column: { count: number };
    cell(rowIndex: number, colIndex: number): string | number | boolean | Date | null;
  }
  interface XlrdWorkbook {
    sheets: XlrdSheet[];
  }
  export function open(filePath: string, callback: (err: Error | null, workbook: XlrdWorkbook) => void): void;
}
