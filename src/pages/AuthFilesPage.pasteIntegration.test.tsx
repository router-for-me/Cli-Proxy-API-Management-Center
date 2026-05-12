import { type ReactNode } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { AuthFilesPage } from './AuthFilesPage';

const { mocks } = vi.hoisted(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;
  return {
      mocks: {
        connectionStatus: 'connected' as 'connected' | 'disconnected',
        list: vi.fn(),
      saveJsonObject: vi.fn(),
      showNotification: vi.fn(),
      showConfirmation: vi.fn(),
      navigate: vi.fn(),
      loadExcluded: vi.fn(async () => undefined),
      loadModelAlias: vi.fn(async () => undefined),
      deleteExcluded: vi.fn(async () => undefined),
      deleteModelAlias: vi.fn(async () => undefined),
      handleMappingUpdate: vi.fn(async () => undefined),
      handleDeleteLink: vi.fn(async () => undefined),
      handleToggleFork: vi.fn(async () => undefined),
      handleRenameAlias: vi.fn(async () => undefined),
      handleDeleteAlias: vi.fn(async () => undefined),
      showModels: vi.fn(),
      closeModelsModal: vi.fn(),
      openPrefixProxyEditor: vi.fn(),
      closePrefixProxyEditor: vi.fn(),
      handlePrefixProxyChange: vi.fn(),
      handlePrefixProxySave: vi.fn(async () => undefined),
      t: (key: string, options?: Record<string, unknown>) => {
        if (options && typeof options.name === 'string') {
          return `${key}:${options.name}`;
        }
        return key;
      },
    },
  };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: mocks.t,
  }),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => mocks.navigate,
}));

vi.mock('motion/mini', () => ({
  animate: () => ({ stop: () => {} }),
}));

vi.mock('@/hooks/useInterval', () => ({
  useInterval: () => {},
}));

vi.mock('@/hooks/useHeaderRefresh', () => ({
  useHeaderRefresh: () => {},
}));

vi.mock('@/components/common/PageTransitionLayer', () => ({
  usePageTransitionLayer: () => ({ status: 'current' }),
}));

vi.mock('@/utils/clipboard', () => ({
  copyToClipboard: vi.fn(async () => undefined),
}));

vi.mock('@/services/api', () => ({
  authFilesApi: {
    list: mocks.list,
    saveJsonObject: mocks.saveJsonObject,
  },
}));

vi.mock('@/stores', () => ({
  useNotificationStore: (selector?: (state: { showNotification: typeof mocks.showNotification; showConfirmation: typeof mocks.showConfirmation }) => unknown) => {
    const state = {
      showNotification: mocks.showNotification,
      showConfirmation: mocks.showConfirmation,
    };
    return selector ? selector(state) : state;
  },
    useAuthStore: (selector: (state: { connectionStatus: 'connected' | 'disconnected' }) => unknown) =>
      selector({ connectionStatus: mocks.connectionStatus }),
  useThemeStore: (selector: (state: { resolvedTheme: 'dark' }) => unknown) =>
    selector({ resolvedTheme: 'dark' }),
  useQuotaStore: (selector: (state: { codexQuota: null }) => unknown) => selector({ codexQuota: null }),
}));

vi.mock('@/features/authFiles/hooks/useAuthFilesOauth', () => ({
  useAuthFilesOauth: () => ({
    excluded: [],
    excludedError: '',
    modelAlias: [],
    modelAliasError: '',
    allProviderModels: {},
    loadExcluded: mocks.loadExcluded,
    loadModelAlias: mocks.loadModelAlias,
    deleteExcluded: mocks.deleteExcluded,
    deleteModelAlias: mocks.deleteModelAlias,
    handleMappingUpdate: mocks.handleMappingUpdate,
    handleDeleteLink: mocks.handleDeleteLink,
    handleToggleFork: mocks.handleToggleFork,
    handleRenameAlias: mocks.handleRenameAlias,
    handleDeleteAlias: mocks.handleDeleteAlias,
  }),
}));

