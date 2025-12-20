import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { INLINE_LOGO_PNG } from '@/assets/logoInline';
import App from './App.tsx';

document.title = 'CLI Proxy API Management Center';

const faviconEl = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
if (faviconEl) {
  faviconEl.href = INLINE_LOGO_PNG;
  faviconEl.type = 'image/png';
} else {
  const newFavicon = document.createElement('link');
  newFavicon.rel = 'icon';
  newFavicon.type = 'image/png';
  newFavicon.href = INLINE_LOGO_PNG;
  document.head.appendChild(newFavicon);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
