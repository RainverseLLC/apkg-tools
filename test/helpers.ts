import { readFileSync } from 'node:fs';
import type { ParsedAnkiCollection } from '../src/types';

export function modernCollectionBytes(): Uint8Array {
  return new Uint8Array(
    readFileSync(new URL('./fixtures/modern-collection.anki2', import.meta.url))
  );
}

export function emptyCollectionMeta(): ParsedAnkiCollection['collection'] {
  return {
    ankiId: '1',
    collectionMod: 1,
    schemaMod: 1,
    usn: 0,
    createdSecs: 1,
    dirty: 0,
    confJson: '{}',
    decksJson: '{}',
    deckConfigJson: '{}',
    tagsJson: '{}',
    modelsJson: '{}',
  };
}

function emptyNotetype(
  partial: Partial<ParsedAnkiCollection['notetypes'][0]> & {
    ankiId: string;
    name: string;
  }
): ParsedAnkiCollection['notetypes'][0] {
  return {
    type: 0,
    mod: 1,
    usn: 0,
    sortField: 0,
    css: '',
    latexPre: null,
    latexPost: null,
    originalJson: '{}',
    fields: [],
    templates: [],
    ...partial,
  };
}

function emptyDeck(
  partial: Partial<ParsedAnkiCollection['decks'][0]> & {
    ankiId: string;
    name: string;
    fullName: string;
  }
): ParsedAnkiCollection['decks'][0] {
  return {
    parentAnkiId: null,
    configId: '1',
    dyn: 0,
    collapsed: 0,
    browserCollapsed: 0,
    desc: null,
    mod: 1,
    usn: 0,
    originalJson: '{}',
    ...partial,
  };
}

function emptyNote(
  partial: Partial<ParsedAnkiCollection['notes'][0]> & {
    ankiId: string;
    guid: string;
    notetypeAnkiId: string;
    fields: string;
  }
): ParsedAnkiCollection['notes'][0] {
  return {
    mod: 1,
    usn: 0,
    tags: '',
    sortField: null,
    checksum: 0,
    flags: 0,
    data: '',
    ...partial,
  };
}

function emptyCard(
  partial: Partial<ParsedAnkiCollection['cards'][0]> & {
    ankiId: string;
    noteAnkiId: string;
    deckAnkiId: string;
  }
): ParsedAnkiCollection['cards'][0] {
  return {
    ord: 0,
    mod: 1,
    usn: 0,
    type: 0,
    queue: 0,
    due: 0,
    interval: 0,
    factor: 0,
    reps: 0,
    lapses: 0,
    left: 0,
    originalDue: 0,
    originalDeckAnkiId: null,
    flags: 0,
    data: '',
    ...partial,
  };
}

/** Two note types with different field names — used for spreadsheet column tests. */
export function mixedNotetypeCollection(): ParsedAnkiCollection {
  return {
    collection: emptyCollectionMeta(),
    notetypes: [
      emptyNotetype({
        ankiId: '1',
        name: 'Basic',
        fields: [
          {
            name: 'Front',
            ord: 0,
            sticky: 0,
            rtl: 0,
            font: 'Arial',
            size: 20,
            description: null,
          },
          {
            name: 'Back',
            ord: 1,
            sticky: 0,
            rtl: 0,
            font: 'Arial',
            size: 20,
            description: null,
          },
        ],
      }),
      emptyNotetype({
        ankiId: '2',
        name: 'Cloze',
        type: 1,
        fields: [
          {
            name: 'Text',
            ord: 0,
            sticky: 0,
            rtl: 0,
            font: 'Arial',
            size: 20,
            description: null,
          },
          {
            name: 'Extra',
            ord: 1,
            sticky: 0,
            rtl: 0,
            font: 'Arial',
            size: 20,
            description: null,
          },
        ],
      }),
    ],
    decks: [
      emptyDeck({
        ankiId: '10',
        name: 'GuruOwl Viewer Sample',
        fullName: 'GuruOwl Viewer Sample',
      }),
    ],
    notes: [
      emptyNote({
        ankiId: '100',
        guid: 'g1',
        notetypeAnkiId: '1',
        tags: ' sample ',
        fields:
          'SampleFinalCard: a packaged test image<img src="sample.png">\x1fThe answer',
      }),
      emptyNote({
        ankiId: '101',
        guid: 'g2',
        notetypeAnkiId: '2',
        fields:
          'The sample token is {{c1::blue::colour}} and its shape is {{c2::round::shape}}.\x1f',
      }),
    ],
    cards: [
      emptyCard({ ankiId: '200', noteAnkiId: '100', deckAnkiId: '10', ord: 0 }),
      emptyCard({ ankiId: '201', noteAnkiId: '101', deckAnkiId: '10', ord: 0 }),
      emptyCard({ ankiId: '202', noteAnkiId: '101', deckAnkiId: '10', ord: 1 }),
    ],
    revlog: [],
  };
}
