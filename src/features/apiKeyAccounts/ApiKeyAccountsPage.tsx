import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import {
  IconAlertTriangle,
  IconCheckCircle2,
  IconKey,
  IconPencil,
  IconPlus,
  IconRefreshCw,
  IconTrash2,
} from '@/components/ui/icons';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/Table';
import { apiKeyAccountsApi } from '@/services/api';
import { useNotificationStore } from '@/stores';
import { copyToClipboard } from '@/utils/clipboard';
import type { ApiKeyProfile, ApiKeyUsageEvent, ApiKeyUsageSummary } from '@/types/apiKeyAccounts';
import styles from './ApiKeyAccountsPage.module.scss';

type Period = 'week' | 'month';

const emptyProfile = (): ApiKeyProfile => ({
  id: '',
  name: '',
  apiKey: '',
  keyFingerprint: '',
  disabled: false,
  allowedModels: [],
  weekly: { requests: 0, tokens: 0 },
  monthly: { requests: 0, tokens: 0 },
});

const formatNumber = (value: number): string => new Intl.NumberFormat().format(value || 0);

const formatDateTime = (value: string): string => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
};

const usagePercent = (used: number, limit: number): number | null => {
  if (limit <= 0) return null;
  return Math.min(100, Math.max(0, (used / limit) * 100));
};

