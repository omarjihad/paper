/**
 * ترميز مضغوط لشبكة الأرض.
 * الأرض 150×150 = 22500 خلية؛ إرسالها خامًا كل مرة هدر، لكن أغلبها مساحات
 * متصلة لمالك واحد، فترميز الأطوال (RLE) يختصرها إلى مئات البايتات.
 * الخرج نص Base64 كي يمر في JSON بلا ثنائي خام.
 */

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_INDEX: Record<string, number> = {};
for (let i = 0; i < B64.length; i++) B64_INDEX[B64[i]] = i;

/** يحوّل الشبكة إلى أزواج (طول متغيّر الحجم، قيمة) ثم Base64. */
export function encodeRle(data: Uint8Array): string {
  const bytes: number[] = [];
  let i = 0;
  while (i < data.length) {
    const value = data[i];
    let run = 1;
    while (i + run < data.length && data[i + run] === value) run++;
    writeVarint(bytes, run);
    bytes.push(value);
    i += run;
  }
  return toBase64(bytes);
}

/** يفكّ الترميز داخل مصفوفة جاهزة. يعيد false إذا لم يطابق الطول المتوقع. */
export function decodeRle(text: string, out: Uint8Array): boolean {
  const bytes = fromBase64(text);
  let cursor = 0;
  let index = 0;
  while (cursor < bytes.length) {
    const read = readVarint(bytes, cursor);
    if (!read) return false;
    cursor = read.next;
    if (cursor >= bytes.length) return false;
    const value = bytes[cursor++];
    const end = index + read.value;
    if (end > out.length) return false;
    out.fill(value, index, end);
    index = end;
  }
  return index === out.length;
}

function writeVarint(bytes: number[], value: number): void {
  let rest = value;
  while (rest >= 0x80) {
    bytes.push((rest & 0x7f) | 0x80);
    rest >>>= 7;
  }
  bytes.push(rest);
}

function readVarint(bytes: Uint8Array, start: number): { value: number; next: number } | null {
  let value = 0;
  let shift = 0;
  let cursor = start;
  while (cursor < bytes.length) {
    const byte = bytes[cursor++];
    value |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return { value: value >>> 0, next: cursor };
    shift += 7;
    if (shift > 28) return null;
  }
  return null;
}

/** Base64 يدوي: يعمل في المتصفح وفي Node بلا أي اعتماد. */
function toBase64(bytes: readonly number[]): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += B64[b0 >> 2];
    out += B64[((b0 & 3) << 4) | (b1 >> 4)];
    out += i + 1 < bytes.length ? B64[((b1 & 15) << 2) | (b2 >> 6)] : '=';
    out += i + 2 < bytes.length ? B64[b2 & 63] : '=';
  }
  return out;
}

function fromBase64(text: string): Uint8Array {
  let clean = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '=' && B64_INDEX[text[i]] !== undefined) clean++;
  }
  const out = new Uint8Array(((clean * 6) / 8) | 0);
  let bits = 0;
  let acc = 0;
  let index = 0;
  for (let i = 0; i < text.length; i++) {
    const value = B64_INDEX[text[i]];
    if (value === undefined) continue;
    acc = (acc << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[index++] = (acc >> bits) & 0xff;
    }
  }
  return out.subarray(0, index);
}
