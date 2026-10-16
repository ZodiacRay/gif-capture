/**
 * GIF89a encoder (no dependencies, no DOM): per-frame palettes (median cut), LZW compression, and
 * changed-area-only frames — after the first frame, pixels equal to the previous frame are written as
 * transparent so only the part of the screen that moved costs bytes. Same approach as the desktop app.
 *
 * Pixel data is RGBA (alpha is ignored; frames are treated as opaque). Uint32 views assume a
 * little-endian machine, which is every browser platform.
 */

const MAX_PALETTE_COLORS = 255; // one slot is kept for the transparent index

/** Growable byte buffer. */
class ByteWriter {
  private buf = new Uint8Array(1 << 16);
  length = 0;

  private ensure(extra: number): void {
    if (this.length + extra <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.length + extra) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf.subarray(0, this.length));
    this.buf = next;
  }

  byte(b: number): void {
    this.ensure(1);
    this.buf[this.length++] = b;
  }

  u16(v: number): void {
    this.byte(v & 0xff);
    this.byte((v >> 8) & 0xff);
  }

  ascii(s: string): void {
    for (let i = 0; i < s.length; i++) this.byte(s.charCodeAt(i));
  }

  bytes(src: Uint8Array, start = 0, end = src.length): void {
    const n = end - start;
    this.ensure(n);
    this.buf.set(src.subarray(start, end), this.length);
    this.length += n;
  }

  result(): Uint8Array {
    return this.buf.slice(0, this.length);
  }
}

export interface Palette {
  /** RGB triplets, at most 255 colors. */
  colors: Uint8Array;
  /** 15-bit (5-5-5) color bin -> palette index. */
  lut: Int32Array;
}

/** Reduces a 15-bit color histogram (with true per-bin channel sums) to at most 255 colors. */
export function quantize(count: Int32Array, sumR: Int32Array, sumG: Int32Array, sumB: Int32Array): Palette {
  const lut = new Int32Array(32768);
  const used: number[] = [];
  for (let i = 0; i < 32768; i++) if (count[i] > 0) used.push(i);
  if (used.length === 0) return { colors: new Uint8Array(3), lut };

  const bins = Int32Array.from(used);
  const channel = (bin: number, ch: number): number => (ch === 0 ? (bin >> 10) & 31 : ch === 1 ? (bin >> 5) & 31 : bin & 31);
  const boxes: { lo: number; hi: number }[] = [{ lo: 0, hi: bins.length }];

  const measure = (box: { lo: number; hi: number }): { pop: number; ch: number; range: number } => {
    const min = [31, 31, 31];
    const max = [0, 0, 0];
    let pop = 0;
    for (let i = box.lo; i < box.hi; i++) {
      pop += count[bins[i]];
      for (let c = 0; c < 3; c++) {
        const v = channel(bins[i], c);
        if (v < min[c]) min[c] = v;
        if (v > max[c]) max[c] = v;
      }
    }
    let best = 0;
    for (let c = 1; c < 3; c++) if (max[c] - min[c] > max[best] - min[best]) best = c;
    return { pop, ch: best, range: max[best] - min[best] };
  };

  while (boxes.length < MAX_PALETTE_COLORS) {
    let pick = -1;
    let bestScore = -1;
    let pickInfo = { pop: 0, ch: 0, range: 0 };
    for (let b = 0; b < boxes.length; b++) {
      if (boxes[b].hi - boxes[b].lo < 2) continue;
      const info = measure(boxes[b]);
      const score = info.pop * (info.range + 1);
      if (score > bestScore) {
        bestScore = score;
        pick = b;
        pickInfo = info;
      }
    }
    if (pick < 0) break;

    const { lo, hi } = boxes[pick];
    const ch = pickInfo.ch;
    bins.subarray(lo, hi).sort((a, b) => channel(a, ch) - channel(b, ch));

    let run = 0;
    let mid = lo;
    for (let i = lo; i < hi - 1; i++) {
      run += count[bins[i]];
      mid = i + 1;
      if (run * 2 >= pickInfo.pop) break;
    }
    boxes[pick] = { lo, hi: mid };
    boxes.push({ lo: mid, hi });
  }

  const colors = new Uint8Array(boxes.length * 3);
  for (let b = 0; b < boxes.length; b++) {
    let n = 0;
    let r = 0;
    let g = 0;
    let bl = 0;
    for (let i = boxes[b].lo; i < boxes[b].hi; i++) {
      const bin = bins[i];
      n += count[bin];
      r += sumR[bin];
      g += sumG[bin];
      bl += sumB[bin];
      lut[bin] = b;
    }
    colors[b * 3] = Math.floor((r + n / 2) / n);
    colors[b * 3 + 1] = Math.floor((g + n / 2) / n);
    colors[b * 3 + 2] = Math.floor((bl + n / 2) / n);
  }
  return { colors, lut };
}

