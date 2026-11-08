/** Temporary DEV-only lab: real cards/hooks/transport, isolated from the main app window. */
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Button } from '@/components/ui/Button';
import { NotificationContainer } from '@/components/common/NotificationContainer';
import { ConfirmationModal } from '@/components/common/ConfirmationModal';
import { QuotaCard } from '../../components/QuotaCard';
import { CODEX_CONFIG } from '../../providers/codex/data';
import {
  applyCodexCreditOverage,
  codexCreditOverageKey,
  countCodexCreditOverageKeys,
} from '../../providers/codex/creditOverage';
import { useAuthStore, useLanguageStore, useQuotaStore, useThemeStore } from '@/stores';
import { apiClient } from '@/services/api';
import i18n from '@/i18n';
import type { AuthFileItem, Theme } from '@/types';
import { SCENARIOS, findScenario, type Scenario } from './scenarios';
import { MOCK_A, MOCK_B, MOCK_KEY, mockTransport } from './transport';
import type { Trace } from './transport';
import '@/styles/global.scss';
import pageStyles from '../../QuotaPage.module.scss';
import styles from './Lab.module.scss';

const CHANNEL = 'codex-overage-mock-v1';
interface Report {
  channel: typeof CHANNEL;
  scenario: string;
  initialPatches: number;
  patches: number;
  pending: number;
  late: number;
  connected: boolean;
  base: string;
  generation: number;
  connectionRevision: number;
  entries: unknown;
  operations: unknown;
  server: Record<string, boolean>;
  events: string[];
  traces: Trace[];
  probe: string;
}
const query = new URLSearchParams(location.search);
const scenario = findScenario(query.get('scenario'));
const events: string[] = [];
let initialPatches = 0;
let probe = '';
const auth = () => useAuthStore.getState();
async function refresh(file: AuthFileItem) {
  const store = useQuotaStore.getState();
  store.setCodexQuota((prev) => ({ ...prev, [file.name]: CODEX_CONFIG.buildLoadingState() }));
  try {
    const data = await CODEX_CONFIG.fetchQuota(file, i18n.t.bind(i18n));
    store.setCodexQuota((prev) => ({ ...prev, [file.name]: CODEX_CONFIG.buildSuccessState(data) }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    store.setCodexQuota((prev) => ({
      ...prev,
      [file.name]: CODEX_CONFIG.buildErrorState(message),
    }));
  }
}
const refreshAll = () => Promise.all(mockTransport.files.map(refresh));
async function login(base: string) {
  await auth().login({ apiBase: base, managementKey: MOCK_KEY, rememberPassword: false });
  await refreshAll();
}
function sendReport() {
  if (parent === window) return;
  const store = useQuotaStore.getState();
  const report: Report = {
    channel: CHANNEL,
    scenario: scenario.id,
    initialPatches,
    patches: mockTransport.traces.filter((trace) => trace.upstreamMethod === 'PATCH').length,
    pending: mockTransport.pendingCount,
    late: mockTransport.lateCount,
    connected: auth().isAuthenticated && auth().connectionStatus === 'connected',
    base: auth().apiBase,
    generation: store.cacheGeneration,
    connectionRevision: apiClient.getConnectionRevision(),
    entries: store.codexCreditOverage,
    operations: store.codexCreditOverageOperations,
    server: { ...mockTransport.serverValues },
    events: [...events],
    traces: mockTransport.traces.map((trace) => ({ ...trace })),
    probe,
  };
  parent.postMessage(report, location.origin);
}
export function Runtime() {
  const [files, setFiles] = useState(mockTransport.files);
  const quotas = useQuotaStore((state) => state.codexQuota);
  const connected = useAuthStore((state) => state.connectionStatus === 'connected');
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const counts = countCodexCreditOverageKeys(files);
  useEffect(() => {
    const reportSoon = () => queueMicrotask(sendReport);
    const cleanups = [
      useQuotaStore.subscribe(reportSoon),
      useAuthStore.subscribe(reportSoon),
      mockTransport.subscribe(reportSoon),
    ];
    const onEvent = (event: Event) => {
      events.push(event.type);
      reportSoon();
    };
    for (const name of ['unauthorized', 'server-version-update', 'server-plugin-support-update'])
      window.addEventListener(name, onEvent);
    const onMessage = async (event: MessageEvent) => {
      if (
        event.source !== parent ||
        event.origin !== location.origin ||
        event.data?.channel !== CHANNEL
      )
        return;
      const { action, value } = event.data as { action: string; value?: string };
      try {
        if (action === 'release') mockTransport.release({ kind: 'success' });
        if (action === 'old-401') mockTransport.release({ kind: 'management', status: 401 });
        if (action === 'reply-403') mockTransport.release({ kind: 'upstream', status: 403 });
        if (action === 'timeout') mockTransport.release({ kind: 'timeout' });
        if (action === 'late') mockTransport.applyLate();
        if (action === 'switch') await login(auth().apiBase === MOCK_A ? MOCK_B : MOCK_A);
        if (action === 'aba') {
          const original = auth().apiBase;
          await login(original === MOCK_A ? MOCK_B : MOCK_A);
          await login(original);
        }
        if (action === 'session') await login(auth().apiBase || MOCK_A);
        if (action === 'logout') auth().logout();
        if (action === 'refresh') await refreshAll();
        if (action === 'invalidate-one') {
          useQuotaStore.getState().clearQuotaCache([mockTransport.files[0].name]);
          await refreshAll();
        }
        if (action === 'invalidate-all') {
          useQuotaStore.getState().clearQuotaCache();
          await refreshAll();
        }
        if (action === 'delete') {
          const [first, ...remaining] = mockTransport.files;
          mockTransport.files = remaining;
          setFiles(remaining);
          if (first) useQuotaStore.getState().clearQuotaCache([first.name]);
        }
        if (action === 'replace') {
          const next = mockTransport.files.map((file, index) =>
            index
              ? file
              : {
                  ...file,
                  email: 'replacement@example.invalid',
                  chatgpt_account_id: 'replacement-account',
                }
          );
          mockTransport.files = next;
          setFiles(next);
        }
        if (action === 'theme' && ['white', 'light', 'dark'].includes(value ?? ''))
          useThemeStore.getState().setTheme(value as Theme);
        if (action === 'language' && value) {
          useLanguageStore.getState().setLanguage(value);
          document.documentElement.lang = value;
        }
        if (action === 'probe') {
          const result = await applyCodexCreditOverage(mockTransport.files[0], true);
          probe = JSON.stringify(
            result.kind === 'failed' ? { kind: result.kind, code: result.error.code } : result
          );
        }
        if (action === 'other') {
          const other = mockTransport.files.find(
            (file) => file.chatgpt_account_id === 'mock-account-b'
          );
          if (other) {
            const result = await applyCodexCreditOverage(other, false);
            probe = JSON.stringify(
              result.kind === 'failed' ? { kind: result.kind, code: result.error.code } : result
            );
          }
        }
        if (action === 'reenter') {
          const first = applyCodexCreditOverage(mockTransport.files[0], true);
          const duplicate = await applyCodexCreditOverage(mockTransport.files[0], false);
          const sibling = await applyCodexCreditOverage(
            mockTransport.files[1] ?? mockTransport.files[0],
            false
          );
          probe = JSON.stringify({ duplicate, sibling, first: '等待响应' });
          reportSoon();
          const result = await first;
          probe = JSON.stringify({ duplicate, sibling, first: result.kind });
        }
      } catch (error) {
        probe = error instanceof Error ? error.message : String(error);
      }
      reportSoon();
    };
    window.addEventListener('message', onMessage);
    sendReport();
    return () => {
      cleanups.forEach((cleanup) => cleanup());
      for (const name of ['unauthorized', 'server-version-update', 'server-plugin-support-update'])
        window.removeEventListener(name, onEvent);
      window.removeEventListener('message', onMessage);
    };
  }, []);
  return (
    <main className={styles.runtime}>
      <p className={styles.runtimeLabel}>
        MOCK · {scenario.title} · {connected ? '模拟会话已连接' : '模拟会话已退出'}
      </p>
      <div className={pageStyles.grid}>
        {files.map((file) => (
          <QuotaCard
            key={file.name}
            entry={{ type: 'codex', file }}
            quota={quotas[file.name]}
            resolvedTheme={resolvedTheme}
            canRefresh={connected && !file.disabled}
            resetting={false}
            entranceDelayMs={null}
            creditOverageSharedCount={counts.get(codexCreditOverageKey(file) ?? '') ?? 1}
            onRefresh={() => void refresh(file)}
            onReset={() => {}}
          />
        ))}
      </div>
      <NotificationContainer />
      <ConfirmationModal />
    </main>
  );
}
const COMMANDS = [
  ['release', '放行 200'],
  ['old-401', '返回旧 401'],
  ['reply-403', '返回上游 403'],
  ['timeout', '客户端超时'],
  ['late', '延迟写入生效'],
  ['refresh', '刷新额度'],
  ['switch', '切换连接'],
  ['aba', 'A → B → A'],
  ['session', '新会话'],
  ['logout', '登出'],
  ['invalidate-one', '清理单个额度'],
  ['invalidate-all', '清理全部额度'],
  ['delete', '删除首凭证'],
  ['replace', '替换首凭证身份'],
  ['probe', '前置校验探针'],
  ['reenter', '并发重入探针'],
  ['other', '另一账号写入'],
];
export function Lab() {
  const [selected, setSelected] = useState(scenario);
  const [revision, setRevision] = useState(0);
  const [frameSource, setFrameSource] = useState(
    `${location.pathname}?runtime=1&scenario=${encodeURIComponent(scenario.id)}&theme=white&language=zh-CN`
  );
  const [report, setReport] = useState<Report | null>(null);
  const [width, setWidth] = useState('100%');
  const [theme, setTheme] = useState('white');
  const [language, setLanguage] = useState('zh-CN');
  const iframe = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (
        event.source !== iframe.current?.contentWindow ||
        event.origin !== location.origin ||
        event.data?.channel !== CHANNEL
      )
        return;
      setReport(event.data as Report);
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, []);
  const command = (action: string, value?: string) =>
    iframe.current?.contentWindow?.postMessage(
      { channel: CHANNEL, action, value },
      location.origin
    );
  const select = (next: Scenario) => {
    setSelected(next);
    setReport(null);
    setRevision((value) => value + 1);
    setFrameSource(
      `${location.pathname}?runtime=1&scenario=${encodeURIComponent(next.id)}&theme=${theme}&language=${language}`
    );
    history.replaceState(null, '', `?scenario=${encodeURIComponent(next.id)}`);
  };
  const groups = [...new Set(SCENARIOS.map((item) => item.group))];
  return (
    <main className={styles.lab}>
      <header className={styles.header}>
        <div>
          <h1>Codex Credit · Mock 验收</h1>
          <p>
            {SCENARIOS.length} 个可复现场景 · 真实卡片 / Hook / Axios 客户端 ·
            所有账号与响应均为虚构
          </p>
        </div>
        <Button variant="secondary" onClick={() => select(selected)}>
          重置当前场景
        </Button>
      </header>
      <p className={styles.notice}>
        页面使用独立内存存储，所有管理请求由本地适配器终止处理，不读取现有登录信息，也不访问真实
        ChatGPT / CPA。Mock 可以验证前端契约与竞态，不能证明未公开上游接口仍然兼容。
      </p>
      <section className={styles.selection}>
        <label>
          场景
          <select
            data-testid="scenario"
            value={selected.id}
            onChange={(event) => select(findScenario(event.target.value))}
          >
            {groups.map((group) => (
              <optgroup key={group} label={group}>
                {SCENARIOS.filter((item) => item.group === group).map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <label>
          宽度
          <select value={width} onChange={(event) => setWidth(event.target.value)}>
            <option value="100%">桌面 / 自适应</option>
            <option value="390px">390px</option>
            <option value="320px">320px</option>
          </select>
        </label>
        <label>
          主题
          <select
            value={theme}
            onChange={(event) => {
              setTheme(event.target.value);
              command('theme', event.target.value);
            }}
          >
            <option value="white">纯白</option>
            <option value="light">纸感</option>
            <option value="dark">暗色</option>
          </select>
        </label>
        <label>
          语言
          <select
            value={language}
            onChange={(event) => {
              setLanguage(event.target.value);
              command('language', event.target.value);
            }}
          >
            {['zh-CN', 'zh-TW', 'en', 'ru', 'vi', 'ko', 'tr'].map((locale) => (
              <option key={locale}>{locale}</option>
            ))}
          </select>
        </label>
      </section>
      <section className={styles.instructions}>
        <h2>
          {selected.group} / {selected.title}
        </h2>
        <p>
          <strong>操作：</strong>
          {selected.steps}
        </p>
        <p>
          <strong>预期：</strong>
          {selected.expected}
        </p>
      </section>
      <div className={styles.commands}>
        {COMMANDS.map(([action, label]) => (
          <Button
            key={action}
            variant="secondary"
            size="sm"
            data-command={action}
            onClick={() => command(action)}
          >
            {label}
          </Button>
        ))}
      </div>
      <div className={styles.metrics} aria-live="polite">
        <span>
          初始 PATCH：<b data-testid="initial-patches">{report?.initialPatches ?? '—'}</b>
        </span>
        <span>
          累计 PATCH：<b data-testid="patch-count">{report?.patches ?? '—'}</b>
        </span>
        <span>
          挂起：<b>{report?.pending ?? '—'}</b>
        </span>
        <span>
          延迟上游写入：<b>{report?.late ?? '—'}</b>
        </span>
        <span>
          会话：
          <b data-testid="session">
            {report ? (report.connected ? '已连接' : '已退出') : '启动中'}
          </b>
        </span>
        <span>
          请求契约：
          <b>
            {report
              ? report.traces
                  .filter((trace) => trace.upstreamMethod === 'PATCH')
                  .every((trace) => trace.valid)
                ? '符合'
                : '不符合'
              : '—'}
          </b>
        </span>
      </div>
      <div className={styles.stage}>
        <iframe
          key={revision}
          ref={iframe}
          src={frameSource}
          title="真实 Codex 卡片 Mock 预览"
          style={{ width }}
        />
      </div>
      <details className={styles.trace} open>
        <summary>请求、事件、账号状态与模拟上游状态</summary>
        <pre data-testid="trace">{JSON.stringify(report, null, 2)}</pre>
      </details>
      <details className={styles.catalog}>
        <summary>全部场景链接 / 覆盖矩阵</summary>
        <table>
          <thead>
            <tr>
              <th>场景</th>
              <th>预期</th>
            </tr>
          </thead>
          <tbody>
            {SCENARIOS.map((item) => (
              <tr key={item.id}>
                <td>
                  <a href={`?scenario=${item.id}`}>
                    {item.group} · {item.title}
                  </a>
                </td>
                <td>{item.expected}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </main>
  );
}
const root = createRoot(document.getElementById('root')!);
import.meta.hot?.dispose(() => root.unmount());

async function mountLab() {
  useThemeStore.getState().setTheme('white');
  if (query.get('runtime') === '1') {
    useThemeStore.getState().setTheme((query.get('theme') || 'white') as Theme);
    useLanguageStore.getState().setLanguage(query.get('language') || 'zh-CN');
    await i18n.changeLanguage(query.get('language') || 'zh-CN');
    await auth().login({ apiBase: MOCK_A, managementKey: MOCK_KEY, rememberPassword: false });
    if (scenario.quota) {
      const store = useQuotaStore.getState();
      for (const file of mockTransport.files)
        store.setCodexQuota((prev) => ({
          ...prev,
          [file.name]:
            scenario.quota === 'loading'
              ? CODEX_CONFIG.buildLoadingState()
              : scenario.quota === 'error'
                ? CODEX_CONFIG.buildErrorState('Mock quota read failed', 503)
                : { status: 'idle', windows: [] },
        }));
    } else await refreshAll();
    if (scenario.initial) {
      const store = useQuotaStore.getState();
      const key = codexCreditOverageKey(mockTransport.files[0]);
      if (key) {
        const at = Date.now() - (scenario.initial === 'yesterday' ? 86400000 : 60000);
        if (scenario.initial.startsWith('unconfirmed')) {
          const operation = {
            status: 'unconfirmed' as const,
            target: scenario.initial === 'unconfirmed-allow',
            at,
          };
          store.setCodexCreditOverage(key, operation);
          store.setCodexCreditOverageOperation('mock-account-a', operation);
        } else
          store.setCodexCreditOverage(key, {
            status: 'known',
            value: scenario.initial !== 'blocked',
            at,
          });
      }
    }
    initialPatches = mockTransport.traces.filter(
      (trace) => trace.upstreamMethod === 'PATCH'
    ).length;
    root.render(<Runtime />);
  } else root.render(<Lab />);
  document.title = `Mock · ${scenario.title} · Codex Credit`;
}

await mountLab();
