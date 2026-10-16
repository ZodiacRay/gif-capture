import { describe, expect, it } from 'vitest';
import { decodeGif, delayToMs, readGifHeader } from '../src/gif/decoder';
import { GifEncoder } from '../src/gif/encoder';

// 4-color global palette used by the hand-built test GIFs.
const RED = [255, 0, 0];
const GREEN = [0, 255, 0];
const BLUE = [0, 0, 255];
const YELLOW = [255, 255, 0];
const WHITE = [255, 255, 255];
const PALETTE = [RED, GREEN, BLUE, YELLOW];

interface TestFrame {
  x?: number;
  y?: number;
  w: number;
  h: number;
  /** Palette index for every pixel of the frame rectangle (row-major). */
  pixels: number[];
  delayCentis?: number;
  disposal?: number;
  transparentIndex?: number;
}

/** Valid but uncompressed LZW: a clear code every 2 pixels keeps the table small enough for 3-bit codes. */
function lzwLiteral(indices: number[]): number[] {
  const out: number[] = [];
  let bits = 0;
  let count = 0;
  const emit = (code: number): void => {
    bits |= code << count;
    count += 3;
    while (count >= 8) {
      out.push(bits & 255);
      bits >>= 8;
      count -= 8;
    }
  };
  for (let i = 0; i < indices.length; i += 2) {
    emit(4); // clear
    for (const p of indices.slice(i, i + 2)) emit(p);
  }
  emit(5); // end of information
  if (count > 0) out.push(bits & 255);
  return out;
}

function buildGif(w: number, h: number, frames: TestFrame[]): Uint8Array {
  const b: number[] = [];
  const u16 = (v: number): void => void b.push(v & 255, (v >> 8) & 255);
  b.push(...'GIF89a'.split('').map((c) => c.charCodeAt(0)));
  u16(w);
  u16(h);
  b.push(0x80 | 0x70 | 1, 0, 0); // global table of 4 colors
  for (const c of PALETTE) b.push(...c);
  for (const f of frames) {
    const trans = f.transparentIndex !== undefined;
    b.push(0x21, 0xf9, 0x04, ((f.disposal ?? 0) << 2) | (trans ? 1 : 0));
    u16(f.delayCentis ?? 10);
    b.push(f.transparentIndex ?? 0, 0);
    b.push(0x2c);
    u16(f.x ?? 0);
    u16(f.y ?? 0);
    u16(f.w);
    u16(f.h);
    b.push(0, 2); // no local table, min code size 2
    const data = lzwLiteral(f.pixels);
    for (let i = 0; i < data.length; i += 255) {
      const chunk = data.slice(i, i + 255);
      b.push(chunk.length, ...chunk);
    }
    b.push(0);
  }
  b.push(0x3b);
  return Uint8Array.from(b);
}

const fill = (n: number, index: number): number[] => Array(n).fill(index);
const pixel = (rgba: Uint8ClampedArray, w: number, x: number, y: number): number[] =>
  Array.from(rgba.subarray((y * w + x) * 4, (y * w + x) * 4 + 3));

