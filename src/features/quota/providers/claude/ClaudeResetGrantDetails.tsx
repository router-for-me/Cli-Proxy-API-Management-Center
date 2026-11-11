import { useTranslation } from 'react-i18next';
import { useNow } from '@/hooks/useNow';
import { Button } from '@/components/ui/Button';
import { resetGrantHasNoUsage, type AnthropicResetGrant } from '@/services/api/claudeResetGrants';
import { resetGrantKind } from './resetGrantChoice';
import { buildResetDisplay, parseIsoToMs } from '@/utils/quota';
import { resolveTimeZoneLabel } from '@/utils/time/timezone';
import { QuotaResetLabel } from '../../components/QuotaResetLabel';
import type { QuotaClassMap } from '../../types';

interface ClaudeResetGrantDetailsProps {
  grants: readonly AnthropicResetGrant[];
  classes: QuotaClassMap;
  onRedeem?: (grantId: string) => void;
  canRedeem?: (grantId: string) => boolean;
  busy?: boolean;
  pendingGrantId?: string;
}

/** Match Codex's reset-credit details without treating a multi-reset grant as one credit. */
export function ClaudeResetGrantDetails({
  grants,
  classes,
  onRedeem,
  canRedeem,
  busy,
  pendingGrantId,
}: ClaudeResetGrantDetailsProps) {
  const { t, i18n } = useTranslation();
  const now = useNow();
  const remaining = grants
    .filter((grant) => grant.resetsLeft > 0 || grant.id === pendingGrantId)
    .sort((a, b) => (parseIsoToMs(a.endsAt) ?? Infinity) - (parseIsoToMs(b.endsAt) ?? Infinity));

  if (remaining.length === 0) return null;

  return (
    <div className={classes.codexResetCredits}>
      <div className={classes.codexResetCreditsTitle}>
        {t('claude_reset.expiry_title', { timezone: resolveTimeZoneLabel() })}
      </div>
      {remaining.map((grant, index) => {
        const kind = t(`claude_reset.kind_${resetGrantKind(grant)}`);
        const label = grant.label || t('claude_reset.grant_number', { index: index + 1 });
        const retry = pendingGrantId === grant.id;
        const display = buildResetDisplay(
          null,
          parseIsoToMs(grant.endsAt),
          now,
          i18n.resolvedLanguage
        );
        return (
          <div key={grant.id} className={classes.codexResetCreditRow}>
            <span className={classes.codexResetCreditLabel}>
              {kind}
              {' · '}
              {label}
              {' · '}
              {t('claude_reset.count', { left: grant.resetsLeft, total: grant.resetsTotal })}
            </span>
            {onRedeem && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={busy || !canRedeem?.(grant.id)}
                onClick={() => onRedeem(grant.id)}
                aria-label={t(retry ? 'claude_reset.retry_grant' : 'claude_reset.redeem_grant', {
                  kind,
                  label,
                })}
                title={t(
                  !retry && resetGrantHasNoUsage(grant)
                    ? 'claude_reset.no_usage'
                    : grant.givesBackWeekly
                      ? 'claude_reset.fable_hint'
                      : 'claude_reset.exact_grant_hint'
                )}
              >
                {t(retry ? 'claude_reset.retry' : 'claude_reset.redeem_grant', { kind, label })}
              </Button>
            )}
            <span className={classes.codexResetCreditTime}>
              {display ? (
                <QuotaResetLabel display={display} classes={classes} />
              ) : (
                <span className={classes.quotaReset}>{t('claude_reset.expiry_unknown')}</span>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}
