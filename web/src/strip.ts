import { h } from './dom';
import { thumbnailOf } from './imaging';
import type { Frame, FrameStore } from './model';

/**
 * Horizontal list of frame thumbnails with the frame number and delay under each.
 * Click selects, Shift+click selects a range, Ctrl/Cmd+click toggles. Thumbnails are made lazily.
 */
export class FrameStrip {
  readonly el: HTMLElement;
  /** Ids of the selected frames (what delete / text-on-selection act on). */
  selected = new Set<number>();
  /** The frame shown in the preview. */
  currentIndex = 0;

  private anchor = 0;
  private readonly thumbs = new Map<number, ImageBitmap>();
  private readonly observer: IntersectionObserver;
  private items: HTMLElement[] = [];

  constructor(
    private readonly store: FrameStore,
    private readonly onSelect: () => void,
  ) {
    this.el = h('div', { class: 'strip', tabindex: '0', role: 'listbox', 'aria-label': '프레임 목록', 'aria-multiselectable': 'true' });
    this.observer = new IntersectionObserver((entries) => this.onVisible(entries), { root: this.el, rootMargin: '300px' });
    this.el.addEventListener('keydown', (e) => this.onKey(e));
  }

  get currentFrame(): Frame | undefined {
    return this.store.frames[this.currentIndex];
  }

  /** Rebuilds the list after the frames changed. */
  render(): void {
    const frames = this.store.frames;
    const alive = new Set(frames.map((f) => f.id));
    for (const [id, bmp] of this.thumbs) {
      if (!alive.has(id)) {
        bmp.close();
        this.thumbs.delete(id);
      }
    }
    this.selected = new Set([...this.selected].filter((id) => alive.has(id)));
    this.currentIndex = Math.min(this.currentIndex, Math.max(0, frames.length - 1));
    if (frames.length > 0 && this.selected.size === 0) this.selected.add(frames[this.currentIndex].id);

    this.observer.disconnect();
    this.el.replaceChildren();
    this.items = frames.map((frame, i) => {
      const canvas = h('canvas', { class: 'thumb', width: 104, height: 66 });
      const item = h(
        'div',
        { class: 'strip-item', role: 'option', 'data-id': frame.id, 'data-index': i, onclick: (e: Event) => this.onClick(i, e as MouseEvent) },
        canvas,
        h('div', { class: 'strip-meta' }, h('span', { class: 'n' }, String(i)), h('span', { class: 'ms' }, `${frame.delayMs} ms`)),
      );
      this.observer.observe(item);
      this.el.append(item);
      return item;
    });
    this.updateClasses();
  }

  /** Makes `index` the shown frame and the only selected one (used by playback and navigation). */
  goTo(index: number, notify = false): void {
    const frames = this.store.frames;
    if (frames.length === 0) return;
    this.currentIndex = Math.min(Math.max(0, index), frames.length - 1);
    this.anchor = this.currentIndex;
    this.selected = new Set([frames[this.currentIndex].id]);
    this.updateClasses();
    this.scrollToCurrent();
    if (notify) this.onSelect();
  }

  private onClick(index: number, e: MouseEvent): void {
    const frames = this.store.frames;
    if (e.shiftKey) {
      const [a, b] = [Math.min(this.anchor, index), Math.max(this.anchor, index)];
      this.selected = new Set(frames.slice(a, b + 1).map((f) => f.id));
    } else if (e.ctrlKey || e.metaKey) {
      const id = frames[index].id;
      if (this.selected.has(id) && this.selected.size > 1) this.selected.delete(id);
      else this.selected.add(id);
      this.anchor = index;
    } else {
      this.selected = new Set([frames[index].id]);
      this.anchor = index;
    }
    this.currentIndex = index;
    this.updateClasses();
    this.onSelect();
    this.el.focus({ preventScroll: true });
  }

  private onKey(e: KeyboardEvent): void {
    const last = this.store.frames.length - 1;
    let target: number | null = null;
    if (e.key === 'ArrowLeft') target = this.currentIndex - 1;
    else if (e.key === 'ArrowRight') target = this.currentIndex + 1;
    else if (e.key === 'Home') target = 0;
    else if (e.key === 'End') target = last;
    if (target === null) return;
    e.preventDefault();
    e.stopPropagation();
    this.goTo(target, true);
  }

  private updateClasses(): void {
    const frames = this.store.frames;
    this.items.forEach((item, i) => {
      const selected = this.selected.has(frames[i].id);
      item.classList.toggle('selected', selected);
      item.classList.toggle('current', i === this.currentIndex);
      item.setAttribute('aria-selected', String(selected));
    });
  }

  private scrollToCurrent(): void {
    const item = this.items[this.currentIndex];
    if (!item) return;
    const left = item.offsetLeft;
    const right = left + item.offsetWidth;
    if (left < this.el.scrollLeft) this.el.scrollLeft = left - 8;
    else if (right > this.el.scrollLeft + this.el.clientWidth) this.el.scrollLeft = right - this.el.clientWidth + 8;
  }

  private onVisible(entries: IntersectionObserverEntry[]): void {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const item = entry.target as HTMLElement;
      this.observer.unobserve(item);
      const frame = this.store.frames[Number(item.dataset.index)];
      if (frame) void this.paintThumb(item, frame);
    }
  }

  private async paintThumb(item: HTMLElement, frame: Frame): Promise<void> {
    let bmp = this.thumbs.get(frame.id);
    if (!bmp) {
      bmp = await thumbnailOf(frame);
      this.thumbs.set(frame.id, bmp);
    }
    const canvas = item.querySelector('canvas');
    if (!canvas || !canvas.isConnected) return;
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    canvas.getContext('2d')?.drawImage(bmp, 0, 0);
  }
}
