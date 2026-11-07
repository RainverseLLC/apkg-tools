/**
 * Delimited-text parsing for CSV → Anki conversion. Pure and synchronous so
 * it runs in Node tests and in the browser without a dependency.
 *
 * Two readers, because the inputs really are different:
 *
 * - `parseDelimited` is RFC 4180: quoted fields, doubled quotes, line breaks
 *   inside quotes, CRLF / LF / CR. It also reads the `#key:value` file headers
 *   Anki 2.1.54+ writes and accepts (#separator, #html, #columns, #tags column,
 *   #deck, #guid column …), so a file exported from Anki or from apkgToCsv
 *   maps itself.
 * - `parseSeparated` is the plain split Quizlet's Export produces: one string
 *   between term and definition, one between cards, no quoting at all. Running
 *   that text through the CSV reader would break on any definition that
 *   happens to start with a quote mark.
 */

import { CsvParseError } from './errors';

export type Delimiter = ',' | ';' | '\t' | '|';

export const DELIMITERS: readonly Delimiter[] = ['\t', ';', ',', '|'];

/** Hard caps: the converter runs on phones, and a deck past this is a job for Anki Desktop. */
export const MAX_INPUT_CHARS = 20 * 1024 * 1024;
export const MAX_ROWS = 10_000;
/** Rows read from a file: MAX_ROWS cards plus a possible header row. */
export const MAX_PARSE_ROWS = MAX_ROWS + 1;
export const MAX_COLUMNS = 50;

export type AnkiFileHeaders = {
  separator?: Delimiter;
  html?: boolean;
  /** Column names from `#columns:` (split on the separator). */
  columns?: string[];
  /** Tags added to every note (`#tags:`). */
  tags?: string[];
  deck?: string;
  notetype?: string;
  /** 1-based column numbers, exactly as Anki writes them. */
  tagsColumn?: number;
  deckColumn?: number;
  notetypeColumn?: number;
  guidColumn?: number;
};

export type ParsedTable = {
  rows: string[][];
  delimiter: Delimiter;
  headers: AnkiFileHeaders;
  /** Rows past MAX_PARSE_ROWS that were not read. */
  truncatedRows: number;
  /** Rows that had more than MAX_COLUMNS fields (extra fields dropped). */
  wideRows: number;
  /** A quoted field was still open at the end of the file. */
  unterminatedQuote: boolean;
};

const SEPARATOR_NAMES: Record<string, Delimiter> = {
  comma: ',',
  semicolon: ';',
  tab: '\t',
  pipe: '|',
  ',': ',',
  ';': ';',
  '\t': '\t',
  '|': '|',
};

/** Strip a UTF-8 byte-order mark (Excel writes one). */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

const HEADER_LINE = /^#([a-z][a-z ]*):(.*)$/i;

/**
 * Read Anki's `#key:value` headers from the top of the file. Only a leading
 * run of header lines counts; a later line that starts with `#` is data
 * (a card about C# or a hashtag), not a header.
 */
export function readAnkiHeaders(text: string): {
  headers: AnkiFileHeaders;
  body: string;
} {
  const headers: AnkiFileHeaders = {};
  let offset = 0;
  const rawColumns: string[] = [];
  while (offset < text.length) {
    const end = nextLineEnd(text, offset);
    const line = text.slice(offset, end.index);
    const match = HEADER_LINE.exec(line);
    if (!match) break;
    const key = match[1].trim().toLowerCase();
    const value = match[2];
    applyHeader(headers, key, value, rawColumns);
    offset = end.next;
  }
  if (rawColumns.length > 0) {
    const sep = headers.separator ?? guessDelimiter(rawColumns[0]);
    headers.columns = rawColumns[0].split(sep).map((c) => c.trim());
  }
  return { headers, body: text.slice(offset) };
}

function applyHeader(
  headers: AnkiFileHeaders,
  key: string,
  value: string,
  rawColumns: string[]
) {
  const trimmed = value.trim();
  const column = () => {
    const n = Number.parseInt(trimmed, 10);
    return Number.isInteger(n) && n > 0 ? n : undefined;
  };
  switch (key) {
    case 'separator': {
      const sep =
        SEPARATOR_NAMES[trimmed.toLowerCase()] ?? SEPARATOR_NAMES[value];
      if (sep) headers.separator = sep;
      return;
    }
    case 'html':
      headers.html = trimmed.toLowerCase() === 'true';
      return;
    case 'columns':
      rawColumns.push(value);
      return;
    case 'tags':
      headers.tags = trimmed.split(/\s+/).filter(Boolean);
      return;
    case 'deck':
      if (trimmed) headers.deck = trimmed;
      return;
    case 'notetype':
      if (trimmed) headers.notetype = trimmed;
      return;
    case 'tags column':
      headers.tagsColumn = column();
      return;
    case 'deck column':
      headers.deckColumn = column();
      return;
    case 'notetype column':
      headers.notetypeColumn = column();
      return;
    case 'guid column':
      headers.guidColumn = column();
      return;
    default:
      // Unknown headers are ignored, as Anki does.
      return;
  }
}

function nextLineEnd(
  text: string,
  from: number
): { index: number; next: number } {
  for (let i = from; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\n') return { index: i, next: i + 1 };
    if (ch === '\r') {
      return { index: i, next: text[i + 1] === '\n' ? i + 2 : i + 1 };
    }
  }
  return { index: text.length, next: text.length };
}

