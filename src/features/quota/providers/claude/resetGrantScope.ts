import { createApiCallApi } from '@/services/api/apiCall';
import { readClaudeOrganization, readClaudeResetGrants } from '@/services/api/claudeResetGrants';
import type { SourceOwner, SourceSession } from '@/services/api/sourceSession';
import { refreshPoolAccountAfterReset } from '@/features/quotaPool/accountSync';
import { poolSourceAccountId } from '@/features/quotaPool/resetAccounts';
import { claimResetOnServer, claudeClaimCode } from '../serverResets';
import { createQuotaPoolApi } from '@/services/api/quotaPool';
import {
  createResetGrantJournal,
  createResetGrantOperations,
  ResetGrantPreflightError,
  type ResetGrantJournal,
} from './resetGrantOperations';
import { createResetGrantReader } from './resetGrantReads';

export interface ResetGrantScope {
  current: () => boolean;
  revision: () => number;
  read: ReturnType<typeof createResetGrantReader>;
  operations: ReturnType<typeof createResetGrantOperations>;
}

const journals = new WeakMap<SourceOwner, ResetGrantJournal>();
const scopes = new WeakMap<SourceSession, ResetGrantScope>();
/** Share ambiguous-operation journals across cards/pages, only within their owner.
 * The journal belongs to the authenticated owner so leaving a page keeps it; currentness
 * and requests stay bound to each page's own lease. */
export function createSourceResetGrants(session: SourceSession): ResetGrantScope {
  const existing = scopes.get(session);
  if (existing) return existing;
  let journal = journals.get(session.owner);
  if (!journal) {
    journal = createResetGrantJournal();
    journals.set(session.owner, journal);
  }
  const api = createApiCallApi(session);
  const current = () => {
    try {
      session.assertCurrent();
      return true;
    } catch {
      return false;
    }
  };
  // Constant per owner so a claim interrupted by closing its page still releases its key.
  const revision = () => session.owner.sourceGeneration;
  const read = (authIndex: string) => readClaudeResetGrants(authIndex, api);
  const operations = createResetGrantOperations(
    {
      revision,
      readStatus: read,
      readOrganization: (authIndex) => readClaudeOrganization(authIndex, api),
      // The server spends the grant (it reads the organization itself), records the claim and
      // clears the hub's cooldown; the page's own organization read only pins its retries.
      claim: async (authIndex, _organization, grantId, requestId) =>
        claudeClaimCode(
          (
            await claimResetOnServer(createQuotaPoolApi(), {
              accountId: poolSourceAccountId(session.owner.instanceId, 'claude', authIndex),
              grantId,
              clientRequestId: requestId,
            })
          ).outcome
        ),
      now: () => Date.now(),
      requestId: () => crypto.randomUUID(),
    },
    journal
  );
  const scope: ResetGrantScope = {
    current,
    revision,
    read: createResetGrantReader({ revision, read }),
    operations: {
      ...operations,
      // Every page claims through here, so a claim re-reads its account on the history server
      // whichever page made it. A refusal before the claim was sent changed nothing.
      run: async (...args: Parameters<typeof operations.run>) => {
        const history = createQuotaPoolApi();
        let sent = true;
        try {
          return await operations.run(...args);
        } catch (error) {
          if (error instanceof ResetGrantPreflightError) sent = false;
          throw error;
        } finally {
          if (sent) void refreshPoolAccountAfterReset(session.owner, 'claude', args[1], history);
        }
      },
    },
  };
  scopes.set(session, scope);
  return scope;
}
