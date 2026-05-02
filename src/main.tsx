import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@/styles/global.scss';
import { LOGO_URL } from '@/assets/logo';
import App from './App.tsx';

document.title = 'CLI Proxy API Management Center';
document.documentElement.setAttribute('translate', 'no');
document.documentElement.classList.add('notranslate');

const faviconEl = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
if (faviconEl) {
  faviconEl.href = LOGO_URL;
  faviconEl.type = 'image/webp';
} else {
  const newFavicon = document.createElement('link');
  newFavicon.rel = 'icon';
  newFavicon.type = 'image/webp';
  newFavicon.href = LOGO_URL;
  document.head.appendChild(newFavicon);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
