import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import {
  accessControlApi,
  type CreatedOAuthInvitation,
  type ManagedUser,
  type ManagedUserDetails,
  type ManagedUserPayload,
  type OAuthInvitation,
} from '@/services/api';
import { useNotificationStore } from '@/stores';
import { copyToClipboard } from '@/utils/clipboard';
import { getErrorMessage } from '@/utils/helpers';
import styles from './AccessControlPage.module.scss';

const PROVIDERS = ['anthropic', 'codex', 'antigravity', 'kimi', 'xai'] as const;

const emptyUser = (): ManagedUserPayload => ({
  name: '',
  email: '',
  status: 'active',
  limits: {
    requests_per_minute: 0,
    concurrent_requests: 0,
    monthly_tokens: 0,
    allowed_models: [],
  },
  expires_at: null,
});

function toLocalDateTime(value?: string): string {
  if (!value) return '';
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function toPayloadDate(value: string): string | null {
  return value ? new Date(value).toISOString() : null;
}

export function AccessControlPage() {
  const { t } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const [tab, setTab] = useState<'users' | 'invites'>('users');
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [invitations, setInvitations] = useState<OAuthInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [userDraft, setUserDraft] = useState(emptyUser);
  const [models, setModels] = useState('');
  const [userExpiry, setUserExpiry] = useState('');
  const [editingId, setEditingId] = useState<string>();
  const [details, setDetails] = useState<ManagedUserDetails>();
  const [savingUser, setSavingUser] = useState(false);
  const [oneTimeSecret, setOneTimeSecret] = useState('');
  const [inviteLabel, setInviteLabel] = useState('');
  const [inviteProviders, setInviteProviders] = useState<string[]>([...PROVIDERS]);
  const [inviteMaxUses, setInviteMaxUses] = useState(1);
  const [inviteExpiry, setInviteExpiry] = useState('');
  const [createdInvite, setCreatedInvite] = useState<CreatedOAuthInvitation>();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [nextUsers, nextInvitations] = await Promise.all([
        accessControlApi.listUsers(),
        accessControlApi.listInvitations(),
      ]);
      setUsers(nextUsers);
      setInvitations(nextInvitations);
    } catch (error) {
      showNotification(getErrorMessage(error), 'error');
    } finally {
      setLoading(false);
    }
  }, [showNotification]);

  useEffect(() => {
    void load();
  }, [load]);

  const visibleUsers = useMemo(
    () => [...users].sort((left, right) => left.name.localeCompare(right.name)),
    [users]
  );

  const resetUserForm = () => {
    setEditingId(undefined);
    setUserDraft(emptyUser());
    setModels('');
    setUserExpiry('');
  };

  const editUser = (user: ManagedUser) => {
    setEditingId(user.id);
    setUserDraft({
      name: user.name,
      email: user.email ?? '',
      status: user.status,
      limits: { ...user.limits },
      expires_at: user.expires_at ?? null,
    });
    setModels(user.limits.allowed_models.join(', '));
    setUserExpiry(toLocalDateTime(user.expires_at));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const saveUser = async (event: FormEvent) => {
    event.preventDefault();
    setSavingUser(true);
    const payload: ManagedUserPayload = {
      ...userDraft,
      expires_at: toPayloadDate(userExpiry),
      limits: {
        ...userDraft.limits,
        allowed_models: models
          .split(',')
          .map((model) => model.trim())
          .filter(Boolean),
      },
    };
    try {
      if (editingId) {
        await accessControlApi.updateUser(editingId, payload);
      } else {
        await accessControlApi.createUser(payload);
      }
      resetUserForm();
      await load();
      showNotification(t('access_control.saved'), 'success');
    } catch (error) {
      showNotification(getErrorMessage(error), 'error');
    } finally {
      setSavingUser(false);
    }
  };

  const openUser = async (user: ManagedUser) => {
    try {
      setDetails(await accessControlApi.getUser(user.id));
      setOneTimeSecret('');
    } catch (error) {
      showNotification(getErrorMessage(error), 'error');
    }
  };

  const createKey = async (user: ManagedUser) => {
    const name = window.prompt(t('access_control.key_name_prompt'), 'Default key');
    if (name === null) return;
    try {
      const key = await accessControlApi.createApiKey(user.id, name.trim() || 'Default key');
      setOneTimeSecret(key.secret);
      setDetails(await accessControlApi.getUser(user.id));
    } catch (error) {
      showNotification(getErrorMessage(error), 'error');
    }
  };

  const revokeKey = async (id: string) => {
    if (!details || !window.confirm(t('access_control.confirm_revoke'))) return;
    try {
      await accessControlApi.revokeApiKey(id);
      setDetails(await accessControlApi.getUser(details.user.id));
    } catch (error) {
      showNotification(getErrorMessage(error), 'error');
    }
  };

  const deleteUser = async (user: ManagedUser) => {
    if (!window.confirm(t('access_control.confirm_delete'))) return;
    try {
      await accessControlApi.deleteUser(user.id);
      if (details?.user.id === user.id) setDetails(undefined);
      await load();
    } catch (error) {
      showNotification(getErrorMessage(error), 'error');
    }
  };

  const createInvitation = async (event: FormEvent) => {
    event.preventDefault();
    try {
      const invitation = await accessControlApi.createInvitation({
        label: inviteLabel,
        providers: inviteProviders,
        max_uses: inviteMaxUses,
        expires_at: toPayloadDate(inviteExpiry),
      });
      setCreatedInvite(invitation);
      setInviteLabel('');
      await load();
    } catch (error) {
      showNotification(getErrorMessage(error), 'error');
    }
  };

  const revokeInvitation = async (id: string) => {
    if (!window.confirm(t('access_control.confirm_revoke'))) return;
    try {
      await accessControlApi.revokeInvitation(id);
      await load();
    } catch (error) {
      showNotification(getErrorMessage(error), 'error');
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.heading}>
        <div>
          <h1>{t('access_control.title')}</h1>
          <p>{t('access_control.subtitle')}</p>
        </div>
        <div className={styles.tabs}>
          <Button
            variant={tab === 'users' ? 'primary' : 'secondary'}
            onClick={() => setTab('users')}
          >
            {t('access_control.users')}
          </Button>
          <Button
            variant={tab === 'invites' ? 'primary' : 'secondary'}
            onClick={() => setTab('invites')}
          >
            {t('access_control.invites')}
          </Button>
        </div>
      </div>

      {tab === 'users' ? (
        <div className={styles.layout}>
          <Card title={editingId ? t('access_control.edit_user') : t('access_control.new_user')}>
            <form className={styles.form} onSubmit={saveUser}>
              <div className={styles.grid}>
                <Input
                  required
                  label={t('access_control.name')}
                  value={userDraft.name}
                  onChange={(event) => setUserDraft({ ...userDraft, name: event.target.value })}
                />
                <Input
                  type="email"
                  label={t('access_control.email')}
                  value={userDraft.email}
                  onChange={(event) => setUserDraft({ ...userDraft, email: event.target.value })}
                />
                <Input
                  type="number"
                  min="0"
                  label={t('access_control.rpm')}
                  value={userDraft.limits.requests_per_minute}
                  onChange={(event) =>
                    setUserDraft({
                      ...userDraft,
                      limits: {
                        ...userDraft.limits,
                        requests_per_minute: Number(event.target.value),
                      },
                    })
                  }
                />
                <Input
                  type="number"
                  min="0"
                  label={t('access_control.concurrent')}
                  value={userDraft.limits.concurrent_requests}
                  onChange={(event) =>
                    setUserDraft({
                      ...userDraft,
                      limits: {
                        ...userDraft.limits,
                        concurrent_requests: Number(event.target.value),
                      },
                    })
                  }
                />
                <Input
                  type="number"
                  min="0"
                  label={t('access_control.monthly_tokens')}
                  value={userDraft.limits.monthly_tokens}
                  onChange={(event) =>
                    setUserDraft({
                      ...userDraft,
                      limits: { ...userDraft.limits, monthly_tokens: Number(event.target.value) },
                    })
                  }
                />
                <Input
                  type="datetime-local"
                  label={t('access_control.expires')}
                  value={userExpiry}
                  onChange={(event) => setUserExpiry(event.target.value)}
                />
              </div>
              <Input
                label={t('access_control.models')}
                hint={t('access_control.models_hint')}
                value={models}
                onChange={(event) => setModels(event.target.value)}
              />
              <label className={styles.checkbox}>
                <input
                  type="checkbox"
                  checked={userDraft.status === 'active'}
                  onChange={(event) =>
                    setUserDraft({
                      ...userDraft,
                      status: event.target.checked ? 'active' : 'disabled',
                    })
                  }
                />
                {t('access_control.active')}
              </label>
              <div className={styles.actions}>
                <Button type="submit" loading={savingUser}>
                  {t('access_control.save')}
                </Button>
                {editingId ? (
                  <Button type="button" variant="secondary" onClick={resetUserForm}>
                    {t('access_control.cancel')}
                  </Button>
                ) : null}
              </div>
            </form>
          </Card>

          <Card title={t('access_control.users')}>
            <div className={styles.list}>
              {loading ? <p>{t('common.loading')}</p> : null}
              {!loading && visibleUsers.length === 0 ? (
                <p>{t('access_control.empty_users')}</p>
              ) : null}
              {visibleUsers.map((user) => (
                <article className={styles.item} key={user.id}>
                  <div>
                    <strong>{user.name}</strong>
                    <span>{user.email || '—'}</span>
                    <small>
                      {user.limits.requests_per_minute || '∞'} RPM ·{' '}
                      {user.limits.monthly_tokens || '∞'} tokens
                    </small>
                  </div>
                  <span className={user.status === 'active' ? styles.active : styles.disabled}>
                    {user.status}
                  </span>
                  <div className={styles.actions}>
                    <Button size="sm" variant="secondary" onClick={() => openUser(user)}>
                      {t('access_control.manage')}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => editUser(user)}>
                      {t('access_control.edit')}
                    </Button>
                    <Button size="sm" variant="danger" onClick={() => deleteUser(user)}>
                      {t('access_control.delete')}
                    </Button>
                  </div>
                </article>
              ))}
            </div>
          </Card>

          {details ? (
            <Card
              title={`${details.user.name} · ${t('access_control.api_keys')}`}
              extra={
                <Button onClick={() => createKey(details.user)}>
                  {t('access_control.new_key')}
                </Button>
              }
            >
              {oneTimeSecret ? (
                <div className={styles.secret}>
                  <strong>{t('access_control.copy_now')}</strong>
                  <code>{oneTimeSecret}</code>
                  <Button size="sm" onClick={() => void copyToClipboard(oneTimeSecret)}>
                    {t('access_control.copy')}
                  </Button>
                </div>
              ) : null}
              <p className={styles.usage}>
                {t('access_control.usage')}: {details.usage.total_tokens.toLocaleString()} tokens ·{' '}
                {details.usage.requests.toLocaleString()} requests
              </p>
              <div className={styles.list}>
                {details.api_keys.map((key) => (
                  <article className={styles.item} key={key.id}>
                    <div>
                      <strong>{key.name}</strong>
                      <code>{key.prefix}••••••••</code>
                    </div>
                    <span className={key.status === 'active' ? styles.active : styles.disabled}>
                      {key.status}
                    </span>
                    {key.status === 'active' ? (
                      <Button size="sm" variant="danger" onClick={() => revokeKey(key.id)}>
                        {t('access_control.revoke')}
                      </Button>
                    ) : null}
                  </article>
                ))}
              </div>
            </Card>
          ) : null}
        </div>
      ) : (
        <div className={styles.layout}>
          <Card title={t('access_control.new_invite')}>
            <form className={styles.form} onSubmit={createInvitation}>
              <div className={styles.grid}>
                <Input
                  required
                  label={t('access_control.label')}
                  value={inviteLabel}
                  onChange={(event) => setInviteLabel(event.target.value)}
                />
                <Input
                  type="number"
                  min="1"
                  label={t('access_control.max_uses')}
                  value={inviteMaxUses}
                  onChange={(event) => setInviteMaxUses(Number(event.target.value))}
                />
                <Input
                  type="datetime-local"
                  label={t('access_control.expires')}
                  value={inviteExpiry}
                  onChange={(event) => setInviteExpiry(event.target.value)}
                />
              </div>
              <div className={styles.providers}>
                {PROVIDERS.map((provider) => (
                  <label className={styles.checkbox} key={provider}>
                    <input
                      type="checkbox"
                      checked={inviteProviders.includes(provider)}
                      onChange={(event) =>
                        setInviteProviders((current) =>
                          event.target.checked
                            ? [...current, provider]
                            : current.filter((item) => item !== provider)
                        )
                      }
                    />
                    {provider}
                  </label>
                ))}
              </div>
              <Button type="submit" disabled={inviteProviders.length === 0}>
                {t('access_control.create_link')}
              </Button>
            </form>
          </Card>

          {createdInvite ? (
            <Card title={t('access_control.link_ready')}>
              <div className={styles.secret}>
                <code>{createdInvite.url}</code>
                <Button onClick={() => void copyToClipboard(createdInvite.url)}>
                  {t('access_control.copy')}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => window.open(createdInvite.url, '_blank', 'noopener')}
                >
                  {t('access_control.open')}
                </Button>
              </div>
            </Card>
          ) : null}

          <Card title={t('access_control.invites')}>
            <div className={styles.list}>
              {invitations.map((invite) => (
                <article className={styles.item} key={invite.id}>
                  <div>
                    <strong>{invite.label}</strong>
                    <span>{invite.providers.join(', ')}</span>
                    <small>
                      {invite.used_uses}/{invite.max_uses} {t('access_control.used')}
                    </small>
                  </div>
                  <span className={invite.active ? styles.active : styles.disabled}>
                    {invite.active ? t('access_control.active') : t('access_control.revoked')}
                  </span>
                  {invite.active ? (
                    <Button size="sm" variant="danger" onClick={() => revokeInvitation(invite.id)}>
                      {t('access_control.revoke')}
                    </Button>
                  ) : null}
                </article>
              ))}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
