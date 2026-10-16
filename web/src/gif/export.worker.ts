/// Runs the whole GIF export off the main thread so the page stays responsive.
import { GifEncoder } from './encoder';
import { searchScale } from './sizeSearch';

export interface ExportRequest {
  frames: { blob: Blob; delayMs: number }[];
  /** Playback speed multiplier (2 = twice as fast). */
  speed: number;
  loop: boolean;
  /** Size limit in bytes, or null for "full size". */
  maxBytes: number | null;
}

export type ExportMessage =
  | { type: 'progress'; text: string; fraction: number }
  | { type: 'done'; bytes: Uint8Array; scale: number; fit: boolean }
  | { type: 'error'; message: string };

const ctx = self as unknown as {
  postMessage(message: ExportMessage, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<ExportRequest>) => void) | null;
};

async function encodeAt(req: ExportRequest, scale: number, label: string): Promise<Uint8Array> {
  let encoder: GifEncoder | null = null;
  let canvas: OffscreenCanvas | null = null;
  let g: OffscreenCanvasRenderingContext2D | null = null;
  let w = 0;
  let h = 0;

  for (let i = 0; i < req.frames.length; i++) {
    const frame = req.frames[i];
    const bitmap = await createImageBitmap(frame.blob);
    if (!encoder || !canvas || !g) {
      w = Math.max(1, Math.round(bitmap.width * scale));
      h = Math.max(1, Math.round(bitmap.height * scale));
      encoder = new GifEncoder(w, h, req.loop);
      canvas = new OffscreenCanvas(w, h);
      g = canvas.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D;
      g.imageSmoothingQuality = 'high';
    }
    g.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    encoder.addFrame(g.getImageData(0, 0, w, h).data, frame.delayMs / req.speed);
    ctx.postMessage({ type: 'progress', text: `${label} ${i + 1}/${req.frames.length}`, fraction: (i + 1) / req.frames.length });
  }
  if (!encoder) throw new Error('내보낼 프레임이 없습니다.');
  return encoder.finish();
}

ctx.onmessage = async (event) => {
  const req = event.data;
  try {
    if (req.frames.length === 0) throw new Error('내보낼 프레임이 없습니다.');

    if (req.maxBytes === null) {
      const bytes = await encodeAt(req, 1, '인코딩 중');
      ctx.postMessage({ type: 'done', bytes, scale: 1, fit: true }, [bytes.buffer]);
      return;
    }

    const result = await searchScale((scale) => encodeAt(req, scale, `시도 ${Math.round(scale * 100)}% ·`), req.maxBytes);
    ctx.postMessage({ type: 'done', bytes: result.bytes, scale: result.scale, fit: result.fit }, [result.bytes.buffer]);
  } catch (error) {
    ctx.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};
