import { describe, expect, it } from 'vitest';
import {
  MAX_COLUMNS,
  MAX_PARSE_ROWS,
  guessDelimiter,
  parseDelimited,
  parseSeparated,
  readAnkiHeaders,
} from '../src/csv-parse';
import { CsvParseError } from '../src/errors';

describe('parseDelimited (RFC 4180)', () => {
  it('reads quoted fields, doubled quotes and line breaks inside quotes', () => {
    const { rows, delimiter } = parseDelimited(
      'Front,Back\n"Say ""hi""","line one\nline two"\nplain,"a, b"\n'
    );
    expect(delimiter).toBe(',');
    expect(rows).toEqual([
      ['Front', 'Back'],
      ['Say "hi"', 'line one\nline two'],
      ['plain', 'a, b'],
    ]);
  });

  it('accepts CRLF, CR and a UTF-8 BOM, and skips blank lines', () => {
    const { rows } = parseDelimited('\uFEFFa,b\r\n\r\nc,d\re,f');
    expect(rows).toEqual([
      ['a', 'b'],
      ['c', 'd'],
      ['e', 'f'],
    ]);
  });

  it('keeps empty cells and a quote in the middle of an unquoted cell', () => {
    const { rows } = parseDelimited('a,,c\n5" screen,x\n');
    expect(rows).toEqual([
      ['a', '', 'c'],
      ['5" screen', 'x'],
    ]);
  });

  it('flags a quote that never closes instead of guessing', () => {
    const result = parseDelimited('a,"open\nb,c\n');
    expect(result.unterminatedQuote).toBe(true);
    expect(result.rows).toHaveLength(1);
  });

  it('caps rows and columns', () => {
    const many = Array.from(
      { length: MAX_PARSE_ROWS + 5 },
      (_, i) => `q${i},a`
    ).join('\n');
    const capped = parseDelimited(many);
    expect(capped.rows).toHaveLength(MAX_PARSE_ROWS);
    expect(capped.truncatedRows).toBe(5);

    const wide = parseDelimited(
      Array.from({ length: MAX_COLUMNS + 3 }, (_, i) => `c${i}`).join(',')
    );
    expect(wide.rows[0]).toHaveLength(MAX_COLUMNS);
    expect(wide.wideRows).toBe(1);
  });

  it('honours an explicit delimiter over the guess', () => {
    const { rows } = parseDelimited('a;b,c', { delimiter: ',' });
    expect(rows).toEqual([['a;b', 'c']]);
  });
});

describe('guessDelimiter', () => {
  it('picks the delimiter that splits lines consistently', () => {
    expect(guessDelimiter('a\tb\nc\td')).toBe('\t');
    expect(guessDelimiter('a;b;c\nd;e;f')).toBe(';');
    expect(guessDelimiter('a,b\nc,d')).toBe(',');
    expect(guessDelimiter('a|b\nc|d')).toBe('|');
  });

  it('ignores delimiters inside quotes', () => {
    expect(
      guessDelimiter('"Hund";"dog, the animal"\n"Katze";"cat, small, furry"')
    ).toBe(';');
  });

  it('prefers tab when a tab-separated file also has commas in prose', () => {
    expect(
      guessDelimiter('apple\ta fruit, usually red\npear\ta fruit, green')
    ).toBe('\t');
  });
});

describe('Anki file headers', () => {
  it('reads the headers Anki 2.1.54+ writes and leaves the body', () => {
    const text = [
      '#separator:tab',
      '#html:true',
      '#columns:GUID\tNote type\tDeck\tFront\tBack\tTags',
      '#guid column:1',
      '#notetype column:2',
      '#deck column:3',
      '#tags column:6',
      '#deck:Spanish',
      '#tags:imported verbs',
      'g1\tBasic\tSpanish\thola\thello\tgreeting',
    ].join('\n');
    const { headers, body } = readAnkiHeaders(text);
    expect(headers).toEqual({
      separator: '\t',
      html: true,
      columns: ['GUID', 'Note type', 'Deck', 'Front', 'Back', 'Tags'],
      guidColumn: 1,
      notetypeColumn: 2,
      deckColumn: 3,
      tagsColumn: 6,
      deck: 'Spanish',
      tags: ['imported', 'verbs'],
    });
    expect(body).toBe('g1\tBasic\tSpanish\thola\thello\tgreeting');

    const parsed = parseDelimited(text);
    expect(parsed.delimiter).toBe('\t');
    expect(parsed.rows).toEqual([
      ['g1', 'Basic', 'Spanish', 'hola', 'hello', 'greeting'],
    ]);
  });

  it('accepts literal separator characters and names in any case', () => {
    expect(readAnkiHeaders('#separator:;\na;b').headers.separator).toBe(';');
    expect(readAnkiHeaders('#separator:Comma\na,b').headers.separator).toBe(
      ','
    );
    expect(readAnkiHeaders('#separator:Pipe\na|b').headers.separator).toBe('|');
  });

  it('treats a later # line as data, not a header', () => {
    const { rows } = parseDelimited('q,a\n#hashtag,meaning\n');
    expect(rows).toEqual([
      ['q', 'a'],
      ['#hashtag', 'meaning'],
    ]);
  });
});

describe('parseSeparated (Quizlet export)', () => {
  it('reads the default export: tab between term and definition, new line between cards', () => {
    const { rows } = parseSeparated(
      'mitochondria\tpowerhouse of the cell\nribosome\tmakes proteins\n\n',
      { fieldSeparator: '\t', rowSeparator: '\n' }
    );
    expect(rows).toEqual([
      ['mitochondria', 'powerhouse of the cell'],
      ['ribosome', 'makes proteins'],
    ]);
  });

  it('reads custom separators and splits each card at the first one only', () => {
    const { rows } = parseSeparated(
      'term one##definition with ## inside####term two##second',
      { fieldSeparator: '##', rowSeparator: '####' }
    );
    expect(rows).toEqual([
      ['term one', 'definition with ## inside'],
      ['term two', 'second'],
    ]);
  });

  it('does not treat a leading quote mark as CSV quoting', () => {
    const { rows } = parseSeparated('"to be"\tser / estar\n', {
      fieldSeparator: '\t',
      rowSeparator: '\n',
    });
    expect(rows).toEqual([['"to be"', 'ser / estar']]);
  });

  it('semicolon between cards, comma between term and definition', () => {
    const { rows } = parseSeparated('a,b;c,d', {
      fieldSeparator: ',',
      rowSeparator: ';',
    });
    expect(rows).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('rejects identical separators', () => {
    expect(() =>
      parseSeparated('a,b', { fieldSeparator: ',', rowSeparator: ',' })
    ).toThrow(CsvParseError);
  });
});
