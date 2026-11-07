/**
 * A parsed Anki collection → spreadsheet rows / CSV text. Pure: takes the
 * `ParsedAnkiCollection` openApkg already produces.
 *
 * Column layout follows Anki's own "Notes in Plain Text" export: GUID, note
 * type, deck, the note's fields (padded to the widest note type so the tags
 * column stays put), then tags. With `ankiHeaders` the file carries the
 * `#separator`, `#html`, `#columns` and `#… column` headers Anki 2.1.54+
 * reads, so importing the file back maps every column on its own — and,
 * because the GUID column is there, updates the original notes instead of
 * adding duplicates (Anki manual, "Importing text files → GUID column").
 */

import { parseNoteFields, splitAnkiTags } from './fields';
import type { ParsedAnkiCollection, ParsedAnkiNotetype } from './types';

/** C0 control characters, which no deck or file name should carry. */
const CONTROL_CHARS = /[\u0000-\u001f]+/g;

export type CsvDelimiter = ',' | '\t' | ';';

export type ApkgRowOptions = {
  delimiter: CsvDelimiter;
  /** Keep field HTML (and [sound:] / <img> references) instead of plain text. */
  keepHtml: boolean;
  /** First row = column names. Ignored when `ankiHeaders` is on (#columns replaces it). */
  headerRow: boolean;
  includeGuid: boolean;
  includeNotetype: boolean;
  includeDeck: boolean;
  includeTags: boolean;
  /** Write Anki's import headers at the top of the file. */
  ankiHeaders: boolean;
  /**
   * Prefix cells that start with = + - @ with an apostrophe so a spreadsheet
   * does not evaluate them as formulas (OWASP "CSV injection"). Off for Anki
   * round-trip files, where the text must come back byte-for-byte.
   */
  protectFormulas: boolean;
  /** Only these note type ids; empty / omitted = all. */
  notetypeIds?: string[];
};

export const SPREADSHEET_PRESET: ApkgRowOptions = {
  delimiter: ',',
  keepHtml: false,
  headerRow: true,
  includeGuid: false,
  includeNotetype: false,
  includeDeck: true,
  includeTags: true,
  ankiHeaders: false,
  protectFormulas: true,
};

export const ANKI_ROUND_TRIP_PRESET: ApkgRowOptions = {
  delimiter: '\t',
  keepHtml: true,
  headerRow: false,
  includeGuid: true,
  includeNotetype: true,
  includeDeck: true,
  includeTags: true,
  ankiHeaders: true,
  protectFormulas: false,
};

export type NotetypeSummary = {
  id: string;
  name: string;
  fields: string[];
  noteCount: number;
  isCloze: boolean;
};

export type ApkgTable = {
  columns: string[];
  rows: string[][];
  /** Lines written before the data (Anki headers), already formatted. */
  headerLines: string[];
  noteCount: number;
  notetypes: NotetypeSummary[];
  /** Notes whose fields reference media files (not included in a CSV). */
  notesWithMedia: number;
};

const MEDIA_REF = /<(?:img)\b[^>]*\bsrc\s*=|\[sound:[^\]]+\]/i;

