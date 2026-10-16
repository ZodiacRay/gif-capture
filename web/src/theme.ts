import { loadSettings, saveSettings } from './storage';

type Theme = 'light' | 'dark';

const listeners = new Set<() => void>();

export function currentTheme(): Theme {
  const saved = loadSettings().theme;
  if (saved) return saved;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme(): void {
  const theme = currentTheme();
  document.documentElement.dataset.theme = theme;
  // Native controls (scrollbars, form fields) follow too.
  document.documentElement.style.colorScheme = theme;
  listeners.forEach((fn) => fn());
}

export function toggleTheme(): void {
  saveSettings({ theme: currentTheme() === 'dark' ? 'light' : 'dark' });
  applyTheme();
}

/** Notified after every theme change, so buttons can show the mode a click would switch to. */
export function onThemeChange(fn: () => void): void {
  listeners.add(fn);
}

/** Label/icon for the toggle button: it names the mode you would switch to. */
export function themeToggleLabel(): { icon: string; name: string } {
  return currentTheme() === 'dark' ? { icon: '☀', name: '라이트 모드' } : { icon: '🌙', name: '다크 모드' };
}