vi.mock('@/features/authFiles/hooks/useAuthFilesModels', () => ({
  useAuthFilesModels: () => ({
    modelsModalOpen: false,
    modelsLoading: false,
    modelsList: [],
    modelsFileName: '',
    modelsFileType: '',
    modelsError: '',
    showModels: mocks.showModels,
    closeModelsModal: mocks.closeModelsModal,
  }),
}));

vi.mock('@/features/authFiles/hooks/useAuthFilesPrefixProxyEditor', () => ({
  useAuthFilesPrefixProxyEditor: () => ({
    prefixProxyEditor: null,
    prefixProxyUpdatedText: '',
    prefixProxyDirty: false,
    openPrefixProxyEditor: mocks.openPrefixProxyEditor,
    closePrefixProxyEditor: mocks.closePrefixProxyEditor,
    handlePrefixProxyChange: mocks.handlePrefixProxyChange,
    handlePrefixProxySave: mocks.handlePrefixProxySave,
  }),
}));

vi.mock('@/features/authFiles/hooks/useAuthFilesStatusBarCache', () => ({
  useAuthFilesStatusBarCache: () => new Map(),
}));

vi.mock('@/features/authFiles/uiState', () => ({
  normalizeAuthFilesSortMode: (value: string) => (value === 'default' ? 'default' : null),
  readAuthFilesUiState: () => null,
  readPersistedAuthFilesCompactMode: () => null,
  writeAuthFilesUiState: vi.fn(),
  writePersistedAuthFilesCompactMode: vi.fn(),
}));

vi.mock('@/features/authFiles/components/AuthFileCard', () => ({
  AuthFileCard: () => null,
}));

vi.mock('@/features/authFiles/components/AuthFileModelsModal', () => ({
  AuthFileModelsModal: () => null,
}));

vi.mock('@/features/authFiles/components/AuthFilesPrefixProxyEditorModal', () => ({
  AuthFilesPrefixProxyEditorModal: () => null,
}));

vi.mock('@/features/authFiles/components/OAuthExcludedCard', () => ({
  OAuthExcludedCard: () => null,
}));

vi.mock('@/features/authFiles/components/OAuthModelAliasCard', () => ({
  OAuthModelAliasCard: () => null,
}));

vi.mock('@/components/ui/EmptyState', () => ({
  EmptyState: () => null,
}));

vi.mock('@/components/ui/ToggleSwitch', () => ({
  ToggleSwitch: () => null,
}));

vi.mock('@/components/ui/Modal', () => ({
  Modal: (props: { open: boolean; children: ReactNode; footer?: ReactNode }) => {
    if (!props.open) return null;
    return (
      <div>
        <div>{props.children}</div>
        <div>{props.footer}</div>
      </div>
    );
  },
}));

const findButtonByText = (renderer: ReactTestRenderer, text: string) => {
  const button = renderer.root.findAllByType(Button).find((node) => node.props.children === text);
  if (!button) throw new Error(`Button not found: ${text}`);
  return button;
};

