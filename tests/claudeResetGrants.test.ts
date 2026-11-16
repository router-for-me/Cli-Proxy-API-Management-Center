import {
  resetGrantChoices,
  selectResetGrant,
} from '../src/features/quota/providers/claude/selectResetGrant';

import { afterEach, describe, expect, test } from 'bun:test';
import {
  anthropicResetGrantBlocker,
  claimClaudeResetGrant,
  parseAnthropicResetGrantStatus,
  readClaudeOrganization,
  readClaudeResetGrants,
  AnthropicResetGrantUnknownOutcome,
  AnthropicResetGrantError,
  ANTHROPIC_RESET_RESULTS,
  type AnthropicResetSettledCode,
} from '../src/services/api/claudeResetGrants';
import { apiCallApi, type ApiCallRequest } from '../src/services/api/apiCall';
import {
  createResetGrantOperations,
  ResetGrantPreflightError,
  resetGrantFailureMessageKey,
  RETRY_WINDOW_MS,
} from '../src/features/quota/providers/claude/resetGrantOperations';

const organization = '11111111-2222-3333-4444-555555555555';
const grant = { id: 'test-grant', resets_total: 2, resets_left: 2, usable_now: true };
const block = { eligible: true, at_limit: true, grants: [grant] };
const status = () => parseAnthropicResetGrantStatus(block)!;
const originalRequest = apiCallApi.request;
afterEach(() => {
  apiCallApi.request = originalRequest;
});

describe('Claude reset grant fail-closed parsing', () => {
  test('valid block and refusing defaults', () => {
    expect(status().grants[0].useRequiresLimit).toBe(true);
    expect(anthropicResetGrantBlocker(status(), grant.id)).toBeNull();
    expect(anthropicResetGrantBlocker({ ...status(), atLimit: false }, grant.id)).toBe(
      'not_limited'
    );
    expect(anthropicResetGrantBlocker({ ...status(), eligible: false }, grant.id)).toBe(
      'ineligible'
    );
    const missing = parseAnthropicResetGrantStatus({
      ...block,
      grants: [{ ...grant, usable_now: undefined }],
    })!;
    expect(anthropicResetGrantBlocker(missing, grant.id)).toBe('not_usable');
  });
  test('rejects malformed blocks and grants', () => {
    for (const value of [
      undefined,
      {},
      { ...block, eligible: 1 },
      { ...block, grants: {} },
      { ...block, grants: [grant, grant] },
      { ...block, cooldown_until: 'bad' },
    ]) {
      expect(parseAnthropicResetGrantStatus(value)).toBeNull();
    }
    for (const fields of [
      { id: '../bad' },
      { resets_left: -1 },
      { resets_left: 3 },
      { resets_total: 1.5 },
      { paused: 'false' },
      { starts_at: 'bad' },
      { clears: {} },
    ]) {
      expect(
        parseAnthropicResetGrantStatus({ ...block, grants: [{ ...grant, ...fields }] })
      ).toBeNull();
    }
  });
});

describe('Claude reset grant kinds', () => {
  const kindOf = (fields: Record<string, unknown>) =>
    parseAnthropicResetGrantStatus({ ...block, grants: [{ ...grant, ...fields }] })?.grants[0]
      ?.kind;

  test('a grant that gives back weekly usage is a Fable reset, whatever else it says', () => {
    expect(kindOf({ gives_back_weekly: true })).toBe('fable');
    expect(kindOf({ gives_back_weekly: true, type: 'full', clears: ['five_hour'] })).toBe('fable');
  });

  test('a declared type wins over the windows a grant clears', () => {
    expect(kindOf({ type: 'session', clears: ['seven_day'] })).toBe('session');
    expect(kindOf({ type: 'weekly', clears: ['five_hour'] })).toBe('weekly');
    expect(kindOf({ type: 'full', clears: ['five_hour'] })).toBe('full');
  });

  test('without a type, the cleared windows decide, as Claude Code reads them', () => {
    expect(kindOf({ clears: ['five_hour'] })).toBe('session');
    expect(kindOf({ clears: ['seven_day'] })).toBe('weekly');
    expect(kindOf({ clears: ['five_hour', 'seven_day'] })).toBe('full');
    expect(kindOf({})).toBe('full');
    // A window this client doesn't list still counts as a non-5-hour window.
    expect(kindOf({ clears: ['seven_day_cowork'] })).toBe('weekly');
  });

  test('an unknown type or a non-boolean flag falls back instead of rejecting the block', () => {
    expect(kindOf({ type: 'bogus', clears: ['five_hour'] })).toBe('session');
    expect(kindOf({ gives_back_weekly: 'yes', clears: ['seven_day'] })).toBe('weekly');
  });
});

