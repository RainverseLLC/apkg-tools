import JSZip from 'jszip';
import { decompress } from 'fzstd';
import { ApkgError } from './errors';
import { decodeMediaIndex, maybeDecompressMedia } from './media';
import type { ApkgCollectionFormat } from './types';

/** Cap for the uploaded package (zip). */
export const APKG_MAX_FILE_BYTES = 100 * 1024 * 1024;
/** Cap for decompressed collection SQLite. */
export const APKG_MAX_SQLITE_BYTES = 64 * 1024 * 1024;

export type MediaEntry = {
  filename: string;
  bytes: Uint8Array;
};

const COLLECTION_CANDIDATES: Array<{
  name: string;
  format: ApkgCollectionFormat;
  zstd: boolean;
}> = [
  { name: 'collection.anki21b', format: 'anki21b', zstd: true },
  { name: 'collection.anki21', format: 'anki21', zstd: false },
  { name: 'collection.anki2', format: 'anki2', zstd: false },
];

export async function extractCollectionFromZip(zip: JSZip): Promise<{
  bytes: Uint8Array;
  format: ApkgCollectionFormat;
}> {
  for (const candidate of COLLECTION_CANDIDATES) {
    const entry = zip.file(candidate.name);
    if (!entry) continue;
    let bytes = await entry.async('uint8array');
    if (candidate.zstd) {
      try {
        bytes = decompress(bytes);
      } catch {
        throw new ApkgError(
          'Could not decompress the zstd collection (.anki21b) inside this package.'
        );
      }
    }
    if (bytes.byteLength > APKG_MAX_SQLITE_BYTES) {
      throw new ApkgError(
        `The collection inside this package is too large to open (max ${Math.floor(APKG_MAX_SQLITE_BYTES / (1024 * 1024))} MB).`
      );
    }
    return { bytes, format: candidate.format };
  }
  throw new ApkgError(
    'No Anki collection found inside this file — is it really an .apkg / .colpkg export?'
  );
}

/**
 * Read the package media map (`media` JSON: index → filename) and zip
 * entries named by index. Returns filename → bytes.
 */
export async function loadMediaFromZip(
  zip: JSZip,
  warnings: string[] = []
): Promise<Map<string, MediaEntry>> {
  const out = new Map<string, MediaEntry>();
  const mediaFile = zip.file('media');
  if (!mediaFile) return out;

  let map: Record<string, string> = {};
  try {
    map = decodeMediaIndex(await mediaFile.async('uint8array'));
  } catch {
    warnings.push(
      'The media index could not be read. Cards remain available; missing media is shown as a placeholder.'
    );
    return out;
  }

  for (const [index, filename] of Object.entries(map)) {
    if (typeof filename !== 'string' || !filename) continue;
    const entry = zip.file(String(index));
    if (!entry) continue;
    try {
      const bytes = maybeDecompressMedia(await entry.async('uint8array'));
      out.set(filename, { filename, bytes });
    } catch {
      // skip unreadable media
    }
  }
  return out;
}
