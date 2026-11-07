import type { Database } from 'sql.js';
import { getSqlJs, type InitSqlJs } from './sql';
import type {
  ParsedAnkiCard,
  ParsedAnkiCollection,
  ParsedAnkiDeck,
  ParsedAnkiNote,
  ParsedAnkiNotetype,
  ParsedAnkiRevlog,
} from './types';

type SqlValue = string | number | Uint8Array | null;
type SqlRow = Record<string, SqlValue>;

type ProtobufField = {
  field: number;
  wireType: number;
  value: number | Uint8Array;
};

const ANKI_DECK_SEPARATOR = String.fromCharCode(0x1f);

function toBytes(input: ArrayBuffer | Uint8Array): Uint8Array {
  return input instanceof Uint8Array ? input : new Uint8Array(input);
}

function stringifyId(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value);
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function numberOrDefault(value: unknown, fallback = 0): number {
  return numberOrNull(value) ?? fallback;
}

function stringOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Uint8Array) return new TextDecoder().decode(value);
  return String(value);
}

function jsonString(value: unknown): string {
  return JSON.stringify(value ?? {});
}

function rows(db: Database, query: string): SqlRow[] {
  const result = db.exec(query);
  if (!result[0]) return [];
  const { columns, values } = result[0];
  return values.map((valueRow) =>
    Object.fromEntries(
      columns.map((column, index) => [column, valueRow[index]])
    )
  ) as SqlRow[];
}

function firstRow(db: Database, query: string): SqlRow {
  const row = rows(db, query)[0];
  if (!row)
    throw new Error(`Anki collection is missing required row: ${query}`);
  return row;
}

function tableExists(db: Database, tableName: string): boolean {
  return (
    rows(
      db,
      `select 1 as present from sqlite_master where type = 'table' and name = '${tableName}' limit 1`
    ).length > 0
  );
}

function tableHasRows(db: Database, tableName: string): boolean {
  if (!tableExists(db, tableName)) return false;
  return rows(db, `select 1 as present from ${tableName} limit 1`).length > 0;
}

function isEmptyLegacyBlob(value: string | null): boolean {
  return !value || value.trim() === '' || value.trim() === '{}';
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string' || !value.trim()) return {};
  return JSON.parse(value) as Record<string, unknown>;
}

function bytesOrEmpty(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  return new Uint8Array();
}

function readVarint(bytes: Uint8Array, offset: number) {
  let value = 0;
  let shift = 0;
  let cursor = offset;
  while (cursor < bytes.length) {
    const byte = bytes[cursor];
    value += (byte & 0x7f) * 2 ** shift;
    cursor += 1;
    if ((byte & 0x80) === 0) {
      return { value, offset: cursor };
    }
    shift += 7;
  }
  return { value, offset: cursor };
}

function readProtoFields(bytes: Uint8Array): ProtobufField[] {
  const fields: ProtobufField[] = [];
  let offset = 0;
  while (offset < bytes.length) {
    const tag = readVarint(bytes, offset);
    offset = tag.offset;
    const field = Math.floor(tag.value / 8);
    const wireType = tag.value & 0x7;

    if (wireType === 0) {
      const varint = readVarint(bytes, offset);
      offset = varint.offset;
      fields.push({ field, wireType, value: varint.value });
      continue;
    }

    if (wireType === 2) {
      const length = readVarint(bytes, offset);
      offset = length.offset;
      const end = Math.min(bytes.length, offset + length.value);
      fields.push({
        field,
        wireType,
        value: bytes.slice(offset, end),
      });
      offset = end;
      continue;
    }

    if (wireType === 1) {
      offset = Math.min(bytes.length, offset + 8);
      continue;
    }

    if (wireType === 5) {
      offset = Math.min(bytes.length, offset + 4);
      continue;
    }

    break;
  }
  return fields;
}

function protoVarint(fields: ProtobufField[], field: number, fallback = 0) {
  const value = fields.find(
    (item) => item.field === field && typeof item.value === 'number'
  )?.value;
  return typeof value === 'number' ? value : fallback;
}

function protoString(
  fields: ProtobufField[],
  field: number,
  fallback: string | null = null
) {
  const value = fields.find(
    (item) => item.field === field && item.value instanceof Uint8Array
  )?.value;
  return value instanceof Uint8Array
    ? new TextDecoder().decode(value)
    : fallback;
}

