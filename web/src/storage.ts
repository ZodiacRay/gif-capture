/** Choices that are remembered between visits (kept only in this browser's localStorage). */
export interface Settings {
  theme: 'light' | 'dark' | null; // null = follow the system
  fps: number;
  timerOn: boolean;
  timerSeconds: number;
  /** Playback / export speed multiplier. */
  speed: number;
  /** Whether the preview loops. */
  playLoop: boolean;
  /** Whether the saved GIF loops. */
  gifLoop: boolean;
  limitOn: boolean;
  limitMb: number;
  textSize: number;
  textColor: string;
}

const DEFAULTS: Settings = {
  theme: null,
  fps: 15,
  timerOn: false,
  timerSeconds: 10,
  speed: 1,
  playLoop: true,
  gifLoop: true,
  limitOn: false,
  limitMb: 5,
  textSize: 32,
  textColor: '#ffffff',
};

const KEY = 'gif-capture-web:settings';

let cache: Settings | null = null;

export function loadSettings(): Settings {
  if (cache) return cache;
  let stored: Partial<Settings> = {};
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) stored = JSON.parse(raw) as Partial<Settings>;
  } catch {
    // storage blocked or damaged: fall back to defaults
  }
  cache = { ...DEFAULTS, ...pickKnown(stored) };
  return cache;
}

export function saveSettings(patch: Partial<Settings>): Settings {
  cache = { ...loadSettings(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    // private mode / quota: the choice just won't be remembered
  }
  return cache;
}

/** Ignores unknown keys and values of the wrong type, so an old or edited file can't break the app. */
function pickKnown(obj: Partial<Settings>): Partial<Settings> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(DEFAULTS) as (keyof Settings)[]) {
    const v = obj[key];
    const d = DEFAULTS[key];
    if (key === 'theme') {
      if (v === 'light' || v === 'dark') out[key] = v;
    } else if (typeof v === typeof d && (typeof v !== 'number' || Number.isFinite(v))) {
      out[key] = v;
    }
  }
  return out as Partial<Settings>;
}
