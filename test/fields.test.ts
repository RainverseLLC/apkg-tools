import { describe, expect, it } from 'vitest';
import { parseNoteFields, splitAnkiTags } from '../src/fields';

describe('parseNoteFields / splitAnkiTags', () => {
  it('splits fields on the Anki unit separator in field-ord order', () => {
    const fields = parseNoteFields('Capital of France?\x1fParis\x1f', [
      { name: 'Front', ord: 0 },
      { name: 'Back', ord: 1 },
      { name: 'Extra', ord: 2 },
    ]);
    expect(fields).toEqual([
      { name: 'Front', ord: 0, value: 'Capital of France?' },
      { name: 'Back', ord: 1, value: 'Paris' },
      { name: 'Extra', ord: 2, value: '' },
    ]);
  });

  it('splits Anki tags on whitespace', () => {
    expect(splitAnkiTags(' tag::one  marked ')).toEqual(['tag::one', 'marked']);
  });
});
