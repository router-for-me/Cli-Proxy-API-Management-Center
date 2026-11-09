import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createElement, type ReactElement } from 'react';
import ts from 'typescript';

// Exercise the real card callbacks with the repository's DOM-free hook-harness pattern.
function harness() {
  const source = readFileSync('src/features/quota/providers/codex/CodexAutoReset.tsx', 'utf8');
  const js = ts.transpileModule(
    source.slice(source.indexOf('export function')).replace('export ', ''),
    {
      compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
    }
  ).outputText;
  let revision = 1;
  let index = 0;
  let file = { name: 'codex.json', auth_index: 'index' };
  const hooks: Array<Record<string, unknown>> = [];
  const effects: Array<() => void> = [];
  const reads: Array<(value: unknown) => void> = [];
  const writes: Array<{ seconds: number; resolve: (value: unknown) => void }> = [];
  const confirmations: Array<{ onConfirm(): Promise<void> }> = [];
  let timer = () => {};
  const authStore = Object.assign(
    (selector: (state: unknown) => unknown) => selector({ connectionStatus: 'connected' }),
    {
      getState: () => ({ connectionStatus: 'connected' }),
    }
  );
  const env = {
    React: { createElement },
    Select: 'select',
    useState: (initial: unknown) => {
      const slot = (hooks[index++] ??= { value: initial });
      return [
        slot.value,
        (value: unknown) => {
          slot.value = value;
        },
      ];
    },
    useRef: (initial: unknown) => (hooks[index++] ??= { current: initial }),
    useEffect: (run: () => (() => void) | undefined, deps: unknown[]) => {
      const slot = (hooks[index++] ??= {});
      const previous = slot.deps as unknown[] | undefined;
      if (!previous || deps.some((value, i) => !Object.is(value, previous[i]))) {
        slot.deps = deps;
        effects.push(() => {
          (slot.cleanup as (() => void) | undefined)?.();
          slot.cleanup = run();
        });
      }
    },
    useTranslation: () => ({ t: (key: string) => key }),
    useAuthStore: authStore,
    useNotificationStore: (selector: (state: unknown) => unknown) =>
      selector({
        showConfirmation: (value: { onConfirm(): Promise<void> }) => confirmations.push(value),
      }),
    apiClient: { getConnectionRevision: () => revision },
    normalizeAuthIndex: (value: unknown) => value,
    codexResetPolicyApi: {
      read: () => new Promise((resolve) => reads.push(resolve)),
      save: (_index: string, _previous: unknown, seconds: number) =>
        new Promise((resolve) => writes.push({ seconds, resolve })),
    },
    setInterval: (read: () => void) => {
      timer = read;
      return 1;
    },
    clearInterval: () => {
      timer = () => {};
    },
  };
  const component = new Function(...Object.keys(env), `${js}\nreturn CodexAutoReset;`)(
    ...Object.values(env)
  );
  let tree: ReactElement | null = null;
  const render = () => {
    index = 0;
    tree = component({ file, disabled: false, onRefresh: () => {} });
    while (effects.length) effects.shift()!();
  };
  const flush = async () => {
    await Promise.resolve();
    await Promise.resolve();
    render();
  };
  const control = () =>
    (tree!.props as { children: ReactElement[] }).children.find((child) => child.type === 'select')!
      .props as { value: string; onChange(value: string): void };
  render();
  return {
    reads,
    writes,
    confirmations,
    flush,
    control,
    poll: () => timer(),
    switchAccount: () => {
      file = { ...file, auth_index: 'replacement' };
      revision++;
      render();
    },
  };
}

const policy = {
  account_key: `codex-reset:${'a'.repeat(64)}`,
  enabled: false,
  before_expiry_seconds: 3600,
  result: 'disabled',
  pending: false,
  last_reset_at: 0,
};

test('automation is opt-in and enabling requires explicit confirmation', async () => {
  const h = harness();
  h.reads.shift()!(policy);
  await h.flush();
  expect(h.control().value).toBe('0');
  h.control().onChange('900');
  expect(h.writes).toHaveLength(0);
  expect(h.confirmations).toHaveLength(1);
  const saving = h.confirmations[0].onConfirm();
  expect(h.writes[0].seconds).toBe(900);
  h.writes[0].resolve({ ...policy, enabled: true, before_expiry_seconds: 900 });
  await saving;
  await h.flush();
  expect(h.control().value).toBe('900');
});

test('a delayed poll cannot overwrite newly saved consent', async () => {
  const h = harness();
  h.reads.shift()!(policy);
  await h.flush();
  h.poll();
  h.control().onChange('3600');
  const saving = h.confirmations[0].onConfirm();
  h.writes[0].resolve({ ...policy, enabled: true });
  await saving;
  h.reads.shift()!(policy);
  await h.flush();
  expect(h.control().value).toBe('3600');
});

test('a pending confirmation cannot write after a connection/account switch', async () => {
  const h = harness();
  h.reads.shift()!(policy);
  await h.flush();
  h.control().onChange('3600');
  h.switchAccount();
  await h.confirmations[0].onConfirm();
  expect(h.writes).toHaveLength(0);
});

test('duplicate confirmation submissions produce one policy write', async () => {
  const h = harness();
  h.reads.shift()!(policy);
  await h.flush();
  h.control().onChange('3600');
  const saving = h.confirmations[0].onConfirm();
  await h.confirmations[0].onConfirm();
  expect(h.writes).toHaveLength(1);
  h.writes[0].resolve({ ...policy, enabled: true });
  await saving;
});
