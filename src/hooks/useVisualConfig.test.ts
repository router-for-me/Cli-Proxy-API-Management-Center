// @ts-nocheck
import test from 'node:test';
import assert from 'node:assert/strict';
import { __visualConfigTestUtils } from './useVisualConfig';

const {
  hasPayloadParamValidationErrors,
  parsePayloadRules,
  parsePayloadFilterRules,
  serializePayloadRulesForYaml,
  serializePayloadFilterRulesForYaml,
} = __visualConfigTestUtils;

test('disabled payload param still blocks save when value is invalid', () => {
  const rules = [
    {
      id: 'rule-1',
      disabled: false,
      models: [],
      params: [
        {
          id: 'param-1',
          path: 'temperature',
          valueType: 'boolean' as const,
          value: 'abc',
          disabled: true,
        },
      ],
    },
  ];

  assert.equal(hasPayloadParamValidationErrors(rules), true);
});

test('disabled payload rule still blocks save when nested value is invalid', () => {
  const rules = [
    {
      id: 'rule-1',
      disabled: true,
      models: [],
      params: [
        {
          id: 'param-1',
          path: 'response_format',
          valueType: 'json' as const,
          value: '{"type":}',
          disabled: false,
        },
      ],
    },
  ];

  assert.equal(hasPayloadParamValidationErrors(rules), true);
});

test('valid disabled payload params still serialize disabled-params without extra metadata', () => {
  const serialized = serializePayloadRulesForYaml([
    {
      id: 'rule-1',
      disabled: false,
      models: [{ id: 'model-1', name: 'gpt-*', protocol: 'openai' }],
      params: [
        {
          id: 'param-1',
          path: 'temperature',
          valueType: 'number',
          value: '0.7',
          disabled: true,
        },
        {
          id: 'param-2',
          path: 'top_p',
          valueType: 'number',
          value: '0.9',
          disabled: false,
        },
      ],
    },
  ]);

  assert.deepEqual(serialized, [
    {
      models: [{ name: 'gpt-*', protocol: 'openai' }],
      params: { temperature: 0.7, top_p: 0.9 },
      'disabled-params': ['temperature'],
    },
  ]);
});

test('filter rules parse disabled-params into disabled entries', () => {
  const parsed = parsePayloadFilterRules([
    {
      models: [{ name: 'gpt-*', protocol: 'openai' }],
      params: ['temperature', 'top_p'],
      'disabled-params': ['temperature'],
    },
  ]);

  assert.equal(parsed.length, 1);
  assert.equal(parsed[0]?.params[0]?.path, 'temperature');
  assert.equal(parsed[0]?.params[0]?.disabled, true);
  assert.equal(parsed[0]?.params[1]?.path, 'top_p');
  assert.equal(parsed[0]?.params[1]?.disabled, false);
});

test('filter rules serialize disabled entries back into disabled-params', () => {
  const serialized = serializePayloadFilterRulesForYaml([
    {
      id: 'filter-rule-1',
      disabled: false,
      models: [{ id: 'model-1', name: 'gpt-*', protocol: 'openai' }],
      params: [
        { id: 'filter-param-1', path: 'temperature', disabled: true },
        { id: 'filter-param-2', path: 'top_p', disabled: false },
      ],
    },
  ]);

  assert.deepEqual(serialized, [
    {
      models: [{ name: 'gpt-*', protocol: 'openai' }],
      params: ['temperature', 'top_p'],
      'disabled-params': ['temperature'],
    },
  ]);
});

test('payload rules still parse disabled-params into disabled param entries', () => {
  const parsed = parsePayloadRules([
    {
      models: [{ name: 'claude-*', protocol: 'claude' }],
      params: { temperature: 0.6, top_p: 0.95 },
      'disabled-params': ['temperature'],
    },
  ]);

  assert.equal(parsed[0]?.params[0]?.disabled, true);
  assert.equal(parsed[0]?.params[1]?.disabled, false);
});
