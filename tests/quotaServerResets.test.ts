import { describe, expect, test } from 'bun:test';
import { AnthropicResetGrantUnknownOutcome } from '../src/services/api/claudeResetGrants';
import { ResetGrantPreflightError } from '../src/features/quota/providers/claude/resetGrantOperations';
import { claimResetOnServer, claudeClaimCode } from '../src/features/quota/providers/serverResets';
import { loadResetEvents } from '../src/features/quotaPool/resetEvents';
import type { ResetEventView } from '../src/services/api/quotaPool';

const body = { accountId: 'hub:claude:abc', clientRequestId: 'request-1', grantId: 'grant' };
const failing = (error: unknown) => ({
  claimReset: async () => {
    throw error;
  },
});

describe('pages spend resets through the history server', () => {
  test('the answer is passed through', async () => {
    const answer = {
      outcome: 'reset',
      replayed: false,
      refreshed: true,
      event: {} as ResetEventView,
    };
    expect(await claimResetOnServer({ claimReset: async () => answer }, body)).toBe(answer);
  });

  test('a refusal proves nothing was sent, and keeps the server stage and reason', async () => {
    const refusal = { status: 409, details: { stage: 'eligibility', reason: 'blocked_cooldown' } };
    const error = await claimResetOnServer(failing(refusal), body).catch((caught) => caught);
    expect(error).toBeInstanceOf(ResetGrantPreflightError);
    expect(error).toMatchObject({ stage: 'eligibility', reason: 'blocked_cooldown' });
    // A hub the server could not reach before sending is a refusal too.
    const unreachable = await claimResetOnServer(failing({ status: 502, details: {} }), body).catch(
      (caught) => caught
    );
    expect(unreachable).toMatchObject({ stage: 'operation', reason: 'refused' });
  });

  test('anything without an answer may have been sent, so it stays an unknown outcome', async () => {
    for (const error of [{ status: 500, details: {} }, new Error('network'), { status: 503 }]) {
      const caught = await claimResetOnServer(failing(error), body).catch((value) => value);
      expect(caught).toBeInstanceOf(AnthropicResetGrantUnknownOutcome);
    }
  });

  test('Claude codes map onto the journal; an unknown outcome stays retryable', () => {
    for (const code of ['reset', 'already_used', 'cooldown', 'rate_limited', 'auth_error'])
      expect(String(claudeClaimCode(code))).toBe(code);
    expect(() => claudeClaimCode('unknown')).toThrow(AnthropicResetGrantUnknownOutcome);
  });
});

describe('recorded resets for Quota Management', () => {
  test('one request serves every account row of a provider; a failed read shows nothing', async () => {
    let reads = 0;
    const event = { accountId: 'a', kind: 'fable', outcome: 'reset' } as ResetEventView;
    const api = {
      resetEvents: async () => {
        reads++;
        return { events: [event] };
      },
    };
    const [first, second] = await Promise.all([
      loadResetEvents('codex', api),
      loadResetEvents('codex', api),
    ]);
    expect(first).toEqual([event]);
    expect(second).toEqual([event]);
    expect(reads).toBe(1);
    // Nothing is kept once it settled: a later page (or another connection) reads its own.
    await loadResetEvents('codex', api);
    expect(reads).toBe(2);
    const failed = await loadResetEvents('claude', {
      resetEvents: async () => {
        throw new Error('down');
      },
    });
    expect(failed).toEqual([]);
  });
});