describe('decodeGif', () => {
  it('reads the header without decoding frames', () => {
    const gif = buildGif(4, 3, [{ w: 4, h: 3, pixels: fill(12, 0) }, { w: 4, h: 3, pixels: fill(12, 1) }]);
    expect(readGifHeader(gif)).toEqual({ width: 4, height: 3, frameCount: 2 });
  });

  it('decodes full frames and converts delays', () => {
    const gif = buildGif(2, 2, [
      { w: 2, h: 2, pixels: fill(4, 0), delayCentis: 5 },
      { w: 2, h: 2, pixels: fill(4, 1), delayCentis: 0 },
      { w: 2, h: 2, pixels: fill(4, 2), delayCentis: 1 },
      { w: 2, h: 2, pixels: fill(4, 3), delayCentis: 12 },
    ]);
    const frames = [...decodeGif(gif)];
    expect(frames.map((f) => f.delayMs)).toEqual([50, 100, 100, 120]);
    expect(frames.map((f) => pixel(f.rgba, 2, 0, 0))).toEqual([RED, GREEN, BLUE, YELLOW]);
    expect(delayToMs(0)).toBe(100);
    expect(delayToMs(2)).toBe(20);
  });

  it('places partial frames at their offset and keeps the rest (disposal 1)', () => {
    const gif = buildGif(4, 4, [
      { w: 4, h: 4, pixels: fill(16, 1), disposal: 1 },
      { x: 1, y: 2, w: 2, h: 1, pixels: [0, 2], disposal: 1 },
    ]);
    const [, second] = [...decodeGif(gif)];
    expect(pixel(second.rgba, 4, 1, 2)).toEqual(RED);
    expect(pixel(second.rgba, 4, 2, 2)).toEqual(BLUE);
    expect(pixel(second.rgba, 4, 0, 0)).toEqual(GREEN); // untouched area stays
    expect(pixel(second.rgba, 4, 3, 2)).toEqual(GREEN);
  });

  it('transparent pixels let the previous frame show through', () => {
    const gif = buildGif(2, 1, [
      { w: 2, h: 1, pixels: [0, 0], disposal: 1 },
      { w: 2, h: 1, pixels: [3, 2], disposal: 1, transparentIndex: 3 },
    ]);
    const [, second] = [...decodeGif(gif)];
    expect(pixel(second.rgba, 2, 0, 0)).toEqual(RED); // index 3 was transparent
    expect(pixel(second.rgba, 2, 1, 0)).toEqual(BLUE);
  });

  it('disposal 2 clears the previous frame area to the background (white)', () => {
    const gif = buildGif(4, 4, [
      { x: 0, y: 0, w: 2, h: 2, pixels: fill(4, 0), disposal: 2 },
      { x: 2, y: 2, w: 2, h: 2, pixels: fill(4, 2), disposal: 1 },
    ]);
    const [first, second] = [...decodeGif(gif)];
    expect(pixel(first.rgba, 4, 0, 0)).toEqual(RED);
    expect(pixel(second.rgba, 4, 0, 0)).toEqual(WHITE); // red was disposed
    expect(pixel(second.rgba, 4, 3, 3)).toEqual(BLUE);
  });

  it('disposal 3 restores what was there before the frame was drawn', () => {
    const gif = buildGif(4, 4, [
      { w: 4, h: 4, pixels: fill(16, 1), disposal: 1 },
      { x: 0, y: 0, w: 2, h: 2, pixels: fill(4, 0), disposal: 3 }, // red patch, then restore
      { x: 3, y: 3, w: 1, h: 1, pixels: [2], disposal: 1 },
    ]);
    const [, second, third] = [...decodeGif(gif)];
    expect(pixel(second.rgba, 4, 0, 0)).toEqual(RED);
    expect(pixel(third.rgba, 4, 0, 0)).toEqual(GREEN); // patch gone, original green back
    expect(pixel(third.rgba, 4, 3, 3)).toEqual(BLUE);
  });

  it('flattens unpainted areas onto white and returns fully opaque pixels', () => {
    const gif = buildGif(3, 1, [{ x: 1, w: 1, h: 1, y: 0, pixels: [0] }]);
    const [f] = [...decodeGif(gif)];
    expect(pixel(f.rgba, 3, 0, 0)).toEqual(WHITE);
    expect(pixel(f.rgba, 3, 1, 0)).toEqual(RED);
    for (let i = 3; i < f.rgba.length; i += 4) expect(f.rgba[i]).toBe(255);
  });

  it('round-trips frames made by our own encoder', () => {
    const w = 60;
    const h = 40;
    const frames: Uint8ClampedArray[] = [];
    for (let i = 0; i < 5; i++) {
      const img = new Uint8ClampedArray(w * h * 4);
      for (let p = 0; p < w * h; p++) img.set([20, 30, 70, 255], p * 4);
      for (let y = 10; y < 22; y++) for (let x = i * 8; x < i * 8 + 12; x++) img.set([230, 90, 40, 255], (y * w + x) * 4);
      frames.push(img);
    }
    const enc = new GifEncoder(w, h, true);
    frames.forEach((f, i) => enc.addFrame(f, 50 + i * 10));
    const decoded = [...decodeGif(enc.finish())];
    expect(decoded).toHaveLength(5);
    expect(decoded.map((d) => d.delayMs)).toEqual([50, 60, 70, 80, 90]);
    decoded.forEach((d, i) => expect(Array.from(d.rgba)).toEqual(Array.from(frames[i])));
  });

  it('gives a readable error for files that are not GIFs', () => {
    expect(() => [...decodeGif(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))]).toThrow(/GIF/);
    expect(() => readGifHeader(new Uint8Array(0))).toThrow(/GIF/);
  });
});
