/**
 * Standalone entry point (its own build output, see electron.vite.config.ts) — spawned
 * as a child process by ipc/knowledgeBase.ts's extractXls, never imported directly.
 *
 * node-xlrd (the only viable legacy .xls reader found) throws an uncaught synchronous
 * exception from deep inside an fs.read callback on malformed input — a throw that
 * happens in a later I/O tick outside any caller's try/catch, so nothing in the parent
 * process could ever safely catch it. Running the parse here means the worst case is
 * this one short-lived process crashing, not the whole app.
 *
 * Protocol: argv[2] is the path to the .xls file to parse. On success, prints
 * `{"text": "..."}` as JSON to stdout and exits 0. On any failure (including an
 * uncaught exception from node-xlrd itself), prints a message to stderr and exits 1.
 */

// process.stdout/stderr.write() on a pipe isn't guaranteed synchronous — for output
// larger than the OS pipe buffer (64KB is a common boundary), exiting immediately after
// write() can truncate it mid-flush. Always wait for the write's own callback before
// exiting, on every exit path here (large sheets can easily exceed that boundary).
function writeAndExit(stream: NodeJS.WriteStream, data: string, code: number): void {
  stream.write(data, () => process.exit(code));
}

process.on("uncaughtException", (err) => {
  writeAndExit(process.stderr, err instanceof Error ? err.message : String(err), 1);
});

async function main(): Promise<void> {
  const filePath = process.argv[2];
  if (!filePath) {
    writeAndExit(process.stderr, "xlsWorker requires a file path argument", 1);
    return;
  }

  const { open } = await import("node-xlrd");
  const workbook = await new Promise<Parameters<Parameters<typeof open>[1]>[1]>((resolve, reject) => {
    open(filePath, (err, wb) => (err ? reject(err) : resolve(wb)));
  });

  const sections = workbook.sheets.map((sheet) => {
    const rows: string[] = [];
    for (let r = 0; r < sheet.row.count; r++) {
      const cells: string[] = [];
      for (let c = 0; c < sheet.column.count; c++) {
        const value = sheet.cell(r, c);
        cells.push(value === null || value === undefined ? "" : String(value));
      }
      rows.push(cells.join(","));
    }
    return `## Sheet: ${sheet.name}\n${rows.join("\n")}`;
  });

  writeAndExit(process.stdout, JSON.stringify({ text: sections.join("\n\n") }), 0);
}

main().catch((err) => {
  writeAndExit(process.stderr, err instanceof Error ? err.message : String(err), 1);
});