test('exact proxied GET/profile/claim contract, no provider token in frontend', async () => {
  const calls: ApiCallRequest[] = [];
  apiCallApi.request = async (request) => {
    calls.push(request);
    const body =
      request.method === 'POST'
        ? { result: 'reset' }
        : request.url.endsWith('profile')
          ? { organization: { uuid: organization } }
          : { cedar_ember: block };
    return { statusCode: 200, body, bodyText: '', header: {} };
  };
  await readClaudeResetGrants('index');
  expect(await readClaudeOrganization('index')).toBe(organization);
  expect(await claimClaudeResetGrant('index', organization, grant.id, 'request-1')).toBe('reset');
  expect(calls[0].url).toBe('https://api.anthropic.com/api/oauth/usage?cedar_ember=1&skip_spend=1');
  expect(calls[1].url).toBe('https://api.anthropic.com/api/oauth/profile');
  expect(calls[2].url).toBe(
    `https://api.anthropic.com/api/organizations/${organization}/reset_rate_limits`
  );
  expect(JSON.parse(calls[2].data!)).toEqual({
    program: 'cedar_ember',
    grant_id: grant.id,
    request_id: 'request-1',
  });
  for (const call of calls) {
    expect(call.authIndex).toBe('index');
    expect(call.header?.Authorization).toBe('Bearer $TOKEN$');
    expect(call.header?.['anthropic-beta']).toBe('oauth-2025-04-20');
    expect(call.header?.['User-Agent']).toBe('claude-cli/2.1.280 (external, cli)');
  }
});

test('claim terminal mappings and ambiguous outcomes', async () => {
  for (const result of ANTHROPIC_RESET_RESULTS) {
    apiCallApi.request = async () => ({
      statusCode: 200,
      body: { result },
      bodyText: '',
      header: {},
    });
    expect(await claimClaudeResetGrant('a', organization, grant.id, 'r')).toBe(result);
  }
  for (const [statusCode, code] of [
    [401, 'auth_error'],
    [403, 'auth_error'],
    [429, 'rate_limited'],
  ] as const) {
    apiCallApi.request = async () => ({ statusCode, body: null, bodyText: '', header: {} });
    expect(await claimClaudeResetGrant('a', organization, grant.id, 'r')).toBe(code);
  }
  for (const statusCode of [200, 400, 500]) {
    apiCallApi.request = async () => ({
      statusCode,
      body: { result: 'unexpected' },
      bodyText: '',
      header: {},
    });
    await expect(claimClaudeResetGrant('a', organization, grant.id, 'r')).rejects.toBeInstanceOf(
      AnthropicResetGrantUnknownOutcome
    );
  }
  apiCallApi.request = async () => {
    throw new Error('private upstream detail');
  };
  await expect(claimClaudeResetGrant('a', organization, grant.id, 'r')).rejects.toThrow(
    'outcome is unknown'
  );
});

function setup() {
  let revision = 1;
  let now = 100;
  let count = 0;
  const ids: string[] = [];
  const deps = {
    revision: () => revision,
    now: () => now,
    requestId: () => `request-${++count}`,
    readStatus: async () => status(),
    readOrganization: async () => organization,
    claim: async (
      _auth: string,
      _org: string,
      _grant: string,
      id: string
    ): Promise<AnthropicResetSettledCode> => {
      ids.push(id);
      throw new AnthropicResetGrantUnknownOutcome();
    },
  };
  return {
    deps,
    ids,
    nextSession: () => {
      revision++;
    },
    advance: () => {
      now += RETRY_WINDOW_MS;
    },
  };
}

