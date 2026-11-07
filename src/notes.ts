/**
 * Note types written by createApkg. Field layout matches the GuruOwl export:
 *   Basic: Front / Back / Extra / Source
 *   Cloze: Text / Extra / Source
 * Source is left empty for CSV-converted notes.
 */

export type ApkgNote = {
  id: string;
  type: 'basic' | 'cloze';
  front: string;
  back: string;
  extra: string;
  tags: string[];
  /** Front/back/extra are already field HTML (CSV converter escapes once). */
  fieldHtml: boolean;
};

export type AnkiNoteTypeSpec = {
  name: string;
  isCloze: boolean;
  fields: string[];
  templates: Array<{ name: string; qfmt: string; afmt: string }>;
  css: string;
};

const SHARED_CSS = `.card {
  font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
  font-size: 20px;
  line-height: 1.5;
  text-align: center;
  color: #1f2430;
  background-color: #fbfbfd;
}
.cloze {
  font-weight: 700;
  color: #2563eb;
}
.extra {
  margin-top: 14px;
  padding-top: 10px;
  border-top: 1px dashed #c9cedb;
  font-size: 16px;
  color: #4b5468;
}
.source {
  margin-top: 12px;
  font-size: 12px;
  color: #9aa1b2;
}
`;

const EXTRA_SOURCE_BLOCK = `{{#Extra}}<div class="extra">{{Extra}}</div>{{/Extra}}
{{#Source}}<div class="source">{{Source}}</div>{{/Source}}`;

export const FLASHIFY_BASIC: AnkiNoteTypeSpec = {
  name: 'Flashify Basic',
  isCloze: false,
  fields: ['Front', 'Back', 'Extra', 'Source'],
  templates: [
    {
      name: 'Card 1',
      qfmt: '{{Front}}',
      afmt: `{{FrontSide}}
<hr id=answer>
{{Back}}
${EXTRA_SOURCE_BLOCK}`,
    },
  ],
  css: SHARED_CSS,
};

export const FLASHIFY_CLOZE: AnkiNoteTypeSpec = {
  name: 'Flashify Cloze',
  isCloze: true,
  fields: ['Text', 'Extra', 'Source'],
  templates: [
    {
      name: 'Cloze',
      qfmt: '{{cloze:Text}}',
      afmt: `{{cloze:Text}}
${EXTRA_SOURCE_BLOCK}`,
    },
  ],
  css: SHARED_CSS,
};

/** Cloze routing: declared cloze AND a real deletion. */
export function isClozeNote(n: ApkgNote): boolean {
  return n.type === 'cloze' && /\{\{c\d+::/.test(n.front);
}

/** Anki fields are HTML; cards are stored as plain text with newlines. */
export function toFieldHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');
}

/**
 * Resolve a card to its note type + ordered field values. This package does
 * not strip scripts or event handlers from HTML fields — callers that render
 * the result must do that themselves.
 */
export function noteToFields(n: ApkgNote): {
  spec: AnkiNoteTypeSpec;
  values: string[];
} {
  const field = n.fieldHtml ? (html: string) => html : toFieldHtml;
  if (isClozeNote(n)) {
    const clozeExtra = n.extra || (n.back !== n.front ? n.back.trim() : '');
    return {
      spec: FLASHIFY_CLOZE,
      values: [field(n.front), field(clozeExtra), ''],
    };
  }
  return {
    spec: FLASHIFY_BASIC,
    values: [field(n.front), field(n.back), field(n.extra), ''],
  };
}
