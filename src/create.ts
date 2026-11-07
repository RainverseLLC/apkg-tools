/**
 * Build a standard .apkg: open the bundled blank template, clear its
 * placeholder notes/cards, write ours, re-zip. ~150 lines on purpose —
 * no review history, no remote media, no i18n.
 */

import JSZip from 'jszip';
import { ApkgError } from './errors';
import {
  FLASHIFY_BASIC,
  FLASHIFY_CLOZE,
  noteToFields,
  type AnkiNoteTypeSpec,
  type ApkgNote,
} from './notes';
import { getSqlJs, type InitSqlJs } from './sql';

export type CreateApkgOptions = {
  deckName: string;
  initSqlJs?: InitSqlJs;
  /** Override the bundled `data/template-basic.apkg` (required in the browser). */
  template?: Uint8Array;
};

type AnkiModelJson = {
  id?: number;
  name?: string;
  type?: number;
  mod?: number;
  usn?: number;
  sortf?: number;
  css?: string;
  flds?: Array<Record<string, unknown>>;
  tmpls?: Array<Record<string, unknown>>;
  req?: unknown;
  [k: string]: unknown;
};

export async function createApkg(
  notes: ApkgNote[],
  options: CreateApkgOptions
): Promise<Uint8Array> {
  if (notes.length === 0) throw new ApkgError('No notes to pack into an .apkg.');
  const unique = [...new Map(notes.map((n) => [n.id, n])).values()];
  const SQL = await getSqlJs(options.initSqlJs);
  const templateZip = await JSZip.loadAsync(
    options.template ?? (await loadDefaultTemplate())
  );
  const collectionFile = templateZip.file('collection.anki2');
  if (!collectionFile) {
    throw new ApkgError('The Anki template is missing collection.anki2.');
  }
  const db = new SQL.Database(await collectionFile.async('uint8array'));
  try {
    const noteSampleRes = db.exec('SELECT * FROM notes LIMIT 1');
    const cardSampleRes = db.exec('SELECT * FROM cards LIMIT 1');
    if (noteSampleRes.length === 0 || cardSampleRes.length === 0) {
      throw new ApkgError('The Anki template has no sample note/card to clone.');
    }
    const noteColumns = noteSampleRes[0].columns ?? [];
    const cardColumns = cardSampleRes[0].columns ?? [];
    const noteSample = Object.fromEntries(
      noteColumns.map((c, i) => [c, noteSampleRes[0].values?.[0]?.[i]])
    ) as Record<string, unknown>;
    const cardSample = Object.fromEntries(
      cardColumns.map((c, i) => [c, cardSampleRes[0].values?.[0]?.[i]])
    ) as Record<string, unknown>;

    db.run('DELETE FROM cards;');
    db.run('DELETE FROM notes;');
    try {
      db.run('DELETE FROM revlog;');
    } catch {
      /* some templates ship without revlog */
    }

    const deckName = (options.deckName || 'Deck').slice(0, 80);
    try {
      const decksRes = db.exec('SELECT decks FROM col LIMIT 1');
      const decksJson = decksRes[0]?.values?.[0]?.[0];
      if (typeof decksJson === 'string' && cardSample.did != null) {
        const decks = JSON.parse(decksJson) as Record<string, { name?: string }>;
        if (decks[String(cardSample.did)]) {
          decks[String(cardSample.did)].name = deckName;
          db.run('UPDATE col SET decks=?', [JSON.stringify(decks)]);
        }
      }
    } catch {
      /* keep the template deck name */
    }

    const modelsRes = db.exec('SELECT models FROM col LIMIT 1');
    const modelsJson = modelsRes[0]?.values?.[0]?.[0];
    const models =
      typeof modelsJson === 'string'
        ? (JSON.parse(modelsJson) as Record<string, AnkiModelJson>)
        : {};
    const stockBasic =
      Object.values(models).find((m) => m?.name === 'Basic') ??
      models[String(noteSample.mid)];
    const stockCloze =
      Object.values(models).find((m) => m?.type === 1 && m?.name === 'Cloze') ??
      stockBasic;
    if (!stockBasic || !stockCloze) {
      throw new ApkgError('The Anki template is missing Basic/Cloze models.');
    }
    const now0 = 1720000000000;
    const basicMid = buildModel(models, stockBasic, FLASHIFY_BASIC, now0);
    const clozeMid = buildModel(models, stockCloze, FLASHIFY_CLOZE, now0 + 1);
    db.run('UPDATE col SET models=?', [JSON.stringify(models)]);

    const now = Date.now();
    const nowSec = Math.floor(now / 1000);
    const noteModIsMs =
      typeof noteSample.mod === 'number' && noteSample.mod > 1_000_000_000_000;
    const cardModIsMs =
      typeof cardSample.mod === 'number' && cardSample.mod > 1_000_000_000_000;
    let idSeq = now * 1000;
    let due = 0;
    const insertRow = (
      table: string,
      cols: string[],
      row: Record<string, unknown>
    ) => {
      db.run(
        `INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`,
        cols.map((c) => (row[c] ?? null) as string | number | Uint8Array | null)
      );
    };

    for (const n of unique) {
      const { spec, values } = noteToFields(n);
      const isCloze = spec.isCloze;
      const clozeOrds = isCloze
        ? [
            ...new Set(
              Array.from(n.front.matchAll(/\{\{c(\d+)::/g), (m) => Number(m[1]))
            ),
          ].sort((a, b) => a - b)
        : [];
      const nid = idSeq++;
      const guid = `g${(await sha1ToInt32(n.id)).toString(36)}${(await sha1ToInt32(`note:${n.id}`)).toString(36)}`;
      const noteRow: Record<string, unknown> = { ...noteSample };
      noteRow.id = nid;
      noteRow.guid = guid;
      noteRow.mid = isCloze ? clozeMid : basicMid;
      noteRow.flds = values.join('\x1f');
      noteRow.sfld = n.front;
      noteRow.tags = n.tags?.length
        ? ` ${n.tags.map((tg) => tg.trim().replace(/\s+/g, '_')).filter(Boolean).join(' ')} `
        : '';
      noteRow.mod = noteModIsMs ? now : nowSec;
      noteRow.csum = await sha1ToInt32(n.front);
      noteRow.usn = -1;
      insertRow('notes', noteColumns, noteRow);
      for (const ord of isCloze ? clozeOrds.map((o) => o - 1) : [0]) {
        const cardRow: Record<string, unknown> = { ...cardSample };
        cardRow.id = idSeq++;
        cardRow.nid = nid;
        cardRow.did = cardSample.did;
        cardRow.ord = ord;
        cardRow.mod = cardModIsMs ? now : nowSec;
        cardRow.usn = -1;
        if (typeof cardRow.due === 'number') cardRow.due = due;
        insertRow('cards', cardColumns, cardRow);
      }
      due += 1;
    }

    const outZip = new JSZip();
    outZip.file('collection.anki2', db.export());
    outZip.file('media', '{}');
    return outZip.generateAsync({ type: 'uint8array' });
  } finally {
    db.close();
  }
}

async function loadDefaultTemplate(): Promise<Uint8Array> {
  try {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    return new Uint8Array(
      readFileSync(
        fileURLToPath(new URL('../data/template-basic.apkg', import.meta.url))
      )
    );
  } catch {
    throw new ApkgError(
      'Could not load the bundled Anki template. In the browser, fetch data/template-basic.apkg from this package and pass it as { template }.'
    );
  }
}

function buildModel(
  models: Record<string, AnkiModelJson>,
  stock: AnkiModelJson,
  spec: AnkiNoteTypeSpec,
  id: number
): number {
  const m = JSON.parse(JSON.stringify(stock)) as AnkiModelJson;
  const fieldProto = m.flds?.[0] ?? {
    sticky: false,
    rtl: false,
    font: 'Arial',
    size: 20,
    media: [],
  };
  const tmplProto = m.tmpls?.[0] ?? { bqfmt: '', bafmt: '', did: null };
  m.id = id;
  m.name = spec.name;
  m.type = spec.isCloze ? 1 : 0;
  m.mod = Math.floor(id / 1000);
  m.usn = -1;
  m.sortf = 0;
  m.css = spec.css;
  m.flds = spec.fields.map((name, ord) => ({ ...fieldProto, name, ord }));
  m.tmpls = spec.templates.map((tpl, ord) => ({
    ...tmplProto,
    name: tpl.name,
    ord,
    qfmt: tpl.qfmt,
    afmt: tpl.afmt,
  }));
  if (!spec.isCloze) m.req = [[0, 'any', [0]]];
  models[String(id)] = m;
  return id;
}

async function sha1ToInt32(input: string): Promise<number> {
  const digest = await crypto.subtle.digest(
    'SHA-1',
    new TextEncoder().encode(input)
  );
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return parseInt(hex.slice(0, 8), 16);
}
