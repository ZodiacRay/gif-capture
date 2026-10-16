import { type AdsConfig, type AdsState, type Consent, adsState, normalizeConsent } from './adsPolicy';
import { h } from './dom';

/**
 * Optional ads on the start page only (never on the recording or editing screens).
 * Everything here stays inert until an AdSense publisher id and slot are configured at build time
 * (VITE_ADSENSE_CLIENT / VITE_ADSENSE_SLOT_HOME), and the ad script is only loaded after the visitor agrees.
 */
export const adsConfig: AdsConfig = {
  client: String(import.meta.env.VITE_ADSENSE_CLIENT ?? ''),
  slot: String(import.meta.env.VITE_ADSENSE_SLOT_HOME ?? ''),
};

const CONSENT_KEY = 'gif-capture-web:ad-consent';

function readConsent(): Consent {
  try {
    return normalizeConsent(localStorage.getItem(CONSENT_KEY));
  } catch {
    return null;
  }
}

function writeConsent(value: Exclude<Consent, null>): void {
  try {
    localStorage.setItem(CONSENT_KEY, value);
  } catch {
    // choice just will not be remembered
  }
}

export interface Ads {
  /** False when ads are not configured; then no ad-related text or controls should be shown. */
  enabled: boolean;
  /** Shows the consent question again (the "광고 설정" link in the footer). */
  reopen(): void;
}

declare global {
  interface Window {
    adsbygoogle?: unknown[];
  }
}

/** Sets up the consent banner and the ad slot. `slot` is the (initially hidden) container on the start page. */
export function initAds(slot: HTMLElement): Ads {
  let state: AdsState = adsState(adsConfig, readConsent());
  if (state === 'off') return { enabled: false, reopen() {} };

  let banner: HTMLElement | null = null;
  let scriptLoaded = false;
  let adMounted = false;

  const closeBanner = (): void => {
    banner?.remove();
    banner = null;
  };

  const choose = (answer: Exclude<Consent, null>): void => {
    const previous = state;
    writeConsent(answer);
    state = adsState(adsConfig, answer);
    closeBanner();
    // An ad script that is already running cannot be unloaded, so withdrawing consent restarts the page cleanly.
    if (previous === 'on' && state !== 'on') {
      location.reload();
      return;
    }
    render();
  };

  const showBanner = (): void => {
    if (banner) return;
    banner = h(
      'div',
      { class: 'consent-banner', role: 'dialog', 'aria-label': '광고 쿠키 동의' },
      h(
        'p',
        {},
        '시작 화면의 광고를 위해 Google AdSense가 쿠키를 사용할 수 있습니다. 동의하지 않으면 광고가 표시되지 않으며, 녹화·편집한 영상과는 관계가 없습니다. ',
        h('a', { href: './privacy.html' }, '개인정보처리방침'),
      ),
      h(
        'div',
        { class: 'consent-actions' },
        h('button', { class: 'btn', type: 'button', onclick: () => choose('denied') }, '거부'),
        h('button', { class: 'btn primary', type: 'button', onclick: () => choose('granted') }, '동의'),
      ),
    );
    document.body.append(banner);
  };

  const loadScript = (): void => {
    if (scriptLoaded) return;
    scriptLoaded = true;
    const script = document.createElement('script');
    script.async = true;
    script.crossOrigin = 'anonymous';
    // adsConfig.client is validated against a strict pattern before it can reach this URL.
    script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${adsConfig.client.trim()}`;
    document.head.append(script);
  };

  const mountAd = (): void => {
    if (adMounted) return;
    adMounted = true;
    const ins = document.createElement('ins');
    ins.className = 'adsbygoogle';
    ins.style.display = 'block';
    ins.setAttribute('data-ad-client', adsConfig.client.trim());
    ins.setAttribute('data-ad-slot', adsConfig.slot.trim());
    ins.setAttribute('data-ad-format', 'auto');
    ins.setAttribute('data-full-width-responsive', 'true');
    slot.replaceChildren(h('div', { class: 'ad-label' }, '광고'), ins);
    (window.adsbygoogle = window.adsbygoogle || []).push({});
  };

  const render = (): void => {
    if (state === 'ask') showBanner();
    if (state === 'on') {
      slot.hidden = false;
      loadScript();
      mountAd();
    } else {
      slot.hidden = true;
    }
  };

  render();
  return {
    enabled: true,
    reopen: showBanner,
  };
}
