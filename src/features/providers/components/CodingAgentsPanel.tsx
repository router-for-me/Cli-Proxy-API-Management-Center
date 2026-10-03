import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { IconBot, IconRefreshCw } from '@/components/ui/icons';
import claudeLogo from '@/assets/icons/claude.svg';
import codexLogo from '@/assets/icons/codex.svg';
import codexDarkLogo from '@/assets/icons/codex-dark.svg';
import geminiLogo from '@/assets/icons/gemini.svg';
import opencodeLogo from '@/assets/icons/opencode.svg';
import opencodeDarkLogo from '@/assets/icons/opencode-dark.svg';
import piLogo from '@/assets/icons/pi.svg';
import piDarkLogo from '@/assets/icons/pi-dark.svg';
import {
  codingAgentsApi,
  type CodingAgentBackupStamp,
  type CodingAgentPlan,
  type CodingAgentStatus,
  type CodingAgentsStatusResponse,
} from '@/services/api/codingAgents';
import styles from './CodingAgentsPanel.module.scss';

interface AgentLogo {
  src: string;
  darkSrc?: string;
}

/** Coding-agent avatars, same lobe-icons set and light/dark swap as provider logos. */
const AGENT_LOGOS: Record<string, AgentLogo> = {
  'claude-code': { src: claudeLogo },
  codex: { src: codexLogo, darkSrc: codexDarkLogo },
  'gemini-cli': { src: geminiLogo },
  opencode: { src: opencodeLogo, darkSrc: opencodeDarkLogo },
  pi: { src: piLogo, darkSrc: piDarkLogo },
};

function AgentIcon({ name }: { name: string }) {
  const logo = AGENT_LOGOS[name];
  if (!logo) {
    return <IconBot size={18} className={styles.agentIcon} />;
  }
  return (
    <span className={styles.agentIconWrap}>
      <img
        src={logo.src}
        alt=""
        aria-hidden="true"
        className={`${styles.agentIcon} ${logo.darkSrc ? styles.agentIconLight : ''}`}
      />
      {logo.darkSrc ? (
        <img src={logo.darkSrc} alt="" aria-hidden="true" className={`${styles.agentIcon} ${styles.agentIconDark}`} />
      ) : null}
    </span>
  );
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; agents: CodingAgentStatus[]; stamps: CodingAgentBackupStamp[] };

/**
 * Coding-agent auto-configuration: repoints known coding agents
 * (claude-code, pi, opencode, …) at the local proxy, always creating a
 * timestamped backup that can be reverted. One agent per action by design —
 * no bulk apply exists.
 */
