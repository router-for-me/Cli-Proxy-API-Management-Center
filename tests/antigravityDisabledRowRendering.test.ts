import { beforeAll, describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from '../src/i18n/index';
import { AntigravityQuotaBody } from '../src/features/quota/providers/antigravity/AntigravityQuotaBody';
import { QUOTA_CLASS_KEYS, type QuotaBodyProps } from '../src/features/quota/types';
import type { AntigravityQuotaState } from '../src/types';

beforeAll(async () => {
  // The wording under test is locale-specific; pin zh-CN rather than let the
  // browser guess decide what the assertions read.
  await i18n.changeLanguage('zh-CN');
});

const classes = Object.fromEntries(QUOTA_CLASS_KEYS.map((key) => [key, key]));

type Bucket = AntigravityQuotaState['groups'][number]['buckets'][number];

const NOW = new Date('2026-10-03T12:00:00Z').getTime();
const WEEKLY_RESET = '2026-10-06T02:26:28Z'; // ~2 天后
const FIVE_HOUR_RESET = '2026-10-03T17:00:00Z'; // 5 小时后

const render = (buckets: Bucket[], nowMs = NOW): string => {
  const quota: AntigravityQuotaState = {
    groups: [{ id: 'gemini-models', label: 'Gemini Models', buckets }],
  };
  const realNow = Date.now;
  Date.now = () => nowMs;
  try {
    return renderToStaticMarkup(
      createElement(AntigravityQuotaBody, {
        quota,
        classes,
      } as QuotaBodyProps<AntigravityQuotaState>)
    );
  } finally {
    Date.now = realNow;
  }
};

const disabledFiveHour = (overrides: Partial<Bucket> = {}): Bucket => ({
  id: 'five-hour',
  label: '5 hour limit',
  window: '5h',
  remainingFraction: 1,
  resetTime: FIVE_HOUR_RESET,
  disabled: true,
  disabledResetTime: WEEKLY_RESET,
  ...overrides,
});

const EXHAUSTED = '周额度已用完，5 小时额度暂不生效';

describe('Antigravity disabled-row wording', () => {
  test('carries the recovery countdown on the left and no second one on the right', () => {
    const markup = render([
      disabledFiveHour(),
      {
        id: 'weekly',
        label: 'weekly limit',
        window: 'weekly',
        remainingFraction: 0,
        resetTime: WEEKLY_RESET,
      },
    ]);

    expect(markup).toContain(`${EXHAUSTED}，2 天 14 小时 后恢复`);
    // 5h 自己的倒计时不能再出现在被压制的那一行 —— 左侧已经写了恢复时长。
    // （weekly 行照常显示自己的倒计时，所以按行断言而不是整页。）
    const disabledRow = markup.slice(0, markup.indexOf('周限额'));
    expect(disabledRow).not.toContain('后刷新');
    expect(disabledRow).not.toContain('可刷新');
  });

  test('falls back to the duration-free copy once the weekly reset has passed', () => {
    const markup = render([disabledFiveHour({ disabledResetTime: '2026-10-01T00:00:00Z' })]);

    expect(markup).toContain(EXHAUSTED);
    expect(markup).not.toContain('后恢复');
    expect(markup).not.toContain('可刷新');
  });

  test('never renders "- 后恢复" when the weekly reset is missing', () => {
    const markup = render([disabledFiveHour({ disabledResetTime: undefined })]);

    expect(markup).toContain(EXHAUSTED);
    expect(markup).not.toContain('暂不生效，-');
    expect(markup).not.toContain('后恢复');
  });

  test('keeps the ordinary countdown on rows that are not suppressed', () => {
    const markup = render([disabledFiveHour({ disabled: undefined, disabledResetTime: undefined })]);

    expect(markup).toContain('额度可用');
    expect(markup).toContain('5 小时 0 分钟 后刷新');
  });
});
