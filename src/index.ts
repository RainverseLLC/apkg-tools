export { ApkgError, CsvParseError } from './errors';
export type { InitSqlJs } from './sql';

export type {
  AnkiFieldDef,
  AnkiMediaUpload,
  AnkiTemplateDef,
  ApkgCollectionFormat,
  ApkgMediaFile,
  ParsedAnkiCard,
  ParsedAnkiCollection,
  ParsedAnkiDeck,
  ParsedAnkiNote,
  ParsedAnkiNotetype,
  ParsedAnkiRevlog,
} from './types';

export { parseNoteFields, splitAnkiTags } from './fields';
export {
  FLASHIFY_BASIC,
  FLASHIFY_CLOZE,
  isClozeNote,
  noteToFields,
  toFieldHtml,
  type AnkiNoteTypeSpec,
  type ApkgNote,
} from './notes';

export { decodeMediaIndex, maybeDecompressMedia } from './media';
export { parseAnkiCollection } from './parse-collection';
export {
  APKG_MAX_FILE_BYTES,
  APKG_MAX_SQLITE_BYTES,
  extractCollectionFromZip,
  loadMediaFromZip,
} from './zip';
export { openApkg, type OpenApkgOptions, type OpenedApkg } from './open';
export { createApkg, type CreateApkgOptions } from './create';

export {
  DELIMITERS,
  MAX_COLUMNS,
  MAX_INPUT_CHARS,
  MAX_PARSE_ROWS,
  MAX_ROWS,
  guessDelimiter,
  parseCsv,
  parseDelimited,
  parseSeparated,
  readAnkiHeaders,
  stripBom,
  type AnkiFileHeaders,
  type Delimiter,
  type ParsedTable,
} from './csv-parse';

export {
  csvApkgFilename,
  csvToNotes,
  looksLikeHeaderRow,
  rowsToNotes,
  safeCsvDeckName,
  splitTagCell,
  suggestMapping,
  type ColumnMapping,
  type CsvConversion,
  type CsvConversionOptions,
  type MappingSuggestion,
} from './csv-to-notes';

export {
  ANKI_ROUND_TRIP_PRESET,
  SPREADSHEET_PRESET,
  UTF8_BOM,
  apkgToCsv,
  apkgToRows,
  apkgToTable,
  csvCell,
  csvFilename,
  fieldHtmlToText,
  summarizeNotetypes,
  tableToCsv,
  type ApkgRowOptions,
  type ApkgTable,
  type CsvDelimiter,
  type NotetypeSummary,
} from './apkg-to-rows';
