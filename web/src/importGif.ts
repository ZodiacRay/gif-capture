import { decodeGif, readGifHeader } from './gif/decoder';
import { canvasToBlob } from './imaging';
import { type Frame, makeFrame } from './model';

/** Reads a .gif file into frames (one lossless PNG per frame, keeping each frame's own delay). */
export async function importGif(file: File, onProgress?: (done: number, total: number) => void): Promise<Frame[]> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const header = readGifHeader(bytes); // throws a readable error for non-GIF files
  if (header.frameCount === 0) throw new Error('GIF에 프레임이 없습니다.');

  const canvas = document.createElement('canvas');
  canvas.width = header.width;
  canvas.height = header.height;
  const g = canvas.getContext('2d');
  if (!g) throw new Error('캔버스를 사용할 수 없습니다.');

  const frames: Frame[] = [];
  for (const decoded of decodeGif(bytes)) {
    const image = new ImageData(decoded.rgba as Uint8ClampedArray<ArrayBuffer>, header.width, header.height);
    g.putImageData(image, 0, 0);
    frames.push(makeFrame(await canvasToBlob(canvas), decoded.delayMs));
    onProgress?.(frames.length, header.frameCount);
    if (frames.length % 4 === 0) await new Promise((r) => setTimeout(r));
  }
  return frames;
}
