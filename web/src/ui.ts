import { clear, h } from './dom';

/** Button with the icon on top and a short label below, like the desktop app's ribbon. */
export function ribbonButton(
  icon: string,
  label: string,
  onClick: () => void,
  title?: string,
): HTMLButtonElement {
  return h(
    'button',
    { class: 'ribbon-btn', type: 'button', title: title ?? label, onclick: onClick },
    h('span', { class: 'ribbon-icon', 'aria-hidden': true }, icon),
    h('span', { class: 'ribbon-label' }, label),
  );
}

/** A titled group of controls with a divider on its right edge. */
export function ribbonGroup(title: string, ...children: (Node | null)[]): HTMLElement {
  return h('section', { class: 'ribbon-group' }, h('div', { class: 'ribbon-group-title' }, title), h('div', { class: 'ribbon-group-body' }, ...children));
}

let toastTimer = 0;

/** A short message at the bottom of the page. */
export function toast(message: string, kind: 'info' | 'error' = 'info'): void {
  let el = document.getElementById('toast');
  if (!el) {
    el = h('div', { id: 'toast', role: 'status', 'aria-live': 'polite' });
    document.body.append(el);
  }
  el.textContent = message;
  el.className = `toast show ${kind}`;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el?.classList.remove('show'), kind === 'error' ? 6000 : 3500);
}

export interface ProgressDialog {
  update(text: string, fraction?: number): void;
  close(): void;
}

/** A blocking progress window with an optional cancel button. */
export function showProgress(title: string, onCancel?: () => void): ProgressDialog {
  const text = h('div', { class: 'progress-text' }, '준비 중...');
  const fill = h('div', { class: 'progress-fill' });
  const body = h('div', { class: 'modal' }, h('h2', {}, title), text, h('div', { class: 'progress' }, fill));
  if (onCancel) body.append(h('button', { class: 'btn', type: 'button', onclick: onCancel }, '취소'));
  const backdrop = h('div', { class: 'backdrop', role: 'dialog', 'aria-modal': true, 'aria-label': title }, body);
  document.body.append(backdrop);

  return {
    update(message, fraction) {
      text.textContent = message;
      if (fraction !== undefined) fill.style.width = `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
    },
    close() {
      backdrop.remove();
    },
  };
}

/** Replaces the children of `el` with `nodes`. */
export function setChildren(el: Element, ...nodes: Node[]): void {
  clear(el);
  el.append(...nodes);
}
