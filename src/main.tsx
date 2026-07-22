import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@/styles/global.scss';
import App from './App.tsx';

const CPAMC_MARK_FAVICON =
  'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2NCA2NCIgZmlsbD0ibm9uZSI+CiAgPGRlZnM+CiAgICA8bGluZWFyR3JhZGllbnQgaWQ9ImNwYW1jLXNpZ25hbCIgeDE9IjEyIiB5MT0iMTAiIHgyPSI1MyIgeTI9IjU1IiBncmFkaWVudFVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+CiAgICAgIDxzdG9wIHN0b3AtY29sb3I9IiMzOUI5QjAiLz4KICAgICAgPHN0b3Agb2Zmc2V0PSIxIiBzdG9wLWNvbG9yPSIjM0Y2QkU4Ii8+CiAgICA8L2xpbmVhckdyYWRpZW50PgogICAgPGxpbmVhckdyYWRpZW50IGlkPSJjcGFtYy1jb3JlIiB4MT0iMjQiIHkxPSIyMCIgeDI9IjQwIiB5Mj0iNDQiIGdyYWRpZW50VW5pdHM9InVzZXJTcGFjZU9uVXNlIj4KICAgICAgPHN0b3Agc3RvcC1jb2xvcj0iI0ZGRjZCNyIvPgogICAgICA8c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IiNFN0E5NDkiLz4KICAgIDwvbGluZWFyR3JhZGllbnQ+CiAgPC9kZWZzPgogIDxyZWN0IHdpZHRoPSI2NCIgaGVpZ2h0PSI2NCIgcng9IjE2IiBmaWxsPSIjMTcyMTJFIi8+CiAgPHBhdGggZD0iTTE0IDI0LjUgMzEuOCAxNCA1MCAyNC41djE1TDMxLjggNTAgMTQgMzkuNXYtMTVaIiBzdHJva2U9InVybCgjY3BhbWMtc2lnbmFsKSIgc3Ryb2tlLXdpZHRoPSIzLjUiIHN0cm9rZS1saW5lam9pbj0icm91bmQiLz4KICA8cGF0aCBkPSJtMTggMzIgMTAtNS44TTM2IDI2LjIgNDYgMzJNMzIgMzguOFY0NyIgc3Ryb2tlPSJ1cmwoI2NwYW1jLXNpZ25hbCkiIHN0cm9rZS13aWR0aD0iMy41IiBzdHJva2UtbGluZWNhcD0icm91bmQiLz4KICA8Y2lyY2xlIGN4PSIzMiIgY3k9IjMyIiByPSI4IiBmaWxsPSJ1cmwoI2NwYW1jLWNvcmUpIi8+CiAgPGNpcmNsZSBjeD0iMzIiIGN5PSIzMiIgcj0iMyIgZmlsbD0iIzE3MjEyRSIvPgo8L3N2Zz4K';

document.title = 'CPAMC++';
document.documentElement.setAttribute('translate', 'no');
document.documentElement.classList.add('notranslate');

const faviconEl = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
if (faviconEl) {
  faviconEl.href = CPAMC_MARK_FAVICON;
  faviconEl.type = 'image/svg+xml';
} else {
  const newFavicon = document.createElement('link');
  newFavicon.rel = 'icon';
  newFavicon.type = 'image/svg+xml';
  newFavicon.href = CPAMC_MARK_FAVICON;
  document.head.appendChild(newFavicon);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