test('unknown outcome retains request ID across retries; expiry blocks', async () => {
  const h = setup();
  const operations = createResetGrantOperations(h.deps);
  await expect(operations.run('account', 'a', grant.id)).rejects.toThrow();
  await expect(operations.run('account', 'a', grant.id)).rejects.toThrow();
  expect(h.ids).toEqual(['request-1', 'request-1']);
  await expect(operations.run('account', 'a', 'other-grant')).rejects.toThrow('expired');
  h.advance();
  await expect(operations.run('account', 'a', grant.id)).rejects.toThrow('expired');
  expect(h.ids).toHaveLength(2);
});

test('a first attempt refused before sending leaves no retry behind; a retry keeps its id', async () => {
  const h = setup();
  let answer: () => Promise<AnthropicResetSettledCode> = async () => {
    throw new ResetGrantPreflightError('eligibility', 'blocked_cooldown');
  };
  h.deps.claim = async (_a, _o, _g, id) => {
    h.ids.push(id);
    return answer();
  };
  const operations = createResetGrantOperations(h.deps);
  await expect(operations.run('account', 'a', grant.id)).rejects.toThrow('blocked_cooldown');
  expect(operations.inspect('account')).toBeUndefined();
  // The next click is a fresh claim: a definite refusal now settles, nothing is left unresolved.
  answer = async () => 'rate_limited';
  expect(await operations.run('account', 'a', grant.id)).toEqual({
    code: 'rate_limited',
    unresolved: false,
  });
  expect(h.ids).toEqual(['request-1', 'request-2']);
  // An ambiguous send stays open, and a refusal on its retry does not drop it.
  answer = async () => {
    throw new AnthropicResetGrantUnknownOutcome();
  };
  await expect(operations.run('other', 'b', grant.id)).rejects.toThrow();
  answer = async () => {
    throw new ResetGrantPreflightError('operation', 'refused');
  };
  await expect(operations.run('other', 'b', grant.id)).rejects.toThrow('refused');
  expect(operations.inspect('other')?.requestId).toBe('request-3');
});

test('fresh spend rechecks eligibility and blocks concurrent clicks', async () => {
  const h = setup();
  h.deps.readStatus = async () => ({ ...status(), eligible: false });
  const operations = createResetGrantOperations(h.deps);
  const first = operations.run('account', 'a', grant.id);
  await expect(operations.run('account', 'a', grant.id)).rejects.toThrow('busy');
  await expect(first).rejects.toThrow('blocked');
  expect(h.ids).toHaveLength(0);
});

test('session change during profile read prevents POST and isolates journal', async () => {
  const h = setup();
  const operations = createResetGrantOperations(h.deps);
  await expect(operations.run('account', 'a', grant.id)).rejects.toThrow();
  h.nextSession();
  expect(operations.inspect('account')).toBeUndefined();
  h.deps.readOrganization = async () => {
    h.nextSession();
    return organization;
  };
  await expect(operations.run('account', 'a', grant.id)).rejects.toThrow('session');
  expect(h.ids).toHaveLength(1);
});

test('retry binds original organization', async () => {
  const h = setup();
  const operations = createResetGrantOperations(h.deps);
  await expect(operations.run('account', 'a', grant.id)).rejects.toThrow();
  h.deps.readOrganization = async () => 'aaaaaaaa-2222-3333-4444-555555555555';
  await expect(operations.run('account', 'a', grant.id)).rejects.toThrow('identity');
  expect(h.ids).toHaveLength(1);
});

