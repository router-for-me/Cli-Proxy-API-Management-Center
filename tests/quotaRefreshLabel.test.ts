import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from '../src/i18n/index';
import { QuotaHeader } from '../src/features/quota/components/QuotaHeader';

const labels = {
  en: 'Refresh page quotas',
  'zh-CN': '刷新本页配额',
  'zh-TW': '重新整理本頁配額',
  ru: 'Обновить квоты на странице',
  vi: 'Làm mới hạn mức trên trang',
  ko: '현재 페이지 할당량 새로 고침',
};

describe('quota refresh scope label', () => {
  for (const [language, label] of Object.entries(labels)) {
    test(`describes page quotas rather than server-wide credentials in ${language}`, async () => {
      const previousLanguage = i18n.language;
      try {
        await i18n.changeLanguage(language);
        const html = renderToStaticMarkup(
          createElement(QuotaHeader, {
            totalCount: 25,
            loadedCount: 20,
            attentionCount: 0,
            refreshing: false,
            disableControls: false,
            onRefreshAll: () => {},
          })
        );
        expect(html).toContain(`${label}</button>`);
      } finally {
        await i18n.changeLanguage(previousLanguage);
      }
    });
  }
});