/** Anki field HTML → readable plain text, keeping line breaks and cloze markup. */
export function fieldHtmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/\[sound:[^\]]+\]/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(div|p|li|h[1-6]|tr)>/gi, '\n')
      .replace(/<li\b[^>]*>/gi, '• ')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function decodeEntities(text: string): string {
  return text.replace(
    /&(#x[0-9a-f]+|#\d+|nbsp|amp|lt|gt|quot|apos|#39);/gi,
    (match, code: string) => {
      const c = code.toLowerCase();
      if (c === 'nbsp') return ' ';
      if (c === 'amp') return '&';
      if (c === 'lt') return '<';
      if (c === 'gt') return '>';
      if (c === 'quot') return '"';
      if (c === 'apos' || c === '#39') return "'";
      const n =
        c[1] === 'x'
          ? Number.parseInt(c.slice(2), 16)
          : Number.parseInt(c.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff
        ? String.fromCodePoint(n)
        : match;
    }
  );
}

export function summarizeNotetypes(
  parsed: ParsedAnkiCollection
): NotetypeSummary[] {
  const counts = new Map<string, number>();
  for (const note of parsed.notes) {
    counts.set(note.notetypeAnkiId, (counts.get(note.notetypeAnkiId) ?? 0) + 1);
  }
  return parsed.notetypes
    .map((nt) => ({
      id: nt.ankiId,
      name: nt.name,
      fields: sortedFields(nt),
      noteCount: counts.get(nt.ankiId) ?? 0,
      isCloze: nt.type === 1,
    }))
    .filter((nt) => nt.noteCount > 0)
    .sort((a, b) => b.noteCount - a.noteCount || a.name.localeCompare(b.name));
}

function sortedFields(nt: ParsedAnkiNotetype): string[] {
  return nt.fields
    .slice()
    .sort((a, b) => a.ord - b.ord)
    .map((f) => f.name);
}

/** Build the table. Notes come out in creation order (Anki note id). */
export function apkgToTable(
  parsed: ParsedAnkiCollection,
  options: ApkgRowOptions
): ApkgTable {
  const wanted =
    options.notetypeIds && options.notetypeIds.length > 0
      ? new Set(options.notetypeIds)
      : null;
  const notetypes = summarizeNotetypes(parsed).filter(
    (nt) => !wanted || wanted.has(nt.id)
  );
  const byId = new Map(parsed.notetypes.map((nt) => [nt.ankiId, nt]));
  const deckById = new Map(
    parsed.decks.map((d) => [d.ankiId, d.fullName || d.name])
  );
  // A note's deck = the deck of its first card, as Anki's own export does.
  const deckOfNote = new Map<string, string>();
  const firstOrd = new Map<string, number>();
  for (const card of parsed.cards) {
    const prev = firstOrd.get(card.noteAnkiId);
    if (prev === undefined || card.ord < prev) {
      firstOrd.set(card.noteAnkiId, card.ord);
      deckOfNote.set(card.noteAnkiId, deckById.get(card.deckAnkiId) ?? '');
    }
  }

  const fieldWidth = Math.max(1, ...notetypes.map((nt) => nt.fields.length));
  const sameFields =
    notetypes.length === 1 ||
    notetypes.every(
      (nt) => nt.fields.join('\u0000') === notetypes[0]?.fields.join('\u0000')
    );
  const fieldNames = Array.from({ length: fieldWidth }, (_, i) =>
    sameFields && notetypes[0]?.fields[i]
      ? notetypes[0].fields[i]
      : `Field ${i + 1}`
  );

  const columns = [
    ...(options.includeGuid ? ['GUID'] : []),
    ...(options.includeNotetype ? ['Note type'] : []),
    ...(options.includeDeck ? ['Deck'] : []),
    ...fieldNames,
    ...(options.includeTags ? ['Tags'] : []),
  ];

  const text = (value: string) =>
    options.keepHtml ? value : fieldHtmlToText(value);

  let notesWithMedia = 0;
  const rows: string[][] = [];
  const notes = parsed.notes
    .filter((n) => !wanted || wanted.has(n.notetypeAnkiId))
    .slice()
    .sort((a, b) => compareIds(a.ankiId, b.ankiId));
  for (const note of notes) {
    const nt = byId.get(note.notetypeAnkiId);
    if (!nt) continue;
    const fields = parseNoteFields(note.fields, nt.fields).map((f) => f.value);
    if (fields.some((f) => MEDIA_REF.test(f))) notesWithMedia++;
    const padded = Array.from({ length: fieldWidth }, (_, i) =>
      text(fields[i] ?? '')
    );
    rows.push([
      ...(options.includeGuid ? [note.guid] : []),
      ...(options.includeNotetype ? [nt.name] : []),
      ...(options.includeDeck ? [deckOfNote.get(note.ankiId) ?? ''] : []),
      ...padded,
      ...(options.includeTags ? [splitAnkiTags(note.tags).join(' ')] : []),
    ]);
  }

  const headerLines: string[] = [];
  if (options.ankiHeaders) {
    const sep = separatorName(options.delimiter);
    headerLines.push(`#separator:${sep}`);
    headerLines.push(`#html:${options.keepHtml ? 'true' : 'false'}`);
    headerLines.push(
      `#columns:${columns.map((c) => c.replaceAll(options.delimiter, ' ')).join(options.delimiter)}`
    );
    let col = 1;
    if (options.includeGuid) headerLines.push(`#guid column:${col++}`);
    if (options.includeNotetype) headerLines.push(`#notetype column:${col++}`);
    if (options.includeDeck) headerLines.push(`#deck column:${col++}`);
    if (options.includeTags) {
      headerLines.push(`#tags column:${columns.length}`);
    }
  }

  return {
    columns,
    rows,
    headerLines,
    noteCount: rows.length,
    notetypes,
    notesWithMedia,
  };
}

function compareIds(a: string, b: string): number {
  if (a.length !== b.length) return a.length - b.length;
  return a < b ? -1 : a > b ? 1 : 0;
}

function separatorName(delimiter: CsvDelimiter): string {
  return delimiter === '\t' ? 'Tab' : delimiter === ';' ? 'Semicolon' : 'Comma';
}

const FORMULA_START = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^[+-]?\d[\d.,]*%?$/;

/** RFC 4180 quoting; optional spreadsheet formula guard. */
export function csvCell(
  value: string,
  delimiter: CsvDelimiter,
  protectFormulas: boolean
): string {
  let v = value;
  if (protectFormulas && FORMULA_START.test(v) && !PLAIN_NUMBER.test(v)) {
    v = `'${v}`;
  }
  const needsQuotes =
    v.includes(delimiter) ||
    v.includes('"') ||
    v.includes('\n') ||
    v.includes('\r') ||
    /^\s|\s$/.test(v);
  return needsQuotes ? `"${v.replace(/"/g, '""')}"` : v;
}

/**
 * The file text. CRLF line endings (RFC 4180; what Excel writes). The BOM is
 * prepended by the caller when building a Blob — Excel needs it to read
 * UTF-8, Anki ignores it.
 */
export function tableToCsv(table: ApkgTable, options: ApkgRowOptions): string {
  const lines = [...table.headerLines];
  const line = (cells: string[]) =>
    cells
      .map((c) => csvCell(c, options.delimiter, options.protectFormulas))
      .join(options.delimiter);
  if (options.headerRow && !options.ankiHeaders)
    lines.push(line(table.columns));
  for (const row of table.rows) lines.push(line(row));
  return `${lines.join('\r\n')}\r\n`;
}

export const UTF8_BOM = '\uFEFF';

export function csvFilename(
  sourceName: string,
  delimiter: CsvDelimiter
): string {
  const base =
    sourceName
      .replace(/\.(apkg|colpkg)$/i, '')
      .replace(/[\\/:*?"<>|]+/g, ' ')
      .replace(CONTROL_CHARS, ' ')
      .trim()
      .slice(0, 80) || 'anki-deck';
  return `${base}.${delimiter === '\t' ? 'tsv' : 'csv'}`;
}

/** One row per note. */
export function apkgToRows(
  parsed: ParsedAnkiCollection,
  options: Partial<ApkgRowOptions> = {}
): ApkgTable {
  const opts = { ...SPREADSHEET_PRESET, ...options };
  return apkgToTable(parsed, opts);
}

export function apkgToCsv(
  parsed: ParsedAnkiCollection,
  options: Partial<ApkgRowOptions> = {}
): string {
  const opts = { ...SPREADSHEET_PRESET, ...options };
  return tableToCsv(apkgToTable(parsed, opts), opts);
}
