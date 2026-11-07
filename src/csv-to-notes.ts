/**
 * Rows from a CSV / TSV / Quizlet export → notes createApkg takes. Pure: no
 * zip, no SQLite, no DOM.
 *
 * Every note is emitted as field HTML (`fieldHtml: true`): plain-text input is
 * escaped here, once, with line breaks turned into <br>; HTML input is passed
 * through unchanged. Callers that render fields must strip scripts themselves.
 */

import { toFieldHtml, type ApkgNote } from './notes';
import { MAX_ROWS, parseDelimited, type ParsedTable } from './csv-parse';

/** C0 control characters, which no deck or file name should carry. */
const CONTROL_CHARS = /[\u0000-\u001f]+/g;

export type ColumnMapping = {
  /** Column index for the card front (or cloze text). Required. */
  front: number;
  back: number | null;
  extra: number | null;
  tags: number | null;
};

export type CsvConversionOptions = {
  mapping: ColumnMapping;
  firstRowIsHeader: boolean;
  /** Treat cell text as HTML (Anki's "Allow HTML in fields"). */
  html: boolean;
  deckName: string;
  /** Added to every note, e.g. from an Anki `#tags:` header. */
  extraTags?: string[];
};

export type CsvConversion = {
  notes: ApkgNote[];
  noteCount: number;
  cardCount: number;
  clozeNotes: number;
  /** Rows dropped because the front cell was empty. */
  skippedEmpty: number;
  /** Basic notes whose back is empty (kept — Anki allows it — but worth a warning). */
  emptyBack: number;
  /** Data rows past MAX_ROWS that were left out (header row not counted). */
  overLimit: number;
};

const FRONT_NAMES = [
  'front',
  'término',
  'termino',
  'pregunta',
  'anverso',
  'palabra',
  '表面',
  '正面',
  '问题',
  '問題',
  '用語',
  '单词',
  '單字',
  '単語',
  '词语',
  'question',
  'term',
  'word',
  'prompt',
  'q',
  'text',
  'cloze',
  'expression',
  'vocab',
  'vocabulary',
];
const BACK_NAMES = [
  'back',
  'answer',
  'definition',
  'meaning',
  'a',
  'translation',
  'reading',
  'definición',
  'definicion',
  'respuesta',
  'reverso',
  'significado',
  'traducción',
  '裏面',
  '背面',
  '答案',
  '答え',
  '定義',
  '释义',
  '釋義',
  '意味',
];
const EXTRA_NAMES = [
  'extra',
  'back extra',
  'notes',
  'note',
  'explanation',
  'example',
  'hint',
  'context',
];
const TAG_NAMES = [
  'tags',
  'tag',
  'labels',
  'etiquetas',
  '标签',
  '標籤',
  'タグ',
];
const META_NAMES = ['guid', 'note type', 'notetype', 'deck', 'id'];

const norm = (cell: string) => cell.trim().toLowerCase().replace(/[_-]+/g, ' ');

function roleOf(name: string): keyof ColumnMapping | 'meta' | null {
  const n = norm(name);
  if (FRONT_NAMES.includes(n)) return 'front';
  if (BACK_NAMES.includes(n)) return 'back';
  if (EXTRA_NAMES.includes(n)) return 'extra';
  if (TAG_NAMES.includes(n)) return 'tags';
  if (META_NAMES.includes(n)) return 'meta';
  return null;
}

/** True when the first row reads as column names rather than a card. */
export function looksLikeHeaderRow(row: string[] | undefined): boolean {
  if (!row || row.length === 0) return false;
  const known = row.filter((cell) => roleOf(cell) !== null).length;
  return known >= Math.min(2, row.length);
}

export type MappingSuggestion = {
  mapping: ColumnMapping;
  firstRowIsHeader: boolean;
  html: boolean;
  /** Each column's name from the file, or null — the UI labels those "Column N". */
  columnNames: Array<string | null>;
  deckName?: string;
  extraTags: string[];
};

/**
 * Best first guess at the mapping. Anki file headers win (they are exact);
 * then a header row's names; otherwise column 1 → front, 2 → back, and every
 * other column is left out until the user maps it.
 */
export function suggestMapping(table: ParsedTable): MappingSuggestion {
  const width = Math.max(1, ...table.rows.slice(0, 50).map((r) => r.length));
  const h = table.headers;
  const reserved = new Set(
    [h.guidColumn, h.deckColumn, h.notetypeColumn]
      .filter((c): c is number => typeof c === 'number')
      .map((c) => c - 1)
  );
  const firstRowIsHeader = !h.columns && looksLikeHeaderRow(table.rows[0]);
  const names: string[] =
    h.columns ?? (firstRowIsHeader ? table.rows[0].map((c) => c.trim()) : []);
  const columnNames = Array.from(
    { length: Math.max(width, names.length) },
    (_, i) => names[i] || null
  );

  const mapping: ColumnMapping = {
    front: -1,
    back: null,
    extra: null,
    tags: h.tagsColumn ? h.tagsColumn - 1 : null,
  };
  if (mapping.tags !== null) reserved.add(mapping.tags);

  if (names.length > 0) {
    names.forEach((name, i) => {
      if (reserved.has(i)) return;
      const role = roleOf(name);
      if (role === 'meta') {
        reserved.add(i);
        return;
      }
      if (role === 'front' && mapping.front === -1) mapping.front = i;
      else if (role === 'back' && mapping.back === null) mapping.back = i;
      else if (role === 'extra' && mapping.extra === null) mapping.extra = i;
      else if (role === 'tags' && mapping.tags === null) mapping.tags = i;
    });
  }
  // Fall back to the first free columns, in order.
  const free = columnNames
    .map((_, i) => i)
    .filter(
      (i) =>
        !reserved.has(i) &&
        i !== mapping.back &&
        i !== mapping.extra &&
        i !== mapping.tags
    );
  if (mapping.front === -1) mapping.front = free[0] ?? 0;
  const remaining = free.filter((i) => i !== mapping.front);
  if (mapping.back === null && remaining.length > 0) {
    mapping.back = remaining.find((i) => i > mapping.front) ?? remaining[0];
  }

  return {
    mapping,
    firstRowIsHeader,
    html: h.html ?? false,
    columnNames,
    deckName: h.deck,
    extraTags: h.tags ?? [],
  };
}

