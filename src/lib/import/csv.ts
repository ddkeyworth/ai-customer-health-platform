// A small, strict CSV reader (RFC 4180 style): quoted fields, commas and line
// breaks inside quotes, doubled quotes, Windows or Unix line endings, and a
// leading byte-order mark (Excel adds one). No dependency, and pure, so it is
// covered by prisma/test-csv-import.ts.
//
// Returns each data row as an object keyed by the lower-cased header names.
// Blank lines are skipped. It throws on a malformed file (an unclosed quote)
// rather than guessing, so a bad upload is refused instead of half-read.

export interface CsvResult {
  headers: string[];
  rows: Record<string, string>[];
}

// Exports put a quote in front of any text that starts with = + - @ so a
// spreadsheet cannot run it as a formula (see exportData.ts). Take that quote
// off again here, so exporting and re-importing returns the original text.
function unguard(value: string): string {
  return /^'[=+\-@]/.test(value) ? value.slice(1) : value;
}

export function parseCsv(input: string): CsvResult {
  const text = input.replace(/^﻿/, "");
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;
  let i = 0;

  const endField = () => {
    record.push(field);
    field = "";
  };
  const endRecord = () => {
    endField();
    if (record.some((f) => f.trim() !== "")) records.push(record);
    record = [];
  };

  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"' && field === "") {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ",") {
      endField();
      i++;
      continue;
    }
    if (ch === "\r") {
      if (text[i + 1] === "\n") i++;
      endRecord();
      i++;
      continue;
    }
    if (ch === "\n") {
      endRecord();
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  if (inQuotes) throw new Error("The file has a quoted value that is never closed.");
  if (field !== "" || record.length > 0) endRecord();

  if (records.length === 0) return { headers: [], rows: [] };
  const headers = records[0].map((h) => h.trim().toLowerCase());
  const rows = records.slice(1).map((r) => {
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = unguard((r[idx] ?? "").trim());
    });
    return row;
  });
  return { headers, rows };
}
