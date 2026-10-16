import { GifReader } from 'omggif';

export interface GifFrame {
  /** Full-canvas RGBA, composited as a viewer would show it, flattened onto white. */
  rgba: Uint8ClampedArray;
  delayMs: number;
}

export interface GifHeader {
  width: number;
  height: number;
  frameCount: number;
}

/** Browsers show a delay of 0 or 1 centisecond as 100 ms; do the same. */
export function delayToMs(centis: number): number {
  return centis <= 1 ? 100 : centis * 10;
}

export function readGifHeader(bytes: Uint8Array): GifHeader {
  const reader = open(bytes);
  return { width: reader.width, height: reader.height, frameCount: reader.numFrames() };
}

function open(bytes: Uint8Array): GifReader {
  try {
    return new GifReader(bytes);
  } catch {
    throw new Error('GIF 파일을 읽을 수 없습니다. 손상되었거나 GIF가 아닌 파일입니다.');
  }
}

/**
 * Yields each frame fully composited. Handles frame offsets, transparency and the three disposal methods
 * (leave in place, restore to background, restore to previous). Frames are produced one at a time so a long
 * GIF never has to be held in memory as raw pixels.
 */
export function* decodeGif(bytes: Uint8Array): Generator<GifFrame, void, void> {
  const reader = open(bytes);
  const { width, height } = reader;
  const count = reader.numFrames();

  const canvas = new Uint8ClampedArray(width * height * 4); // starts fully transparent
  let saved: Uint8ClampedArray | null = null;
  let previous: { x: number; y: number; width: number; height: number; disposal: number } | null = null;

  for (let i = 0; i < count; i++) {
    const info = reader.frameInfo(i);

    // Apply the previous frame's disposal before drawing this one.
    if (previous) {
      if (previous.disposal === 2) {
        for (let y = previous.y; y < Math.min(height, previous.y + previous.height); y++) {
          const start = (y * width + previous.x) * 4;
          const end = (y * width + Math.min(width, previous.x + previous.width)) * 4;
          canvas.fill(0, start, end);
        }
      } else if (previous.disposal === 3 && saved) {
        canvas.set(saved);
      }
    }

    // "Restore to previous" needs the canvas as it was before this frame draws.
    saved = info.disposal === 3 ? canvas.slice() : null;

    try {
      reader.decodeAndBlitFrameRGBA(i, canvas);
    } catch {
      throw new Error(`GIF의 ${i + 1}번째 프레임을 읽을 수 없습니다.`);
    }

    const flat = new Uint8ClampedArray(canvas.length);
    for (let p = 0; p < canvas.length; p += 4) {
      const a = canvas[p + 3];
      if (a === 255) {
        flat[p] = canvas[p];
        flat[p + 1] = canvas[p + 1];
        flat[p + 2] = canvas[p + 2];
      } else {
        // Anything never painted (or cleared to background) is shown on white.
        flat[p] = flat[p + 1] = flat[p + 2] = 255;
      }
      flat[p + 3] = 255;
    }
    yield { rgba: flat, delayMs: delayToMs(info.delay) };

    previous = { x: info.x, y: info.y, width: info.width, height: info.height, disposal: info.disposal };
  }
}
