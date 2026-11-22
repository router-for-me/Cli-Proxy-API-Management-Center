import { expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import en from '@/i18n/locales/en.json';
import { BaseProviderForm } from '@/features/providers/sheets/forms/BaseProviderForm';
import {
  buildSharedSettings,
  memberProbeSettings,
  readSharedForm,
} from '@/features/providers/nativeConnectionForm';
import { buildProviderGroups } from '@/features/providers/useProviderWorkbench';
import { normalizeConfigResponse } from '@/services/api/transformers';

const i18n = createInstance();
await i18n.init({ lng: 'en', resources: { en: { translation: en } } });
const group = {
  name: 'Fixture connection',
  'base-url': 'https://example.invalid',
  headers: { 'X-Group': 'fixture' },
  models: [{ name: 'upstream', alias: 'model', future: true }],
  'connection-pool': { enabled: false, future: true },
  keys: [
    { 'api-key': 'fixture-one', priority: 9 },
    { 'api-key': 'fixture-two', 'proxy-url': 'direct' },
  ],
};

test('all native credentials are blank password inputs within the same shared settings form', () => {
  const nativeSection = buildProviderGroups(
    normalizeConfigResponse({ 'api-keys': { claude: [group] } })
  ).find((g) => g.id === 'claude')!.nativeSections![0];
  const html = renderToStaticMarkup(
    createElement(
      I18nextProvider,
      { i18n },
      createElement(BaseProviderForm, {
        brand: 'claude',
        mode: 'edit',
        nativeSection,
        resource: null,
        formId: 'fixture',
        mutating: false,
        onNativeSubmit: async () => {},
      })
    )
  );
  expect(html.match(/<form\b/g)).toHaveLength(1);
  expect(html.match(/type="password"/g)).toHaveLength(2);
  expect(html).toContain('value="Fixture connection"');
  expect(html).toContain('value="https://example.invalid"');
  expect(html).toContain(en.providersPage.form.addApiKeyEntry);
  for (const [index, key] of group.keys.entries()) {
    expect(html).toContain(`aria-label="Delete Key #${index + 1}"`);
    expect(html).not.toContain(key['api-key']);
  }
  expect(html).not.toContain('type="submit"'); // One Save, owned by the sheet footer.
});

test('changing shared controls preserves unknown fields, sparse pool properties and key overrides', () => {
  const shared = readSharedForm(group, {
    apiKey: '',
    name: '',
    baseUrl: '',
    prefix: '',
    proxyUrl: '',
    disabled: false,
    excludedModelsText: '',
    models: [],
    headers: [],
  });
  expect(buildSharedSettings('claude', group, shared, shared)).toEqual(group);
  const updated = buildSharedSettings('claude', group, shared, {
    ...shared,
    baseUrl: 'https://new.example.invalid',
    prefix: 'team',
    models: [{ ...shared.models[0], alias: 'renamed' }],
    connectionPool: { ...shared.connectionPool, maxIdleConnsPerHost: 0 },
  });
  expect(updated).toEqual({
    ...group,
    'base-url': 'https://new.example.invalid',
    prefix: 'team',
    models: [{ ...group.models[0], alias: 'renamed' }],
    'connection-pool': { ...group['connection-pool'], 'max-idle-conns-per-host': 0 },
  });
  expect(updated.keys).toBe(group.keys);
});

test('probing a key applies its direct proxy and explicit headers instead of shared defaults', () => {
  const shared = readSharedForm(group, {
    apiKey: '',
    name: '',
    baseUrl: '',
    prefix: '',
    proxyUrl: '',
    disabled: false,
    excludedModelsText: '',
    models: [],
    headers: [],
  });
  const initial = { ...shared, proxyUrl: '', headers: [] };
  const input = { ...initial, proxyUrl: 'direct', headers: [{ key: 'X-Key', value: 'fixture' }] };
  const connection = { ...shared, proxyUrl: 'http://proxy.invalid:8080' };
  expect(memberProbeSettings(connection, { resource: null, initial, input })).toEqual({
    probeProxyUrl: 'direct',
    probeHeaders: input.headers,
  });
  expect(memberProbeSettings(connection, { resource: null, initial, input: initial })).toEqual({
    probeProxyUrl: connection.proxyUrl,
    probeHeaders: connection.headers,
  });
});