const parseModels = (value: string): string[] =>
  value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export function ApiKeyAccountsPage() {
  const { t } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const showConfirmation = useNotificationStore((state) => state.showConfirmation);
  const [period, setPeriod] = useState<Period>('week');
  const [profiles, setProfiles] = useState<ApiKeyProfile[]>([]);
  const [summary, setSummary] = useState<ApiKeyUsageSummary | null>(null);
  const [events, setEvents] = useState<ApiKeyUsageEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [editor, setEditor] = useState<ApiKeyProfile | null>(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [createdProfile, setCreatedProfile] = useState<ApiKeyProfile | null>(null);
  const [modelsDraft, setModelsDraft] = useState('');
  const [eventProfileId, setEventProfileId] = useState('');

  const refresh = useCallback(
    async (profileId = eventProfileId) => {
      setLoading(true);
      try {
        const [profileResponse, usageSummary] = await Promise.all([
          apiKeyAccountsApi.getProfiles(),
          apiKeyAccountsApi.getSummary(period),
        ]);
        setProfiles(profileResponse.profiles);
        setSummary(usageSummary);
        if (usageSummary) {
          const eventPage = await apiKeyAccountsApi.getEvents({
            profileId,
            start: usageSummary.start,
            end: usageSummary.end,
            limit: 50,
          });
          setEvents(eventPage.events);
        } else {
          setEvents([]);
        }
      } catch (error) {
        showNotification(
          t('api_key_accounts.load_failed', { error: errorMessage(error) }),
          'error'
        );
      } finally {
        setLoading(false);
      }
    },
    [eventProfileId, period, showNotification, t]
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const usageByID = useMemo(
    () => new Map((summary?.profiles ?? []).map((item) => [item.id, item])),
    [summary]
  );

  const warningCount = useMemo(
    () =>
      (summary?.profiles ?? []).filter((item) => {
        const requestRatio = usagePercent(item.usage.requests, item.limit.requests) ?? 0;
        const tokenRatio = usagePercent(item.usage.totalTokens, item.limit.tokens) ?? 0;
        return requestRatio >= 80 || tokenRatio >= 80;
      }).length,
    [summary]
  );

  const modelCountByProfile = useMemo(() => {
    const result = new Map<string, number>();
    for (const item of summary?.models ?? []) {
      result.set(item.profileId, (result.get(item.profileId) ?? 0) + 1);
    }
    return result;
  }, [summary]);

  const openCreate = () => {
    setCreating(true);
    setModelsDraft('');
    setEditor(emptyProfile());
  };

  const openEdit = (profile: ApiKeyProfile) => {
    setCreating(false);
    setModelsDraft(profile.allowedModels.join('\n'));
    setEditor({
      ...profile,
      allowedModels: [...profile.allowedModels],
      weekly: { ...profile.weekly },
      monthly: { ...profile.monthly },
    });
  };

  const saveProfile = async () => {
    if (!editor) return;
    if (!editor.name.trim()) {
      showNotification(t('api_key_accounts.name_required'), 'warning');
      return;
    }
    setSaving(true);
    try {
      const payload = { ...editor, allowedModels: parseModels(modelsDraft) };
      if (creating) {
        const created = await apiKeyAccountsApi.create(payload);
        setCreatedProfile(created);
        showNotification(t('api_key_accounts.created'), 'success');
      } else {
        await apiKeyAccountsApi.update(payload);
        showNotification(t('api_key_accounts.updated'), 'success');
      }
      setEditor(null);
      await refresh();
    } catch (error) {
      showNotification(t('api_key_accounts.save_failed', { error: errorMessage(error) }), 'error');
    } finally {
      setSaving(false);
    }
  };

  const deleteProfile = (profile: ApiKeyProfile) => {
    showConfirmation({
      title: t('api_key_accounts.delete_title'),
      message: t('api_key_accounts.delete_message', { name: profile.name }),
      confirmText: t('common.delete'),
      variant: 'danger',
      onConfirm: async () => {
        try {
          await apiKeyAccountsApi.delete(profile.id);
          showNotification(t('api_key_accounts.deleted'), 'success');
          const nextProfileId = eventProfileId === profile.id ? '' : eventProfileId;
          if (nextProfileId !== eventProfileId) setEventProfileId(nextProfileId);
          await refresh(nextProfileId);
        } catch (error) {
          showNotification(
            t('api_key_accounts.delete_failed', { error: errorMessage(error) }),
            'error'
          );
        }
      },
    });
  };

  const copyCreatedKey = async () => {
    if (!createdProfile) return;
    const copied = await copyToClipboard(createdProfile.apiKey);
    showNotification(
      copied ? t('api_key_accounts.copied') : t('api_key_accounts.copy_failed'),
      copied ? 'success' : 'error'
    );
  };

  const updateLimit = (limitPeriod: Period, field: 'requests' | 'tokens', value: string) => {
    const parsed = Math.max(0, Number.parseInt(value || '0', 10) || 0);
    const profilePeriod = limitPeriod === 'week' ? 'weekly' : 'monthly';
    setEditor((current) =>
      current
        ? {
            ...current,
            [profilePeriod]: { ...current[profilePeriod], [field]: parsed },
          }
        : current
    );
  };

  const periodLabel =
    period === 'week' ? t('api_key_accounts.this_week') : t('api_key_accounts.this_month');

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>{t('api_key_accounts.eyebrow')}</span>
          <h1>{t('api_key_accounts.title')}</h1>
          <p>{t('api_key_accounts.subtitle')}</p>
        </div>
        <div className={styles.headerActions}>
          <button
            className={styles.iconButton}
            type="button"
            onClick={() => void refresh()}
            aria-label={t('common.refresh')}
            title={t('common.refresh')}
            disabled={loading}
          >
            <IconRefreshCw size={18} />
          </button>
          <Button onClick={openCreate}>
            <span className={styles.buttonContent}>
              <IconPlus size={17} />
              {t('api_key_accounts.create')}
            </span>
          </Button>
        </div>
      </header>

      <div className={styles.periodBar}>
        <div className={styles.segmented} role="group" aria-label={t('api_key_accounts.period')}>
          <button
            type="button"
            className={period === 'week' ? styles.segmentActive : ''}
            onClick={() => setPeriod('week')}
          >
            {t('api_key_accounts.week')}
          </button>
          <button
            type="button"
            className={period === 'month' ? styles.segmentActive : ''}
            onClick={() => setPeriod('month')}
          >
            {t('api_key_accounts.month')}
          </button>
        </div>
        <span className={styles.periodMeta}>
          {summary
            ? `${formatDateTime(summary.start)} · ${formatDateTime(summary.end)} · ${summary.timezone}`
            : t('api_key_accounts.accounting_inactive')}
        </span>
      </div>

      <section className={styles.metrics} aria-label={t('api_key_accounts.summary')}>
        <div>
          <span>{t('api_key_accounts.requests')}</span>
          <strong>{formatNumber(summary?.totals.requests ?? 0)}</strong>
          <small>{periodLabel}</small>
        </div>
        <div>
          <span>{t('api_key_accounts.tokens')}</span>
          <strong>{formatNumber(summary?.totals.totalTokens ?? 0)}</strong>
          <small>
            {t('api_key_accounts.token_split', {
              input: formatNumber(summary?.totals.inputTokens ?? 0),
              output: formatNumber(summary?.totals.outputTokens ?? 0),
            })}
          </small>
        </div>
        <div>
          <span>{t('api_key_accounts.active_keys')}</span>
          <strong>{profiles.filter((profile) => !profile.disabled).length}</strong>
          <small>{t('api_key_accounts.total_keys', { count: profiles.length })}</small>
        </div>
        <div>
          <span>{t('api_key_accounts.near_limit')}</span>
          <strong className={warningCount > 0 ? styles.warningValue : ''}>{warningCount}</strong>
          <small>{t('api_key_accounts.near_limit_hint')}</small>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeading}>
          <div>
            <h2>{t('api_key_accounts.users')}</h2>
            <p>{t('api_key_accounts.users_hint')}</p>
          </div>
        </div>

        {loading ? (
          <div className={styles.empty}>{t('common.loading')}</div>
        ) : profiles.length === 0 ? (
          <div className={styles.empty}>
            <IconKey size={24} />
            <strong>{t('api_key_accounts.empty_title')}</strong>
            <span>{t('api_key_accounts.empty_hint')}</span>
          </div>
        ) : (
          <Table aria-label={t('api_key_accounts.users')}>
            <TableHeader>
              <TableRow>
                <TableHead>{t('api_key_accounts.user')}</TableHead>
                <TableHead>{t('api_key_accounts.key')}</TableHead>
                <TableHead>{t('api_key_accounts.requests')}</TableHead>
                <TableHead>{t('api_key_accounts.tokens')}</TableHead>
                <TableHead>{t('api_key_accounts.models')}</TableHead>
                <TableHead>{t('common.status')}</TableHead>
                <TableHead alignRight>{t('common.action')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {profiles.map((profile) => {
                const usage = usageByID.get(profile.id);
                return (
                  <TableRow key={profile.id}>
                    <TableCell>
                      <div className={styles.userCell}>
                        <strong>{profile.name}</strong>
                        <span>{profile.id}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <code className={styles.fingerprint}>
                        {usage?.keyFingerprint || profile.keyFingerprint || '—'}
                      </code>
                    </TableCell>
                    <TableCell>
                      <UsageCell
                        value={usage?.usage.requests ?? 0}
                        limit={usage?.limit.requests ?? 0}
                        unlimitedLabel={t('api_key_accounts.unlimited')}
                      />
                    </TableCell>
                    <TableCell>
                      <UsageCell
                        value={usage?.usage.totalTokens ?? 0}
                        limit={usage?.limit.tokens ?? 0}
                        unlimitedLabel={t('api_key_accounts.unlimited')}
                      />
                    </TableCell>
                    <TableCell>{modelCountByProfile.get(profile.id) ?? 0}</TableCell>
                    <TableCell>
                      <span
                        className={`${styles.status} ${profile.disabled ? styles.disabled : styles.active}`}
                      >
                        {profile.disabled ? (
                          <IconAlertTriangle size={14} />
                        ) : (
                          <IconCheckCircle2 size={14} />
                        )}
                        {profile.disabled
                          ? t('api_key_accounts.disabled')
                          : t('api_key_accounts.active')}
                      </span>
                    </TableCell>
                    <TableCell alignRight>
                      <div className={styles.rowActions}>
                        <button
                          type="button"
                          onClick={() => openEdit(profile)}
                          aria-label={t('common.edit')}
                          title={t('common.edit')}
                        >
                          <IconPencil size={16} />
                        </button>
                        <button
                          type="button"
                          className={styles.dangerAction}
                          onClick={() => deleteProfile(profile)}
                          aria-label={t('common.delete')}
                          title={t('common.delete')}
                        >
                          <IconTrash2 size={16} />
                        </button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeading}>
          <div>
            <h2>{t('api_key_accounts.recent_calls')}</h2>
            <p>{t('api_key_accounts.recent_calls_hint')}</p>
          </div>
          <label className={styles.profileFilter}>
            <span>{t('api_key_accounts.user_filter')}</span>
            <select
              value={eventProfileId}
              onChange={(event) => setEventProfileId(event.target.value)}
            >
              <option value="">{t('api_key_accounts.all_users')}</option>
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        {events.length === 0 ? (
          <div className={styles.empty}>{t('api_key_accounts.no_calls')}</div>
        ) : (
          <Table aria-label={t('api_key_accounts.recent_calls')}>
            <TableHeader>
              <TableRow>
                <TableHead>{t('api_key_accounts.time')}</TableHead>
                <TableHead>{t('api_key_accounts.user')}</TableHead>
                <TableHead>{t('api_key_accounts.model')}</TableHead>
                <TableHead>{t('api_key_accounts.provider')}</TableHead>
                <TableHead>{t('api_key_accounts.tokens')}</TableHead>
                <TableHead>{t('api_key_accounts.latency')}</TableHead>
                <TableHead>{t('common.status')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.map((event) => (
                <TableRow key={event.id}>
                  <TableCell>{formatDateTime(event.requestedAt)}</TableCell>
                  <TableCell>{usageByID.get(event.profileId)?.name ?? event.profileId}</TableCell>
                  <TableCell>
                    <code>{event.model || '—'}</code>
                  </TableCell>
                  <TableCell>{event.provider || '—'}</TableCell>
                  <TableCell>{formatNumber(event.totalTokens)}</TableCell>
                  <TableCell>{formatNumber(event.latencyMs)} ms</TableCell>
                  <TableCell>
                    <span
                      className={`${styles.eventStatus} ${event.failed ? styles.eventFailed : styles.eventSuccess}`}
                    >
                      {event.failed ? t('common.failure') : t('common.success')}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      <Modal
        open={Boolean(editor)}
        onClose={() => setEditor(null)}
        title={creating ? t('api_key_accounts.create') : t('api_key_accounts.edit_title')}
        width={680}
        closeDisabled={saving}
        footer={
          <div className={styles.modalActions}>
            <Button variant="ghost" onClick={() => setEditor(null)} disabled={saving}>
              {t('common.cancel')}
            </Button>
            <Button onClick={() => void saveProfile()} loading={saving}>
              {t('common.save')}
            </Button>
          </div>
        }
      >
        {editor && (
          <div className={styles.editor}>
            <Input
              label={t('api_key_accounts.name')}
              value={editor.name}
              onChange={(event) => setEditor({ ...editor, name: event.target.value })}
              placeholder={t('api_key_accounts.name_placeholder')}
            />
            <Input
              label={t('api_key_accounts.custom_key')}
              value={editor.apiKey}
              onChange={(event) => setEditor({ ...editor, apiKey: event.target.value })}
              placeholder={creating ? t('api_key_accounts.auto_generate') : ''}
              hint={
                creating
                  ? t('api_key_accounts.custom_key_hint')
                  : t('api_key_accounts.key_edit_hint')
              }
              autoComplete="off"
            />
            <div className={styles.toggleRow}>
              <div>
                <strong>{t('api_key_accounts.enabled')}</strong>
                <span>{t('api_key_accounts.enabled_hint')}</span>
              </div>
              <ToggleSwitch
                checked={!editor.disabled}
                onChange={(enabled) => setEditor({ ...editor, disabled: !enabled })}
                ariaLabel={t('api_key_accounts.enabled')}
              />
            </div>
            <div className={styles.formGroup}>
              <label htmlFor="allowed-models">{t('api_key_accounts.allowed_models')}</label>
              <textarea
                id="allowed-models"
                className="input"
                rows={3}
                value={modelsDraft}
                onChange={(event) => setModelsDraft(event.target.value)}
                placeholder={'gpt-*\ngemini-3.*'}
              />
              <span>{t('api_key_accounts.allowed_models_hint')}</span>
            </div>
            <div className={styles.limitGrid}>
              <LimitEditor
                title={t('api_key_accounts.weekly_limit')}
                profile={editor}
                period="week"
                onChange={updateLimit}
                requestsLabel={t('api_key_accounts.request_limit')}
                tokensLabel={t('api_key_accounts.token_limit')}
              />
              <LimitEditor
                title={t('api_key_accounts.monthly_limit')}
                profile={editor}
                period="month"
                onChange={updateLimit}
                requestsLabel={t('api_key_accounts.request_limit')}
                tokensLabel={t('api_key_accounts.token_limit')}
              />
            </div>
            <p className={styles.limitHint}>{t('api_key_accounts.zero_unlimited')}</p>
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(createdProfile)}
        onClose={() => setCreatedProfile(null)}
        title={t('api_key_accounts.created_title')}
        width={620}
        footer={
          <div className={styles.modalActions}>
            <Button variant="secondary" onClick={() => void copyCreatedKey()}>
              {t('common.copy')}
            </Button>
            <Button onClick={() => setCreatedProfile(null)}>{t('common.confirm')}</Button>
          </div>
        }
      >
        {createdProfile && (
          <div className={styles.createdKey}>
            <p>{t('api_key_accounts.created_hint', { name: createdProfile.name })}</p>
            <code>{createdProfile.apiKey}</code>
          </div>
        )}
      </Modal>
    </div>
  );
}

function UsageCell({
  value,
  limit,
  unlimitedLabel,
}: {
  value: number;
  limit: number;
  unlimitedLabel: string;
}) {
  const percent = usagePercent(value, limit);
  const tone =
    percent !== null && percent >= 90
      ? styles.progressCritical
      : percent !== null && percent >= 75
        ? styles.progressWarning
        : '';
  return (
    <div className={styles.usageCell}>
      <span>
        <strong>{formatNumber(value)}</strong>
        <small>{limit > 0 ? ` / ${formatNumber(limit)}` : ` / ${unlimitedLabel}`}</small>
      </span>
      {percent !== null && (
        <span className={styles.progressTrack} aria-hidden="true">
          <i className={tone} style={{ width: `${percent}%` }} />
        </span>
      )}
    </div>
  );
}

function LimitEditor({
  title,
  profile,
  period,
  onChange,
  requestsLabel,
  tokensLabel,
}: {
  title: string;
  profile: ApiKeyProfile;
  period: Period;
  onChange: (period: Period, field: 'requests' | 'tokens', value: string) => void;
  requestsLabel: string;
  tokensLabel: string;
}) {
  const profilePeriod = period === 'week' ? 'weekly' : 'monthly';
  return (
    <fieldset className={styles.limitFieldset}>
      <legend>{title}</legend>
      <Input
        label={requestsLabel}
        type="number"
        min={0}
        step={1}
        value={profile[profilePeriod].requests}
        onChange={(event) => onChange(period, 'requests', event.target.value)}
      />
      <Input
        label={tokensLabel}
        type="number"
        min={0}
        step={1}
        value={profile[profilePeriod].tokens}
        onChange={(event) => onChange(period, 'tokens', event.target.value)}
      />
    </fieldset>
  );
}
