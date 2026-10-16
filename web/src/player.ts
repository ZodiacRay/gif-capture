import { h } from './dom';
import { loadBitmap } from './imaging';
import type { Frame, FrameStore } from './model';
import type { FrameStrip } from './strip';

const CACHE_SIZE = 12;

/** The big picture of the current frame. Decoded frames are kept in a small cache for smooth playback. */
export class Preview {
  readonly canvas = h('canvas', { class: 'preview-canvas' });
  /** Holds the canvas and anything laid over it (crop box, text preview). */
  readonly wrapper = h('div', { class: 'preview-wrap' }, this.canvas);
  size: { w: number; h: number } | null = null;
  onSizeChange: (() => void) | null = null;

  private token = 0;
  private readonly cache = new Map<number, ImageBitmap>();

  async show(frame: Frame): Promise<void> {
    const mine = ++this.token;
    const bmp = await this.bitmapFor(frame);
    if (mine !== this.token) return; // a newer frame was requested meanwhile
    if (this.canvas.width !== bmp.width || this.canvas.height !== bmp.height) {
      this.canvas.width = bmp.width;
      this.canvas.height = bmp.height;
      this.size = { w: bmp.width, h: bmp.height };
      this.onSizeChange?.();
    }
    this.size ??= { w: bmp.width, h: bmp.height };
    this.canvas.getContext('2d')?.drawImage(bmp, 0, 0);
  }

  clear(): void {
    this.token++;
    this.canvas.getContext('2d')?.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.size = null;
    this.onSizeChange?.();
  }

  /** Decodes a frame ahead of time so the next playback step is instant. */
  prefetch(frame: Frame): void {
    void this.bitmapFor(frame).catch(() => {});
  }

  private async bitmapFor(frame: Frame): Promise<ImageBitmap> {
    const hit = this.cache.get(frame.id);
    if (hit) {
      this.cache.delete(frame.id); // refresh its position (most recently used goes last)
      this.cache.set(frame.id, hit);
      return hit;
    }
    const bmp = await loadBitmap(frame.blob);
    this.cache.set(frame.id, bmp);
    if (this.cache.size > CACHE_SIZE) {
      const oldest = this.cache.keys().next().value as number;
      this.cache.get(oldest)?.close();
      this.cache.delete(oldest);
    }
    return bmp;
  }
}

/** Plays the frames in the preview with their own delays, scaled by the speed. */
export class Player {
  speed = 1;
  loop = true;
  playing = false;
  onStateChange: (() => void) | null = null;

  private run = 0;

  constructor(
    private readonly store: FrameStore,
    private readonly preview: Preview,
    private readonly strip: FrameStrip,
  ) {}

  toggle(): void {
    if (this.playing) this.stop();
    else void this.play();
  }

  stop(): void {
    if (!this.playing) return;
    this.run++;
    this.playing = false;
    this.onStateChange?.();
  }

  async play(): Promise<void> {
    if (this.store.frames.length === 0) return;
    const id = ++this.run;
    this.playing = true;
    this.onStateChange?.();

    // Pressing play on the last frame of a non-looping animation starts over.
    let index = this.strip.currentIndex;
    if (index >= this.store.frames.length - 1 && !this.loop) index = 0;

    while (id === this.run) {
      const frames = this.store.frames;
      const frame = frames[index];
      if (!frame) break;

      const started = performance.now();
      this.strip.goTo(index);
      await this.preview.show(frame);
      const next = frames[(index + 1) % frames.length];
      if (next) this.preview.prefetch(next);

      const wait = Math.max(0, frame.delayMs / this.speed - (performance.now() - started));
      await new Promise((r) => setTimeout(r, wait));
      if (id !== this.run) return; // stopped or restarted: whoever did that already updated the state

      index++;
      if (index >= frames.length) {
        if (!this.loop) break;
        index = 0;
      }
    }
    if (id === this.run) {
      this.playing = false;
      this.onStateChange?.();
    }
  }
}
