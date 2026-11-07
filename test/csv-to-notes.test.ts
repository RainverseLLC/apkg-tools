import { describe, expect, it } from 'vitest';
import { MAX_ROWS, parseDelimited } from '../src/csv-parse';
import {
  csvApkgFilename,
  looksLikeHeaderRow,
  rowsToNotes,
  safeCsvDeckName,
  splitTagCell,
  suggestMapping,
} from '../src/csv-to-notes';
import { noteToFields } from '../src/notes';

const base = {
  firstRowIsHeader: false,
  html: false,
  deckName: 'Spanish',
};

describe('suggestMapping', () => {
  it('maps a named header row', () => {
    const s = suggestMapping(
      parseDelimited('Term,Definition,Tags\nhola,hello,greeting\n')
    );
    expect(s.firstRowIsHeader).toBe(true);
    expect(s.mapping).toEqual({ front: 0, back: 1, extra: null, tags: 2 });
    expect(s.columnNames).toEqual(['Term', 'Definition', 'Tags']);
  });

  it('falls back to column 1 → front, 2 → back when there are no names', () => {
    const s = suggestMapping(parseDelimited('perro,dog\ngato,cat\n'));
    expect(s.firstRowIsHeader).toBe(false);
    expect(s.mapping).toEqual({ front: 0, back: 1, extra: null, tags: null });
    expect(s.columnNames).toEqual([null, null]);
  });

  it('recognises header names in several languages', () => {
    for (const [header, sep] of [
      ['Término;Definición', ';'],
      ['表面,裏面', ','],
      ['正面,背面', ','],
      ['问题,答案', ','],
      ['Pregunta\tRespuesta', '\t'],
    ]) {
      const s = suggestMapping(parseDelimited(`${header}\nq${sep}a\n`));
      expect(s.firstRowIsHeader, header).toBe(true);
      expect(s.mapping.front).toBe(0);
      expect(s.mapping.back).toBe(1);
    }
  });

  it('does not read unknown column names as a header row', () => {
    expect(looksLikeHeaderRow(['Spanish', 'English'])).toBe(false);
    expect(looksLikeHeaderRow(['Question', 'Answer'])).toBe(true);
    expect(looksLikeHeaderRow(['Front'])).toBe(true);
  });

  it('uses Anki headers and keeps GUID / note type / deck columns out of the card', () => {
    const s = suggestMapping(
      parseDelimited(
        [
          '#separator:tab',
          '#html:true',
          '#columns:GUID\tNote type\tDeck\tFront\tBack\tTags',
          '#guid column:1',
          '#notetype column:2',
          '#deck column:3',
          '#tags column:6',
          '#deck:Biology',
          'g\tBasic\tBio\tq\ta\tt',
        ].join('\n')
      )
    );
    expect(s.firstRowIsHeader).toBe(false);
    expect(s.html).toBe(true);
    expect(s.deckName).toBe('Biology');
    expect(s.mapping).toEqual({ front: 3, back: 4, extra: null, tags: 5 });
  });

  it('skips GUID / Deck columns named in a plain header row', () => {
    const s = suggestMapping(parseDelimited('GUID,Deck,Front,Back\nx,y,q,a\n'));
    expect(s.mapping.front).toBe(2);
    expect(s.mapping.back).toBe(3);
  });
});

