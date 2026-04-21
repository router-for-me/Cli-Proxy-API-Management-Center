import { Suspense, lazy, type ComponentType } from 'react';
import { Navigate, useRoutes, type Location } from 'react-router-dom';
import { PageLoadFallback } from '@/components/common/PageLoadFallback';
import {
  loadAiProvidersPage,
  loadAuthFilesPage,
  loadConfigPage,
  loadDashboardPage,
  loadRequestLogsPage,
  loadSystemPage,
  loadUsagePage,
} from './routeLoaders';

function lazyNamed<TModule extends Record<string, unknown>>(
  loader: () => Promise<TModule>,
  exportName: keyof TModule
) {
  return lazy(async () => {
    const module = await loader();
    return { default: module[exportName] as ComponentType };
  });
}

function renderLazyPage(Component: ComponentType) {
  return (
    <Suspense fallback={<PageLoadFallback />}>
      <Component />
    </Suspense>
  );
}

const LazyDashboardPage = lazyNamed(loadDashboardPage, 'DashboardPage');
const LazyAiProvidersPage = lazyNamed(loadAiProvidersPage, 'AiProvidersPage');
const LazyAiProvidersAmpcodeEditPage = lazyNamed(
  () => import('@/pages/AiProvidersAmpcodeEditPage'),
  'AiProvidersAmpcodeEditPage'
);
const LazyAiProvidersClaudeEditLayout = lazyNamed(
  () => import('@/pages/AiProvidersClaudeEditLayout'),
  'AiProvidersClaudeEditLayout'
);
const LazyAiProvidersClaudeEditPage = lazyNamed(
  () => import('@/pages/AiProvidersClaudeEditPage'),
  'AiProvidersClaudeEditPage'
);
const LazyAiProvidersClaudeModelsPage = lazyNamed(
  () => import('@/pages/AiProvidersClaudeModelsPage'),
  'AiProvidersClaudeModelsPage'
);
const LazyAiProvidersCodexEditPage = lazyNamed(
  () => import('@/pages/AiProvidersCodexEditPage'),
  'AiProvidersCodexEditPage'
);
const LazyAiProvidersGeminiEditPage = lazyNamed(
  () => import('@/pages/AiProvidersGeminiEditPage'),
  'AiProvidersGeminiEditPage'
);
const LazyAiProvidersOpenAIEditLayout = lazyNamed(
  () => import('@/pages/AiProvidersOpenAIEditLayout'),
  'AiProvidersOpenAIEditLayout'
);
const LazyAiProvidersOpenAIEditPage = lazyNamed(
  () => import('@/pages/AiProvidersOpenAIEditPage'),
  'AiProvidersOpenAIEditPage'
);
const LazyAiProvidersOpenAIModelsPage = lazyNamed(
  () => import('@/pages/AiProvidersOpenAIModelsPage'),
  'AiProvidersOpenAIModelsPage'
);
const LazyAiProvidersVertexEditPage = lazyNamed(
  () => import('@/pages/AiProvidersVertexEditPage'),
  'AiProvidersVertexEditPage'
);
const LazyAuthFilesPage = lazyNamed(loadAuthFilesPage, 'AuthFilesPage');
const LazyAuthFilesOAuthExcludedEditPage = lazyNamed(
  () => import('@/pages/AuthFilesOAuthExcludedEditPage'),
  'AuthFilesOAuthExcludedEditPage'
);
const LazyAuthFilesOAuthModelAliasEditPage = lazyNamed(
  () => import('@/pages/AuthFilesOAuthModelAliasEditPage'),
  'AuthFilesOAuthModelAliasEditPage'
);
const LazyOAuthPage = lazyNamed(() => import('@/pages/OAuthPage'), 'OAuthPage');
const LazyQuotaPage = lazyNamed(() => import('@/pages/QuotaPage'), 'QuotaPage');
const LazyRequestLogsPage = lazyNamed(loadRequestLogsPage, 'RequestLogsPage');
const LazyUsagePage = lazyNamed(loadUsagePage, 'UsagePage');
const LazyConfigPage = lazyNamed(loadConfigPage, 'ConfigPage');
const LazyLogsPage = lazyNamed(() => import('@/pages/LogsPage'), 'LogsPage');
const LazySystemPage = lazyNamed(loadSystemPage, 'SystemPage');

