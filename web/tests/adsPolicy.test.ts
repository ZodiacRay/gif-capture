import { describe, expect, it } from 'vitest';
import { adsConfigured, adsState, normalizeConsent } from '../src/adsPolicy';

const valid = { client: 'ca-pub-1234567890123456', slot: '1234567890' };

describe('adsConfigured', () => {
  it('needs a valid publisher id and slot', () => {
    expect(adsConfigured(valid)).toBe(true);
    expect(adsConfigured({ client: '', slot: '' })).toBe(false);
    expect(adsConfigured({ client: valid.client, slot: '' })).toBe(false);
    expect(adsConfigured({ client: '', slot: valid.slot })).toBe(false);
  });

  it('rejects values that are not real ids (typos, placeholders, other publishers)', () => {
    expect(adsConfigured({ client: 'ca-pub-abc', slot: valid.slot })).toBe(false);
    expect(adsConfigured({ client: 'pub-1234567890123456', slot: valid.slot })).toBe(false);
    expect(adsConfigured({ client: valid.client, slot: 'slot-id' })).toBe(false);
    expect(adsConfigured({ client: 'YOUR_ID_HERE', slot: 'YOUR_SLOT' })).toBe(false);
    expect(adsConfigured({ client: 'ca-pub-1234567890123456"><script>', slot: valid.slot })).toBe(false);
  });

  it('ignores surrounding whitespace from copy and paste', () => {
    expect(adsConfigured({ client: `  ${valid.client}\n`, slot: ` ${valid.slot} ` })).toBe(true);
  });
});

describe('adsState', () => {
  it('is off whenever ads are not configured, whatever the consent says', () => {
    for (const consent of ['granted', 'denied', null] as const) {
      expect(adsState({ client: '', slot: '' }, consent)).toBe('off');
    }
  });

  it('asks first, and only loads ads after an explicit yes', () => {
    expect(adsState(valid, null)).toBe('ask');
    expect(adsState(valid, 'granted')).toBe('on');
    expect(adsState(valid, 'denied')).toBe('blocked');
  });
});

describe('normalizeConsent', () => {
  it('accepts only the two known answers', () => {
    expect(normalizeConsent('granted')).toBe('granted');
    expect(normalizeConsent('denied')).toBe('denied');
    for (const bad of [null, undefined, '', 'yes', 'GRANTED', 1, true, {}]) expect(normalizeConsent(bad)).toBeNull();
  });
});