test('a retry refusal keeps the ambiguous original operation open', async () => {
  const h = setup();
  const operations = createResetGrantOperations(h.deps);
  await expect(operations.run('account', 'a', grant.id)).rejects.toThrow();
  h.deps.claim = async (_auth, _org, _grant, id) => {
    h.ids.push(id);
    return 'rate_limited';
  };
  expect(await operations.run('account', 'a', grant.id)).toEqual({
    code: 'rate_limited',
    unresolved: true,
  });
  expect(operations.inspect('account')?.code).toBeUndefined();
  h.deps.claim = async (_auth, _org, _grant, id) => {
    h.ids.push(id);
    return 'already_used';
  };
  expect(await operations.run('account', 'a', grant.id)).toEqual({
    code: 'already_used',
    unresolved: false,
  });
  expect(h.ids).toEqual(['request-1', 'request-1', 'request-1']);
});

test('no retry after the deadline expires during profile lookup', async () => {
  const h = setup();
  const operations = createResetGrantOperations(h.deps);
  await expect(operations.run('account', 'a', grant.id)).rejects.toThrow();
  h.deps.readOrganization = async () => {
    h.advance();
    return organization;
  };
  await expect(operations.run('account', 'a', grant.id)).rejects.toThrow('expired');
  expect(h.ids).toHaveLength(1);
});

test('date, pause, limit, balance, usability and cooldown gates refuse new spending', async () => {
  for (const fields of [
    { paused: true },
    { resetsLeft: 0 },
    { usableNow: false },
    { startsAt: '2099-01-01T00:00:00Z' },
    { endsAt: '1970-01-01T00:00:00Z' },
  ]) {
    const h = setup();
    h.deps.readStatus = async () => ({
      ...status(),
      grants: [{ ...status().grants[0], ...fields }],
    });
    await expect(createResetGrantOperations(h.deps).run('account', 'a', grant.id)).rejects.toThrow(
      'blocked'
    );
    expect(h.ids).toHaveLength(0);
  }
  for (const fields of [{ atLimit: false }, { cooldownUntil: '2099-01-01T00:00:00Z' }]) {
    const h = setup();
    h.deps.readStatus = async () => ({ ...status(), ...fields });
    await expect(createResetGrantOperations(h.deps).run('account', 'a', grant.id)).rejects.toThrow(
      'blocked'
    );
    expect(h.ids).toHaveLength(0);
  }
});

test('a stale claim answer cannot settle the replacement session operation', async () => {
  const h = setup();
  const operations = createResetGrantOperations(h.deps);
  h.deps.claim = async () => {
    h.nextSession();
    expect(operations.inspect('account')).toBeUndefined();
    return 'reset';
  };
  await expect(operations.run('account', 'a', grant.id)).rejects.toThrow('session');
  expect(operations.inspect('account')).toBeUndefined();
});

test('preflight read failures identify the stage without exposing upstream details', async () => {
  for (const stage of ['organization', 'status'] as const) {
    for (const failure of [new Error('SECRET'), new AnthropicResetGrantError('auth')]) {
      const h = setup();
      const fail = async (): Promise<never> => {
        throw failure;
      };
      if (stage === 'organization') h.deps.readOrganization = fail;
      else h.deps.readStatus = fail;
      const operations = createResetGrantOperations(h.deps);
      try {
        await operations.run('account', 'a', grant.id);
        throw new Error('Expected preflight failure');
      } catch (error) {
        expect(error).toBeInstanceOf(ResetGrantPreflightError);
        expect((error as ResetGrantPreflightError).stage).toBe(stage);
        expect((error as Error).message).not.toContain('SECRET');
        expect(resetGrantFailureMessageKey(error)).toBe(`claude_reset.failure_${stage}`);
      }
      expect(h.ids).toHaveLength(0);
      expect(operations.inspect('account')).toBeUndefined();
    }
  }
  expect(resetGrantFailureMessageKey(new Error('SECRET'))).toBe('claude_reset.blocked');
});

test('request ID generation failure is diagnosed before journaling or dispatch', async () => {
  const h = setup();
  h.deps.requestId = () => {
    throw new Error('crypto unavailable');
  };
  const operations = createResetGrantOperations(h.deps);
  await expect(operations.run('account', 'a', grant.id)).rejects.toMatchObject({
    stage: 'request_id',
    reason: 'generation_failed',
  });
  expect(operations.inspect('account')).toBeUndefined();
  expect(h.ids).toHaveLength(0);
});