/** Split a tags cell: Anki separates with spaces; spreadsheets often use commas. */
export function splitTagCell(cell: string): string[] {
  return cell
    .split(/[\s,;]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

const CLOZE = /\{\{c(\d+)::/g;

function clozeOrdinals(text: string): number[] {
  return [...new Set(Array.from(text.matchAll(CLOZE), (m) => Number(m[1])))];
}

/** A deck name Anki and every filesystem will accept. */
export function safeCsvDeckName(name: string | null | undefined): string {
  const cleaned = (name ?? '')
    .replace(/\.(csv|tsv|txt)$/i, '')
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(CONTROL_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return cleaned || 'Imported cards';
}

export function csvApkgFilename(deckName: string): string {
  return `${safeCsvDeckName(deckName).replace(/\s+/g, '-')}.apkg`;
}

/** Convert rows to notes. Throws only on an impossible mapping. */
export function rowsToNotes(
  rows: string[][],
  options: CsvConversionOptions
): CsvConversion {
  const { mapping } = options;
  if (!Number.isInteger(mapping.front) || mapping.front < 0) {
    throw new Error('Choose which column holds the front of the card.');
  }
  const allBody = options.firstRowIsHeader ? rows.slice(1) : rows;
  const body = allBody.slice(0, MAX_ROWS);
  const overLimit = allBody.length - body.length;
  const deck = safeCsvDeckName(options.deckName);
  const cell = (row: string[], index: number | null) =>
    index === null || index < 0 ? '' : (row[index] ?? '').trim();
  const asHtml = (text: string) => (options.html ? text : toFieldHtml(text));
  const seen = new Map<string, number>();

  const notes: ApkgNote[] = [];
  let cardCount = 0;
  let clozeNotes = 0;
  let skippedEmpty = 0;
  let emptyBack = 0;

  for (const row of body) {
    const frontText = cell(row, mapping.front);
    if (frontText === '') {
      skippedEmpty++;
      continue;
    }
    const backText = cell(row, mapping.back);
    const extraText = cell(row, mapping.extra);
    const tags = [
      ...splitTagCell(cell(row, mapping.tags)),
      ...(options.extraTags ?? []),
    ];
    const ords = clozeOrdinals(frontText);
    const isCloze = ords.length > 0;

    // Same front twice is two notes, not one: the writer dedupes by id.
    const key = `${deck}\u0000${frontText}`;
    const occurrence = seen.get(key) ?? 0;
    seen.set(key, occurrence + 1);

    if (isCloze) {
      clozeNotes++;
      cardCount += ords.length;
      // A cloze note has no Back field; whatever was mapped there is context,
      // so it moves to Extra rather than being dropped.
      const extra = [backText, extraText]
        .filter(Boolean)
        .map(asHtml)
        .join('<br>');
      notes.push({
        id: `csv:${key}:${occurrence}`,
        type: 'cloze',
        front: asHtml(frontText),
        back: '',
        extra,
        tags: [...new Set(tags)],
        fieldHtml: true,
      });
    } else {
      cardCount += 1;
      if (backText === '') emptyBack++;
      notes.push({
        id: `csv:${key}:${occurrence}`,
        type: 'basic',
        front: asHtml(frontText),
        back: asHtml(backText),
        extra: extraText ? asHtml(extraText) : '',
        tags: [...new Set(tags)],
        fieldHtml: true,
      });
    }
  }

  return {
    notes,
    noteCount: notes.length,
    cardCount,
    clozeNotes,
    skippedEmpty,
    emptyBack,
    overLimit,
  };
}

/** Parse CSV/TSV text (or raw rows) into notes ready for createApkg. */
export function csvToNotes(
  input: string | string[][],
  options: Partial<CsvConversionOptions> = {}
): CsvConversion {
  if (typeof input === 'string') {
    const table = parseDelimited(input);
    const suggestion = suggestMapping(table);
    return rowsToNotes(table.rows, {
      mapping: options.mapping ?? suggestion.mapping,
      firstRowIsHeader: options.firstRowIsHeader ?? suggestion.firstRowIsHeader,
      html: options.html ?? suggestion.html,
      deckName: options.deckName ?? suggestion.deckName ?? 'Imported cards',
      extraTags: options.extraTags ?? suggestion.extraTags,
    });
  }
  const mapping = options.mapping;
  if (!mapping) {
    throw new Error('mapping is required when converting raw rows.');
  }
  return rowsToNotes(input, {
    mapping,
    firstRowIsHeader: options.firstRowIsHeader ?? false,
    html: options.html ?? false,
    deckName: options.deckName ?? 'Imported cards',
    extraTags: options.extraTags,
  });
}
