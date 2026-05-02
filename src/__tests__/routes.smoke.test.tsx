import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

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

import { DashboardPage } from '@/pages/DashboardPage';
import { AiProvidersPage } from '@/pages/AiProvidersPage';
import { AuthFilesPage } from '@/pages/AuthFilesPage';
import { OAuthPage } from '@/pages/OAuthPage';
import { QuotaPage } from '@/pages/QuotaPage';
import { ConfigPage } from '@/pages/ConfigPage';
import { LogsPage } from '@/pages/LogsPage';
import { SystemPage } from '@/pages/SystemPage';

const cases: ReadonlyArray<{ name: string; element: ReactElement }> = [
  { name: '/', element: <DashboardPage /> },
  { name: '/ai-providers', element: <AiProvidersPage /> },
  { name: '/auth-files', element: <AuthFilesPage /> },
  { name: '/oauth', element: <OAuthPage /> },
  { name: '/quota', element: <QuotaPage /> },
  { name: '/config', element: <ConfigPage /> },
  { name: '/logs', element: <LogsPage /> },
  { name: '/system', element: <SystemPage /> }
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

  for (const { name, element } of cases) {
    it(`mounts ${name} without console.error`, () => {
      render(<MemoryRouter>{element}</MemoryRouter>);
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
