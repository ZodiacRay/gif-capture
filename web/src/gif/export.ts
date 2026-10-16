import type { ExportMessage, ExportRequest } from './export.worker';

export interface ExportFrame {
  blob: Blob;
  delayMs: number;
}

export interface ExportOptions {
  speed: number;
  loop: boolean;
  /** Size limit in bytes, or null for full size. */
  maxBytes: number | null;
}

export interface ExportResult {
  blob: Blob;
  /** 1 = original size. */
  scale: number;
  /** False when the size limit could not be met; `blob` is then the smallest we could make. */
  fit: boolean;
}

export interface ExportJob {
  promise: Promise<ExportResult>;
  cancel(): void;
}

/** Encodes frames to a GIF in a worker. `onProgress` gets a short text and a 0..1 fraction of the current pass. */
export function exportGif(
  frames: ExportFrame[],
  options: ExportOptions,
  onProgress: (text: string, fraction: number) => void,
): ExportJob {
  const worker = new Worker(new URL('./export.worker.ts', import.meta.url), { type: 'module' });
  let reject: (reason: Error) => void = () => {};

  const promise = new Promise<ExportResult>((resolve, rej) => {
    reject = rej;
    worker.onmessage = (event: MessageEvent<ExportMessage>) => {
      const m = event.data;
      if (m.type === 'progress') {
        onProgress(m.text, m.fraction);
      } else if (m.type === 'done') {
        worker.terminate();
        resolve({ blob: new Blob([m.bytes as BlobPart], { type: 'image/gif' }), scale: m.scale, fit: m.fit });
      } else {
        worker.terminate();
        rej(new Error(m.message));
      }
    };
    worker.onerror = (e) => {
      worker.terminate();
      rej(new Error(e.message || 'GIF를 만드는 중 오류가 발생했습니다.'));
    };
    const request: ExportRequest = { frames, speed: options.speed, loop: options.loop, maxBytes: options.maxBytes };
    worker.postMessage(request);
  });

  return {
    promise,
    cancel() {
      worker.terminate();
      reject(new DOMException('취소됨', 'AbortError'));
    },
  };
}
