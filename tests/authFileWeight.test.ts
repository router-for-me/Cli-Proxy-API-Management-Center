import { describe, expect, test } from 'bun:test';
import {
  buildAuthFileFieldsPatch,
  type PrefixProxyEditorState,
} from '../src/features/authFiles/hooks/useAuthFilesPrefixProxyEditor';

const makeEditor = (json: Record<string, unknown>, weight: string): PrefixProxyEditorState => ({
  fileName: 'credential.json',
  fileInfoText: '',
  loading: false,
  saving: false,
  error: null,
  originalText: JSON.stringify(json),
  rawText: JSON.stringify(json),
  invalidContentPreview: '',
  json,
  providerKey: 'codex',
  prefix: '',
  proxyUrl: '',
  priority: '',
  weight,
  weightError: null,
  websockets: false,
  websocketsTouched: false,
  usingApi: false,
  usingApiTouched: false,
  note: '',
  noteTouched: false,
  excludedModelsText: '',
  excludedModelsTouched: false,
  headersText: '',
  headersTouched: false,
  headersError: null,
});

const resolveError = (key: string) => key;

describe('auth-file credential weight patch', () => {
  test('writes numeric weight and uses null to restore the default', () => {
    expect(buildAuthFileFieldsPatch(makeEditor({}, '0'), resolveError)).toEqual({ weight: 0 });
    expect(buildAuthFileFieldsPatch(makeEditor({ weight: 5 }, ''), resolveError)).toEqual({
      weight: null,
    });
  });

  test('recognizes a numeric string in an existing auth file', () => {
    expect(buildAuthFileFieldsPatch(makeEditor({ weight: '7' }, '7'), resolveError)).toEqual({});
    expect(buildAuthFileFieldsPatch(makeEditor({ weight: '7' }, ''), resolveError)).toEqual({
      weight: null,
    });
  });

  test('rejects invalid and oversized values before PATCH', () => {
    expect(() => buildAuthFileFieldsPatch(makeEditor({}, '1.5'), resolveError)).toThrow(
      'auth_files.weight_invalid_integer'
    );
    expect(() => buildAuthFileFieldsPatch(makeEditor({}, '1000001'), resolveError)).toThrow(
      'auth_files.weight_invalid_max'
    );
  });
});

describe('auth-file excluded models patch', () => {
  test('writes normalized model patterns to the canonical field', () => {
    const editor = {
      ...makeEditor({}, ''),
      excludedModelsText: ' gpt-5-*\nGPT-5-*\nclaude-opus ',
      excludedModelsTouched: true,
    };

    expect(buildAuthFileFieldsPatch(editor, resolveError)).toEqual({
      excluded_models: ['gpt-5-*', 'claude-opus'],
    });
  });

  test('preserves the legacy hyphenated field name', () => {
    const editor = {
      ...makeEditor({ 'excluded-models': ['old-model'] }, ''),
      excludedModelsText: 'new-model',
      excludedModelsTouched: true,
    };

    expect(buildAuthFileFieldsPatch(editor, resolveError)).toEqual({
      'excluded-models': ['new-model'],
    });
  });

  test('clears exclusions with an empty array and ignores untouched values', () => {
    const original = { excluded_models: ['gpt-5-*'] };
    expect(buildAuthFileFieldsPatch(makeEditor(original, ''), resolveError)).toEqual({});
    expect(
      buildAuthFileFieldsPatch(
        {
          ...makeEditor(original, ''),
          excludedModelsText: '',
          excludedModelsTouched: true,
        },
        resolveError
      )
    ).toEqual({ excluded_models: [] });
  });
});