/**
 * Pick the delimiter that splits the first lines into the most consistent
 * number of columns (>1). Quoted text is skipped, so a comma inside a quoted
 * definition does not vote for comma. Ties go to tab, then semicolon, then
 * comma — tab is what Quizlet and Anki both default to, and a stray comma in
 * prose is far more common than a stray tab.
 */
export function guessDelimiter(sample: string): Delimiter {
  const lines = sample
    .slice(0, 64 * 1024)
    .split(/\r\n|\n|\r/)
    .filter((l) => l.trim() !== '')
    .slice(0, 20);
  let best: Delimiter = ',';
  let bestScore = -1;
  for (const delimiter of DELIMITERS) {
    const counts = lines.map((line) => countUnquoted(line, delimiter));
    const withSplit = counts.filter((c) => c > 0);
    if (withSplit.length === 0) continue;
    const mode = modeOf(withSplit);
    const consistent = counts.filter((c) => c === mode).length;
    // Lines that agree on the column count dominate; total coverage breaks ties.
    const score = consistent * 1000 + withSplit.length;
    if (score > bestScore) {
      best = delimiter;
      bestScore = score;
    }
  }
  return best;
}

function countUnquoted(line: string, delimiter: string): number {
  let inQuotes = false;
  let count = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && ch === delimiter) count++;
  }
  return count;
}

function modeOf(values: number[]): number {
  const freq = new Map<number, number>();
  for (const v of values) freq.set(v, (freq.get(v) ?? 0) + 1);
  let mode = values[0];
  let best = 0;
  for (const [v, n] of freq) {
    if (n > best) {
      mode = v;
      best = n;
    }
  }
  return mode;
}

/**
 * RFC 4180 reader with Anki header support. `delimiter: 'auto'` honours a
 * `#separator:` header first, then guesses.
 */
export function parseDelimited(
  input: string,
  options: { delimiter?: Delimiter | 'auto' } = {}
): ParsedTable {
  if (input.length > MAX_INPUT_CHARS) {
    throw new CsvParseError(
      `This file is ${Math.round(input.length / (1024 * 1024))} MB of text — the limit here is ${MAX_INPUT_CHARS / (1024 * 1024)} MB. Split it into smaller files.`
    );
  }
  const { headers, body } = readAnkiHeaders(stripBom(input));
  const delimiter =
    options.delimiter && options.delimiter !== 'auto'
      ? options.delimiter
      : (headers.separator ?? guessDelimiter(body));

  const rows: string[][] = [];
  let truncatedRows = 0;
  let wideRows = 0;
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let fieldStarted = false;

  const pushRow = () => {
    row.push(field);
    field = '';
    fieldStarted = false;
    // A line with nothing on it is a blank line, not a one-empty-field row.
    if (!(row.length === 1 && row[0] === '')) {
      if (rows.length >= MAX_PARSE_ROWS) truncatedRows++;
      else {
        if (row.length > MAX_COLUMNS) {
          wideRows++;
          row = row.slice(0, MAX_COLUMNS);
        }
        rows.push(row);
      }
    }
    row = [];
  };

  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (inQuotes) {
      if (ch === '"') {
        if (body[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"' && !fieldStarted) {
      inQuotes = true;
      fieldStarted = true;
      continue;
    }
    if (ch === delimiter) {
      row.push(field);
      field = '';
      fieldStarted = false;
      continue;
    }
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && body[i + 1] === '\n') i++;
      pushRow();
      continue;
    }
    field += ch;
    fieldStarted = true;
  }
  const unterminatedQuote = inQuotes;
  if (field !== '' || row.length > 0 || fieldStarted) pushRow();

  return {
    rows,
    delimiter,
    headers,
    truncatedRows,
    wideRows,
    unterminatedQuote,
  };
}

/** Alias used in the public API. */
export const parseCsv = parseDelimited;

/**
 * Plain two-part split for Quizlet-style exports: `fieldSeparator` between
 * term and definition, `rowSeparator` between cards. Each card splits at the
 * FIRST field separator, so a definition may itself contain the separator.
 */
export function parseSeparated(
  input: string,
  options: { fieldSeparator: string; rowSeparator: string }
): ParsedTable {
  if (input.length > MAX_INPUT_CHARS) {
    throw new CsvParseError(
      `That is ${Math.round(input.length / (1024 * 1024))} MB of text — the limit here is ${MAX_INPUT_CHARS / (1024 * 1024)} MB.`
    );
  }
  const { fieldSeparator, rowSeparator } = options;
  if (!fieldSeparator || !rowSeparator) {
    throw new CsvParseError('Choose both separators first.');
  }
  if (fieldSeparator === rowSeparator) {
    throw new CsvParseError(
      'The separator between term and definition has to differ from the one between cards.'
    );
  }
  const text = stripBom(input).replace(/\r\n?/g, '\n');
  const chunks = text.split(rowSeparator === '\n' ? /\n/ : rowSeparator);
  const rows: string[][] = [];
  let truncatedRows = 0;
  for (const chunk of chunks) {
    if (chunk.trim() === '') continue;
    const at = chunk.indexOf(fieldSeparator);
    const cells =
      at === -1
        ? [chunk.trim()]
        : [
            chunk.slice(0, at).trim(),
            chunk.slice(at + fieldSeparator.length).trim(),
          ];
    if (rows.length >= MAX_PARSE_ROWS) truncatedRows++;
    else rows.push(cells);
  }
  const delimiter: Delimiter = fieldSeparator === '\t' ? '\t' : ',';
  return {
    rows,
    delimiter,
    headers: {},
    truncatedRows,
    wideRows: 0,
    unterminatedQuote: false,
  };
}