function protoBytes(fields: ProtobufField[], field: number) {
  const value = fields.find(
    (item) => item.field === field && item.value instanceof Uint8Array
  )?.value;
  return value instanceof Uint8Array ? value : null;
}

function parseNotetypes(modelsJson: string | null): ParsedAnkiNotetype[] {
  const models = parseJsonObject(modelsJson);
  return Object.entries(models).map(([id, model]) => {
    const m = model as Record<string, unknown>;
    const fields = Array.isArray(m.flds) ? m.flds : [];
    const templates = Array.isArray(m.tmpls) ? m.tmpls : [];

    return {
      ankiId: stringifyId(m.id ?? id),
      name: String(m.name ?? 'Untitled'),
      type: numberOrDefault(m.type),
      mod: numberOrNull(m.mod),
      usn: numberOrNull(m.usn),
      sortField: numberOrDefault(m.sortf),
      css: String(m.css ?? ''),
      latexPre: stringOrNull(m.latexPre),
      latexPost: stringOrNull(m.latexPost),
      originalJson: jsonString(m),
      fields: fields.map((field: Record<string, unknown>, index: number) => ({
        name: String(field.name ?? `Field ${index + 1}`),
        ord: numberOrDefault(field.ord, index),
        sticky: numberOrDefault(field.sticky),
        rtl: numberOrDefault(field.rtl),
        font: stringOrNull(field.font),
        size: numberOrNull(field.size),
        description: stringOrNull(field.description),
      })),
      templates: templates.map(
        (template: Record<string, unknown>, index: number) => ({
          name: String(template.name ?? `Card ${index + 1}`),
          ord: numberOrDefault(template.ord, index),
          qfmt: String(template.qfmt ?? ''),
          afmt: String(template.afmt ?? ''),
          browserQfmt: stringOrNull(template.bqfmt),
          browserAfmt: stringOrNull(template.bafmt),
          deckOverride: stringOrNull(template.did),
          browserFont: stringOrNull(template.bfont),
          browserSize: numberOrNull(template.bsize),
          originalJson: jsonString(template),
        })
      ),
    };
  });
}

function parseModernNotetypes(db: Database): ParsedAnkiNotetype[] {
  const fieldRows = rows(
    db,
    'select ntid,ord,name,config from fields order by ntid, ord'
  );
  const templateRows = rows(
    db,
    'select ntid,ord,name,mtime_secs,usn,config from templates order by ntid, ord'
  );
  const fieldsByNotetype = new Map<string, SqlRow[]>();
  const templatesByNotetype = new Map<string, SqlRow[]>();

  for (const row of fieldRows) {
    const ntid = stringifyId(row.ntid);
    fieldsByNotetype.set(ntid, [...(fieldsByNotetype.get(ntid) ?? []), row]);
  }
  for (const row of templateRows) {
    const ntid = stringifyId(row.ntid);
    templatesByNotetype.set(ntid, [
      ...(templatesByNotetype.get(ntid) ?? []),
      row,
    ]);
  }

  return rows(
    db,
    'select id,name,mtime_secs,usn,config from notetypes order by id'
  ).map((row) => {
    const ankiId = stringifyId(row.id);
    const config = readProtoFields(bytesOrEmpty(row.config));
    const fields = fieldsByNotetype.get(ankiId) ?? [];
    const templates = templatesByNotetype.get(ankiId) ?? [];
    const type = protoVarint(config, 1);
    const sortField = protoVarint(config, 2);
    const css = protoString(config, 3, '') ?? '';
    const latexPre = protoString(config, 5);
    const latexPost = protoString(config, 6);

    return {
      ankiId,
      name: String(row.name ?? 'Untitled'),
      type,
      mod: numberOrNull(row.mtime_secs),
      usn: numberOrNull(row.usn),
      sortField,
      css,
      latexPre,
      latexPost,
      originalJson: jsonString({
        id: ankiId,
        name: row.name,
        type,
        sortf: sortField,
        css,
        latexPre,
        latexPost,
        schema: 'modern',
      }),
      fields: fields.map((field, index) => {
        const fieldConfig = readProtoFields(bytesOrEmpty(field.config));
        return {
          name: String(field.name ?? `Field ${index + 1}`),
          ord: numberOrDefault(field.ord, index),
          sticky: protoVarint(fieldConfig, 1),
          rtl: protoVarint(fieldConfig, 2),
          font: protoString(fieldConfig, 3),
          size: protoVarint(fieldConfig, 4) || null,
          description: protoString(fieldConfig, 5),
        };
      }),
      templates: templates.map((template, index) => {
        const templateConfig = readProtoFields(bytesOrEmpty(template.config));
        const qfmt = protoString(templateConfig, 1, '') ?? '';
        const afmt = protoString(templateConfig, 2, '') ?? '';
        const browserQfmt = protoString(templateConfig, 3);
        const browserAfmt = protoString(templateConfig, 4);
        const deckOverride = protoVarint(templateConfig, 5);
        const browserFont = protoString(templateConfig, 6);
        const browserSize = protoVarint(templateConfig, 7);
        return {
          name: String(template.name ?? `Card ${index + 1}`),
          ord: numberOrDefault(template.ord, index),
          qfmt,
          afmt,
          browserQfmt,
          browserAfmt,
          deckOverride: deckOverride ? String(deckOverride) : null,
          browserFont,
          browserSize: browserSize || null,
          originalJson: jsonString({
            name: template.name,
            ord: numberOrDefault(template.ord, index),
            qfmt,
            afmt,
            browserQfmt,
            browserAfmt,
            deckOverride: deckOverride || null,
            browserFont,
            browserSize: browserSize || null,
            schema: 'modern',
          }),
        };
      }),
    };
  });
}

