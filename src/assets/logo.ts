// Build-time-inlined logo URL. Vite's `assetsInlineLimit` (set high in
// vite.config.ts) ensures this resolves to a base64 data URL embedded in
// the single-file `dist/management.html` artifact — no separate emitted
// asset, no broken auto-updater contract.
//
// Source: src/assets/logo.webp (256x256, q85). Replaces a 54KB JPEG that
// used to live as an inline base64 string in src/assets/logoInline.ts.
import logoUrl from './logo.webp';

export const LOGO_URL: string = logoUrl;
