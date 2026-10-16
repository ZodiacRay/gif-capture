import { clamp, h } from './dom';
import type { Rect } from './imaging';

type Edge = 'l' | 'r' | 't' | 'b' | 'tl' | 'tr' | 'bl' | 'br' | 'move';

const MIN_SIZE = 8; // source pixels

/** Where a picture shown with "object-fit: contain" sits inside its wrapper, and its scale. */
export function contentBox(
  wrapper: HTMLElement,
  size: { w: number; h: number } | null,
): { x: number; y: number; scale: number } | null {
  const cw = wrapper.clientWidth;
  const ch = wrapper.clientHeight;
  if (!size || size.w === 0 || size.h === 0 || cw === 0 || ch === 0) return null;
  const scale = Math.min(cw / size.w, ch / size.h);
  return { x: (cw - size.w * scale) / 2, y: (ch - size.h * scale) / 2, scale };
}
const HANDLES: Edge[] = ['tl', 't', 'tr', 'r', 'br', 'b', 'bl', 'l'];
const CURSORS: Record<Edge, string> = {
  l: 'ew-resize',
  r: 'ew-resize',
  t: 'ns-resize',
  b: 'ns-resize',
  tl: 'nwse-resize',
  br: 'nwse-resize',
  tr: 'nesw-resize',
  bl: 'nesw-resize',
  move: 'move',
};

export interface CropBoxOptions {
  /** Size of the picture under the box, in pixels; null while nothing is loaded. */
  getSourceSize: () => { w: number; h: number } | null;
  onChange?: (rect: Rect) => void;
}

/**
 * A resizable rectangle laid over a picture that is shown with "object-fit: contain".
 * Drag the handles to resize and the inside to move, like a window. Coordinates are in source pixels.
 */
export class CropBox {
  rect: Rect = { x: 0, y: 0, w: 0, h: 0 };

  private readonly layer: HTMLElement;
  private readonly box: HTMLElement;
  private readonly label: HTMLElement;
  private readonly observer: ResizeObserver;
  private locked = false;
  private visible = false;
  private drag: { edge: Edge; startX: number; startY: number; start: Rect } | null = null;

  constructor(
    private readonly wrapper: HTMLElement,
    private readonly options: CropBoxOptions,
  ) {
    this.label = h('div', { class: 'crop-label' });
    this.box = h('div', { class: 'crop-box' }, this.label);
    for (const edge of HANDLES) this.box.append(h('div', { class: `crop-handle crop-${edge}`, 'data-edge': edge }));
    this.layer = h('div', { class: 'crop-layer' }, this.box);
    this.layer.hidden = true;
    wrapper.append(this.layer);

    this.box.addEventListener('pointerdown', (e) => this.onDown(e));
    this.box.addEventListener('pointermove', (e) => this.onMove(e));
    this.box.addEventListener('pointerup', (e) => this.onUp(e));
    this.box.addEventListener('pointercancel', (e) => this.onUp(e));

    this.observer = new ResizeObserver(() => this.render());
    this.observer.observe(wrapper);
  }

  show(): void {
    this.visible = true;
    this.layer.hidden = false;
    this.render();
  }

  hide(): void {
    this.visible = false;
    this.layer.hidden = true;
  }

  setLocked(locked: boolean): void {
    this.locked = locked;
    this.layer.classList.toggle('locked', locked);
  }

  /** Selects the whole picture. */
  reset(): void {
    const size = this.options.getSourceSize();
    if (!size) return;
    this.setRect({ x: 0, y: 0, w: size.w, h: size.h });
  }

  setRect(rect: Rect): void {
    const size = this.options.getSourceSize();
    if (!size) return;
    const w = clamp(Math.round(rect.w), 1, size.w);
    const hh = clamp(Math.round(rect.h), 1, size.h);
    this.rect = { x: clamp(Math.round(rect.x), 0, size.w - w), y: clamp(Math.round(rect.y), 0, size.h - hh), w, h: hh };
    this.render();
    this.options.onChange?.(this.rect);
  }

  /** Changes the size, keeping the top-left corner where it is (as far as the picture allows). */
  setSize(w: number, hh: number): void {
    this.setRect({ ...this.rect, w, h: hh });
  }

  /** Call when the picture or its size changed. */
  refresh(): void {
    const size = this.options.getSourceSize();
    if (size && (this.rect.w === 0 || this.rect.x + this.rect.w > size.w || this.rect.y + this.rect.h > size.h)) {
      this.reset();
    } else {
      this.render();
    }
  }

  destroy(): void {
    this.observer.disconnect();
    this.layer.remove();
  }

  private contentBox(): { x: number; y: number; scale: number } | null {
    return contentBox(this.wrapper, this.options.getSourceSize());
  }

  private render(): void {
    if (!this.visible) return;
    const c = this.contentBox();
    if (!c || this.rect.w === 0) return;
    const s = this.box.style;
    s.left = `${c.x + this.rect.x * c.scale}px`;
    s.top = `${c.y + this.rect.y * c.scale}px`;
    s.width = `${this.rect.w * c.scale}px`;
    s.height = `${this.rect.h * c.scale}px`;
    this.label.textContent = `${this.rect.w} × ${this.rect.h} px`;
  }

  private onDown(e: PointerEvent): void {
    if (this.locked || e.button !== 0) return;
    const target = e.target as HTMLElement;
    const edge = (target.dataset.edge as Edge | undefined) ?? 'move';
    this.drag = { edge, startX: e.clientX, startY: e.clientY, start: { ...this.rect } };
    this.box.setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  private onMove(e: PointerEvent): void {
    const target = e.target as HTMLElement;
    if (!this.drag) {
      this.box.style.cursor = this.locked ? 'default' : CURSORS[(target.dataset.edge as Edge | undefined) ?? 'move'];
      return;
    }
    const c = this.contentBox();
    const size = this.options.getSourceSize();
    if (!c || !size) return;

    const dx = (e.clientX - this.drag.startX) / c.scale;
    const dy = (e.clientY - this.drag.startY) / c.scale;
    const s = this.drag.start;
    const edge = this.drag.edge;

    if (edge === 'move') {
      this.setRect({ ...s, x: clamp(s.x + dx, 0, size.w - s.w), y: clamp(s.y + dy, 0, size.h - s.h) });
      return;
    }

    let left = s.x;
    let top = s.y;
    let right = s.x + s.w;
    let bottom = s.y + s.h;
    if (edge.includes('l')) left = clamp(s.x + dx, 0, right - MIN_SIZE);
    if (edge.includes('r')) right = clamp(right + dx, left + MIN_SIZE, size.w);
    if (edge.includes('t')) top = clamp(s.y + dy, 0, bottom - MIN_SIZE);
    if (edge.includes('b')) bottom = clamp(bottom + dy, top + MIN_SIZE, size.h);
    this.setRect({ x: left, y: top, w: right - left, h: bottom - top });
  }

  private onUp(e: PointerEvent): void {
    if (!this.drag) return;
    this.drag = null;
    if (this.box.hasPointerCapture(e.pointerId)) this.box.releasePointerCapture(e.pointerId);
  }
}
