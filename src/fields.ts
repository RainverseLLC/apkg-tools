import type { AnkiFieldDef } from './types';

const FIELD_SEPARATOR = '\x1f';

export function splitAnkiTags(tags: string): string[] {
  return tags
    .trim()
    .split(/\s+/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

export function parseNoteFields(
  flds: string,
  fieldDefs: AnkiFieldDef[]
): Array<{ name: string; value: string; ord: number }> {
  const values = flds.split(FIELD_SEPARATOR);
  return fieldDefs
    .slice()
    .sort((a, b) => a.ord - b.ord)
    .map((field, index) => ({
      name: field.name,
      ord: field.ord,
      value: values[index] ?? '',
    }));
}
