# apkg-tools

Read and write Anki `.apkg` / `.colpkg` packages and convert them to and from CSV, in the browser and in Node — no Anki install, and files never leave the device.

## Install

```bash
npm install github:RainverseLLC/apkg-tools
```

(The npm registry release is coming; until then, install straight from GitHub. The package builds itself on install.)

Requires Node.js 18 or newer. The package is ESM-only.

Dependencies: `jszip`, `sql.js` 1.14.x, `fzstd`. Anki collections use a custom `unicase` collation; sql.js 1.15+ wasm builds cannot open those tables, so this package pins 1.14.1.

## Usage

### Read a package

```ts
import { readFile } from 'node:fs/promises';
import { openApkg } from 'apkg-tools';

const data = await readFile('deck.apkg');
const opened = await openApkg(data);

opened.format; // 'anki2' | 'anki21' | 'anki21b'
opened.notes; // one record per Anki note
opened.cards;
opened.decks;
opened.notetypes;
opened.media; // [{ filename, data }]
```

`openApkg` accepts `.apkg` and `.colpkg`, including zstd-compressed `collection.anki21b` (Anki's current default export).

### Export CSV

```ts
import { apkgToCsv, ANKI_ROUND_TRIP_PRESET } from 'apkg-tools';

// Spreadsheet preset: comma-separated, plain text, formula injection guards
const csv = apkgToCsv(opened.parsed);

// Anki 2.1.54+ import headers so the file maps itself on the way back
const tsv = apkgToCsv(opened.parsed, ANKI_ROUND_TRIP_PRESET);
```

One row per note. Columns follow Anki's "Notes in Plain Text" export (GUID, note type, deck, fields, tags) when you use the round-trip preset.

You can also call `apkgToRows(opened.parsed)` for the table without joining it into text, or `parseCsv(text)` / `parseDelimited(text)` to read RFC 4180 CSV (including Anki `#separator:` / `#columns:` headers). Quizlet's unquoted export is `parseSeparated(text, { fieldSeparator, rowSeparator })`.

### CSV → `.apkg`

```ts
import { writeFile } from 'node:fs/promises';
import { csvToNotes, createApkg } from 'apkg-tools';

const { notes } = csvToNotes(csvText, { deckName: 'Spanish verbs' });
const apkg = await createApkg(notes, { deckName: 'Spanish verbs' });
await writeFile('spanish-verbs.apkg', apkg);
```

`createApkg` writes Basic (`Front` / `Back` / `Extra` / `Source`) and Cloze (`Text` / `Extra` / `Source`) notes into a standard Anki package.

### Browser (sql.js wasm)

In the browser you provide sql.js's wasm yourself, and you pass the bundled blank template into `createApkg`:

```ts
import initSqlJs from 'sql.js';
import { openApkg, createApkg, csvToNotes } from 'apkg-tools';
import templateUrl from 'apkg-tools/template';

const init = () =>
  initSqlJs({ locateFile: (file) => `https://sql.js.org/dist/${file}` });

const opened = await openApkg(await file.arrayBuffer(), { initSqlJs: init });

const template = new Uint8Array(await fetch(templateUrl).then((r) => r.arrayBuffer()));
const { notes } = csvToNotes(csvText, { deckName: 'Imported cards' });
const apkg = await createApkg(notes, {
  deckName: 'Imported cards',
  template,
  initSqlJs: init,
});
```

Node resolves `sql.js`'s wasm from `node_modules` and the bundled template from `data/template-basic.apkg`, so those options are optional there.

## API

| Function | What it does |
| --- | --- |
| `openApkg(data, opts?)` | Unzip, decompress zstd if needed, parse the collection with sql.js. |
| `apkgToRows(parsed, opts?)` | One row per note. |
| `apkgToCsv(parsed, opts?)` | Same, as RFC 4180 text. |
| `parseCsv(text)` / `parseDelimited(text)` | RFC 4180 + Anki 2.1.54+ file headers. |
| `parseSeparated(text, seps)` | Quizlet-style split (no quoting). |
| `csvToNotes(text \| rows, opts?)` | Map columns → Basic / Cloze notes. |
| `createApkg(notes, { deckName })` | Write a standard `.apkg`. |

## Limits

This package only handles the file format. It does not sync with AnkiWeb, AnkiMobile, or AnkiDroid. It does not render card templates and it does not clean card HTML — if you display fields, clean them first. Advanced note types such as image occlusion are out of scope.

## Try it in the browser

The same conversion core runs in these GuruOwl tools (files stay in the tab):

- [APKG Viewer](https://guruowl.com/apkg-viewer)
- [APKG to CSV](https://guruowl.com/apkg-to-csv)
- [CSV to Anki](https://guruowl.com/csv-to-anki)

## License

MIT. Maintained by Rainverse LLC, the team behind [GuruOwl](https://guruowl.com).

apkg-tools is not affiliated with Anki, AnkiMobile, AnkiDroid or AnkiWeb.
