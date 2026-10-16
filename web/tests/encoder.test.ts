import { describe, expect, it } from 'vitest';
import { GifReader } from 'omggif';
import { GifEncoder } from '../src/gif/encoder';

interface Decoded {
  width: number;
  height: number;
  delays: number[]; // ms
  frames: Uint8ClampedArray[]; // composited, RGBA
  loops: boolean;
}

/** Decodes with an independent library, compositing frames the way a viewer does. */
function decode(gif: Uint8Array): Decoded {
  const reader = new GifReader(gif as unknown as Uint8Array);
  const { width, height } = reader;
  const canvas = new Uint8ClampedArray(width * height * 4);
  // Unpainted (transparent) pixels stay as-is; start from opaque black to notice any holes.
  for (let i = 3; i < canvas.length; i += 4) canvas[i] = 255;
  const frames: Uint8ClampedArray[] = [];
  const delays: number[] = [];
  for (let i = 0; i < reader.numFrames(); i++) {
    reader.decodeAndBlitFrameRGBA(i, canvas);
    frames.push(canvas.slice());
    delays.push(reader.frameInfo(i).delay * 10);
  }
  const loops = reader.loopCount() !== null;
  return { width, height, delays, frames, loops };
}

function solid(w: number, h: number, r: number, g: number, b: number): Uint8ClampedArray {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) d.set([r, g, b, 255], i * 4);
  return d;
}