test('expiry and cooldown failures have distinct safe diagnostic codes', async () => {
  for (const [fields, reason] of [
    [{ startsAt: '2099-01-01T00:00:00Z' }, 'blocked_not_started'],
    [{ endsAt: '1970-01-01T00:00:00Z' }, 'blocked_grant_expired'],
    [{ paused: true }, 'blocked_paused'],
  ] as const) {
    const h = setup();
    h.deps.readStatus = async () => ({
      ...status(),
      grants: [{ ...status().grants[0], ...fields }],
    });
    await expect(
      createResetGrantOperations(h.deps).run('account', 'a', grant.id)
    ).rejects.toMatchObject({
      stage: 'eligibility',
      reason,
    });
    expect(h.ids).toHaveLength(0);
  }
  const h = setup();
  h.deps.readStatus = async () => ({ ...status(), cooldownUntil: '2099-01-01T00:00:00Z' });
  await expect(
    createResetGrantOperations(h.deps).run('account', 'a', grant.id)
  ).rejects.toMatchObject({
    stage: 'eligibility',
    reason: 'blocked_cooldown',
  });
  expect(h.ids).toHaveLength(0);
});

test('read authentication refusals retain a safe diagnostic code', async () => {
  for (const statusCode of [401, 403]) {
    apiCallApi.request = async () => ({ statusCode, header: {}, body: {}, bodyText: '' });
    await expect(readClaudeOrganization('a')).rejects.toMatchObject({ code: 'auth' });
    await expect(readClaudeResetGrants('a')).rejects.toMatchObject({ code: 'auth' });
  }
});

test('all grant messages and confirmation are translated in six locales', async () => {
  const locales = await Promise.all(
    ['en', 'zh-CN', 'zh-TW', 'ru', 'vi', 'ko'].map(
      async (locale) => (await Bun.file(`src/i18n/locales/${locale}.json`).json()).claude_reset
    )
  );
  for (const locale of locales) {
    expect(Object.keys(locale).sort()).toEqual(Object.keys(locales[0]).sort());
    for (const stage of ['organization', 'status', 'eligibility', 'request_id', 'operation']) {
      expect(locale[`failure_${stage}`]).toContain('{{code}}');
    }
    expect(locale.confirm_text).toContain('{{name}}');
    expect(locale.retry_confirm).toContain('{{name}}');
    expect(locale.count).toContain('{{left}}');
    for (const key of [
      ...ANTHROPIC_RESET_RESULTS,
      'auth_error',
      'rate_limited',
      'unknown',
      'expired',
    ]) {
      expect(typeof locale[key]).toBe('string');
    }
  }
});

test('card selection prefers usable recommendation and has deterministic fallback', () => {
  const base = status();
  const a = { ...base.grants[0], id: 'a' };
  const b = { ...a, id: 'b' };
  const multiple = { ...base, grants: [b, a], nextGrantId: 'b' };
  expect(selectResetGrant(multiple, 0)?.id).toBe('b');
  expect(selectResetGrant({ ...multiple, nextGrantId: null }, 0)?.id).toBe('a');
  expect(selectResetGrant({ ...multiple, grants: [a, { ...b, paused: true }] }, 0)?.id).toBe('a');
  expect(selectResetGrant({ ...multiple, eligible: false }, 0)).toBeUndefined();
  expect(selectResetGrant({ ...multiple, atLimit: false }, 0)).toBeUndefined();
  expect(
    selectResetGrant({ ...multiple, cooldownUntil: new Date(1000).toISOString() }, 0)
  ).toBeUndefined();
  for (const changed of [
    { resetsLeft: 0 },
    { usableNow: false },
    { paused: true },
    { startsAt: new Date(1000).toISOString() },
    { endsAt: new Date(0).toISOString() },
  ]) {
    expect(selectResetGrant({ ...base, grants: [{ ...a, ...changed }] }, 0)).toBeUndefined();
  }
});

