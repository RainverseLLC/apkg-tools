import { describe, expect, it } from 'vitest';
import { parseAnkiCollection } from '../src/parse-collection';
import {
  ANKI_ROUND_TRIP_PRESET,
  SPREADSHEET_PRESET,
  apkgToTable,
  csvCell,
  csvFilename,
  fieldHtmlToText,
  summarizeNotetypes,
  tableToCsv,
} from '../src/apkg-to-rows';
import { parseDelimited } from '../src/csv-parse';
import { mixedNotetypeCollection, modernCollectionBytes } from './helpers';

describe('fieldHtmlToText', () => {
  it('keeps line breaks and cloze markup, drops tags, media and entities', () => {
    expect(
      fieldHtmlToText(
        '<div>One&nbsp;&amp; two</div><div>{{c1::three}}<br>four [sound:a.mp3]</div><img src="x.png">'
      )
    ).toBe('One & two\n{{c1::three}}\nfour');
    expect(fieldHtmlToText('&lt;tag&gt; &#233;t&#xE9;')).toBe('<tag> été');
    expect(fieldHtmlToText('<ul><li>a</li><li>b</li></ul>')).toBe('• a\n• b');
  });
});

describe('apkgToTable', () => {
  it('spreadsheet preset: one row per note, deck + tags, plain text, cloze kept', () => {
    const parsed = mixedNotetypeCollection();
    const table = apkgToTable(parsed, SPREADSHEET_PRESET);
    expect(table.columns).toEqual(['Deck', 'Field 1', 'Field 2', 'Tags']);
    expect(table.noteCount).toBe(2);
    expect(table.notesWithMedia).toBe(1);
    expect(table.rows[0][0]).toBe('GuruOwl Viewer Sample');
    expect(table.rows[0][1]).toBe(
      'SampleFinalCard: a packaged test image'
    );
    expect(table.rows[0][3]).toBe('sample');
    expect(table.rows[1][1]).toBe(
      'The sample token is {{c1::blue::colour}} and its shape is {{c2::round::shape}}.'
    );
    expect(table.headerLines).toEqual([]);
  });

  it('filters to one note type and uses its field names', () => {
    const parsed = mixedNotetypeCollection();
    const cloze = summarizeNotetypes(parsed).find((nt) => nt.isCloze)!;
    const table = apkgToTable(parsed, {
      ...SPREADSHEET_PRESET,
      notetypeIds: [cloze.id],
    });
    expect(table.columns).toEqual(['Deck', 'Text', 'Extra', 'Tags']);
    expect(table.noteCount).toBe(1);
  });

  it('round-trip preset writes the Anki import headers in Anki’s own column order', async () => {
    const parsed = await parseAnkiCollection(modernCollectionBytes());
    const table = apkgToTable(parsed, ANKI_ROUND_TRIP_PRESET);
    expect(table.columns).toEqual([
      'GUID',
      'Note type',
      'Deck',
      'Front',
      'Back',
      'Tags',
    ]);
    expect(table.headerLines).toEqual([
      '#separator:Tab',
      '#html:true',
      '#columns:GUID\tNote type\tDeck\tFront\tBack\tTags',
      '#guid column:1',
      '#notetype column:2',
      '#deck column:3',
      '#tags column:6',
    ]);
    expect(table.rows[0]).toEqual([
      'kkBxeVwZtx',
      'Basic',
      'Flashify::Native Sync Test',
      'What does Flashify native sync prove?',
      'A stock Anki client can sync into our backend.',
      '',
    ]);
  });

  it('pads narrower note types so the tags column never moves', () => {
    const parsed = mixedNotetypeCollection();
    const wide = parsed.notetypes[0];
    wide.fields.push({ ...wide.fields[0], name: 'Hint', ord: 2 });
    const table = apkgToTable(parsed, SPREADSHEET_PRESET);
    expect(table.columns).toEqual([
      'Deck',
      'Field 1',
      'Field 2',
      'Field 3',
      'Tags',
    ]);
    for (const row of table.rows) expect(row).toHaveLength(5);
  });
});

describe('CSV text', () => {
  it('quotes only what needs quoting and guards formulas for spreadsheets', () => {
    expect(csvCell('plain', ',', true)).toBe('plain');
    expect(csvCell('a, b', ',', true)).toBe('"a, b"');
    expect(csvCell('say "hi"', ',', true)).toBe('"say ""hi"""');
    expect(csvCell('two\nlines', ',', true)).toBe('"two\nlines"');
    expect(csvCell('=SUM(A1)', ',', true)).toBe("'=SUM(A1)");
    expect(csvCell('@cmd', ',', true)).toBe("'@cmd");
    expect(csvCell('-5', ',', true)).toBe('-5');
    expect(csvCell('+3.5%', ',', true)).toBe('+3.5%');
    expect(csvCell('=SUM(A1)', '\t', false)).toBe('=SUM(A1)');
  });

  it('spreadsheet CSV reads back to the same rows', () => {
    const parsed = mixedNotetypeCollection();
    const table = apkgToTable(parsed, SPREADSHEET_PRESET);
    const text = tableToCsv(table, SPREADSHEET_PRESET);
    expect(text.startsWith('Deck,Field 1,Field 2,Tags\r\n')).toBe(true);
    const back = parseDelimited(text);
    expect(back.delimiter).toBe(',');
    expect(back.rows).toEqual([table.columns, ...table.rows]);
  });

  it('Anki file reads back with its headers and HTML intact', () => {
    const parsed = mixedNotetypeCollection();
    const table = apkgToTable(parsed, ANKI_ROUND_TRIP_PRESET);
    const text = tableToCsv(table, ANKI_ROUND_TRIP_PRESET);
    const back = parseDelimited(text);
    expect(back.delimiter).toBe('\t');
    expect(back.headers).toMatchObject({
      separator: '\t',
      html: true,
      guidColumn: 1,
      notetypeColumn: 2,
      deckColumn: 3,
      tagsColumn: 6,
    });
    expect(back.rows).toEqual(table.rows);
    expect(back.rows[0][3]).toContain('<img src="sample.png"');
  });

  it('names the file after the deck package', () => {
    expect(csvFilename('My Deck.apkg', ',')).toBe('My Deck.csv');
    expect(csvFilename('col.colpkg', '\t')).toBe('col.tsv');
    expect(csvFilename('', ',')).toBe('anki-deck.csv');
  });
});