/** Deterministic pseudo-random numbers so failures are reproducible. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function meanError(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < a.length; i += 4) {
    sum += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
    n += 3;
  }
  return sum / n;
}

function maxError(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let max = 0;
  for (let i = 0; i < a.length; i += 4) {
    max = Math.max(max, Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]));
  }
  return max;
}

describe('GifEncoder', () => {
  it('writes a valid header, size, trailer and loop extension', () => {
    const enc = new GifEncoder(8, 6, true);
    enc.addFrame(solid(8, 6, 10, 20, 30), 100);
    const gif = enc.finish();
    expect(String.fromCharCode(...gif.subarray(0, 6))).toBe('GIF89a');
    expect(gif[gif.length - 1]).toBe(0x3b);
    const d = decode(gif);
    expect([d.width, d.height]).toEqual([8, 6]);
    expect(d.loops).toBe(true);
  });

  it('omits the loop extension when looping is off', () => {
    const enc = new GifEncoder(4, 4, false);
    enc.addFrame(solid(4, 4, 1, 2, 3), 100);
    expect(decode(enc.finish()).loops).toBe(false);
  });

  it('reproduces solid colors exactly (single-color palette)', () => {
    const enc = new GifEncoder(5, 5, true);
    enc.addFrame(solid(5, 5, 200, 100, 50), 100);
    const f = decode(enc.finish()).frames[0];
    // 5-bit binning only affects grouping; the palette holds the true average, so it is exact.
    expect(Array.from(f.subarray(0, 4))).toEqual([200, 100, 50, 255]);
    expect(maxError(f, solid(5, 5, 200, 100, 50))).toBe(0);
  });

  it('handles the smallest image (1x1)', () => {
    const enc = new GifEncoder(1, 1, true);
    enc.addFrame(solid(1, 1, 255, 0, 0), 50);
    enc.addFrame(solid(1, 1, 0, 0, 255), 50);
    const d = decode(enc.finish());
    expect(d.frames).toHaveLength(2);
    expect(Array.from(d.frames[0].subarray(0, 3))).toEqual([255, 0, 0]);
    expect(Array.from(d.frames[1].subarray(0, 3))).toEqual([0, 0, 255]);
  });

  it('keeps frame count and per-frame delays (rounded to 10 ms, minimum 20 ms)', () => {
    const enc = new GifEncoder(4, 4, true);
    const delays = [50, 123, 200, 80, 10, 5];
    delays.forEach((ms, i) => enc.addFrame(solid(4, 4, i * 30, 0, 0), ms));
    const d = decode(enc.finish());
    expect(d.frames).toHaveLength(delays.length);
    expect(d.delays).toEqual([50, 120, 200, 80, 20, 20]);
  });

  it('keeps the total duration even though delays are rounded to 10 ms steps', () => {
    // 66 ms (a typical 15 fps frame) cannot be written exactly; naive rounding would make it 70 ms every time.
    const enc = new GifEncoder(4, 4, true);
    for (let i = 0; i < 45; i++) enc.addFrame(solid(4, 4, i * 5, 0, 0), 66);
    const d = decode(enc.finish());
    const total = d.delays.reduce((a, b) => a + b, 0);
    expect(Math.abs(total - 45 * 66)).toBeLessThanOrEqual(10);
    expect(new Set(d.delays)).toEqual(new Set([60, 70])); // alternates between the two nearest steps
  });

  it('round-trips an image with few colors exactly, including LZW dictionary resets', () => {
    // 400x400 random pixels from 200 distinct colors: ~160k codes, so the 4096-entry table fills many times.
    const w = 400;
    const h = 400;
    const rand = rng(1);
    const palette = Array.from({ length: 200 }, (_, i) => [(i * 37) % 256, (i * 91) % 256, (i * 53) % 256]);
    const img = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const c = palette[Math.floor(rand() * palette.length)];
      img.set([c[0], c[1], c[2], 255], i * 4);
    }
    const enc = new GifEncoder(w, h, true);
    enc.addFrame(img, 100);
    const f = decode(enc.finish()).frames[0];
    // Colors that share a 15-bit bin are merged into their average, so allow a tiny difference.
    expect(maxError(f, img)).toBeLessThanOrEqual(8);
    expect(meanError(f, img)).toBeLessThan(1);
  });

  it('keeps photographic content close to the original (mean error)', () => {
    const w = 320;
    const h = 200;
    const rand = rng(2);
    const img = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const v = 128 + 60 * Math.sin(x / 9) * Math.cos(y / 11) + (rand() - 0.5) * 12;
        img.set([v, v + 20, 255 - v, 255], (y * w + x) * 4);
      }
    }
    const enc = new GifEncoder(w, h, true);
    enc.addFrame(img, 100);
    expect(meanError(decode(enc.finish()).frames[0], img)).toBeLessThan(4);
  });

  it('stores only what changed and still reconstructs every frame', () => {
    const w = 200;
    const h = 120;
    const frames: Uint8ClampedArray[] = [];
    for (let i = 0; i < 12; i++) {
      const img = solid(w, h, 30, 30, 60);
      // a 24x24 square moving to the right on a flat background
      for (let y = 40; y < 64; y++) for (let x = i * 10; x < i * 10 + 24; x++) img.set([240, 80, 40, 255], (y * w + x) * 4);
      frames.push(img);
    }

    const delta = new GifEncoder(w, h, true);
    frames.forEach((f) => delta.addFrame(f, 80));
    const deltaGif = delta.finish();

    const d = decode(deltaGif);
    expect(d.frames).toHaveLength(12);
    frames.forEach((f, i) => expect(maxError(d.frames[i], f)).toBe(0));

    // Compared with writing every frame in full (each frame is made different by a 1-pixel noise dot).
    const full = new GifEncoder(w, h, true);
    frames.forEach((f, i) => {
      const g = f.slice();
      g.set([i * 20, 0, 0, 255], 0);
      full.addFrame(g, 80);
      g.set([i * 20 + 1, 0, 0, 255], 4 * (w * h - 1)); // keep both corners changing
    });
    expect(deltaGif.length).toBeLessThan(full.finish().length);
  });

  it('survives identical consecutive frames (nothing changed)', () => {
    const img = solid(30, 30, 90, 120, 150);
    const enc = new GifEncoder(30, 30, true);
    enc.addFrame(img, 100);
    enc.addFrame(img, 150);
    enc.addFrame(img, 200);
    const d = decode(enc.finish());
    expect(d.frames).toHaveLength(3);
    expect(d.delays).toEqual([100, 150, 200]);
    d.frames.forEach((f) => expect(maxError(f, img)).toBe(0));
  });

  it('is independent of the caller reusing its buffer', () => {
    const buf = solid(16, 16, 10, 10, 10);
    const enc = new GifEncoder(16, 16, true);
    enc.addFrame(buf, 100);
    buf.fill(250); // overwritten after the call
    enc.addFrame(solid(16, 16, 250, 250, 250), 100);
    const d = decode(enc.finish());
    expect(d.frames[0][0]).toBe(10);
    expect(d.frames[1][0]).toBe(250);
  });

  it('works for widths that are not multiples of 4 or 8', () => {
    for (const [w, h] of [[3, 7], [13, 5], [97, 31]] as const) {
      // Few distinct colors, so a 255-color palette can represent the image (random full-range noise could not).
      const rand = rng(w * 100 + h);
      const palette = Array.from({ length: 40 }, (_, i) => [(i * 67) % 256, (i * 29) % 256, (i * 113) % 256]);
      const img = new Uint8ClampedArray(w * h * 4);
      for (let i = 0; i < w * h; i++) {
        const c = palette[Math.floor(rand() * palette.length)];
        img.set([c[0], c[1], c[2], 255], i * 4);
      }
      const enc = new GifEncoder(w, h, true);
      enc.addFrame(img, 100);
      expect(maxError(decode(enc.finish()).frames[0], img)).toBeLessThanOrEqual(8);
    }
  });

  it('rejects invalid sizes and short frames', () => {
    expect(() => new GifEncoder(0, 10, true)).toThrow();
    expect(() => new GifEncoder(70000, 10, true)).toThrow();
    const enc = new GifEncoder(4, 4, true);
    expect(() => enc.addFrame(new Uint8ClampedArray(10), 100)).toThrow();
  });
});
