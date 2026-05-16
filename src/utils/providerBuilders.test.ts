import { describe, it, expect } from 'vitest';
import { buildApiKeyEntry } from './providerBuilders';

describe('buildApiKeyEntry', () => {
  it('returns defaults when called with no arguments', () => {
    expect(buildApiKeyEntry()).toEqual({
      apiKey: '',
      proxyUrl: '',
      headers: {},
    });
  });

  it('returns defaults for empty object', () => {
    expect(buildApiKeyEntry({})).toEqual({
      apiKey: '',
      proxyUrl: '',
      headers: {},
    });
  });

  it('populates apiKey from partial input', () => {
    expect(buildApiKeyEntry({ apiKey: 'sk-abc' })).toEqual({
      apiKey: 'sk-abc',
      proxyUrl: '',
      headers: {},
    });
  });

  it('populates proxyUrl from partial input', () => {
    expect(buildApiKeyEntry({ proxyUrl: 'http://localhost:8080' })).toEqual({
      apiKey: '',
      proxyUrl: 'http://localhost:8080',
      headers: {},
    });
  });

  it('populates headers from partial input', () => {
    expect(buildApiKeyEntry({ headers: { 'X-Custom': 'val' } })).toEqual({
      apiKey: '',
      proxyUrl: '',
      headers: { 'X-Custom': 'val' },
    });
  });

  it('populates all fields from full input', () => {
    expect(buildApiKeyEntry({
      apiKey: 'sk-full',
      proxyUrl: 'https://proxy.example.com',
      headers: { Authorization: 'Bearer x' },
    })).toEqual({
      apiKey: 'sk-full',
      proxyUrl: 'https://proxy.example.com',
      headers: { Authorization: 'Bearer x' },
    });
  });
});
