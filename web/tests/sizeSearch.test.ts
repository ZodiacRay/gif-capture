import { describe, expect, it } from 'vitest';
import { searchScale } from '../src/gif/sizeSearch';

/** A fake encoder whose output size follows scale^2, like real GIFs roughly do. */
const fakeEncoder = (base: number) => (scale: number) => new Uint8Array(Math.round(base * scale * scale));

describe('searchScale', () => {
  it('keeps full size when it already fits', async () => {
    const r = await searchScale(fakeEncoder(100_000), 500_000);
    expect(r).toMatchObject({ scale: 1, fit: true, attempts: 1 });
  });

  it('finds a scale close to the limit without going over', async () => {
    const limit = 250_000;
    const r = await searchScale(fakeEncoder(1_000_000), limit);
    expect(r.fit).toBe(true);
    expect(r.bytes.length).toBeLessThanOrEqual(limit);
    expect(r.bytes.length).toBeGreaterThan(limit * 0.9); // not wastefully small
    expect(r.scale).toBeGreaterThan(0.45);
    expect(r.scale).toBeLessThan(0.55);
    expect(r.attempts).toBeLessThanOrEqual(8);
  });

  it('reports when the limit cannot be met even at the smallest scale', async () => {
    const r = await searchScale(fakeEncoder(1_000_000), 100);
    expect(r.fit).toBe(false);
    expect(r.scale).toBe(0.1);
  });

  it('handles an encoder that is not smooth (size jumps)', async () => {
    const stepped = (scale: number) => new Uint8Array(scale > 0.6 ? 900_000 : scale > 0.3 ? 400_000 : 100_000);
    const r = await searchScale(stepped, 450_000);
    expect(r.fit).toBe(true);
    expect(r.bytes.length).toBeLessThanOrEqual(450_000);
  });

  it('reports every attempt', async () => {
    const seen: number[] = [];
    await searchScale(fakeEncoder(1_000_000), 250_000, { onAttempt: (n) => seen.push(n) });
    expect(seen[0]).toBe(1);
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
  });

  it('works with async encoders', async () => {
    const r = await searchScale(async (s) => fakeEncoder(1_000_000)(s), 250_000);
    expect(r.fit).toBe(true);
  });
});