/**
 * GIF flavour of LZW: variable code width up to 12 bits, clear code when the table is full.
 * Writes the data sub-blocks (including the terminator) to `out`.
 */
function lzwEncode(indices: Uint8Array, minCodeSize: number, out: ByteWriter): void {
  const MAX_CODES = 4096;
  const TABLE_SIZE = 8192; // power of two, at least twice the number of codes
  const keys = new Int32Array(TABLE_SIZE).fill(-1);
  const vals = new Int32Array(TABLE_SIZE);

  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;
  let nextCode = eoiCode + 1;
  let codeSize = minCodeSize + 1;

  const block = new Uint8Array(255);
  let blockLen = 0;
  let bits = 0;
  let bitCount = 0;

  const flushBlock = (): void => {
    if (blockLen === 0) return;
    out.byte(blockLen);
    out.bytes(block, 0, blockLen);
    blockLen = 0;
  };
  const putByte = (b: number): void => {
    block[blockLen++] = b;
    if (blockLen === 255) flushBlock();
  };
  const emit = (code: number): void => {
    bits |= code << bitCount;
    bitCount += codeSize;
    while (bitCount >= 8) {
      putByte(bits & 0xff);
      bits >>>= 8;
      bitCount -= 8;
    }
  };
  const slot = (key: number): number => {
    let h = ((key * 2654435761) >>> 19) & (TABLE_SIZE - 1);
    while (keys[h] !== -1 && keys[h] !== key) h = (h + 1) & (TABLE_SIZE - 1);
    return h;
  };

  emit(clearCode);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = (prefix << 8) | k;
    const h = slot(key);
    if (keys[h] === key) {
      prefix = vals[h];
      continue;
    }

    emit(prefix);
    if (nextCode < MAX_CODES) {
      keys[h] = key;
      vals[h] = nextCode++;
      // The decoder adds its entry one code later, so widen only after the code that fills the range.
      if (nextCode - 1 > (1 << codeSize) - 1 && codeSize < 12) codeSize++;
    } else {
      emit(clearCode);
      keys.fill(-1);
      nextCode = eoiCode + 1;
      codeSize = minCodeSize + 1;
    }
    prefix = k;
  }

  emit(prefix);
  emit(eoiCode);
  if (bitCount > 0) putByte(bits & 0xff);
  flushBlock();
  out.byte(0); // block terminator
}

export class GifEncoder {
  private readonly out = new ByteWriter();
  private prev: Uint32Array | null = null;
  private headerWritten = false;
  /** GIF delays are whole 10 ms steps; the rounding error is carried to the next frame so the total stays right. */
  private carryMs = 0;

  constructor(
    readonly width: number,
    readonly height: number,
    private readonly loop: boolean,
  ) {
    if (width < 1 || height < 1 || width > 65535 || height > 65535) throw new RangeError('Invalid GIF size');
  }