describe('AuthFilesPage real auth JSON paste flow', () => {
  beforeEach(() => {
    mocks.list.mockReset();
    mocks.saveJsonObject.mockReset();
      mocks.showNotification.mockReset();
      mocks.showConfirmation.mockReset();
      mocks.loadExcluded.mockReset();
      mocks.loadModelAlias.mockReset();
      mocks.connectionStatus = 'connected';

    mocks.list.mockResolvedValue({ files: [] });
    mocks.saveJsonObject.mockResolvedValue(undefined);
    mocks.loadExcluded.mockResolvedValue(undefined);
    mocks.loadModelAlias.mockResolvedValue(undefined);
  });

  it('submits default session paste through modal and uploads converted codex payload', async () => {
    const sessionInput = JSON.stringify({
      user: { email: 'Session.User+tag@example.com' },
      account: { id: 'session-account' },
      accessToken: 'plain-access-token',
    });

    let renderer: ReactTestRenderer;
    act(() => {
      renderer = create(<AuthFilesPage />);
    });

    expect(renderer!.root.findAllByProps({ id: 'auth-json-paste-content' })).toHaveLength(0);

    act(() => {
      findButtonByText(renderer!, 'auth_files.paste_button').props.onClick?.();
    });

    const textarea = renderer!.root.findByProps({ id: 'auth-json-paste-content' });
    act(() => {
      textarea.props.onChange({ target: { value: sessionInput } });
    });

    await act(async () => {
      await findButtonByText(renderer!, 'auth_files.paste_save_button').props.onClick?.();
    });

    await vi.waitFor(() => {
      expect(mocks.saveJsonObject).toHaveBeenCalledWith(
        'session-user-tag-example-com.codex.json',
        expect.objectContaining({
          type: 'codex',
          email: 'Session.User+tag@example.com',
          account_id: 'session-account',
          access_token: 'plain-access-token',
        })
      );
    });
    await vi.waitFor(() => {
      expect(mocks.showNotification).toHaveBeenCalledWith(
        'auth_files.paste_success:session-user-tag-example-com.codex.json',
        'success'
      );
      expect(renderer!.root.findAllByProps({ id: 'auth-json-paste-content' })).toHaveLength(0);
    });

    await act(async () => {
      renderer!.unmount();
    });
  });

  it('keeps the paste modal open and does not upload invalid CPA JSON', async () => {
    let renderer: ReactTestRenderer;
    act(() => {
      renderer = create(<AuthFilesPage />);
    });

    act(() => {
      findButtonByText(renderer!, 'auth_files.paste_button').props.onClick?.();
    });

    const select = renderer!.root
      .findAllByType(Select)
      .find((node) => node.props.ariaLabel === 'auth_files.paste_type_label');
    if (!select) throw new Error('Paste type select not found');
    act(() => {
      select.props.onChange('cpa');
    });

    const textarea = renderer!.root.findByProps({ id: 'auth-json-paste-content' });
    act(() => {
      textarea.props.onChange({ target: { value: '{"type":"codex"}' } });
    });

    await act(async () => {
      await findButtonByText(renderer!, 'auth_files.paste_save_button').props.onClick?.();
    });

    expect(mocks.saveJsonObject).not.toHaveBeenCalled();
    expect(JSON.stringify(renderer!.toJSON())).toContain(
      'CPA auth JSON is missing required auth fields'
    );
    expect(renderer!.root.findAllByProps({ id: 'auth-json-paste-content' })).toHaveLength(1);

    await act(async () => {
      renderer!.unmount();
    });
  });

  it('does not submit an open paste modal after connection is lost', async () => {
    const sessionInput = JSON.stringify({
      user: { email: 'Session.User+tag@example.com' },
      account: { id: 'session-account' },
      accessToken: 'plain-access-token',
    });
    let renderer: ReactTestRenderer;
    act(() => {
      renderer = create(<AuthFilesPage />);
    });

    act(() => {
      findButtonByText(renderer!, 'auth_files.paste_button').props.onClick?.();
    });

    const textarea = renderer!.root.findByProps({ id: 'auth-json-paste-content' });
    act(() => {
      textarea.props.onChange({ target: { value: sessionInput } });
    });

    mocks.connectionStatus = 'disconnected';
    act(() => {
      renderer!.update(<AuthFilesPage />);
    });

    await act(async () => {
      await findButtonByText(renderer!, 'auth_files.paste_save_button').props.onClick?.();
    });

    expect(mocks.saveJsonObject).not.toHaveBeenCalled();
    expect(renderer!.root.findAllByProps({ id: 'auth-json-paste-content' })).toHaveLength(1);

    await act(async () => {
      renderer!.unmount();
    });
  });
});
