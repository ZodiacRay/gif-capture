import { type Frame, makeFrame } from './model';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const TEXT_FONT = '"Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", system-ui, sans-serif';

export function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('이미지를 만들지 못했습니다.'))), 'image/png');
  });
}

export function loadBitmap(blob: Blob): Promise<ImageBitmap> {
  return createImageBitmap(blob);
}

/** A small bitmap for the frame strip. */
export function thumbnailOf(frame: Frame, width = 208): Promise<ImageBitmap> {
  return createImageBitmap(frame.blob, { resizeWidth: width, resizeQuality: 'medium' });
}

export interface TextOptions {
  text: string;
  /** Top-left of the text, in image pixels. */
  x: number;
  y: number;
  /** Font size in image pixels. */
  size: number;
  color: string;
}

function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return 1;
  const n = parseInt(m[1], 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
}

/** Draws bold text with a thin contrasting outline so it stays readable on any background. */
export function drawText(g: CanvasRenderingContext2D, o: TextOptions): void {
  g.save();
  g.font = `700 ${o.size}px ${TEXT_FONT}`;
  g.textBaseline = 'top';
  g.lineJoin = 'round';
  g.lineWidth = Math.max(2, o.size / 5); // stroke is centred, so the visible outline is half of this
  g.strokeStyle = luminance(o.color) > 0.5 ? '#000000' : '#ffffff';
  g.fillStyle = o.color;
  const lineHeight = Math.round(o.size * 1.25);
  o.text.split('\n').forEach((line, i) => {
    g.strokeText(line, o.x, o.y + i * lineHeight);
    g.fillText(line, o.x, o.y + i * lineHeight);
  });
  g.restore();
}

type Progress = (done: number, total: number) => void;

/**
 * Builds new frames for every frame accepted by `include`; the others are reused untouched.
 * Frames are rewritten one at a time to keep memory low, yielding now and then so the page stays alive.
 */
async function transformFrames(
  frames: readonly Frame[],
  include: (frame: Frame) => boolean,
  outputSize: (width: number, height: number) => { w: number; h: number },
  paint: (g: CanvasRenderingContext2D, bitmap: ImageBitmap) => void,
  onProgress?: Progress,
): Promise<Frame[]> {
  const canvas = document.createElement('canvas');
  const total = frames.filter(include).length;
  const result: Frame[] = [];
  let done = 0;

  for (const frame of frames) {
    if (!include(frame)) {
      result.push(frame);
      continue;
    }
    const bitmap = await loadBitmap(frame.blob);
    const size = outputSize(bitmap.width, bitmap.height);
    canvas.width = size.w; // resizing also clears the canvas
    canvas.height = size.h;
    const g = canvas.getContext('2d');
    if (!g) throw new Error('캔버스를 사용할 수 없습니다.');
    paint(g, bitmap);
    bitmap.close();
    result.push(makeFrame(await canvasToBlob(canvas), frame.delayMs));
    onProgress?.(++done, total);
    if (done % 4 === 0) await new Promise((r) => setTimeout(r));
  }
  return result;
}

/** Crops every frame to `rect` (image pixels). */
export function cropFrames(frames: readonly Frame[], rect: Rect, onProgress?: Progress): Promise<Frame[]> {
  return transformFrames(
    frames,
    () => true,
    () => ({ w: rect.w, h: rect.h }),
    (g, bitmap) => g.drawImage(bitmap, -rect.x, -rect.y),
    onProgress,
  );
}

/** Draws text on the frames whose ids are in `ids` (or on all frames when `ids` is null). */
export function addTextToFrames(
  frames: readonly Frame[],
  ids: ReadonlySet<number> | null,
  text: TextOptions,
  onProgress?: Progress,
): Promise<Frame[]> {
  return transformFrames(
    frames,
    (f) => ids === null || ids.has(f.id),
    (w, h) => ({ w, h }),
    (g, bitmap) => {
      g.drawImage(bitmap, 0, 0);
      drawText(g, text);
    },
    onProgress,
  );
}
