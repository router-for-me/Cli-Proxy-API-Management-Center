import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom';

vi.mock('@/services/api/client', () => ({
  apiClient: {
    get: vi.fn().mockResolvedValue({}),
    post: vi.fn().mockResolvedValue({}),
    put: vi.fn().mockResolvedValue({}),
    patch: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue({}),
    getRaw: vi.fn().mockResolvedValue({ data: {}, headers: {} }),
    postForm: vi.fn().mockResolvedValue({}),
    requestRaw: vi.fn().mockResolvedValue({ data: {}, headers: {} }),
    setConfig: vi.fn()
  }
}));

// useUnsavedChangesGuard internally calls useBlocker which only works
// inside a data router (createMemoryRouter + RouterProvider). Smoke
// tests use the simpler MemoryRouter, so mock the guard to a no-op.
vi.mock('@/hooks/useUnsavedChangesGuard', () => ({
  useUnsavedChangesGuard: () => ({
    allowNextNavigation: () => {},
    confirmIfNeeded: async () => true,
  }),
}));

import { DashboardPage } from '@/pages/DashboardPage';
import { AiProvidersPage } from '@/pages/AiProvidersPage';
import { AuthFilesPage } from '@/pages/AuthFilesPage';
import { OAuthPage } from '@/pages/OAuthPage';
import { QuotaPage } from '@/pages/QuotaPage';
import { ConfigPage } from '@/pages/ConfigPage';
import { LogsPage } from '@/pages/LogsPage';
import { SystemPage } from '@/pages/SystemPage';
import { AiProvidersClaudeEditPage } from '@/pages/AiProvidersClaudeEditPage';
import { AiProvidersOpenAIEditPage } from '@/pages/AiProvidersOpenAIEditPage';
import { AiProvidersCodexEditPage } from '@/pages/AiProvidersCodexEditPage';
import { AiProvidersGeminiEditPage } from '@/pages/AiProvidersGeminiEditPage';

// Outlet-context wrapper: Claude and OpenAI edit pages read state from
// the parent layout via useOutletContext. The smoke test provides a
// minimal context so the page can mount without crashing. Codex Phase D
// round-1 IMPORTANT #2.
function withOutletContext(context: unknown, element: ReactElement) {
  return (
    <MemoryRouter>
      <Routes>
        <Route element={<Outlet context={context} />}>
          <Route index element={element} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

const claudeOutletContext = {
  hasIndexParam: false,
  editIndex: null,
  invalidIndexParam: false,
  invalidIndex: false,
  disableControls: false,
  loading: false,
  saving: false,
  form: {
    apiKey: '',
    priority: undefined,
    prefix: '',
    baseUrl: '',
    proxyUrl: '',
    headers: [],
    models: [],
    excludedModels: [],
    modelEntries: [{ name: '', alias: '' }],
    excludedText: '',
  },
  setForm: () => {},
  testModel: '',
  setTestModel: () => {},
  testStatus: 'idle' as const,
  setTestStatus: () => {},
  testMessage: '',
  setTestMessage: () => {},
  availableModels: [],
  handleBack: () => {},
  handleSave: async () => {},
  mergeDiscoveredModels: () => {},
};

const openaiOutletContext = {
  ...claudeOutletContext,
  form: {
    ...claudeOutletContext.form,
    apiKeyEntries: [],
  },
  keyTestStatuses: [],
  setDraftKeyTestStatus: () => {},
  resetDraftKeyTestStatuses: () => {},
};

const cases: ReadonlyArray<{ name: string; element: ReactElement; wrapper?: 'outlet-claude' | 'outlet-openai' }> = [
  { name: '/', element: <DashboardPage /> },
  { name: '/ai-providers', element: <AiProvidersPage /> },
  { name: '/auth-files', element: <AuthFilesPage /> },
  { name: '/oauth', element: <OAuthPage /> },
  { name: '/quota', element: <QuotaPage /> },
  { name: '/config', element: <ConfigPage /> },
  { name: '/logs', element: <LogsPage /> },
  { name: '/system', element: <SystemPage /> },
  { name: '/ai-providers/claude/new', element: <AiProvidersClaudeEditPage />, wrapper: 'outlet-claude' },
  { name: '/ai-providers/openai/new', element: <AiProvidersOpenAIEditPage />, wrapper: 'outlet-openai' },
  { name: '/ai-providers/codex/new', element: <AiProvidersCodexEditPage /> },
  { name: '/ai-providers/gemini/new', element: <AiProvidersGeminiEditPage /> },
];

const IGNORED_CONSOLE_ERROR_PATTERNS = [/not implemented:/i];

describe('shared-route smoke tests', () => {
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errSpy.mockRestore();
  });

  for (const { name, element, wrapper } of cases) {
    it(`mounts ${name} without console.error`, () => {
      if (wrapper === 'outlet-claude') {
        render(withOutletContext(claudeOutletContext, element));
      } else if (wrapper === 'outlet-openai') {
        render(withOutletContext(openaiOutletContext, element));
      } else {
        // Wrap in a Routes/Route tree so hooks like useLocation that
        // require a matched route (react-router v7) work.
        render(
          <MemoryRouter>
            <Routes>
              <Route path="*" element={element} />
            </Routes>
          </MemoryRouter>,
        );
      }
      const real = errSpy.mock.calls.filter(
        (args) =>
          !IGNORED_CONSOLE_ERROR_PATTERNS.some((p) =>
            p.test(String(args[0] ?? ''))
          )
      );
      expect(real).toEqual([]);
    });
  }
});
