import { apiCallApi, getApiCallErrorMessage } from './apiCall';
import { isRecord } from '@/utils/helpers';
import { normalizeAuthIndex } from '@/utils/authIndex';
import { resolveCodexChatgptAccountId } from '@/utils/quota/resolvers';

const FEATURE = 'can_consume_personal_credits_chatpass';

export interface CodexAccountTarget {
  authIndex: string;
  accountId: string;
}

/** Only use the listing metadata, never download credentials for this operation. */
export function resolveCodexAccountTarget(fileInfoText: string): CodexAccountTarget | null {
  try {
    const file: unknown = JSON.parse(fileInfoText);
    if (!isRecord(file) || typeof file.name !== 'string') return null;
    const authIndex = normalizeAuthIndex(file.authIndex ?? file.auth_index);
    const accountId = resolveCodexChatgptAccountId({ ...file, name: file.name });
    return authIndex && accountId ? { authIndex, accountId } : null;
  } catch {
    return null;
  }
}

export async function setCodexPersonalCredits(
  target: CodexAccountTarget,
  enabled: boolean
): Promise<void> {
  if (!target.authIndex.trim() || !target.accountId.trim()) {
    throw new Error('Missing Codex account identity');
  }
  const result = await apiCallApi.request({
    authIndex: target.authIndex,
    method: 'PATCH',
    url: `https://chatgpt.com/backend-api/settings/account_user_setting?feature=${FEATURE}&value=${enabled}`,
    header: {
      Authorization: 'Bearer $TOKEN$',
      'ChatGPT-Account-Id': target.accountId,
    },
  });
  if (result.statusCode !== 200) throw new Error(getApiCallErrorMessage(result));
  if (!isRecord(result.body) || result.body[FEATURE] !== enabled) {
    throw new Error('ChatGPT did not confirm the requested setting');
  }
}
