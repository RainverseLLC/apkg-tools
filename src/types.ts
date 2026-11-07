export type AnkiFieldDef = {
  name: string;
  ord: number;
};

export type AnkiTemplateDef = {
  name: string;
  ord: number;
  qfmt: string;
  afmt: string;
};

export type ParsedAnkiCollection = {
  collection: {
    ankiId: string;
    collectionMod: number | null;
    schemaMod: number | null;
    usn: number;
    createdSecs: number | null;
    dirty: number;
    confJson: string | null;
    decksJson: string | null;
    deckConfigJson: string | null;
    tagsJson: string | null;
    modelsJson: string | null;
  };
  notetypes: ParsedAnkiNotetype[];
  decks: ParsedAnkiDeck[];
  notes: ParsedAnkiNote[];
  cards: ParsedAnkiCard[];
  revlog: ParsedAnkiRevlog[];
};

export type ParsedAnkiNotetype = {
  ankiId: string;
  name: string;
  type: number;
  mod: number | null;
  usn: number | null;
  sortField: number;
  css: string;
  latexPre: string | null;
  latexPost: string | null;
  originalJson: string;
  fields: Array<{
    name: string;
    ord: number;
    sticky: number;
    rtl: number;
    font: string | null;
    size: number | null;
    description: string | null;
  }>;
  templates: Array<{
    name: string;
    ord: number;
    qfmt: string;
    afmt: string;
    browserQfmt: string | null;
    browserAfmt: string | null;
    deckOverride: string | null;
    browserFont: string | null;
    browserSize: number | null;
    originalJson: string;
  }>;
};

export type ParsedAnkiDeck = {
  ankiId: string;
  name: string;
  fullName: string;
  parentAnkiId: string | null;
  configId: string | null;
  dyn: number;
  collapsed: number;
  browserCollapsed: number;
  desc: string | null;
  mod: number | null;
  usn: number | null;
  originalJson: string;
};

export type ParsedAnkiNote = {
  ankiId: string;
  guid: string;
  notetypeAnkiId: string;
  mod: number | null;
  usn: number | null;
  tags: string;
  fields: string;
  sortField: string | null;
  checksum: number | null;
  flags: number;
  data: string;
};

export type ParsedAnkiCard = {
  ankiId: string;
  noteAnkiId: string;
  deckAnkiId: string;
  ord: number;
  mod: number | null;
  usn: number | null;
  type: number;
  queue: number;
  due: number;
  interval: number;
  factor: number;
  reps: number;
  lapses: number;
  left: number;
  originalDue: number;
  originalDeckAnkiId: string | null;
  flags: number;
  data: string;
};

export type ParsedAnkiRevlog = {
  ankiId: string;
  cardAnkiId: string;
  usn: number;
  ease: number;
  interval: number;
  lastInterval: number;
  factor: number;
  time: number;
  type: number;
};

export type AnkiMediaUpload = {
  filename: string;
  data: ArrayBuffer | Uint8Array;
  contentType?: string;
  sha1?: string;
  usn?: number;
  deleted?: boolean;
};

export type ApkgCollectionFormat = 'anki2' | 'anki21' | 'anki21b';

export type ApkgMediaFile = {
  filename: string;
  data: Uint8Array;
};
