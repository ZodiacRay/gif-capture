import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

const CLIENT_PATTERN = /^ca-pub-\d{10,20}$/;

// Relative base so the site works from any sub-path (e.g. GitHub Pages project sites).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', 'VITE_');
  const adsenseClient = (env.VITE_ADSENSE_CLIENT ?? '').trim();

  return {
    base: './',
    build: { target: 'es2022', sourcemap: true },
    worker: { format: 'es' },
    test: { environment: 'node', include: ['tests/**/*.test.ts'] },
    plugins: [
      {
        // AdSense checks site ownership with this tag. It does not load any ad code, so it is safe to
        // include even before a visitor has agreed to ads. Only a well-formed id is ever written out.
        name: 'adsense-account-meta',
        transformIndexHtml(html: string) {
          if (!CLIENT_PATTERN.test(adsenseClient)) return html;
          return html.replace('</head>', `    <meta name="google-adsense-account" content="${adsenseClient}" />\n  </head>`);
        },
      },
    ],
  };
});
