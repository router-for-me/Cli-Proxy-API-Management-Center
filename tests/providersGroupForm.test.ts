import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { getProviderCapabilities } from '@/features/providers/descriptors';
import { buildGeminiGroupConfig } from '@/features/providers/useProviderWorkbench';
import { BaseProviderForm } from '@/features/providers/sheets/forms/BaseProviderForm';
import type { ProviderResource } from '@/features/providers/types';
import en from '@/i18n/locales/en.json';

const i18n = createInstance();
await i18n.init({ lng: 'en', resources: { en: { translation: en } } });

const baseInput = {
  apiKey: '',
  name: 'team-a',
  baseUrl: 'https://generativelanguage.googleapis.com',
  proxyUrl: '',
  prefix: '',
  disabled: false,
  priority: 100,
  weight: undefined,
  models: [{ name: 'gemini-2.5-flash', alias: 'flash' }],
  headers: [{ key: 'X-Test', value: '1' }],
  excludedModelsText: 'veo*',
  apiKeyEntries: [
    { apiKey: '', existingApiKey: 'key-1', proxyUrl: '', weight: undefined },
    { apiKey: 'key-2', proxyUrl: 'http://127.0.0.1:7890', weight: 5 },
  ],
};

describe('gemini group capabilities', () => {
  test('group variant enables name and keys editor, hides the single key input', () => {
    const group = getProviderCapabilities('gemini', 'group');
    expect(group.supportsName).toBe(true);
    expect(group.supportsApiKey).toBe(false);
    expect(group.supportsApiKeyEntries).toBe(true);
    expect(getProviderCapabilities('gemini', 'key').supportsName).toBe(false);
  });
});

describe('buildGeminiGroupConfig', () => {
  test('keeps shared settings on the group and keys inheriting', () => {
    const draft = buildGeminiGroupConfig({
      ...baseInput,
      apiKeyEntries: [
        { apiKey: '', existingApiKey: 'key-1', proxyUrl: '', weight: undefined },
        {
          apiKey: 'key-2',
          proxyUrl: 'http://127.0.0.1:7890',
          weight: 5,
          raw: { 'api-key': 'key-2', models: [{ name: 'override' }], 'connection-pool': { enabled: true } },
        },
      ],
    } as never);

    expect(draft.name).toBe('team-a');
    expect(draft.models).toHaveLength(1);
    expect(draft.models?.[0]).toMatchObject({ name: 'gemini-2.5-flash', alias: 'flash' });
    expect(draft.excludedModels).toEqual(['veo*']);
    expect(draft.priority).toBe(100);
    expect(draft.keys[0]).toEqual({ apiKey: 'key-1', weight: undefined, proxyUrl: undefined, raw: undefined });
    expect(draft.keys[1].raw).toMatchObject({
      models: [{ name: 'override' }],
      'connection-pool': { enabled: true },
    });
  });

  test('adds the disable rule only when disabled', () => {
    const disabled = buildGeminiGroupConfig({ ...baseInput, disabled: true } as never);
    expect(disabled.excludedModels).toEqual(['veo*', '*']);
    const cleared = buildGeminiGroupConfig({
      ...baseInput,
      excludedModelsText: '',
    } as never);
    expect(cleared.excludedModels).toEqual([]);
  });
});

describe('group form rendering', () => {
  test('renders the group name field and the keys editor', () => {
    const resource = {
      kind: 'group',
      raw: {
        name: 'team-a',
        models: [{ name: 'gemini-2.5-flash' }],
        'excluded-models': [],
        keys: [{ 'api-key': 'key-1' }],
      },
    } as unknown as ProviderResource;
    const html = renderToStaticMarkup(
      createElement(
        I18nextProvider,
        { i18n },
        createElement(BaseProviderForm, {
          brand: 'gemini',
          resource,
          mode: 'edit',
          variant: 'group',
          mutating: false,
          formId: 'group-form',
          onSubmit: async () => {},
        })
      )
    );
    expect(html).toContain('team-a');
    expect(html).toContain(String(en.providersPage.form.apiKeyEntriesSection));
    expect(html).toContain(String(en.providersPage.form.modelsSection));
  });
});
