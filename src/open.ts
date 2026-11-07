/**
 * Open an .apkg / .colpkg: unzip → optional zstd → sql.js → notes/cards/decks
 * / note types / media. Same path as the original viewer, without rendering.
 */

import JSZip from 'jszip';
import { ApkgError } from './errors';
import { parseAnkiCollection } from './parse-collection';
import type { InitSqlJs } from './sql';
import type {
  ApkgCollectionFormat,
  ApkgMediaFile,
  ParsedAnkiCollection,
} from './types';
import {
  APKG_MAX_FILE_BYTES,
  extractCollectionFromZip,
  loadMediaFromZip,
} from './zip';

export type OpenApkgOptions = {
  initSqlJs?: InitSqlJs;
};

export type OpenedApkg = {
  format: ApkgCollectionFormat;
  parsed: ParsedAnkiCollection;
  notes: ParsedAnkiCollection['notes'];
  cards: ParsedAnkiCollection['cards'];
  decks: ParsedAnkiCollection['decks'];
  notetypes: ParsedAnkiCollection['notetypes'];
  media: ApkgMediaFile[];
};

export async function openApkg(
  data: Uint8Array | ArrayBuffer,
  options: OpenApkgOptions = {}
): Promise<OpenedApkg> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.byteLength > APKG_MAX_FILE_BYTES) {
    throw new ApkgError(
      `This file is larger than ${APKG_MAX_FILE_BYTES / (1024 * 1024)} MB.`
    );
  }
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    throw new ApkgError(
      'That file is not a valid .apkg / .colpkg (could not open it as a zip package).'
    );
  }
  const { bytes: collection, format } = await extractCollectionFromZip(zip);
  const mediaMap = await loadMediaFromZip(zip);
  let parsed: ParsedAnkiCollection;
  try {
    parsed = await parseAnkiCollection(collection, options.initSqlJs);
  } catch (err) {
    throw new ApkgError(
      err instanceof Error
        ? `Could not read the Anki collection: ${err.message}`
        : 'Could not read the Anki collection inside this package.'
    );
  }
  return {
    format,
    parsed,
    notes: parsed.notes,
    cards: parsed.cards,
    decks: parsed.decks,
    notetypes: parsed.notetypes,
    media: [...mediaMap.values()].map((entry) => ({
      filename: entry.filename,
      data: entry.bytes,
    })),
  };
}
