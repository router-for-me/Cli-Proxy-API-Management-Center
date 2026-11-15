import { createHash } from 'node:crypto';
import type { AccountBilling } from '../../src/domain/accountBilling';
import type {
  AccountQuotaWindow,
  AccountResets,
  PoolProviderId,
} from '../../src/domain/quotaPool/types';
import {
  AnthropicResetGrantError,
  ANTHROPIC_RESET_GRANT_ID_RE,
  ANTHROPIC_RESET_REQUEST_ID_RE,
  anthropicResetGrantClaimBlocker,
  claimClaudeResetGrant,
  readClaudeOrganization,
  readClaudeResetGrants,
} from '../../src/services/api/claudeResetGrants';
import { RETRY_WINDOW_MS } from '../../src/features/quota/providers/claude/resetGrantOperations';
import {
  CODEX_RATE_LIMIT_RESET_CREDITS_CONSUME_URL,
  CODEX_REQUEST_HEADERS,
} from '../../src/utils/quota/constants';
import { isRecord } from '../../src/utils/helpers';
import type { ManagedAccount, QuotaCollector } from './collector';
import type { QuotaStore } from './store';
import type { ResetEvent, ResetReading, StoredAccount } from './types';

/** Same bound the Claude Code client and the tab's Codex redeem use. */
const CLAIM_TIMEOUT_MS = 25_000;
export const CODEX_RESET_KIND = 'codex_rate_limits';

export interface ResetClaimRequest {
  accountId: string;
  clientRequestId: string;
  /** Claude: the grant to spend (required). Codex: an optional credit id, recorded as given. */
  grantId?: string;
}

/** A claim that did not start: nothing was sent, no event was recorded. */
export class ResetClaimRefusal extends Error {
  constructor(
    readonly httpStatus: 400 | 404 | 409 | 502,
    readonly detail: Record<string, string>
  ) {
    super(detail.error);
  }
}

export interface AccountReading {
  accountId: string;
  provider: PoolProviderId;
  observedAtMs: number | null;
  windows: readonly AccountQuotaWindow[];
  resets: AccountResets | null;
  billing: AccountBilling | null;
}

export interface ResetClaimResult {
  /** The provider's answer (`reset`, `already_used`, `cooldown`, ...) or `unknown`. */
  outcome: string;
  /** True when this request id was settled before: nothing was sent or recorded this time. */
  replayed: boolean;
  /** Whether the targeted refresh after the claim read the account. */
  refreshed: boolean;
  event: ResetEvent;
  /** The collector's reading after the refresh (the held one when it could not refresh). */
  account: AccountReading;
}

/** Validates a claim body; null when it is not one. */
export function parseResetClaimRequest(body: unknown): ResetClaimRequest | null {
  if (!isRecord(body)) return null;
  const { accountId, clientRequestId, grantId } = body;
  if (typeof accountId !== 'string' || !accountId.trim() || accountId.length > 512) return null;
  if (typeof clientRequestId !== 'string' || !ANTHROPIC_RESET_REQUEST_ID_RE.test(clientRequestId))
    return null;
  if (
    grantId !== undefined &&
    (typeof grantId !== 'string' || !ANTHROPIC_RESET_REQUEST_ID_RE.test(grantId))
  )
    return null;
  return { accountId, clientRequestId, ...(grantId === undefined ? {} : { grantId }) };
}

/** Same-id retries settle only on a definite spend; a refusal cannot prove the first send did not. */
const SPENT = new Set(['reset', 'already_used', 'already_redeemed']);

type Sent = {
  event: ResetEvent;
  outcome: string;
  settled: boolean;
  cooldownCleared: boolean | null;
};

/**
 * The server performs a reset claim only for an explicit, authenticated request. Each claim is
 * single flight per account, recorded before it is sent, serialized with collection, and followed
 * by one targeted refresh. A claim that may have been sent is never reported as failed.
 */
export class ResetClaims {
  private readonly flights = new Set<string>();
  private readonly store: QuotaStore;
  private readonly collector: Pick<
    QuotaCollector,
    'withManagedAccount' | 'refreshAccount' | 'reading' | 'windows' | 'resets' | 'billing'
  >;
  private readonly now: () => number;

  constructor(options: {
    store: QuotaStore;
    collector: ResetClaims['collector'];
    now?: () => number;
  }) {
    this.store = options.store;
    this.collector = options.collector;
    this.now = options.now ?? Date.now;
  }

