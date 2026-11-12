import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { ModelListFeedback, SystemModelsCard } from '../src/pages/SystemModelsCard';
import en from '../src/i18n/locales/en.json';
import zhCN from '../src/i18n/locales/zh-CN.json';
import zhTW from '../src/i18n/locales/zh-TW.json';
import ru from '../src/i18n/locales/ru.json';
import vi from '../src/i18n/locales/vi.json';
import ko from '../src/i18n/locales/ko.json';
import tr from '../src/i18n/locales/tr.json';

describe('model catalog refresh feedback', () => {
  test('keeps both actions and available models together without a result panel', async () => {
    const i18n = createInstance();
    await i18n.init({ lng: 'en', resources: { en: { translation: en } } });
    const markup = renderToStaticMarkup(
      createElement(
        I18nextProvider,
        { i18n },
        createElement(
          SystemModelsCard,
          {
            modelsLoading: false,
            onRefreshModels: async () => {},
            onCatalogsRefreshed: async () => {},
          },
          createElement('div', null, 'available-model-fixture')
        )
      )
    );
    expect(markup.match(/class="card(?:\s|")/g)).toHaveLength(1);
    expect(markup).toContain('Available Models');
    expect(markup).toContain('Refresh list');
    expect(markup).toContain('Update model catalog');
    expect(markup).toContain('Fetch the latest available models and refresh the list.');
    expect(markup).toContain('Update the shared model catalog');
    expect(markup).toContain('If a new model is missing');
    expect(markup).toContain('available-model-fixture');
    expect(markup).not.toContain('<details');
    expect(markup).not.toContain('capability definitions');
    const descriptionId = markup.match(/aria-describedby="([^"]+)"/)?.[1];
    expect(descriptionId).toBeTruthy();
    expect(markup).toContain(`id="${descriptionId}"`);
  });

  test('shows initial loading and errors while leaving completed results out of the layout', async () => {
    const i18n = createInstance();
    await i18n.init({ lng: 'en', resources: { en: { translation: en } } });
    const renderStatus = (status: Parameters<typeof ModelListFeedback>[0]['status']) =>
      renderToStaticMarkup(
        createElement(I18nextProvider, { i18n }, createElement(ModelListFeedback, { status }))
      );
    const pending = renderStatus({ kind: 'loading' });
    expect(pending).toContain('role="status"');
    expect(pending).toContain('Loading available models');
    expect(pending).toContain('loading-spinner');
    expect(renderStatus({ kind: 'loaded' })).toBe('');
    const error = renderStatus({ kind: 'error', retained: false, detail: 'fixture unavailable' });
    expect(error).toContain('role="alert"');
    expect(error).toContain(en.system_info.models_error);
    expect(error).toContain('fixture unavailable');
  });

  test('all seven locales include the action copy and preserve notification interpolation', () => {
    const keys = Object.keys(en.model_catalog);
    for (const locale of [en, zhCN, zhTW, ru, vi, ko, tr]) {
      const strings = locale.model_catalog as Record<string, string>;
      const systemStrings = locale.system_info as Record<string, string>;
      for (const key of keys) expect(strings[key]?.trim()).toBeTruthy();
      for (const key of [
        'models_refresh_button',
        'models_refresh_hint',
        'models_desc',
        'models_error_retained',
        'version_release_notes',
      ]) {
        expect(systemStrings[key]?.trim()).toBeTruthy();
      }
      expect(systemStrings.models_refresh_success).toContain('{{count}}');
      expect(systemStrings.models_desc).toContain(systemStrings.models_refresh_button);
      expect(systemStrings.models_desc).toContain(strings.button);
      expect(strings.changed_providers).toContain('{{providers}}');
      expect(systemStrings.models_refreshed_at).toBeUndefined();
      expect(strings.details).toBeUndefined();
    }
  });
});
