import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { decodeMediaIndex } from '../src/media';
import { openApkg } from '../src/open';
import { parseAnkiCollection } from '../src/parse-collection';
import { APKG_MAX_FILE_BYTES, extractCollectionFromZip, loadMediaFromZip } from '../src/zip';
import { ApkgError } from '../src/errors';
import { modernCollectionBytes } from './helpers';

async function zipCollection(opts: {
  collectionName?: 'collection.anki2' | 'collection.anki21';
  collection?: Uint8Array;
  mediaMap?: Record<string, string>;
  mediaFiles?: Record<string, Uint8Array>;
}): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    opts.collectionName ?? 'collection.anki2',
    opts.collection ?? modernCollectionBytes()
  );
  zip.file('media', JSON.stringify(opts.mediaMap ?? {}));
  for (const [name, bytes] of Object.entries(opts.mediaFiles ?? {})) {
    zip.file(name, bytes);
  }
  return new Uint8Array(await zip.generateAsync({ type: 'uint8array' }));
}

describe('openApkg', () => {
  it('reads notes, cards, decks, note types and media', async () => {
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    const bytes = await zipCollection({
      mediaMap: { '0': 'diagram.png' },
      mediaFiles: { '0': png },
    });
    const opened = await openApkg(bytes);
    expect(opened.format).toBe('anki2');
    expect(opened.notes.length).toBeGreaterThan(0);
    expect(opened.cards.length).toBeGreaterThan(0);
    expect(opened.notetypes.length).toBeGreaterThan(0);
    expect(opened.decks.length).toBeGreaterThan(0);
    expect(opened.media).toEqual([{ filename: 'diagram.png', data: png }]);
  });

  it('rejects non-zip and zip-without-collection', async () => {
    await expect(openApkg(new Uint8Array([1, 2, 3]))).rejects.toBeInstanceOf(
      ApkgError
    );

    const empty = new JSZip();
    empty.file('readme.txt', 'hi');
    const emptyBytes = new Uint8Array(
      await empty.generateAsync({ type: 'uint8array' })
    );
    await expect(openApkg(emptyBytes)).rejects.toBeInstanceOf(ApkgError);
  });

  it('rejects oversized packages', async () => {
    expect(APKG_MAX_FILE_BYTES).toBe(100 * 1024 * 1024);
    const huge = {
      byteLength: APKG_MAX_FILE_BYTES + 1,
    } as unknown as Uint8Array;
    await expect(openApkg(huge)).rejects.toMatchObject({
      name: 'ApkgError',
    });
  });
});

describe('extractCollectionFromZip / loadMediaFromZip', () => {
  it('extracts collection.anki2 and media map entries', async () => {
    const zip = new JSZip();
    zip.file('collection.anki2', modernCollectionBytes());
    zip.file('media', JSON.stringify({ '0': 'a.png' }));
    zip.file('0', new Uint8Array([1, 2, 3]));
    const { bytes, format } = await extractCollectionFromZip(zip);
    expect(format).toBe('anki2');
    const parsed = await parseAnkiCollection(bytes);
    expect(parsed.notes.length).toBeGreaterThan(0);

    const media = await loadMediaFromZip(zip);
    expect(media.get('a.png')?.bytes).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('prefers collection.anki21 when anki2 is absent', async () => {
    const zip = new JSZip();
    zip.file('collection.anki21', modernCollectionBytes());
    zip.file('media', '{}');
    const { format } = await extractCollectionFromZip(zip);
    expect(format).toBe('anki21');
  });

  it('decodes protobuf media indexes, including sparse legacy indexes and zstd media', async () => {
    const proto = new Uint8Array([
      10, 14, 10, 5, 97, 46, 112, 110, 103, 16, 3, 26, 3, 1, 2, 3,
    ]);
    expect(decodeMediaIndex(proto)).toEqual({ 0: 'a.png' });
    const sparse = new Uint8Array([
      10, 10, 10, 5, 97, 46, 112, 110, 103, 248, 15, 7,
    ]);
    expect(decodeMediaIndex(sparse)).toEqual({ 7: 'a.png' });
    const zstd = (data: Uint8Array) =>
      new Uint8Array([
        0x28,
        0xb5,
        0x2f,
        0xfd,
        0x20,
        data.length,
        (data.length << 3) | 1,
        0,
        0,
        ...data,
      ]);
    const zip = new JSZip();
    zip.file('media', zstd(proto));
    zip.file('0', zstd(new Uint8Array([1, 2, 3])));
    expect((await loadMediaFromZip(zip)).get('a.png')?.bytes).toEqual(
      new Uint8Array([1, 2, 3])
    );
  });

  it('keeps cards usable with missing, malformed or incomplete media', async () => {
    const zip = new JSZip();
    expect(await loadMediaFromZip(zip)).toEqual(new Map());
    zip.file('media', new Uint8Array([10, 255]));
    const warnings: string[] = [];
    expect(await loadMediaFromZip(zip, warnings)).toEqual(new Map());
    expect(warnings).toHaveLength(1);
    zip.file('media', JSON.stringify({ 0: 'absent.png', 1: 42 }));
    expect(await loadMediaFromZip(zip)).toEqual(new Map());
  });
});