  async claim(request: ResetClaimRequest): Promise<ResetClaimResult> {
    const account = this.store.listAccounts().find((entry) => entry.id === request.accountId);
    if (!account || account.disabled || account.retired)
      throw new ResetClaimRefusal(404, { error: 'Unknown account' });
    if (
      account.provider === 'claude' &&
      (!request.grantId || !ANTHROPIC_RESET_GRANT_ID_RE.test(request.grantId))
    )
      throw new ResetClaimRefusal(400, { error: 'A Claude claim needs a valid grantId' });
    const existing = this.store.resetEventByRequestId(request.clientRequestId);
    if (existing) {
      if (existing.accountId !== account.id || existing.grantId !== (request.grantId ?? null))
        throw new ResetClaimRefusal(409, { error: 'Request id already used for another claim' });
      if (existing.outcome === 'pending')
        throw new ResetClaimRefusal(409, { error: 'Claim in progress' });
      if (existing.outcome !== 'unknown') {
        return {
          outcome: existing.outcome,
          replayed: true,
          refreshed: false,
          event: existing,
          account: this.accountReading(account),
        };
      }
      this.assertRetryable(existing);
    } else {
      const open = this.store.latestUnknownResetEvent(account.id, this.now() - RETRY_WINDOW_MS);
      if (open)
        throw new ResetClaimRefusal(409, {
          error: 'An earlier claim for this account is unresolved',
          reason: 'unresolved_claim',
          clientRequestId: open.clientRequestId,
        });
    }
    if (this.flights.has(account.id))
      throw new ResetClaimRefusal(409, { error: 'Another claim for this account is in progress' });
    this.flights.add(account.id);
    try {
      const before = existing?.before ?? this.collector.reading(account.id);
      let sent: Sent | null;
      try {
        sent = await this.collector.withManagedAccount(account.id, (managed) =>
          account.provider === 'claude'
            ? this.sendClaude(managed, account, request, existing, before)
            : this.sendCodex(managed, account, request, existing, before)
        );
      } catch (error) {
        if (error instanceof ResetClaimRefusal) throw error;
        throw new ResetClaimRefusal(502, { error: 'Reset claim could not reach the hub' });
      }
      if (!sent) throw new ResetClaimRefusal(404, { error: 'Unknown account' });
      return await this.finish(account, sent);
    } finally {
      this.flights.delete(account.id);
    }
  }

  /** Newest first. Names and emails only when `reveal`, like `/v1/pools`. */
  events(filter: { provider?: PoolProviderId; sinceMs?: number; reveal?: boolean }) {
    const events = this.store.listResetEvents(filter);
    if (!filter.reveal) return events;
    const accounts = new Map(this.store.listAccounts().map((entry) => [entry.id, entry]));
    return events.map((event) => {
      const account = accounts.get(event.accountId);
      return account && !account.retired
        ? { ...event, email: account.email || account.name }
        : event;
    });
  }

  /** A retry is sent only inside its window; checked again right before the send. */
  private assertRetryable(existing: ResetEvent | null): void {
    if (existing && this.now() - existing.requestedAtMs >= RETRY_WINDOW_MS)
      throw new ResetClaimRefusal(409, {
        error: 'Claim retry window has passed',
        stage: 'operation',
        reason: 'expired',
      });
  }

  private accountReading(account: StoredAccount): AccountReading {
    return {
      accountId: account.id,
      provider: account.provider,
      observedAtMs: this.collector.reading(account.id)?.observedAtMs ?? null,
      windows: this.collector.windows.get(account.id) ?? [],
      resets: this.collector.resets.get(account.id) ?? null,
      billing: this.collector.billing.get(account.id) ?? null,
    };
  }

  private async finish(account: StoredAccount, sent: Sent): Promise<ResetClaimResult> {
    const { event, outcome } = sent;
    const settledAtMs = sent.settled ? this.now() : null;
    try {
      this.store.settleResetEvent(event.id, outcome, settledAtMs, sent.cooldownCleared);
    } catch {
      // The claim already went out: report what happened; startup marks a leftover pending as unknown.
      console.error('Reset claim event update failed');
    }
    let refreshed: boolean;
    try {
      // The claim changed (or may have changed) the account: read it now, once, past the 20 s floor.
      refreshed = await this.collector.refreshAccount(account.id, { force: true });
    } catch {
      refreshed = false;
    }
    const after = refreshed ? this.collector.reading(account.id) : null;
    try {
      this.store.setResetEventAfter(event.id, after);
    } catch {
      console.error('Reset claim event update failed');
    }
    let stored: ResetEvent | null = null;
    try {
      stored = this.store.resetEventById(event.id);
    } catch {
      console.error('Reset claim event read failed');
    }
    return {
      outcome,
      replayed: false,
      refreshed,
      event: stored ?? {
        ...event,
        outcome,
        settledAtMs,
        cooldownCleared: sent.cooldownCleared,
        after,
      },
      account: this.accountReading(account),
    };
  }

  private record(
    account: StoredAccount,
    request: ResetClaimRequest,
    kind: string,
    before: ResetReading | null,
    organizationHash?: string
  ): ResetEvent {
    try {
      return this.store.insertResetEvent({
        accountId: account.id,
        provider: account.provider,
        kind,
        grantId: request.grantId ?? null,
        clientRequestId: request.clientRequestId,
        requestedAtMs: this.now(),
        before,
        organizationHash,
      });
    } catch {
      // Nothing was sent. A unique-id clash here is a concurrent request with the same id.
      throw new ResetClaimRefusal(409, { error: 'Claim could not be recorded' });
    }
  }

