/**
 * Static markup for the Codex credit overage row, its dialog, and the body slot that
 * hosts the row. Browser interaction is outside this harness.
 */

import { beforeAll, describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from '@/i18n';
import {
  CodexCreditOverageDialog,
  type CodexCreditOverageDialogProps,
} from '@/features/quota/providers/codex/CodexCreditOverageDialog';
import {
  CodexCreditOverageRow,
  type CodexCreditOverageRowProps,
} from '@/features/quota/providers/codex/CodexCreditOverageRow';
import { CodexQuotaBody } from '@/features/quota/providers/codex/CodexQuotaBody';
import {
  CodexCreditOverageError,
  describeCodexCreditOverageError,
} from '@/features/quota/providers/codex/creditOverage';
import { QUOTA_CLASS_KEYS, bindQuotaClasses } from '@/features/quota/types';
import type { CodexCreditOverageEntry, CodexQuotaState } from '@/types';

const classes = bindQuotaClasses(
  Object.fromEntries(QUOTA_CLASS_KEYS.map((key) => [key, key])),
  'test-host'
);

// The i18n fallback is zh-CN; pin English so assertions read.
beforeAll(async () => {
  await i18n.changeLanguage('en');
});

describe('CodexCreditOverageRow', () => {
  const render = (props: Partial<CodexCreditOverageRowProps> = {}) =>
    renderToStaticMarkup(
      createElement(CodexCreditOverageRow, {
        entry: undefined,
        classes,
        disabled: false,
        name: 'codex-a.json',
        onManage: () => {},
        ...props,
      })
    );

  test('defaults to an honest unknown state with a named dialog trigger', () => {
    const markup = render();

    expect(markup).toContain('Credits after limit');
    expect(markup).toContain('data-state="unknown"');
    expect(markup).toContain('>Unknown<');
    expect(markup).toContain('aria-haspopup="dialog"');
    expect(markup).toContain(
      'aria-label="Configure credits after limit for &quot;codex-a.json&quot;"'
    );
    expect(markup).toContain('>Configure<');
    expect(markup).not.toContain('disabled');
  });

  test.each<[CodexCreditOverageEntry, string, string]>([
    [{ status: 'known', value: true, at: Date.now() }, 'allowed', 'Allowed'],
    [{ status: 'known', value: false, at: Date.now() }, 'blocked', 'Not allowed'],
    [{ status: 'writing', target: true }, 'writing', 'Updating…'],
    [{ status: 'unconfirmed', target: true, at: Date.now() }, 'unconfirmed', 'Unconfirmed'],
  ])('renders %j as %s', (entry, state, label) => {
    const markup = render({ entry });

    expect(markup).toContain(`data-state="${state}"`);
    expect(markup).toContain(`>${label}<`);
    // Only a confirmed write carries its confirmation time.
    expect(markup.includes('confirmed ')).toBe(entry.status === 'known');
  });

  test('disables the trigger while the card or account is busy', () => {
    expect(render({ disabled: true })).toMatch(/<button[^>]*disabled=""/);
  });
});

describe('CodexQuotaBody host slot', () => {
  test('places afterPlan between the plan row and the usage rows', () => {
    const quota: CodexQuotaState = {
      status: 'success',
      planType: 'plus',
      creditBalance: '12',
      windows: [
        {
          id: 'five-hour',
          label: '5-hour limit',
          usedPercent: 10,
          resetLabel: '-',
          resetAtMs: null,
          periodHours: 5,
        },
      ],
    };
    const markup = renderToStaticMarkup(
      createElement(CodexQuotaBody, {
        quota,
        classes,
        afterPlan: createElement('div', { id: 'slot' }),
      })
    );
    const plan = markup.indexOf('class="codexPlan"');
    const slot = markup.indexOf('id="slot"');

    expect(plan).toBeGreaterThanOrEqual(0);
    expect(slot).toBeGreaterThan(plan);
    expect(markup.indexOf('5-hour limit')).toBeGreaterThan(slot);
  });
});

describe('CodexCreditOverageDialog', () => {
  const context: CodexCreditOverageDialogProps['context'] = {
    key: 'acct-123|email:user@example.com',
    accountId: 'acct-123',
    connectionRevision: 1,
    cacheGeneration: 1,
    accountLabel: 'user@example.com',
    creditBalance: '1250',
    creditsUnlimited: false,
  };
  const render = (props: Partial<CodexCreditOverageDialogProps> = {}) =>
    renderToStaticMarkup(
      createElement(CodexCreditOverageDialog, {
        open: true,
        context,
        entry: undefined,
        sharedCredentialCount: 1,
        pendingTarget: null,
        feedback: null,
        onApply: () => {},
        onClose: () => {},
        ...props,
      })
    );

  test('explains scope and risk before offering both values', () => {
    const markup = render();

    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('Use credits after the usage limit');
    expect(markup).toContain('user@example.com');
    expect(markup).toContain('1250');
    expect(markup).toContain('data-state="unknown"');
    expect(markup).toContain('Choose an option below to update it.');
    expect(markup).toContain('spending the account’s credit balance');
    expect(markup).toContain('Applies to all apps authorized to use this ChatGPT plan.');
    expect(markup).not.toContain('SIWC');
    expect(markup).not.toContain('session');
    expect(markup).not.toContain('read this setting');
    expect(markup).not.toContain('cool down');
    expect(markup).not.toContain('share this account setting');
    expect(markup).toContain('btn-secondary');
    expect(markup).toContain('Don’t allow credits');
    expect(markup).toMatch(/btn-danger[^>]*><span>Allow credits<\/span>/);
  });

  test('the close control precedes both choices, so initial focus never lands on Allow', () => {
    const markup = render();
    expect(markup.indexOf('modal-close-floating')).toBeLessThan(markup.indexOf('btn-danger'));
  });

  test('mentions sibling credentials only when the account user is shared', () => {
    expect(render({ sharedCredentialCount: 3 })).toContain(
      '3 credentials in this panel share this account setting'
    );
  });

  test('shows unlimited credits instead of a balance', () => {
    expect(render({ context: { ...context, creditsUnlimited: true } })).toContain('Unlimited');
  });

  test('shows a confirmed value without the unknown hint', () => {
    const markup = render({ entry: { status: 'known', value: true, at: Date.now() } });

    expect(markup).toContain('data-state="allowed"');
    expect(markup).toContain('confirmed ');
    expect(markup).not.toContain('Choose an option below to update it.');
  });

  test('omits an unavailable balance instead of adding a placeholder fact', () => {
    const markup = render({ context: { ...context, creditBalance: null } });
    expect(markup).not.toContain(`<dt>${i18n.t('codex_quota.credit_balance_label')}</dt>`);
  });

  test('keeps a known zero balance visible for the spending decision', () => {
    const markup = render({ context: { ...context, creditBalance: '0' } });
    expect(markup).toContain(`<dt>${i18n.t('codex_quota.credit_balance_label')}</dt>`);
    expect(markup).toContain('<dd>0</dd>');
  });

  test.each<CodexCreditOverageEntry | undefined>([
    undefined,
    { status: 'known', value: false, at: 1 },
    { status: 'known', value: true, at: 1 },
    { status: 'unconfirmed', target: true, at: 1 },
  ])('keeps spending and scope disclosures visible before the choices for %j', (entry) => {
    const markup = render({ entry });
    const footer = markup.indexOf('modal-footer');
    for (const text of [
      'spending the account’s credit balance',
      'all apps authorized to use this ChatGPT plan',
    ]) {
      expect(markup.indexOf(text)).toBeGreaterThan(0);
      expect(markup.indexOf(text)).toBeLessThan(footer);
    }
  });

  test('renders a recovery action without leaking a raw backend diagnostic', () => {
    const raw = '400 {"internal_token":"SYNTHETIC_ONLY","auth_index":"debug-index"}';
    const message = describeCodexCreditOverageError(
      i18n.t.bind(i18n),
      new CodexCreditOverageError('failed', raw)
    );
    const markup = render({ feedback: { tone: 'error', message } });
    expect(markup).toContain('Could not update the setting. Try again later.');
    expect(markup).not.toContain('SYNTHETIC_ONLY');
    expect(markup).not.toContain('auth_index');
  });

  test('combines a retry failure and its unresolved context into one alert', () => {
    const markup = render({
      entry: { status: 'unconfirmed', target: true, at: 1 },
      operation: { status: 'unconfirmed', target: true, at: 1 },
      feedback: { tone: 'error', message: 'This account cannot change the setting.' },
    });
    expect(markup).toContain('This account cannot change the setting.');
    expect(markup).toContain('The previous change could not be confirmed.');
    expect(markup.match(/role="alert"/g)?.length).toBe(1);
    expect(markup).not.toContain('role="status"');
  });

  test('locks both choices and closing while a write is pending', () => {
    const markup = render({ pendingTarget: true });
    const footer = markup.slice(markup.indexOf('modal-footer'));

    expect(markup).toMatch(/class="modal-close-floating"[^>]*disabled=""/);
    expect(footer.match(/disabled=""/g)?.length).toBe(3);
  });

  test.each([true, false])(
    'only permits the original %p choice after an ambiguous write',
    (target) => {
      const markup = render({
        entry: { status: 'unconfirmed', target, at: 1 },
        operation: { status: 'unconfirmed', target, at: 1 },
      });
      const allow = markup.match(/<button[^>]*class="btn btn-danger"[^>]*>/)?.[0];
      const block = markup.match(/<button[^>]*class="btn btn-secondary"[^>]*>/)?.[0];
      expect(allow).toBeDefined();
      expect(block).toBeDefined();
      expect(allow!.includes('disabled')).toBe(!target);
      expect(block!.includes('disabled')).toBe(target);
      expect(markup).toContain('Only the same choice can be retried for now.');
      expect(markup).toContain('role="status"');
      expect(markup).not.toMatch(/class="modal-close-floating"[^>]*disabled/);
    }
  );

  test('an expired dialog blocks writes while keeping cancel and closing available', () => {
    const markup = render({ contextCurrent: false });
    const footer = markup.slice(markup.indexOf('modal-footer'));
    expect(footer.match(/disabled=""/g)?.length).toBe(2);
    expect(markup).toContain('The connection or credential changed.');
    expect(markup).not.toMatch(/class="modal-close-floating"[^>]*disabled/);
  });

  test('a write started by another credential locks both choices in an already open dialog', () => {
    const markup = render({ operation: { status: 'writing', target: true, unconfirmed: false } });
    const footer = markup.slice(markup.indexOf('modal-footer'));
    expect(footer.match(/disabled=""/g)?.length).toBe(2);
    expect(markup).not.toMatch(/class="modal-close-floating"[^>]*disabled/);
  });

  test('announces failures as alerts and ambiguous results as status', () => {
    expect(render({ feedback: { tone: 'error', message: 'nope' } })).toContain('role="alert"');
    const warning = render({ feedback: { tone: 'warning', message: 'maybe' } });
    expect(warning).toContain('role="status"');
    expect(warning).not.toContain('role="alert"');
  });
});