  /** @param rgba width*height*4 bytes; @param delayMs how long this frame stays on screen. */
  addFrame(rgba: Uint8ClampedArray | Uint8Array, delayMs: number): void {
    const w = this.width;
    const h = this.height;
    const n = w * h;
    if (rgba.length < n * 4) throw new RangeError('Frame data is smaller than width*height*4');

    // Copy so we never depend on the caller's buffer or its alignment, and keep it as "previous".
    const cur = new Uint32Array(n);
    new Uint8Array(cur.buffer).set(rgba.subarray(0, n * 4));

    if (!this.headerWritten) {
      this.writeHeader();
      this.headerWritten = true;
    }

    const first = this.prev === null;
    let x0 = 0;
    let y0 = 0;
    let x1 = w - 1;
    let y1 = h - 1;
    let anyChange = true;
    let mask: Uint8Array | null = null;

    if (!first) {
      const prev = this.prev as Uint32Array;
      mask = new Uint8Array(n);
      x0 = w;
      y0 = h;
      x1 = -1;
      y1 = -1;
      for (let y = 0; y < h; y++) {
        const row = y * w;
        for (let x = 0; x < w; x++) {
          if (((cur[row + x] ^ prev[row + x]) & 0x00ffffff) === 0) continue;
          mask[row + x] = 1;
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          y1 = y;
        }
      }
      anyChange = x1 >= 0;
      if (!anyChange) x0 = y0 = x1 = y1 = 0; // keep the delay with a single transparent pixel
    }

    const rw = x1 - x0 + 1;
    const rh = y1 - y0 + 1;

    // Histogram of the colors that actually have to be drawn.
    const count = new Int32Array(32768);
    const sumR = new Int32Array(32768);
    const sumG = new Int32Array(32768);
    const sumB = new Int32Array(32768);
    if (anyChange) {
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const i = y * w + x;
          if (mask !== null && mask[i] === 0) continue;
          const v = cur[i];
          const r = v & 255;
          const g = (v >> 8) & 255;
          const b = (v >> 16) & 255;
          const bin = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
          count[bin]++;
          sumR[bin] += r;
          sumG[bin] += g;
          sumB[bin] += b;
        }
      }
    }

    const { colors, lut } = quantize(count, sumR, sumG, sumB);
    const colorCount = colors.length / 3;
    const useTransparency = !first;
    const transparentIndex = colorCount;
    let tableBits = 1;
    while (1 << tableBits < colorCount + 1) tableBits++;
    const tableSize = 1 << tableBits;

    const indices = new Uint8Array(rw * rh);
    for (let y = 0; y < rh; y++) {
      for (let x = 0; x < rw; x++) {
        const i = (y0 + y) * w + (x0 + x);
        if (anyChange && (mask === null || mask[i] !== 0)) {
          const v = cur[i];
          const bin = (((v & 255) >> 3) << 10) | ((((v >> 8) & 255) >> 3) << 5) | (((v >> 16) & 255) >> 3);
          indices[y * rw + x] = lut[bin];
        } else {
          indices[y * rw + x] = useTransparency ? transparentIndex : 0;
        }
      }
    }

    // Graphic control extension: delay, transparency, "do not dispose" so later frames draw on top.
    const wanted = delayMs + this.carryMs;
    const centis = Math.max(2, Math.round(wanted / 10)); // viewers treat <2 as 10 (100 ms)
    this.carryMs = Math.min(10, Math.max(-10, wanted - centis * 10));
    const out = this.out;
    out.byte(0x21);
    out.byte(0xf9);
    out.byte(0x04);
    out.byte((1 << 2) | (useTransparency ? 1 : 0));
    out.u16(centis);
    out.byte(useTransparency ? transparentIndex : 0);
    out.byte(0x00);

    // Image descriptor with a local color table.
    out.byte(0x2c);
    out.u16(x0);
    out.u16(y0);
    out.u16(rw);
    out.u16(rh);
    out.byte(0x80 | (tableBits - 1));
    const table = new Uint8Array(tableSize * 3);
    table.set(colors);
    out.bytes(table);

    const minCodeSize = Math.max(2, tableBits);
    out.byte(minCodeSize);
    lzwEncode(indices, minCodeSize, out);

    this.prev = cur;
  }

  /** Writes the trailer and returns the finished file. */
  finish(): Uint8Array {
    if (this.headerWritten) this.out.byte(0x3b);
    return this.out.result();
  }

  private writeHeader(): void {
    const out = this.out;
    out.ascii('GIF89a');
    out.u16(this.width);
    out.u16(this.height);
    out.byte(0x70); // no global color table; 8 bits of color resolution
    out.byte(0); // background index
    out.byte(0); // pixel aspect ratio
    if (this.loop) {
      // NETSCAPE2.0 application extension: loop forever.
      out.byte(0x21);
      out.byte(0xff);
      out.byte(0x0b);
      out.ascii('NETSCAPE2.0');
      out.byte(0x03);
      out.byte(0x01);
      out.u16(0);
      out.byte(0x00);
    }
  }
}
