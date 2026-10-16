/** One recorded or imported frame. Frames are never edited in place: edits make new frames. */
export interface Frame {
  id: number;
  /** Lossless PNG of the whole frame. */
  blob: Blob;
  delayMs: number;
}

let nextId = 1;

export function makeFrame(blob: Blob, delayMs: number): Frame {
  return { id: nextId++, blob, delayMs };
}

/**
 * The frame list plus undo history. Because frames are immutable, a snapshot is just a copy of the array,
 * so undoing a crop or a deletion is cheap and exact.
 */
export class FrameStore {
  private list: Frame[] = [];
  private undoStack: Frame[][] = [];
  private listeners = new Set<() => void>();
  static readonly MAX_UNDO = 50;

  get frames(): readonly Frame[] {
    return this.list;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  onChange(fn: () => void): void {
    this.listeners.add(fn);
  }

  /** Replaces the frames. With `undoable`, the previous frames can be restored with undo(). */
  set(frames: Frame[], undoable = true): void {
    if (undoable && this.list.length > 0) this.pushUndo();
    this.list = frames;
    this.emit();
  }

  /** Call before any edit that changes frames. */
  pushUndo(): void {
    this.undoStack.push(this.list.slice());
    if (this.undoStack.length > FrameStore.MAX_UNDO) this.undoStack.shift();
  }

  undo(): boolean {
    const previous = this.undoStack.pop();
    if (!previous) return false;
    this.list = previous;
    this.emit();
    return true;
  }

  /** Forget history (e.g. when starting over with a new recording). */
  reset(frames: Frame[] = []): void {
    this.list = frames;
    this.undoStack = [];
    this.emit();
  }

  totalMs(): number {
    return this.list.reduce((sum, f) => sum + f.delayMs, 0);
  }

  private emit(): void {
    this.listeners.forEach((fn) => fn());
  }
}