test('Claude card uses the account facts panel and shared confirmation, not a grant dialog', async () => {
  const card = await Bun.file('src/features/quota/components/QuotaCard.tsx').text();
  const hook = await Bun.file('src/features/quota/providers/claude/ClaudeResetGrants.tsx').text();
  expect(card).toContain('<AccountDetails');
  expect(card).toContain("claudeReset={entry.type === 'claude' ? claudeReset : undefined}");
  const panel = await Bun.file('src/features/quota/components/AccountDetails.tsx').text();
  expect(panel).toContain('disabled: claudeReset.blocked');
  expect(panel).toContain('onClick: claudeReset.confirm');
  expect(hook).toContain('showConfirmation({');
  // A retry names the same reset; a first use lets the operator pick one in the dialog.
  expect(hook).toContain("t('claude_reset.retry_confirm'");
  expect(hook).toContain('<ClaudeResetChooser');
  expect(hook).not.toContain('<Modal');
  expect(hook).not.toContain('status.grants.map');
});

test('account reads map upstream 429 to a sanitized typed rate-limit failure', async () => {
  let calls = 0;
  apiCallApi.request = async () => {
    calls += 1;
    return { statusCode: 429, body: 'private upstream detail', bodyText: '', header: {} };
  };
  for (const read of [readClaudeResetGrants, readClaudeOrganization]) {
    await expect(read('index')).rejects.toMatchObject({
      name: 'AnthropicResetGrantError',
      code: 'rate_limited',
      message: 'Anthropic reset-grant read failed (rate_limited)',
    });
  }
  expect(calls).toBe(2); // Neither read retries.
});

test('card selection spends the usable grant that expires first, even over the recommendation', () => {
  const base = status();
  const later = { ...base.grants[0], id: 'later', endsAt: new Date(5 * 86400_000).toISOString() };
  const sooner = { ...later, id: 'sooner', endsAt: new Date(2 * 86400_000).toISOString() };
  const open = { ...later, id: 'open', endsAt: null };
  const state = { ...base, grants: [open, later, sooner], nextGrantId: 'later' };
  expect(selectResetGrant(state, 0)?.id).toBe('sooner');
  // A grant with no end never lapses, so it is spent only when nothing dated is usable.
  expect(selectResetGrant({ ...state, grants: [open, later] }, 0)?.id).toBe('later');
  expect(selectResetGrant({ ...state, grants: [open] }, 0)?.id).toBe('open');
  // Equal ends fall back to the recommendation.
  const twin = { ...sooner, id: 'twin' };
  expect(selectResetGrant({ ...state, grants: [sooner, twin], nextGrantId: 'twin' }, 0)?.id).toBe(
    'twin'
  );
});

test('reset choices offer one entry per kind and expiry, in spend order', () => {
  const base = status();
  const day = (n: number) => new Date(n * 86400_000).toISOString();
  const weekly = {
    ...base.grants[0],
    id: 'weekly',
    kind: 'weekly' as const,
    endsAt: day(2),
    resetsLeft: 1,
  };
  const fableA = { ...weekly, id: 'fable-a', kind: 'fable' as const, endsAt: day(9) };
  const fableB = { ...fableA, id: 'fable-b', resetsLeft: 2 };
  const fullSameDay = { ...fableA, id: 'full', kind: 'full' as const };
  const paused = { ...weekly, id: 'paused', endsAt: day(1), paused: true };
  const state = {
    ...base,
    grants: [fableA, paused, fullSameDay, fableB, weekly],
    nextGrantId: 'fable-b',
  };
  // Interchangeable Fable grants become one choice led by the one a spend would use; the
  // paused grant isn't offered; the full reset ending the same day stays its own choice.
  expect(
    resetGrantChoices(state, 0).map((choice) => [choice.grant.id, choice.grant.kind, choice.count])
  ).toEqual([
    ['weekly', 'weekly', 1],
    ['fable-b', 'fable', 3],
    ['full', 'full', 1],
  ]);
  // The first choice is always the grant a plain spend uses.
  expect(resetGrantChoices(state, 0)[0]!.grant.id).toBe(selectResetGrant(state, 0)!.id);
  expect(resetGrantChoices({ ...state, cooldownUntil: day(1) }, 0)).toEqual([]);
});
