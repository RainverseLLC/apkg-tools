import { describe, expect, it } from 'vitest';
import { parseAnkiCollection } from '../src/parse-collection';
import { getSqlJs } from '../src/sql';
import { modernCollectionBytes } from './helpers';

async function fixtureCollectionBytes() {
  const SQL = await getSqlJs();
  const db = new SQL.Database();
  db.run(`
    create table col (
      id integer primary key, crt integer, mod integer, scm integer, ver integer,
      dty integer, usn integer, ls integer, conf text, models text, decks text,
      dconf text, tags text
    );
    create table notes (
      id integer primary key, guid text, mid integer, mod integer, usn integer,
      tags text, flds text, sfld text, csum integer, flags integer, data text
    );
    create table cards (
      id integer primary key, nid integer, did integer, ord integer, mod integer,
      usn integer, type integer, queue integer, due integer, ivl integer,
      factor integer, reps integer, lapses integer, left integer, odue integer,
      odid integer, flags integer, data text
    );
    create table revlog (
      id integer primary key, cid integer, usn integer, ease integer, ivl integer,
      lastIvl integer, factor integer, time integer, type integer
    );
  `);

  const models = {
    '1001': {
      id: 1001,
      name: 'Basic',
      type: 0,
      mod: 1,
      usn: 0,
      sortf: 0,
      css: '.card { color: black; }',
      flds: [
        { name: 'Front', ord: 0, sticky: 0, rtl: 0, font: 'Arial', size: 20 },
        { name: 'Back', ord: 1, sticky: 0, rtl: 0, font: 'Arial', size: 20 },
      ],
      tmpls: [
        {
          name: 'Card 1',
          ord: 0,
          qfmt: '{{Front}}',
          afmt: '{{FrontSide}}<hr id=answer>{{Back}}',
        },
      ],
    },
  };
  const decks = {
    '1': { id: 1, name: 'Default', mod: 1, usn: 0, conf: 1, dyn: 0 },
    '2': { id: 2, name: 'Default::Child', mod: 1, usn: 0, conf: 1, dyn: 0 },
  };

  db.run(
    `insert into col
     (id,crt,mod,scm,ver,dty,usn,ls,conf,models,decks,dconf,tags)
     values (1,100,200,300,11,0,5,0,'{}',$models,$decks,'{}','{}')`,
    {
      $models: JSON.stringify(models),
      $decks: JSON.stringify(decks),
    }
  );
  db.run(
    `insert into notes
     (id,guid,mid,mod,usn,tags,flds,sfld,csum,flags,data)
     values (10,'guid',1001,201,0,' tag ','Question\x1fAnswer','Question',1,0,'')`
  );
  db.run(
    `insert into cards
     (id,nid,did,ord,mod,usn,type,queue,due,ivl,factor,reps,lapses,left,odue,odid,flags,data)
     values (20,10,2,0,202,0,2,2,7,4,2500,3,1,0,0,0,0,'')`
  );
  db.run(
    `insert into revlog
     (id,cid,usn,ease,ivl,lastIvl,factor,time,type)
     values (30,20,0,3,4,2,2500,1000,1)`
  );

  const bytes = db.export();
  db.close();
  return bytes;
}

describe('parseAnkiCollection', () => {
  it('parses core Anki SQLite rows', async () => {
    const parsed = await parseAnkiCollection(await fixtureCollectionBytes());

    expect(parsed.notetypes).toHaveLength(1);
    expect(parsed.notetypes[0]?.fields.map((field) => field.name)).toEqual([
      'Front',
      'Back',
    ]);
    expect(parsed.decks.find((deck) => deck.ankiId === '2')?.parentAnkiId).toBe(
      '1'
    );
    expect(parsed.notes[0]?.fields).toBe('Question\x1fAnswer');
    expect(parsed.cards[0]?.deckAnkiId).toBe('2');
    expect(parsed.revlog).toHaveLength(1);
  });

  it('parses modern Anki schema tables and protobuf configs', async () => {
    const parsed = await parseAnkiCollection(modernCollectionBytes());

    expect(parsed.notes).toHaveLength(2);
    expect(parsed.cards).toHaveLength(2);
    expect(parsed.notetypes.length).toBeGreaterThan(0);
    expect(parsed.decks.length).toBeGreaterThan(0);

    const basic = parsed.notetypes.find(
      (notetype) => notetype.name === 'Basic'
    );
    expect(basic?.css).toContain('.card');
    expect(basic?.fields.map((field) => field.name)).toEqual(['Front', 'Back']);
    expect(basic?.templates[0]?.qfmt).toContain('{{Front}}');
    expect(basic?.templates[0]?.afmt).toContain('{{FrontSide}}');
    expect(basic?.templates[0]?.afmt).toContain('{{Back}}');

    const parentDeck = parsed.decks.find(
      (deck) => deck.fullName === 'Flashify'
    );
    const childDeck = parsed.decks.find(
      (deck) => deck.fullName === 'Flashify::Native Sync Test'
    );
    expect(parentDeck).toBeDefined();
    expect(childDeck).toMatchObject({
      name: 'Native Sync Test',
      parentAnkiId: parentDeck?.ankiId,
    });
  });
});
