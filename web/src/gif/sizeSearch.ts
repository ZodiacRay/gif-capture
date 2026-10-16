/**
 * GIF size grows roughly with the pixel count, so to hit a size limit we search for the largest scale
 * whose encoded result still fits. Pure logic (no browser APIs) so it can be tested on its own.
 */

export interface SearchResult {
  bytes: Uint8Array;
  scale: number;
  /** False when even the smallest scale was too big; `bytes` is then the smallest we can make. */
  fit: boolean;
  attempts: number;
}

export interface SearchOptions {
  minScale?: number;
  maxAttempts?: number;
  /** Called before every encode so the UI can show progress. */
  onAttempt?: (attempt: number, scale: number) => void;
}

export async function searchScale(
  encodeAt: (scale: number) => Promise<Uint8Array> | Uint8Array,
  maxBytes: number,
  options: SearchOptions = {},
): Promise<SearchResult> {
  const minScale = options.minScale ?? 0.1;
  const maxAttempts = options.maxAttempts ?? 8;
  let attempts = 0;

  const run = async (scale: number): Promise<Uint8Array> => {
    attempts++;
    options.onAttempt?.(attempts, scale);
    return encodeAt(scale);
  };

  const full = await run(1);
  if (full.length <= maxBytes) return { bytes: full, scale: 1, fit: true, attempts };

  let lo = minScale;
  let hi = 1;
  let best: { bytes: Uint8Array; scale: number } | null = null;
  // size ~ scale^2, so start near the estimate; most searches then finish in a few passes.
  const guess = Math.min(1, Math.max(minScale, Math.sqrt(maxBytes / full.length) * 0.95));

  for (let attempt = 2; attempt <= maxAttempts; attempt++) {
    const scale = attempt === 2 ? guess : (lo + hi) / 2;
    const bytes = await run(scale);
    if (bytes.length <= maxBytes) {
      best = { bytes, scale };
      lo = scale;
      if (maxBytes - bytes.length < maxBytes * 0.05) break; // within 5% of the limit: good enough
    } else {
      hi = scale;
    }
  }

  if (best) return { ...best, fit: true, attempts };
  const smallest = await run(minScale);
  return { bytes: smallest, scale: minScale, fit: smallest.length <= maxBytes, attempts };
}
