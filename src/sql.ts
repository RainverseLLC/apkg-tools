import type { SqlJsStatic } from 'sql.js';

export type InitSqlJs = (config?: {
  locateFile?: (file: string) => string;
  wasmBinary?: ArrayBuffer;
}) => Promise<SqlJsStatic>;

let cachedDefault: Promise<SqlJsStatic> | null = null;

/**
 * Load sql.js. Node resolves wasm from `sql.js` in node_modules. In the
 * browser, pass the initializer from `sql.js` with `locateFile` pointing at
 * `sql-wasm.wasm`.
 */
export async function getSqlJs(init?: InitSqlJs): Promise<SqlJsStatic> {
  if (init) return init();
  if (!cachedDefault) cachedDefault = loadDefaultSqlJs();
  return cachedDefault;
}

async function loadDefaultSqlJs(): Promise<SqlJsStatic> {
  const initSqlJs = (await import('sql.js')).default as InitSqlJs;
  if (typeof process !== 'undefined' && process.versions?.node) {
    const { createRequire } = await import('node:module');
    const { dirname, join } = await import('node:path');
    const require = createRequire(import.meta.url);
    const wasmPath = require.resolve('sql.js/dist/sql-wasm.wasm');
    return initSqlJs({
      locateFile: (file) => join(dirname(wasmPath), file),
    });
  }
  throw new Error(
    'In the browser, pass initSqlJs from sql.js with locateFile pointing at sql-wasm.wasm.'
  );
}