  private async sendClaude(
    managed: ManagedAccount,
    account: StoredAccount,
    request: ResetClaimRequest,
    existing: ResetEvent | null,
    before: ResetReading | null
  ): Promise<Sent> {
    const grantId = request.grantId!;
    const preflight = (stage: string, error: unknown) =>
      new ResetClaimRefusal(502, {
        error: 'Reset claim preflight failed',
        stage,
        reason: error instanceof AnthropicResetGrantError ? error.code : 'request_failed',
      });
    // The organization is read first: it is part of the claim's address, and a retry must hit
    // the same one.
    let organization: string;
    try {
      organization = await readClaudeOrganization(managed.authIndex, managed.api);
    } catch (error) {
      throw preflight('organization', error);
    }
    const organizationHash = createHash('sha256').update(organization).digest('hex');
    // A retry goes to the organization the first send was addressed to, or not at all.
    if (existing && this.store.resetEventOrganization(existing.id) !== organizationHash)
      throw new ResetClaimRefusal(409, {
        error: 'Account organization changed since the claim was sent',
        stage: 'operation',
        reason: 'identity',
      });
    let event = existing;
    if (!event) {
      let status: Awaited<ReturnType<typeof readClaudeResetGrants>>;
      try {
        status = await readClaudeResetGrants(managed.authIndex, managed.api);
      } catch (error) {
        throw preflight('status', error);
      }
      const reason = anthropicResetGrantClaimBlocker(status, grantId, this.now());
      if (reason)
        throw new ResetClaimRefusal(409, {
          error: 'Reset claim blocked',
          stage: 'eligibility',
          reason: `blocked_${reason}`,
        });
      const kind = status.grants.find((grant) => grant.id === grantId)!.kind;
      event = this.record(account, request, kind, before, organizationHash);
    }
    this.assertRetryable(existing);
    let code: string;
    try {
      code = await claimClaudeResetGrant(
        managed.authIndex,
        organization,
        grantId,
        request.clientRequestId,
        managed.api
      );
    } catch {
      // The proxy may have sent the claim even though no answer came back: never a failure.
      code = 'unknown';
    }
    const settled = code !== 'unknown' && (!existing || SPENT.has(code));
    return { event, outcome: settled ? code : 'unknown', settled, cooldownCleared: null };
  }

  private async sendCodex(
    managed: ManagedAccount,
    account: StoredAccount,
    request: ResetClaimRequest,
    existing: ResetEvent | null,
    before: ResetReading | null
  ): Promise<Sent> {
    if (!existing && before?.resets && before.resets.available === 0)
      throw new ResetClaimRefusal(409, {
        error: 'Reset claim blocked',
        stage: 'eligibility',
        reason: 'blocked_none_available',
      });
    const event = existing ?? this.record(account, request, CODEX_RESET_KIND, before);
    this.assertRetryable(existing);
    let code = 'unknown';
    try {
      const result = await managed.api.request(
        {
          authIndex: managed.authIndex,
          method: 'POST',
          url: CODEX_RATE_LIMIT_RESET_CREDITS_CONSUME_URL,
          header: {
            ...CODEX_REQUEST_HEADERS,
            ...(managed.chatgptAccountId ? { 'Chatgpt-Account-Id': managed.chatgptAccountId } : {}),
          },
          data: JSON.stringify({ redeem_request_id: request.clientRequestId }),
        },
        { timeout: CLAIM_TIMEOUT_MS }
      );
      const answer = isRecord(result.body) ? result.body.code : undefined;
      if (result.statusCode === 429) code = 'rate_limited';
      else if (result.statusCode === 401 || result.statusCode === 403) code = 'auth_error';
      else if (
        result.statusCode >= 200 &&
        result.statusCode < 300 &&
        (answer === 'reset' || answer === 'already_redeemed')
      )
        code = answer;
    } catch {
      /* The proxy may have sent the redeem even though no answer came back. */
    }
    const settled = code !== 'unknown' && (!existing || SPENT.has(code));
    let cooldownCleared: boolean | null = null;
    if (SPENT.has(code)) {
      // A spent credit leaves the credential cooling down on the hub: clear it as the tab does.
      try {
        const cleared = await managed.post('routing/cooldown/reset', {
          auth_index: managed.authIndex,
        });
        cooldownCleared =
          isRecord(cleared) && cleared.status === 'ok' && cleared.auth_index === managed.authIndex;
      } catch {
        cooldownCleared = false;
      }
    }
    return { event, outcome: settled ? code : 'unknown', settled, cooldownCleared };
  }
}
