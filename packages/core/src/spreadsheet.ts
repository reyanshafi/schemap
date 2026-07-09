import type { Readable } from "node:stream";

import ExcelJS from "exceljs";

// XLSX support (PRD §6.1, P1): first sheet by default, with a sheet picker for
// workbooks with more than one.
//
// This uses exceljs's BUFFERED reader, not its streaming one. The streaming
// WorkbookReader resolves a sheet's name from `xl/workbook.xml`, but requires
// that entry to appear before any `xl/worksheets/sheetN.xml` entry in the zip —
// and real files don't guarantee that (exceljs's own writer puts workbook.xml
// LAST, which crashes its own streaming reader on round-trip). The buffered
// reader parses the whole zip's relationships before exposing any sheet, so it
// is correct regardless of entry order. Memory use is bounded by the existing
// 100MB upload cap, so this is an acceptable tradeoff for a P1 format.

export function isSpreadsheetFilename(filename: string): boolean {
  return /\.xlsx?$/i.test(filename);
}

function cellToString(value: ExcelJS.CellValue): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10); // feeds the date transform's ISO branch
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    if ("richText" in value) return value.richText.map((r) => r.text).join("");
    if ("result" in value) return cellToString(value.result as ExcelJS.CellValue);
    if ("text" in value) return String((value as { text: unknown }).text);
    if ("error" in value) return null; // e.g. #DIV/0! — treat as empty rather than the error token
  }
  return String(value);
}

function rowToStrings(values: ExcelJS.CellValue[]): (string | null)[] {
  // row.values is 1-indexed by exceljs convention — index 0 is always empty
  return values.slice(1).map(cellToString);
}

async function loadWorkbook(stream: Readable): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.read(stream);
  return workbook;
}

/** Lists sheet names — powers the sheet picker. */
export async function listSheetNames(stream: Readable): Promise<string[]> {
  const workbook = await loadWorkbook(stream);
  return workbook.worksheets.map((ws) => ws.name);
}

/** Streams rows from one sheet — the named sheet if given, otherwise the first. */
export async function* readSpreadsheetRows(
  stream: Readable,
  sheetName?: string,
): AsyncGenerator<(string | null)[]> {
  const workbook = await loadWorkbook(stream);
  const worksheet = sheetName ? workbook.getWorksheet(sheetName) : workbook.worksheets[0];
  if (!worksheet) {
    throw new Error(sheetName ? `Sheet "${sheetName}" not found in workbook` : "Workbook has no sheets");
  }

  const rows: (string | null)[][] = [];
  worksheet.eachRow({ includeEmpty: true }, (row) => {
    rows.push(rowToStrings(row.values as ExcelJS.CellValue[]));
  });
  for (const row of rows) yield row;
}
