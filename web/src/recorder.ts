import type { Rect } from './imaging';
import { type Frame, makeFrame } from './model';

/** Minimal typing for the WebCodecs track processor (Chromium), which TypeScript's DOM lib lacks. */
interface TrackProcessorCtor {
  new (init: { track: MediaStreamTrack }): { readable: ReadableStream<VideoFrame> };
}

export function captureSupported(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia;
}

export interface Capture {
  stream: MediaStream;
  video: HTMLVideoElement;
  /** Size of the shared surface in pixels. */
  width: number;
  height: number;
  /** Stops sharing and releases the screen. */
  stop(): void;
  /** Called when sharing ends from outside (the browser's "Stop sharing" button). */
  onEnded(callback: () => void): void;
}

/** Asks the user which screen / window / tab to share. Rejects if they cancel. */
export async function startCapture(fps: number): Promise<Capture> {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: { ideal: fps, max: 60 } },
    audio: false,
  });

  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error('화면을 불러오지 못했습니다.'));
  });
  await video.play();

  const track = stream.getVideoTracks()[0];
  const settings = track.getSettings();
  const width = video.videoWidth || settings.width || 0;
  const height = video.videoHeight || settings.height || 0;

  return {
    stream,
    video,
    width,
    height,
    stop: () => stream.getTracks().forEach((t) => t.stop()),
    onEnded: (callback) => track.addEventListener('ended', callback, { once: true }),
  };
}

/** One frame being encoded to PNG, remembered with the moment it was taken. */
interface Pending {
  at: number;
  blob: Promise<Blob>;
}

const MAX_PENDING = 24; // if encoding falls behind, drop frames instead of filling memory

/**
 * Records the chosen region of a capture at a given fps.
 * Each frame is stored as a lossless PNG together with how long it stayed on screen.
 */
export class Recording {
  private readonly canvas = document.createElement('canvas');
  private readonly pending: Pending[] = [];
  private startedAt = 0;
  private lastTakenAt = -Infinity;
  private running = false;
  private cleanup: (() => void) | null = null;
  private stopTime = 0;
  /** Frames handed to the PNG encoder that have not finished yet. */
  private inFlight = 0;

  constructor(
    private readonly capture: Capture,
    private region: Rect,
    private readonly fps: number,
  ) {
    this.canvas.width = region.w;
    this.canvas.height = region.h;
  }

  get frameCount(): number {
    return this.pending.length;
  }

  get elapsedMs(): number {
    return this.running ? performance.now() - this.startedAt : this.stopTime - this.startedAt;
  }

  start(): void {
    this.running = true;
    this.startedAt = performance.now();

    const Processor = (window as unknown as { MediaStreamTrackProcessor?: TrackProcessorCtor }).MediaStreamTrackProcessor;
    if (Processor) this.startWithProcessor(Processor);
    else this.startWithVideo();
  }

  /** Stops and returns the frames, with each frame's delay taken from the real time between frames. */
  async stop(): Promise<Frame[]> {
    this.running = false;
    this.stopTime = performance.now();
    this.cleanup?.();
    this.cleanup = null;

    const blobs = await Promise.all(this.pending.map((p) => p.blob));
    const interval = 1000 / this.fps;
    return this.pending.map((p, i) => {
      const next = i + 1 < this.pending.length ? this.pending[i + 1].at : this.stopTime;
      return makeFrame(blobs[i], Math.max(20, Math.round(Math.max(next - p.at, interval * 0.5))));
    });
  }

  // --- Chromium: frames arrive through a stream, so background-tab timer throttling does not matter ---

  private startWithProcessor(Processor: TrackProcessorCtor): void {
    const track = this.capture.stream.getVideoTracks()[0];
    const reader = new Processor({ track }).readable.getReader();
    this.cleanup = () => void reader.cancel().catch(() => {});

    void (async () => {
      try {
        while (this.running) {
          const { value: frame, done } = await reader.read();
          if (done || !frame) break;
          this.takeIfDue(frame);
          frame.close();
        }
      } catch {
        // the stream was cancelled or sharing ended
      }
    })();
  }

  // --- Other browsers: sample the playing <video> ---

  private startWithVideo(): void {
    const video = this.capture.video;
    if ('requestVideoFrameCallback' in video) {
      let id = 0;
      const tick = (): void => {
        if (!this.running) return;
        this.takeIfDue(video);
        id = video.requestVideoFrameCallback(tick);
      };
      id = video.requestVideoFrameCallback(tick);
      this.cleanup = () => video.cancelVideoFrameCallback(id);
    } else {
      const timer = window.setInterval(() => this.takeIfDue(video), 1000 / this.fps);
      this.cleanup = () => window.clearInterval(timer);
    }
  }

  private takeIfDue(source: CanvasImageSource): void {
    const now = performance.now();
    const interval = 1000 / this.fps;
    const first = this.pending.length === 0;
    if (!first && now - this.lastTakenAt < interval * 0.9) return;
    if (this.inFlight >= MAX_PENDING) return; // encoder is behind: skip this frame

    const g = this.canvas.getContext('2d');
    if (!g) return;
    const r = this.region;
    g.drawImage(source, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
    this.lastTakenAt = now;

    // toBlob snapshots the canvas immediately, so the canvas can be reused for the next frame right away.
    this.inFlight++;
    const blob = new Promise<Blob>((resolve, reject) => {
      this.canvas.toBlob(
        (b) => {
          this.inFlight--;
          if (b) resolve(b);
          else reject(new Error('프레임을 저장하지 못했습니다.'));
        },
        'image/png',
      );
    });
    void blob.catch(() => {});
    this.pending.push({ at: now, blob });
  }
}