const mainRoutes = [
  { path: '/', element: renderLazyPage(LazyDashboardPage) },
  { path: '/dashboard', element: renderLazyPage(LazyDashboardPage) },
  { path: '/settings', element: <Navigate to="/config" replace /> },
  { path: '/api-keys', element: <Navigate to="/config" replace /> },
  { path: '/ai-providers/gemini/new', element: renderLazyPage(LazyAiProvidersGeminiEditPage) },
  { path: '/ai-providers/gemini/:index', element: renderLazyPage(LazyAiProvidersGeminiEditPage) },
  { path: '/ai-providers/codex/new', element: renderLazyPage(LazyAiProvidersCodexEditPage) },
  { path: '/ai-providers/codex/:index', element: renderLazyPage(LazyAiProvidersCodexEditPage) },
  {
    path: '/ai-providers/claude/new',
    element: renderLazyPage(LazyAiProvidersClaudeEditLayout),
    children: [
      { index: true, element: renderLazyPage(LazyAiProvidersClaudeEditPage) },
      { path: 'models', element: renderLazyPage(LazyAiProvidersClaudeModelsPage) },
    ],
  },
  {
    path: '/ai-providers/claude/:index',
    element: renderLazyPage(LazyAiProvidersClaudeEditLayout),
    children: [
      { index: true, element: renderLazyPage(LazyAiProvidersClaudeEditPage) },
      { path: 'models', element: renderLazyPage(LazyAiProvidersClaudeModelsPage) },
    ],
  },
  { path: '/ai-providers/vertex/new', element: renderLazyPage(LazyAiProvidersVertexEditPage) },
  { path: '/ai-providers/vertex/:index', element: renderLazyPage(LazyAiProvidersVertexEditPage) },
  {
    path: '/ai-providers/openai/new',
    element: renderLazyPage(LazyAiProvidersOpenAIEditLayout),
    children: [
      { index: true, element: renderLazyPage(LazyAiProvidersOpenAIEditPage) },
      { path: 'models', element: renderLazyPage(LazyAiProvidersOpenAIModelsPage) },
    ],
  },
  {
    path: '/ai-providers/openai/:index',
    element: renderLazyPage(LazyAiProvidersOpenAIEditLayout),
    children: [
      { index: true, element: renderLazyPage(LazyAiProvidersOpenAIEditPage) },
      { path: 'models', element: renderLazyPage(LazyAiProvidersOpenAIModelsPage) },
    ],
  },
  { path: '/ai-providers/ampcode', element: renderLazyPage(LazyAiProvidersAmpcodeEditPage) },
  { path: '/ai-providers', element: renderLazyPage(LazyAiProvidersPage) },
  { path: '/ai-providers/*', element: renderLazyPage(LazyAiProvidersPage) },
  { path: '/auth-files', element: renderLazyPage(LazyAuthFilesPage) },
  { path: '/auth-files/oauth-excluded', element: renderLazyPage(LazyAuthFilesOAuthExcludedEditPage) },
  { path: '/auth-files/oauth-model-alias', element: renderLazyPage(LazyAuthFilesOAuthModelAliasEditPage) },
  { path: '/oauth', element: renderLazyPage(LazyOAuthPage) },
  { path: '/quota', element: renderLazyPage(LazyQuotaPage) },
  { path: '/usage', element: renderLazyPage(LazyUsagePage) },
  { path: '/request-logs', element: renderLazyPage(LazyRequestLogsPage) },
  { path: '/config', element: renderLazyPage(LazyConfigPage) },
  { path: '/logs', element: renderLazyPage(LazyLogsPage) },
  { path: '/system', element: renderLazyPage(LazySystemPage) },
  { path: '*', element: <Navigate to="/" replace /> },
];

export function MainRoutes({ location }: { location?: Location }) {
  return useRoutes(mainRoutes, location);
}
