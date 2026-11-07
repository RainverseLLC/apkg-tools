/**
 * End to end through the real writer and the real reader:
 * CSV text → notes → createApkg → openApkg, and
 * .apkg (including zstd .anki21b) → CSV → CSV parser.
 */
import { readFileSync } from 'node:fs';
import zlib from 'node:zlib';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { ANKI_ROUND_TRIP_PRESET, SPREADSHEET_PRESET } from '../src/apkg-to-rows';
import { apkgToTable, tableToCsv } from '../src/apkg-to-rows';
import { createApkg } from '../src/create';
import { parseDelimited, parseSeparated } from '../src/csv-parse';
import { rowsToNotes, suggestMapping } from '../src/csv-to-notes';
import { openApkg } from '../src/open';

describe('CSV → .apkg', () => {
  it('builds a deck openApkg reads back with the same cards, deck and tags', async () => {
    const csv =
      'Front,Back,Tags\n' +
      '"What is ATP?","The cell’s energy currency, made in mitochondria",bio ch1\n' +
      '"{{c1::Insulin}} lowers blood {{c2::glucose}}",Endocrine,bio\n' +
      'a < b,"two\nlines",\n';
    const table = parseDelimited(csv);
    const suggestion = suggestMapping(table);
    const conversion = rowsToNotes(table.rows, {
      mapping: suggestion.mapping,
      firstRowIsHeader: suggestion.firstRowIsHeader,
      html: suggestion.html,
      deckName: 'Biology 1.2',
    });
    expect(conversion).toMatchObject({ noteCount: 3, cardCount: 4 });

    const bytes = await createApkg(conversion.notes, { deckName: 'Biology 1.2' });
    const opened = await openApkg(bytes);
    expect(opened.notes).toHaveLength(3);
    expect(opened.cards).toHaveLength(4);
    expect(opened.decks.some((d) => d.fullName === 'Biology 1.2' || d.name === 'Biology 1.2')).toBe(
      true
    );
    expect(opened.notetypes.map((n) => n.name)).toEqual(
      expect.arrayContaining(['Flashify Basic', 'Flashify Cloze'])
    );

    const out = apkgToTable(opened.parsed, ANKI_ROUND_TRIP_PRESET);
    const basic = out.rows.find((r) => r[3] === 'What is ATP?')!;
    expect(basic[1]).toBe('Flashify Basic');
    expect(basic[2]).toBe('Biology 1.2');
    expect(basic[4]).toBe('The cell’s energy currency, made in mitochondria');
    expect(basic.at(-1)).toBe('bio ch1');
    const escaped = out.rows.find((r) => r[3] === 'a &lt; b')!;
    expect(escaped[4]).toBe('two<br>lines');
    expect(escaped[6]).toBe('');
  });

  it('a pasted Quizlet export becomes a deck', async () => {
    const table = parseSeparated('perro\tdog\ngato\tcat\npájaro\tbird\n', {
      fieldSeparator: '\t',
      rowSeparator: '\n',
    });
    const conversion = rowsToNotes(table.rows, {
      mapping: { front: 0, back: 1, extra: null, tags: null },
      firstRowIsHeader: false,
      html: false,
      deckName: 'Spanish animals',
    });
    const opened = await openApkg(
      await createApkg(conversion.notes, { deckName: 'Spanish animals' })
    );
    expect(opened.cards).toHaveLength(3);
    expect(opened.notes.map((n) => n.fields).join(' ')).toContain('pájaro');
  });
});

describe('.apkg → CSV', () => {
  it('reads a zstd .anki21b package (current Anki default export)', async () => {
    if (typeof zlib.zstdCompressSync !== 'function') return;
    const collection = readFileSync(
      new URL('./fixtures/modern-collection.anki2', import.meta.url)
    );
    const zip = new JSZip();
    zip.file('collection.anki21b', zlib.zstdCompressSync(collection));
    zip.file('media', new Uint8Array());
    const bytes = await zip.generateAsync({ type: 'uint8array' });

    const opened = await openApkg(bytes);
    expect(opened.format).toBe('anki21b');
    const table = apkgToTable(opened.parsed, SPREADSHEET_PRESET);
    expect(table.columns).toEqual(['Deck', 'Front', 'Back', 'Tags']);
    expect(table.rows).toEqual([
      [
        'Flashify::Native Sync Test',
        'What does Flashify native sync prove?',
        'A stock Anki client can sync into our backend.',
        '',
      ],
      [
        'Flashify::Native Sync Test',
        'Which sync protocol?',
        'Anki new-style zstd v11 over /api/anki/sync/*.',
        '',
      ],
    ]);
    const csv = tableToCsv(table, SPREADSHEET_PRESET);
    expect(parseDelimited(csv).rows.slice(1)).toEqual(table.rows);
  });

  it('rejects a file that is not a package', async () => {
    await expect(openApkg(new Uint8Array([1, 2, 3]))).rejects.toThrow(
      /not a valid/
    );
  });
});
