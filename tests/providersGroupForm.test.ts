import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { getProviderCapabilities } from '@/features/providers/descriptors';
import { buildGeminiGroupConfig } from '@/features/providers/useProviderWorkbench';
import { serializeGeminiGroup } from '@/services/api/providers';
import {
  BaseProviderForm,
  buildGroupInitialForm,
} from '@/features/providers/sheets/forms/BaseProviderForm';
import type { ProviderResource } from '@/features/providers/types';
import en from '@/i18n/locales/en.json';
import zhCN from '@/i18n/locales/zh-CN.json';
import zhTW from '@/i18n/locales/zh-TW.json';
import ru from '@/i18n/locales/ru.json';
import vi from '@/i18n/locales/vi.json';
import ko from '@/i18n/locales/ko.json';
import tr from '@/i18n/locales/tr.json';

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
    expect(cleared.excludedModels).toBeUndefined();
    const explicitClear = buildGeminiGroupConfig(
      { ...baseInput, excludedModelsText: '' } as never,
      { name: 'team-a', 'excluded-models': ['veo*'], keys: [] }
    );
    expect(explicitClear.excludedModels).toEqual([]);
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

describe('group form model normalization', () => {
  test('keeps advanced model fields when loading a stored group', () => {
    const resource = {
      kind: 'group',
      raw: {
        name: 'team-a',
        models: [
          {
            name: 'gemini-2.5-flash',
            alias: 'flash',
            'display-name': 'Flash Display',
            'max-context-length': 1048576,
            'is-compat': true,
            thinking: { levels: ['high'], 'zero-allowed': true },
          },
        ],
        keys: [{ 'api-key': 'key-1' }],
      },
    } as unknown as ProviderResource;
    const form = buildGroupInitialForm(resource, 'edit');
    expect(form.models[0]).toMatchObject({
      name: 'gemini-2.5-flash',
      displayName: 'Flash Display',
      maxContextLength: '1048576',
      isCompat: true,
      thinkingLevels: ['high'],
      thinkingZeroAllowed: true,
    });
    expect(form.models[0].thinkingJson).toContain('zero_allowed');
  });

  test('keeps request-scoped-errors when loading a stored group', () => {
    const resource = {
      kind: 'group',
      raw: {
        name: 'team-a',
        'request-scoped-errors': [
          { status: 429, match: ['quota'], action: 'continue-and-cooldown' },
        ],
        keys: [{ 'api-key': 'key-1' }],
      },
    } as unknown as ProviderResource;
    const form = buildGroupInitialForm(resource, 'edit');
    expect(form.runtimePolicy?.errorsMode).toBe('override');
    expect(form.runtimePolicy?.errorRules).toHaveLength(1);
    expect(form.runtimePolicy?.errorRules[0]).toMatchObject({ status: '429' });
  });

  test('round-trips request-scoped-errors through a group edit', () => {
    const raw = {
      name: 'team-a',
      models: [{ name: 'gemini-2.5-flash' }],
      'request-scoped-errors': [
        { status: 400, match: ['invalid_argument'], action: 'continue' },
      ],
      keys: [{ 'api-key': 'key-1' }],
    };
    const resource = { kind: 'group', raw } as unknown as ProviderResource;
    const form = buildGroupInitialForm(resource, 'edit');
    const draft = buildGeminiGroupConfig(
      { ...form, models: form.models } as never,
      raw as Record<string, unknown>
    );
    const payload = serializeGeminiGroup(draft, raw as Record<string, unknown>);
    expect(payload['request-scoped-errors']).toEqual([
      { status: 400, match: ['invalid_argument'], action: 'continue' },
    ]);
  });

  test('keeps key overrides when the api-key value is edited', () => {
    const draft = buildGeminiGroupConfig(
      {
        ...baseInput,
        apiKeyEntries: [
          {
            apiKey: 'rotated-key',
            existingApiKey: 'old-key',
            proxyUrl: '',
            weight: undefined,
          },
        ],
      } as never,
      {
        name: 'team-a',
        keys: [
          {
            'api-key': 'old-key',
            models: [{ name: 'legacy-model' }],
            'connection-pool': { enabled: true },
          },
        ],
      }
    );
    expect(draft.keys[0].apiKey).toBe('rotated-key');
    expect(draft.keys[0].raw).toMatchObject({
      models: [{ name: 'legacy-model' }],
      'connection-pool': { enabled: true },
    });
  });
});

describe('group view i18n', () => {
  test('all locales use single-brace-free interpolation', () => {
    const locales = { en, zhCN, zhTW, ru, vi, ko, tr };
    Object.values(locales).forEach((locale) => {
      const table = locale.providersPage.table as Record<string, string>;
      expect(table.keysCount).toContain('{{count}}');
      expect(table.overrides).toContain('{{count}}');
      expect(table.keysCount).not.toMatch(/(^|[^{])\{count\}/);
    });
  });
});
