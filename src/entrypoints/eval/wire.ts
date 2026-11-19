// How model task inputs and outputs cross between the quality gate's driver
// (Node) and its page: Playwright's `page.evaluate` carries JSON only, so each
// Float32Array (audio, voiceprints) travels as base64 of its bytes, exactly.

export type Wire = { f32: string } | Wire[] | { [key: string]: Wire } | string | number | boolean | null;

/** Float32Arrays → `{f32}`, everything else as is. */
export function toWire(value: unknown): Wire {
  if (value instanceof Float32Array) return { f32: toBase64(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)) };
  if (Array.isArray(value)) return value.map(toWire);
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toWire(v)]));
  return value as Wire;
}

/** The reverse of `toWire`. */
export function fromWire(value: Wire): unknown {
  if (Array.isArray(value)) return value.map(fromWire);
  if (value !== null && typeof value === 'object') {
    if (typeof value.f32 === 'string' && Object.keys(value).length === 1) return new Float32Array(fromBase64(value.f32).buffer);
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fromWire(v)]));
  }
  return value;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function fromBase64(data: string): Uint8Array {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