export function CodingAgentsPanel() {
  const { t } = useTranslation();
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmName, setConfirmName] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [openPlan, setOpenPlan] = useState<string | null>(null);
  const [plans, setPlans] = useState<Record<string, CodingAgentPlan | 'error'>>({});
  // Apply/revert bump this so a getPlan still in flight cannot repopulate the
  // cache with pre-apply data after run()'s finally already cleared it.
  const planGenRef = useRef(0);

  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      const [status, backups] = await Promise.all([codingAgentsApi.getStatus(), codingAgentsApi.getBackups()]);
      setState({
        kind: 'ready',
        agents: (status as CodingAgentsStatusResponse).agents ?? [],
        stamps: backups.stamps ?? [],
      });
    } catch (err) {
      setState({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const run = useCallback(
    async (key: string, fn: () => Promise<{ ok?: boolean; lines?: string[]; error?: string }>) => {
      setBusy(key);
      try {
        const res = await fn();
        const lines = res.lines ?? (res.error ? [res.error] : []);
        setLog(lines);
        await load();
      } catch (err) {
        setLog([err instanceof Error ? err.message : String(err)]);
        await load();
      } finally {
        setBusy(null);
        planGenRef.current += 1;
        setPlans({});
        setOpenPlan(null);
      }
    },
    [load]
  );

  const handleApply = (agent: CodingAgentStatus) => {
    // Overwriting an existing non-proxy configuration asks for a second click
    // instead of a modal — cheap, obvious, and gone on blur of intent.
    if (agent.status === 'other-config' && confirmName !== agent.name) {
      setConfirmName(agent.name);
      return;
    }
    setConfirmName(null);
    void run(`apply:${agent.name}`, () => codingAgentsApi.apply(agent.name));
  };

  const handleRevert = (stamp?: string) => {
    void run(`revert:${stamp ?? 'latest'}`, () => codingAgentsApi.revert(stamp));
  };

  // Plan previews load lazily on first expand; apply/revert invalidates them
  // so the "exists / creates" info never goes stale.
  const togglePlan = (name: string) => {
    if (openPlan === name) {
      setOpenPlan(null);
      return;
    }
    setOpenPlan(name);
    if (!plans[name]) {
      const gen = planGenRef.current;
      codingAgentsApi
        .getPlan(name)
        .then((p) => {
          if (gen === planGenRef.current) setPlans((prev) => ({ ...prev, [name]: p }));
        })
        .catch(() => {
          if (gen === planGenRef.current) setPlans((prev) => ({ ...prev, [name]: 'error' }));
        });
    }
  };

  const renderPlan = (name: string) => {
    const plan = plans[name];
    if (!plan || plan === 'error') {
      return <div className={styles.planBox}>{plan === 'error' ? t('codingAgents.plan_error') : t('codingAgents.plan_loading')}</div>;
    }
    return (
      <div className={styles.planBox}>
        <div className={styles.planFile}>
          {plan.creates ? t('codingAgents.plan_creates') : t('codingAgents.plan_file')}{' '}
          <code>{plan.file}</code>
        </div>
        <ul className={styles.planList}>
          {plan.changes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        {plan.hooks.length > 0 ? (
          <>
            <div className={styles.planHooksTitle}>{t('codingAgents.plan_hooks')}</div>
            <ul className={styles.planList}>
              {plan.hooks.map((h) => (
                <li key={h}>{h}</li>
              ))}
            </ul>
          </>
        ) : null}
        <div className={styles.planNote}>{t('codingAgents.plan_backup')}</div>
      </div>
    );
  };

  const statusChip = (status: CodingAgentStatus['status']) => {
    const cls =
      status === 'configured' ? styles.chipOk : status === 'not-installed' ? styles.chipMuted : styles.chipWarn;
    const label =
      status === 'configured'
        ? t('codingAgents.status_configured')
        : status === 'not-installed'
          ? t('codingAgents.status_not_installed')
          : t('codingAgents.status_other');
    return <span className={`${styles.chip} ${cls}`}>{label}</span>;
  };

  return (
    <section className={styles.section}>
      <div className={styles.header}>
        <h2 className={styles.title}>{t('codingAgents.title')}</h2>
        <div className={styles.actions}>
          <Button variant="secondary" size="sm" onClick={() => void load()} disabled={state.kind === 'loading'}>
            <IconRefreshCw />
            {t('codingAgents.refresh')}
          </Button>
          {state.kind === 'ready' && state.stamps.length > 0 ? (
            <Button
              variant="secondary"
              size="sm"
              disabled={busy !== null}
              onClick={() => handleRevert()}
            >
              {t('codingAgents.revert_last')}
            </Button>
          ) : null}
        </div>
      </div>
      <p className={styles.hint}>{t('codingAgents.hint')}</p>

      {state.kind === 'error' ? <p className={styles.note}>{state.message}</p> : null}

      {state.kind === 'ready' ? (
        <div className={styles.rows}>
          {state.agents.map((agent) => (
            <div key={agent.name} className={styles.agentBlock}>
              <div className={styles.row}>
                <AgentIcon name={agent.name} />
                <div className={styles.idBlock}>
                  <span className={styles.name}>{agent.label}</span>
                  <span className={styles.file} title={agent.file}>
                    {agent.file}
                  </span>
                </div>
                {statusChip(agent.status)}
                <Button
                  variant={openPlan === agent.name ? 'primary' : 'secondary'}
                  size="sm"
                  onClick={() => togglePlan(agent.name)}
                >
                  {t('codingAgents.plan_toggle')}
                </Button>
                <Button
                  variant={confirmName === agent.name ? 'primary' : 'secondary'}
                  size="sm"
                  disabled={busy !== null || agent.status === 'configured'}
                  onClick={() => handleApply(agent)}
                  onBlur={() => setConfirmName((n) => (n === agent.name ? null : n))}
                >
                  {busy === `apply:${agent.name}`
                    ? t('codingAgents.working')
                    : confirmName === agent.name
                      ? t('codingAgents.confirm_overwrite')
                      : agent.exists
                        ? t('codingAgents.apply')
                        : t('codingAgents.create')}
                </Button>
              </div>
              {openPlan === agent.name ? renderPlan(agent.name) : null}
            </div>
          ))}

          {state.stamps.length > 0 ? (
            <div className={styles.backups}>
              <div className={styles.backupsTitle}>{t('codingAgents.backups')}</div>
              {state.stamps
                .slice()
                .reverse()
                .map((s) => (
                  <div key={s.stamp} className={styles.stampRow}>
                    <div className={styles.stampInfo}>
                      <span className={styles.stampId}>{s.stamp}</span>
                      {s.entries.map((e) => (
                        <span key={e.backup} className={styles.stampEntry} title={e.file}>
                          <AgentIcon name={e.agent} />
                          <span className={styles.stampEntryName}>{e.agent}</span>
                          <span className={styles.stampFiles}>{e.file}</span>
                        </span>
                      ))}
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={busy !== null}
                      onClick={() => handleRevert(s.stamp)}
                    >
                      {busy === `revert:${s.stamp}` ? t('codingAgents.working') : t('codingAgents.revert')}
                    </Button>
                  </div>
                ))}
            </div>
          ) : null}

          {log.length > 0 ? (
            <pre className={styles.log}>
              {log.join('\n')}
            </pre>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
