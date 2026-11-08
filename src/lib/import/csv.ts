// A small, strict CSV reader (RFC 4180 style): quoted fields, commas and line
// breaks inside quotes, doubled quotes, optional spaces before an opening quote,
// Windows or Unix line endings, and a leading byte-order mark (Excel adds one).
// No dependency, and pure, so it is covered by prisma/test-csv-parse-validate.ts.
//
// Returns each data row as an object keyed by the lower-cased header names, plus
// `lines`: the physical line of the file each data row starts on (blank lines
// and lines inside quoted cells all count), so an error can say "Row 14" and
// mean line 14 of the file. Blank lines are skipped.
//
// It refuses rather than guesses: an unclosed quote, more than MAX_COLUMNS cells
// in one record, or more than MAX_RECORDS records. The two size limits are
// checked WHILE reading, before any row object is built, so a hostile file (a
// huge run of commas, or hundreds of thousands of short lines) cannot make the
// server burn CPU on rows times columns.

export const MAX_COLUMNS = 60;
// The header plus 20,000 data rows.
export const MAX_RECORDS = 20_001;

export interface CsvResult {
  headers: string[];
  rows: Record<string, string>[];
  // lines[i] is the physical line number (1-based) that rows[i] starts on.
  lines: number[];
}

// Exports put a quote in front of any text that starts with = + - @ (or a tab
// or carriage return) so a spreadsheet cannot run it as a formula (see
// exportData.ts, neutraliseFormula). The guard is reversible even for text that
// really starts with an apostrophe: the export adds one quote to any run of
// apostrophes that is followed by a formula character, and this removes exactly
// one. So "=A1" is exported as "'=A1" and read back as "=A1", and the text
// "'=A1" is exported as "''=A1" and read back as "'=A1".
function unguard(value: string): string {
  return /^'+[=+\-@\t\r]/.test(value) ? value.slice(1) : value;
}

export function parseCsv(input: string): CsvResult {
  const text = input.replace(/^﻿/, "");
  const records: { cells: string[]; line: number }[] = [];
  let field = "";
  let cells: string[] = [];
  let inQuotes = false;
  let i = 0;
  let line = 1; // the physical line the reader is on
  let recordLine = 1; // the line the current record started on

  const endField = () => {
    cells.push(field);
    field = "";
    if (cells.length > MAX_COLUMNS) {
      throw new Error(`The file has more than ${MAX_COLUMNS} columns. Bearing reads at most ${MAX_COLUMNS}; remove the columns you do not need.`);
    }
  };
  const endRecord = () => {
    endField();
    if (cells.some((c) => c.trim() !== "")) {
      records.push({ cells, line: recordLine });
      if (records.length > MAX_RECORDS) {
        throw new Error(`The file has more than ${MAX_RECORDS - 1} rows. Split it into smaller files.`);
      }
    }
    cells = [];
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
      // A line break inside a quoted cell stays in the cell but still moves the
      // physical line counter ("\r\n" counts once).
      if (ch === "\n" || (ch === "\r" && text[i + 1] !== "\n")) line++;
      field += ch;
      i++;
      continue;
    }
    // An opening quote may follow spaces or tabs (a, "x,y"): the spaces are not
    // part of the value.
    if (ch === '"' && /^[ \t]*$/.test(field)) {
      field = "";
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ",") {
      endField();
      i++;
      continue;
    }
    if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      endRecord();
      i++;
      line++;
      recordLine = line;
      continue;
    }
    field += ch;
    i++;
  }
  if (inQuotes) throw new Error("The file has a quoted value that is never closed.");
  if (field !== "" || cells.length > 0) endRecord();

  if (records.length === 0) return { headers: [], rows: [], lines: [] };
  const headers = records[0].cells.map((h) => h.trim().toLowerCase());
  const rows: Record<string, string>[] = [];
  const lines: number[] = [];
  for (let n = 1; n < records.length; n++) {
    const cellsOfRow = records[n].cells;
    const row: Record<string, string> = {};
    for (let h = 0; h < headers.length; h++) {
      row[headers[h]] = unguard((cellsOfRow[h] ?? "").trim());
    }
    rows.push(row);
    lines.push(records[n].line);
  }
  return { headers, rows, lines };
}

// Problems with the header row that make a file unsafe to read by column name.
// Called by the importer (not by the parser, which stays usable for the column
// mapping step, where a blank header is something a person can ignore).
export function headerProblems(headers: string[]): string[] {
  const problems: string[] = [];
  const empties = headers.filter((h) => h === "").length;
  if (empties > 0) problems.push(`${empties} column${empties === 1 ? " has" : "s have"} no name in the header row. Give every column a name, or delete the empty columns.`);
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const h of headers) {
    if (h === "") continue;
    if (seen.has(h)) dupes.add(h);
    seen.add(h);
  }
  if (dupes.size > 0) problems.push(`These column names appear more than once: ${[...dupes].join(", ")}. Each column needs its own name.`);
  return problems;
}
