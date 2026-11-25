import { expect, test } from 'bun:test';
import { createElement, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createInstance } from 'i18next';
import { I18nextProvider, useTranslation } from 'react-i18next';
import { useConfigDocument } from '../src/features/config/hooks/useConfigDocument';

test('changing the editor language keeps the draft and does not reschedule the load effect', async () => {
  const i18n = createInstance();
  await i18n.init({
    lng: 'en',
    resources: {
      en: { translation: { title: 'Editor' } },
      fr: { translation: { title: 'Éditeur' } },
    },
  });
  const loadVisualValuesFromYaml = () => ({ ok: true as const });
  let initialLoad: ReturnType<typeof useConfigDocument>['loadConfig'] | undefined;
  function Editor() {
    const { t } = useTranslation();
    const doc = useConfigDocument({
      mode: 'source',
      visualDirty: false,
      visualParseError: null,
      loadVisualValuesFromYaml,
      rebaseVisualValuesFromYaml: loadVisualValuesFromYaml,
      applyVisualChangesToYaml: (yaml) => yaml,
    });
    const [edited, setEdited] = useState(false);
    if (!edited) {
      expect(t('title')).toBe('Editor');
      initialLoad = doc.loadConfig;
      doc.handleChange('server: {port: 9000}');
      void i18n.changeLanguage('fr');
      setEdited(true);
    } else {
      expect(t('title')).toBe('Éditeur');
      expect(doc.content).toBe('server: {port: 9000}');
      expect(doc.sourceDirty).toBe(true);
      expect(doc.loadConfig).toBe(initialLoad);
    }
    return null;
  }
  renderToStaticMarkup(createElement(I18nextProvider, { i18n }, createElement(Editor)));
});