function parseDecks(decksJson: string | null): ParsedAnkiDeck[] {
  const rawDecks = parseJsonObject(decksJson);
  const byName = new Map<string, string>();
  for (const [id, deck] of Object.entries(rawDecks)) {
    const d = deck as Record<string, unknown>;
    byName.set(String(d.name ?? id), stringifyId(d.id ?? id));
  }

  return Object.entries(rawDecks).map(([id, deck]) => {
    const d = deck as Record<string, unknown>;
    const fullName = String(d.name ?? 'Default');
    const parentName = fullName.includes('::')
      ? fullName.split('::').slice(0, -1).join('::')
      : null;
    return {
      ankiId: stringifyId(d.id ?? id),
      name: fullName.split('::').at(-1) || fullName,
      fullName,
      parentAnkiId: parentName ? byName.get(parentName) || null : null,
      configId: stringOrNull(d.conf),
      dyn: numberOrDefault(d.dyn),
      collapsed: numberOrDefault(d.collapsed),
      browserCollapsed: numberOrDefault(d.browserCollapsed),
      desc: stringOrNull(d.desc),
      mod: numberOrNull(d.mod),
      usn: numberOrNull(d.usn),
      originalJson: jsonString(d),
    };
  });
}

function ankiDeckName(value: unknown) {
  return String(value ?? 'Default')
    .split(ANKI_DECK_SEPARATOR)
    .join('::');
}

function parseModernDecks(db: Database): ParsedAnkiDeck[] {
  const rawDecks = rows(
    db,
    'select id,name,mtime_secs,usn,common,kind from decks order by id'
  );
  const byName = new Map<string, string>();
  for (const deck of rawDecks) {
    byName.set(ankiDeckName(deck.name), stringifyId(deck.id));
  }

  return rawDecks.map((deck) => {
    const fullName = ankiDeckName(deck.name);
    const parentName = fullName.includes('::')
      ? fullName.split('::').slice(0, -1).join('::')
      : null;
    const common = readProtoFields(bytesOrEmpty(deck.common));
    const kind = readProtoFields(bytesOrEmpty(deck.kind));
    const normal = protoBytes(kind, 1);
    const filtered = protoBytes(kind, 2);
    const normalConfig = normal ? readProtoFields(normal) : [];
    const configId = normal ? protoVarint(normalConfig, 1, 1) : null;
    const desc = normal ? protoString(normalConfig, 4) : null;

    return {
      ankiId: stringifyId(deck.id),
      name: fullName.split('::').at(-1) || fullName,
      fullName,
      parentAnkiId: parentName ? byName.get(parentName) || null : null,
      configId: configId === null ? null : String(configId),
      dyn: filtered ? 1 : 0,
      collapsed: protoVarint(common, 1),
      browserCollapsed: protoVarint(common, 2),
      desc,
      mod: numberOrNull(deck.mtime_secs),
      usn: numberOrNull(deck.usn),
      originalJson: jsonString({
        id: stringifyId(deck.id),
        name: fullName,
        conf: configId,
        dyn: filtered ? 1 : 0,
        collapsed: protoVarint(common, 1),
        browserCollapsed: protoVarint(common, 2),
        desc,
        schema: 'modern',
      }),
    };
  });
}

