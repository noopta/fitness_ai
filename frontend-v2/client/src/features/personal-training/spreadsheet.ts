// Turns the file a trainer picks into the plain grid of cells the import API
// takes. The file is read in the browser: only its cell values are uploaded.

import { parseCsv, type ImportUpload } from '@axiom/personal-training-core';

export type SpreadsheetProblem = 'notReadable' | 'tooBig';
export class SpreadsheetError extends Error {
  constructor(readonly problem: SpreadsheetProblem) { super(problem); }
}

const MAX_FILE_BYTES = 25 * 1024 * 1024;
/** The API accepts 10 MB of JSON; stay under it with room for the envelope. */
const MAX_UPLOAD_CHARS = 9 * 1024 * 1024;

function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    // Excel on Windows saves "CSV" in the local code page, not UTF-8.
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

export async function readSpreadsheet(file: File): Promise<ImportUpload> {
  if (file.size > MAX_FILE_BYTES) throw new SpreadsheetError('tooBig');
  const bytes = new Uint8Array(await file.arrayBuffer());
  let sheets: ImportUpload['sheets'];
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    // "PK": a zip, so .xlsx whatever the file is called.
    try {
      const { readXlsx } = await import('./xlsx');
      sheets = await readXlsx(bytes);
    } catch {
      throw new SpreadsheetError('notReadable');
    }
  } else {
    const utf16 = bytes[0] === 0xff && bytes[1] === 0xfe;
    // The old binary .xls format, or some other non-text file.
    if (!utf16 && bytes.subarray(0, 2000).includes(0)) throw new SpreadsheetError('notReadable');
    sheets = [{ name: file.name.replace(/\.[^.]+$/, ''), rows: parseCsv(decodeText(bytes)) }];
  }
  sheets = sheets.filter((s) => s.rows.some((r) => r.some((c) => c)));
  if (sheets.length === 0) throw new SpreadsheetError('notReadable');
  const upload = { fileName: file.name.slice(0, 200), sheets };
  if (JSON.stringify(upload).length > MAX_UPLOAD_CHARS) throw new SpreadsheetError('tooBig');
  return upload;
}
