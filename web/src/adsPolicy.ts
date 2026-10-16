/**
 * When may ads be shown? Kept free of browser APIs so the rules can be tested.
 *
 * - off:     ads are not configured, so nothing about ads appears anywhere (no banner, no script).
 * - ask:     configured, but the visitor has not chosen yet. No ad script is loaded.
 * - blocked: the visitor said no. No ad script is loaded.
 * - on:      the visitor said yes. The ad script may load.
 */
export type Consent = 'granted' | 'denied' | null;
export type AdsState = 'off' | 'ask' | 'blocked' | 'on';

export interface AdsConfig {
  /** AdSense publisher id, e.g. "ca-pub-1234567890123456". */
  client: string;
  /** Ad unit id for the home page slot, digits only. */
  slot: string;
}

const CLIENT_PATTERN = /^ca-pub-\d{10,20}$/;
const SLOT_PATTERN = /^\d{6,20}$/;

/** Ads need both a valid publisher id and a slot; anything else counts as "not configured". */
export function adsConfigured(config: AdsConfig): boolean {
  return CLIENT_PATTERN.test(config.client.trim()) && SLOT_PATTERN.test(config.slot.trim());
}

export function adsState(config: AdsConfig, consent: Consent): AdsState {
  if (!adsConfigured(config)) return 'off';
  if (consent === 'granted') return 'on';
  if (consent === 'denied') return 'blocked';
  return 'ask';
}

export function normalizeConsent(value: unknown): Consent {
  return value === 'granted' || value === 'denied' ? value : null;
}
