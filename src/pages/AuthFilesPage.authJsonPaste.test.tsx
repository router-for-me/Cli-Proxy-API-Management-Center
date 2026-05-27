import { act } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Button } from '@/components/ui/Button';
import { AuthFilesPage } from './AuthFilesPage';

const { mocks } = vi.hoisted(() => {
  return {
    mocks: {
      authJsonPasteSaving: false,
      savePastedAuthJson: vi.fn(async () => 'saved.json'),
      showNotification: vi.fn(),
      navigate: vi.fn(),
      lastModalProps: null as
        | {
            open: boolean;
            saving: boolean;
            onClose: () => void;
            onSave: (type: 'session' | 'cpa', fileName: string, jsonText: string) => Promise<void>;
          }
        | null,
    },
  };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
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

vi.mock('@/features/authFiles/hooks/useAuthFilesData', () => ({
  useAuthFilesData: () => ({
    files: [],
    selectedFiles: new Set<string>(),
    selectionCount: 0,
    loading: false,
    error: '',
    uploading: false,
    authJsonPasteSaving: mocks.authJsonPasteSaving,
    deleting: false,
    deletingAll: false,
    statusUpdating: false,
    batchStatusUpdating: false,
    fileInputRef: { current: null },
    loadFiles: vi.fn(async () => undefined),
    handleUploadClick: vi.fn(),
    handleFileChange: vi.fn(),
    savePastedAuthJson: mocks.savePastedAuthJson,
    handleDelete: vi.fn(),
    handleDeleteAll: vi.fn(),
    handleDownload: vi.fn(),
    handleStatusToggle: vi.fn(),
    toggleSelect: vi.fn(),
    selectAllVisible: vi.fn(),
    invertVisibleSelection: vi.fn(),
    deselectAll: vi.fn(),
    batchDownload: vi.fn(),
    batchSetStatus: vi.fn(),
    batchDelete: vi.fn(),
  }),
}));

vi.mock('@/features/authFiles/hooks/useAuthFilesOauth', () => ({
  useAuthFilesOauth: () => ({
    excluded: [],
    excludedError: '',
    modelAlias: [],
    modelAliasError: '',
    allProviderModels: {},
    loadExcluded: vi.fn(async () => undefined),
    loadModelAlias: vi.fn(async () => undefined),
    deleteExcluded: vi.fn(async () => undefined),
    deleteModelAlias: vi.fn(async () => undefined),
    handleMappingUpdate: vi.fn(async () => undefined),
    handleDeleteLink: vi.fn(async () => undefined),
    handleToggleFork: vi.fn(async () => undefined),
    handleRenameAlias: vi.fn(async () => undefined),
    handleDeleteAlias: vi.fn(async () => undefined),
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
    showModels: vi.fn(),
    closeModelsModal: vi.fn(),
  }),
}));

vi.mock('@/features/authFiles/hooks/useAuthFilesPrefixProxyEditor', () => ({
  useAuthFilesPrefixProxyEditor: () => ({
    prefixProxyEditor: null,
    prefixProxyUpdatedText: '',
    prefixProxyDirty: false,
    openPrefixProxyEditor: vi.fn(),
    closePrefixProxyEditor: vi.fn(),
    handlePrefixProxyChange: vi.fn(),
    handlePrefixProxySave: vi.fn(async () => undefined),
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

vi.mock('@/stores', () => ({
  useNotificationStore: (selector: (state: { showNotification: typeof mocks.showNotification }) => unknown) =>
    selector({ showNotification: mocks.showNotification }),
  useAuthStore: (selector: (state: { connectionStatus: 'connected' }) => unknown) =>
    selector({ connectionStatus: 'connected' }),
  useThemeStore: (selector: (state: { resolvedTheme: 'dark' }) => unknown) =>
    selector({ resolvedTheme: 'dark' }),
  useQuotaStore: (selector: (state: { codexQuota: null }) => unknown) => selector({ codexQuota: null }),
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

vi.mock('@/features/authFiles/components/AuthJsonPasteModal', () => ({
  AuthJsonPasteModal: (props: {
    open: boolean;
    saving: boolean;
    onClose: () => void;
    onSave: (type: 'session' | 'cpa', fileName: string, jsonText: string) => Promise<void>;
  }) => {
    mocks.lastModalProps = props;
    return (
      <div>
        <button id="modal-close-trigger" onClick={props.onClose}>
          close
        </button>
        <button
          id="modal-save-trigger"
          onClick={() => props.onSave('cpa', 'custom-auth.json', '{"type":"codex"}')}
        >
          save
        </button>
      </div>
    );
  },
}));

const findButtonByText = (renderer: ReactTestRenderer, text: string) => {
  const button = renderer.root.findAllByType(Button).find((node) => node.props.children === text);
  if (!button) throw new Error(`Button not found: ${text}`);
  return button;
};

describe('AuthFilesPage auth JSON paste flow', () => {
  beforeEach(() => {
    mocks.authJsonPasteSaving = false;
    mocks.savePastedAuthJson.mockClear();
    mocks.lastModalProps = null;
  });

  it('opens the paste modal from header action and closes after successful save', async () => {
    let renderer: ReactTestRenderer;
    await act(async () => {
      renderer = create(<AuthFilesPage />);
    });

    expect(mocks.lastModalProps?.open).toBe(false);

    await act(async () => {
      findButtonByText(renderer!, 'auth_files.paste_button').props.onClick();
    });
    expect(mocks.lastModalProps?.open).toBe(true);

    await act(async () => {
      renderer!.root.findByProps({ id: 'modal-save-trigger' }).props.onClick();
    });

    expect(mocks.savePastedAuthJson).toHaveBeenCalledWith('cpa', 'custom-auth.json', '{"type":"codex"}');
    expect(mocks.lastModalProps?.open).toBe(false);

    renderer!.unmount();
  });

  it('does not close the modal from onClose while save is in progress', async () => {
    let renderer: ReactTestRenderer;
    await act(async () => {
      renderer = create(<AuthFilesPage />);
    });

    await act(async () => {
      findButtonByText(renderer!, 'auth_files.paste_button').props.onClick();
    });
    expect(mocks.lastModalProps?.open).toBe(true);

    mocks.authJsonPasteSaving = true;
    await act(async () => {
      renderer!.update(<AuthFilesPage />);
    });
    expect(mocks.lastModalProps?.saving).toBe(true);

    await act(async () => {
      renderer!.root.findByProps({ id: 'modal-close-trigger' }).props.onClick();
    });

    expect(mocks.lastModalProps?.open).toBe(true);

    renderer!.unmount();
  });

  it('keeps the modal open when pasted save fails', async () => {
    let renderer: ReactTestRenderer;
    await act(async () => {
      renderer = create(<AuthFilesPage />);
    });

    await act(async () => {
      findButtonByText(renderer!, 'auth_files.paste_button').props.onClick();
    });
    expect(mocks.lastModalProps?.open).toBe(true);

    mocks.savePastedAuthJson.mockRejectedValueOnce(new Error('reload failed'));
    await expect(mocks.lastModalProps!.onSave('cpa', 'custom-auth.json', '{"type":"codex"}')).rejects.toThrow(
      'reload failed'
    );

    expect(mocks.lastModalProps?.open).toBe(true);
    renderer!.unmount();
  });
});