function parseNotes(db: Database): ParsedAnkiNote[] {
  return rows(
    db,
    'select id,guid,mid,mod,usn,tags,flds,sfld,csum,flags,data from notes'
  ).map((row) => ({
    ankiId: stringifyId(row.id),
    guid: String(row.guid ?? ''),
    notetypeAnkiId: stringifyId(row.mid),
    mod: numberOrNull(row.mod),
    usn: numberOrNull(row.usn),
    tags: String(row.tags ?? ''),
    fields: String(row.flds ?? ''),
    sortField: stringOrNull(row.sfld),
    checksum: numberOrNull(row.csum),
    flags: numberOrDefault(row.flags),
    data: String(row.data ?? ''),
  }));
}

function parseCards(db: Database): ParsedAnkiCard[] {
  return rows(
    db,
    'select id,nid,did,ord,mod,usn,type,queue,due,ivl,factor,reps,lapses,left,odue,odid,flags,data from cards'
  ).map((row) => ({
    ankiId: stringifyId(row.id),
    noteAnkiId: stringifyId(row.nid),
    deckAnkiId: stringifyId(row.did),
    ord: numberOrDefault(row.ord),
    mod: numberOrNull(row.mod),
    usn: numberOrNull(row.usn),
    type: numberOrDefault(row.type),
    queue: numberOrDefault(row.queue),
    due: numberOrDefault(row.due),
    interval: numberOrDefault(row.ivl),
    factor: numberOrDefault(row.factor),
    reps: numberOrDefault(row.reps),
    lapses: numberOrDefault(row.lapses),
    left: numberOrDefault(row.left),
    originalDue: numberOrDefault(row.odue),
    originalDeckAnkiId: stringOrNull(row.odid),
    flags: numberOrDefault(row.flags),
    data: String(row.data ?? ''),
  }));
}

function parseRevlog(db: Database): ParsedAnkiRevlog[] {
  return rows(
    db,
    'select id,cid,usn,ease,ivl,lastIvl,factor,time,type from revlog'
  ).map((row) => ({
    ankiId: stringifyId(row.id),
    cardAnkiId: stringifyId(row.cid),
    usn: numberOrDefault(row.usn),
    ease: numberOrDefault(row.ease),
    interval: numberOrDefault(row.ivl),
    lastInterval: numberOrDefault(row.lastIvl),
    factor: numberOrDefault(row.factor),
    time: numberOrDefault(row.time),
    type: numberOrDefault(row.type),
  }));
}

export async function parseAnkiCollection(
  collectionBytes: ArrayBuffer | Uint8Array,
  initSqlJs?: InitSqlJs
): Promise<ParsedAnkiCollection> {
  const SQL = await getSqlJs(initSqlJs);
  const db = new SQL.Database(toBytes(collectionBytes));
  try {
    const col = firstRow(
      db,
      'select id,crt,mod,scm,dty,usn,conf,models,decks,dconf,tags from col limit 1'
    );
    const modelsJson = stringOrNull(col.models);
    const decksJson = stringOrNull(col.decks);
    const hasModernNotetypeTables =
      tableExists(db, 'notetypes') &&
      tableExists(db, 'fields') &&
      tableExists(db, 'templates');
    const hasModernDeckTables = tableExists(db, 'decks');
    const useModernNotetypes =
      hasModernNotetypeTables &&
      (isEmptyLegacyBlob(modelsJson) || tableHasRows(db, 'notetypes'));
    const useModernDecks =
      hasModernDeckTables &&
      (isEmptyLegacyBlob(decksJson) || tableHasRows(db, 'decks'));

    return {
      collection: {
        ankiId: stringifyId(col.id || 1),
        collectionMod: numberOrNull(col.mod),
        schemaMod: numberOrNull(col.scm),
        usn: numberOrDefault(col.usn),
        createdSecs: numberOrNull(col.crt),
        dirty: numberOrDefault(col.dty),
        confJson: stringOrNull(col.conf),
        decksJson,
        deckConfigJson: stringOrNull(col.dconf),
        tagsJson: stringOrNull(col.tags),
        modelsJson,
      },
      notetypes: useModernNotetypes
        ? parseModernNotetypes(db)
        : parseNotetypes(modelsJson),
      decks: useModernDecks ? parseModernDecks(db) : parseDecks(decksJson),
      notes: parseNotes(db),
      cards: parseCards(db),
      revlog: parseRevlog(db),
    };
  } finally {
    db.close();
  }
}
