import { decompress } from 'fzstd';

export function maybeDecompressMedia(bytes: Uint8Array): Uint8Array {
  return bytes[0] === 0x28 &&
    bytes[1] === 0xb5 &&
    bytes[2] === 0x2f &&
    bytes[3] === 0xfd
    ? decompress(bytes)
    : bytes;
}

/** Anki MediaEntries: repeated entry (1), name (1), optional legacy index (255).
 * https://github.com/ankitects/anki/blob/main/proto/anki/import_export.proto
 */
export function decodeMediaIndex(raw: Uint8Array): Record<string, string> {
  const bytes = maybeDecompressMedia(raw);
  const text = new TextDecoder().decode(bytes);
  if (text.trimStart().startsWith('{')) {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error('Invalid media map');
    return Object.fromEntries(
      Object.entries(value).filter(
        ([key, name]) => /^\d+$/.test(key) && typeof name === 'string'
      )
    );
  }
  const entries = protoFields(bytes).filter(
    (field) => field.tag === 1 && field.value instanceof Uint8Array
  );
  return Object.fromEntries(
    entries.map((entry, index) => {
      const fields = protoFields(entry.value as Uint8Array);
      const name = fields.find((field) => field.tag === 1)?.value;
      const legacyIndex = fields.find((field) => field.tag === 255)?.value;
      if (!(name instanceof Uint8Array))
        throw new Error('Missing media filename');
      return [
        String(typeof legacyIndex === 'number' ? legacyIndex : index),
        new TextDecoder().decode(name),
      ];
    })
  );
}

function protoFields(bytes: Uint8Array) {
  let offset = 0;
  function varint() {
    let value = 0;
    for (let shift = 0; shift < 49; shift += 7) {
      if (offset >= bytes.length) throw new Error('Truncated protobuf');
      const byte = bytes[offset++];
      value += (byte & 127) * 2 ** shift;
      if (!(byte & 128)) return value;
    }
    throw new Error('Invalid protobuf varint');
  }
  const fields: Array<{ tag: number; value: number | Uint8Array }> = [];
  while (offset < bytes.length) {
    const key = varint();
    const tag = Math.floor(key / 8);
    const wire = key % 8;
    if (!tag) throw new Error('Invalid protobuf tag');
    if (wire === 0) fields.push({ tag, value: varint() });
    else {
      const size = wire === 2 ? varint() : wire === 1 ? 8 : wire === 5 ? 4 : -1;
      if (size < 0 || offset + size > bytes.length)
        throw new Error('Invalid protobuf field');
      fields.push({ tag, value: bytes.subarray(offset, offset + size) });
      offset += size;
    }
  }
  return fields;
}