describe('rowsToNotes', () => {
  it('escapes plain text once and turns line breaks into <br>', () => {
    const { notes } = rowsToNotes([['a < b & c', 'line 1\nline 2']], {
      ...base,
      mapping: { front: 0, back: 1, extra: null, tags: null },
    });
    expect(notes[0].front).toBe('a &lt; b &amp; c');
    expect(notes[0].back).toBe('line 1<br>line 2');
    expect(notes[0].fieldHtml).toBe(true);
    const { values } = noteToFields(notes[0]);
    expect(values).toEqual(['a &lt; b &amp; c', 'line 1<br>line 2', '', '']);
  });

  it('passes HTML through in HTML mode', () => {
    const { notes } = rowsToNotes(
      [['<b>bold</b><script>alert(1)</script>', '<img src="x.png">']],
      {
        ...base,
        html: true,
        mapping: { front: 0, back: 1, extra: null, tags: null },
      }
    );
    const { values } = noteToFields(notes[0]);
    expect(values[0]).toBe('<b>bold</b><script>alert(1)</script>');
    expect(values[1]).toBe('<img src="x.png">');
  });

  it('detects cloze, moves the back column to Extra, and counts one card per deletion', () => {
    const result = rowsToNotes(
      [
        ['{{c1::Paris}} is the capital of {{c2::France}}', 'Geography', 'EU'],
        ['plain', 'answer', ''],
      ],
      { ...base, mapping: { front: 0, back: 1, extra: 2, tags: null } }
    );
    expect(result.clozeNotes).toBe(1);
    expect(result.cardCount).toBe(3);
    expect(result.notes[0]).toMatchObject({
      type: 'cloze',
      back: '',
      extra: 'Geography<br>EU',
    });
    const { spec, values } = noteToFields(result.notes[0]);
    expect(spec.name).toBe('Flashify Cloze');
    expect(values).toEqual([
      '{{c1::Paris}} is the capital of {{c2::France}}',
      'Geography<br>EU',
      '',
    ]);
  });

  it('skips empty fronts, counts empty backs, and keeps duplicate fronts apart', () => {
    const result = rowsToNotes(
      [
        ['', 'orphan'],
        ['same', 'one'],
        ['same', 'two'],
        ['lonely', ''],
      ],
      { ...base, mapping: { front: 0, back: 1, extra: null, tags: null } }
    );
    expect(result.skippedEmpty).toBe(1);
    expect(result.emptyBack).toBe(1);
    expect(result.noteCount).toBe(3);
    expect(new Set(result.notes.map((n) => n.id)).size).toBe(3);
  });

  it('splits tags on spaces and commas and adds file-level tags', () => {
    expect(splitTagCell('verb, irregular  ch1')).toEqual([
      'verb',
      'irregular',
      'ch1',
    ]);
    const { notes } = rowsToNotes([['q', 'a', 'verb,verb ch1']], {
      ...base,
      extraTags: ['quizlet'],
      mapping: { front: 0, back: 1, extra: null, tags: 2 },
    });
    expect(notes[0].tags).toEqual(['verb', 'ch1', 'quizlet']);
  });

  it('drops the header row when asked', () => {
    const result = rowsToNotes(
      [
        ['Front', 'Back'],
        ['q', 'a'],
      ],
      {
        ...base,
        firstRowIsHeader: true,
        mapping: { front: 0, back: 1, extra: null, tags: null },
      }
    );
    expect(result.noteCount).toBe(1);
  });

  it('refuses a mapping without a front column', () => {
    expect(() =>
      rowsToNotes([['q']], {
        ...base,
        mapping: { front: -1, back: null, extra: null, tags: null },
      })
    ).toThrow(/front/);
  });
});

describe('row limit', () => {
  it('counts 10,000 cards after a header row, and reports the rest', () => {
    const rows = [
      ['Front', 'Back'],
      ...Array.from({ length: MAX_ROWS + 3 }, (_, i) => [`q${i}`, 'a']),
    ];
    const result = rowsToNotes(rows, {
      ...base,
      firstRowIsHeader: true,
      mapping: { front: 0, back: 1, extra: null, tags: null },
    });
    expect(result.noteCount).toBe(MAX_ROWS);
    expect(result.overLimit).toBe(3);
  });

  it('a file of exactly 10,000 cards plus a header parses whole', () => {
    const text = `Front,Back\n${Array.from({ length: MAX_ROWS }, (_, i) => `q${i},a`).join('\n')}`;
    const table = parseDelimited(text);
    expect(table.truncatedRows).toBe(0);
    const result = rowsToNotes(table.rows, {
      ...base,
      firstRowIsHeader: true,
      mapping: { front: 0, back: 1, extra: null, tags: null },
    });
    expect(result.noteCount).toBe(MAX_ROWS);
    expect(result.overLimit).toBe(0);
  });
});

describe('deck names', () => {
  it('strips file extensions and characters Anki or a filesystem rejects', () => {
    expect(safeCsvDeckName('Spanish 1.2.csv')).toBe('Spanish 1.2');
    expect(safeCsvDeckName('a/b:c*?')).toBe('a b c');
    expect(safeCsvDeckName('   ')).toBe('Imported cards');
    expect(csvApkgFilename('Spanish verbs')).toBe('Spanish-verbs.apkg');
  });
});
