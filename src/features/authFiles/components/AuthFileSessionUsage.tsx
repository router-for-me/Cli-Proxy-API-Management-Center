import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { sessionUsageApi } from '@/services/api';
import type { ApiError, CredentialSessionSeatUsage, CredentialSessionUsage } from '@/types';
import { AuthFileSeatGlyphs } from '@/features/authFiles/components/AuthFileSeatGlyphs';
import styles from './AuthFileSessionUsage.module.scss';

type AuthFileSessionUsageProps = {
  usage: CredentialSessionUsage;
  compact?: boolean;
  disabled?: boolean;
  onPolicySaved?: () => void;
};

const formatTimestamp = (value: string | null): string => {
  if (!value) return '-';
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  return new Date(timestamp).toLocaleString();
};

const shortId = (value: string): string => {
  if (!value) return '-';
  if (value.length <= 30) return value;
  return `${value.slice(0, 14)}...${value.slice(-12)}`;
};

const protocolLabel = (protocol: string, t: ReturnType<typeof useTranslation>['t']): string => {
  if (protocol === 'codex') return t('auth_files.session_protocol_codex');
  if (protocol === 'claude') return t('auth_files.session_protocol_claude');
  return protocol;
};

export function AuthFileSessionUsage({
  usage,
  compact = false,
  disabled = false,
  onPolicySaved,
}: AuthFileSessionUsageProps) {
  const { t } = useTranslation();
  const [maxSessions, setMaxSessions] = useState(String(usage.maxSessions || 10));
  const [maxRequests, setMaxRequests] = useState(String(usage.maxRequestsPerSeat || 0));
  const [policyVersion, setPolicyVersion] = useState(usage.policyVersion);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const requestLimit = usage.maxRequestsPerSeat || 0;
  const seatGroups = useMemo<CredentialSessionSeatUsage[]>(
    () => usage.seats.slice().sort((left, right) => left.ordinal - right.ordinal),
    [usage.seats]
  );

  useEffect(() => {
    setMaxSessions(String(usage.maxSessions || 10));
    setMaxRequests(String(usage.maxRequestsPerSeat || 0));
    setPolicyVersion(usage.policyVersion);
  }, [usage.maxRequestsPerSeat, usage.maxSessions, usage.policyVersion, usage.seatCount]);

  const savePolicy = async () => {
    const nextSessions = Number(maxSessions);
    const nextRequests = Number(maxRequests);
    if (
      !Number.isSafeInteger(nextSessions) ||
      nextSessions < 1 ||
      nextSessions > 1_000_000 ||
      !Number.isSafeInteger(nextRequests) ||
      nextRequests < 0 ||
      nextRequests > 1_000_000
    ) {
      setSaveError(t('auth_files.session_policy_invalid'));
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const response = await sessionUsageApi.patchPolicy(
        usage.credentialId,
        { maxSessions: nextSessions, maxRequestsPerSession: nextRequests },
        policyVersion
      );
      if (response && typeof response === 'object' && 'version' in response) {
        const nextVersion = Number((response as { version?: unknown }).version);
        if (Number.isSafeInteger(nextVersion) && nextVersion >= 0) setPolicyVersion(nextVersion);
      }
      onPolicySaved?.();
    } catch (rawError) {
      const error = rawError as ApiError;
      setSaveError(
        error.status === 409
          ? t('auth_files.session_policy_conflict')
          : error.message || t('auth_files.session_policy_save_failed')
      );
    } finally {
      setSaving(false);
    }
  };

  const policyContent = (
    <div className={styles.policy}>
      <label>
        <span>{t('auth_files.session_policy_max_sessions')}</span>
        <input
          type="number"
          min="1"
          max="1000000"
          step="1"
          value={maxSessions}
          disabled={disabled}
          onChange={(event) => setMaxSessions(event.target.value)}
        />
      </label>
      <label>
        <span>{t('auth_files.session_policy_max_requests')}</span>
        <input
          type="number"
          min="0"
          max="1000000"
          step="1"
          value={maxRequests}
          disabled={disabled}
          onChange={(event) => setMaxRequests(event.target.value)}
        />
      </label>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => void savePolicy()}
        disabled={disabled || saving}
      >
        {t('common.save')}
      </Button>
    </div>
  );

  const seatContent =
    seatGroups.length === 0 ? (
      <p className={styles.empty}>{t('auth_files.session_usage_empty')}</p>
    ) : (
      <div className={styles.seats}>
        {seatGroups.map((seat) => (
          <details className={styles.seat} key={seat.seatId}>
            <summary className={styles.seatSummary}>
              <AuthFileSeatGlyphs seats={[seat]} maxVisible={1} className={styles.seatGlyph} />
              <span className={styles.seatMain}>
                <span className={styles.protocol}>{t('auth_files.session_seat_label')}</span>
                {seat.protocol && (
                  <span className={styles.protocolSecondary}>
                    {protocolLabel(seat.protocol, t)}
                  </span>
                )}
                <span className={styles.protocolSecondary}>
                  {t(`auth_files.session_seat_status_${seat.state}`, {
                    defaultValue: seat.state,
                  })}
                </span>
                <code title={seat.seatId}>{shortId(seat.seatId)}</code>
              </span>
              <span className={styles.seatStats}>
                {t('auth_files.session_seat_summary', {
                  sessions: seat.sessions.length,
                  requests: seat.activeRequests,
                })}
              </span>
            </summary>
            <div className={styles.seatDetails}>
              <dl className={styles.seatMetadata}>
                <div>
                  <dt>{t('auth_files.session_seat_id_label')}</dt>
                  <dd title={seat.seatId}>{seat.seatId || '-'}</dd>
                </div>
                <div>
                  <dt>{t('auth_files.session_seat_sessions_title')}</dt>
                  <dd>{seat.sessions.length}</dd>
                </div>
                <div>
                  <dt>{t('auth_files.session_seat_active_requests')}</dt>
                  <dd>{seat.activeRequests}</dd>
                </div>
                <div>
                  <dt>{t('auth_files.session_seat_status_label')}</dt>
                  <dd>
                    {t(`auth_files.session_seat_status_${seat.state}`, {
                      defaultValue: seat.state,
                    })}
                  </dd>
                </div>
              </dl>
              <div className={styles.sessions}>
                {seat.sessions.map((session) => (
                  <details
                    className={styles.session}
                    key={`${session.protocol}:${session.homeSessionId}`}
                  >
                    <summary className={styles.sessionSummary}>
                      <span className={styles.sessionMain}>
                        <span className={styles.protocol}>
                          {session.isSeat
                            ? t('auth_files.session_record_label')
                            : t('auth_files.session_child_label')}
                        </span>
                        <span className={styles.protocolSecondary}>
                          {protocolLabel(session.protocol, t)}
                        </span>
                        <code title={session.sessionId}>{shortId(session.sessionId)}</code>
                      </span>
                      <span className={styles.requestCount}>
                        {t('auth_files.session_request_count', { count: session.activeRequests })}
                      </span>
                    </summary>
                    <div className={styles.sessionDetails}>
                      <dl className={styles.metadata}>
                        <div>
                          <dt>{t('auth_files.session_id_label')}</dt>
                          <dd title={session.sessionId}>{session.sessionId || '-'}</dd>
                        </div>
                        {!session.isSeat && (
                          <div>
                            <dt>{t('auth_files.session_parent_id_label')}</dt>
                            <dd title={session.parentHomeSessionId}>
                              {session.parentHomeSessionId || '-'}
                            </dd>
                          </div>
                        )}
                        <div>
                          <dt>{t('auth_files.home_session_id_label')}</dt>
                          <dd title={session.homeSessionId}>{session.homeSessionId || '-'}</dd>
                        </div>
                        <div>
                          <dt>{t('auth_files.session_last_seen')}</dt>
                          <dd>{formatTimestamp(session.lastSeenAt)}</dd>
                        </div>
                        <div>
                          <dt>{t('auth_files.session_expires_at')}</dt>
                          <dd>{formatTimestamp(session.expiresAt)}</dd>
                        </div>
                      </dl>
                      {session.requests.length > 0 && (
                        <div className={styles.requests}>
                          <span className={styles.requestTitle}>
                            {t('auth_files.session_requests_title')}
                          </span>
                          {session.requests.map((request) => (
                            <div
                              className={styles.request}
                              key={request.leaseId || request.requestId}
                            >
                              <code title={request.requestId || request.leaseId}>
                                {request.requestId || request.leaseId || '-'}
                              </code>
                              <span>{formatTimestamp(request.startedAt)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </details>
                ))}
              </div>
              {seat.sessionHistory.length > 0 && (
                <div className={styles.history}>
                  <span className={styles.historyTitle}>
                    {t('auth_files.session_history_title')}
                  </span>
                  {seat.sessionHistory.map((session) => (
                    <details
                      className={styles.historyItem}
                      key={`${session.protocol}:${session.homeSessionId}:${session.sessionId}`}
                    >
                      <summary className={styles.historySummary}>
                        <span className={styles.sessionMain}>
                          <span className={styles.protocolSecondary}>
                            {protocolLabel(session.protocol, t)}
                          </span>
                          <code title={session.sessionId}>{shortId(session.sessionId)}</code>
                        </span>
                        <span className={styles.requestCount}>
                          {t('auth_files.session_history_request_count', {
                            count: session.requests.length,
                          })}
                        </span>
                      </summary>
                      <div className={styles.historyDetails}>
                        <dl className={styles.metadata}>
                          <div>
                            <dt>{t('auth_files.session_id_label')}</dt>
                            <dd title={session.sessionId}>{session.sessionId || '-'}</dd>
                          </div>
                          <div>
                            <dt>{t('auth_files.home_session_id_label')}</dt>
                            <dd title={session.homeSessionId}>{session.homeSessionId || '-'}</dd>
                          </div>
                          <div>
                            <dt>{t('auth_files.session_last_seen')}</dt>
                            <dd>{formatTimestamp(session.lastSeenAt)}</dd>
                          </div>
                          <div>
                            <dt>{t('auth_files.session_expires_at')}</dt>
                            <dd>{formatTimestamp(session.expiresAt)}</dd>
                          </div>
                        </dl>
                        {session.requests.length > 0 && (
                          <div className={styles.requests}>
                            <span className={styles.requestTitle}>
                              {t('auth_files.session_history_requests_title')}
                            </span>
                            {session.requests.map((request) => (
                              <div
                                className={styles.request}
                                key={request.leaseId || request.requestId}
                              >
                                <code title={request.requestId || request.leaseId}>
                                  {request.requestId || request.leaseId || '-'}
                                </code>
                                <span>{formatTimestamp(request.startedAt)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </details>
                  ))}
                </div>
              )}
            </div>
          </details>
        ))}
      </div>
    );

  const statusContent = (
    <>
      {saveError && <p className={styles.warning}>{saveError}</p>}
      {!usage.coverageComplete && (
        <p className={styles.warning}>
          {t('auth_files.session_usage_incomplete_detail', {
            admitted: usage.admittedSessions,
            observed: usage.observedSessions,
          })}
        </p>
      )}
    </>
  );

  return (
    <section
      className={`${styles.section} ${compact ? styles.compactSection : ''}`}
      aria-label={t('auth_files.session_usage_title')}
    >
      <div className={styles.header}>
        <span className={styles.title}>{t('auth_files.session_usage_title')}</span>
        <span className={styles.count}>
          {t('auth_files.session_usage_summary', {
            sessions:
              usage.seatCount ||
              seatGroups.length ||
              usage.claimedSeatCount ||
              usage.observedSessions,
            requests: usage.activeRequestCount,
          })}
        </span>
      </div>
      {compact ? (
        <>
          <div className={styles.compactMetrics}>
            <span className={styles.compactSeats}>
              <AuthFileSeatGlyphs seats={seatGroups} />
            </span>
            <span>
              <strong>{usage.activeRequestCount}</strong> {t('auth_files.session_requests_short')}
            </span>
            <span>{t('auth_files.session_request_limit_short', { count: requestLimit })}</span>
            {!usage.coverageComplete && (
              <span
                className={styles.compactWarning}
                title={t('auth_files.session_usage_incomplete_detail', {
                  admitted: usage.admittedSessions,
                  observed: usage.observedSessions,
                })}
                aria-label={t('auth_files.session_usage_incomplete_detail', {
                  admitted: usage.admittedSessions,
                  observed: usage.observedSessions,
                })}
              >
                !
              </span>
            )}
          </div>
          <details className={styles.details}>
            <summary className={styles.detailsSummary}>
              {t('auth_files.session_usage_details')}
            </summary>
            <div className={styles.detailsBody}>
              {policyContent}
              {statusContent}
              {seatContent}
            </div>
          </details>
        </>
      ) : (
        <>
          {policyContent}
          {statusContent}
          {seatContent}
        </>
      )}
    </section>
  );
}
