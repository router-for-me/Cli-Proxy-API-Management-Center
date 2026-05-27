import { act, type ReactNode } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { AuthJsonPasteModal } from './AuthJsonPasteModal';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@/components/ui/Modal', () => ({
  Modal: (props: { children: ReactNode; footer?: ReactNode }) => (
    <div>
      <div>{props.children}</div>
      <div>{props.footer}</div>
    </div>
  ),
}));

type ModalHarness = {
  renderer: ReactTestRenderer;
  clickSave: () => Promise<void>;
  setFileName: (value: string) => void;
  setJsonText: (value: string) => void;
  setType: (value: 'session' | 'cpa') => void;
  getText: () => string;
};

  const mountModal = (
    onSave: (type: 'session' | 'cpa', fileName: string, jsonText: string) => Promise<void>,
    saving = false,
    disabled = false
  ): ModalHarness => {
    let renderer: ReactTestRenderer;
    act(() => {
      renderer = create(
        <AuthJsonPasteModal
          open
          saving={saving}
          disabled={disabled}
          onClose={() => {}}
          onSave={onSave}
        />
      );
  });

  const setFileName = (value: string) => {
    const input = renderer!.root.findByType(Input);
    act(() => {
      input.props.onChange({ target: { value } });
    });
  };

  const setJsonText = (value: string) => {
    const textarea = renderer!.root.findByProps({ id: 'auth-json-paste-content' });
    act(() => {
      textarea.props.onChange({ target: { value } });
    });
  };

  const setType = (value: 'session' | 'cpa') => {
    const select = renderer!.root.findByType(Select);
    act(() => {
      select.props.onChange(value);
    });
  };

  const clickSave = async () => {
    const saveButton = renderer!.root
      .findAllByType(Button)
      .find((node) => node.props.children === 'auth_files.paste_save_button');
    if (!saveButton) throw new Error('Save button not found');
    await act(async () => {
      await saveButton.props.onClick();
    });
  };

  const getText = () => JSON.stringify(renderer!.toJSON());

  return {
    renderer: renderer!,
    clickSave,
    setFileName,
    setJsonText,
    setType,
    getText,
  };
};

describe('AuthJsonPasteModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects invalid file names without calling save', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const modal = mountModal(onSave);

    modal.setFileName('invalid/name.json');
    modal.setJsonText('{"type":"codex"}');

    await modal.clickSave();

    expect(onSave).not.toHaveBeenCalled();
    expect(modal.getText()).toContain('auth_files.paste_error_file_name_invalid');
    modal.renderer.unmount();
  });

  it.each([
    'CON.json',
    'CON.codex.json',
    'AUX.json',
    'NUL.json',
    '.json',
    '.codex.json',
    '.hidden.json',
    'LPT1.json',
    'LPT1.backup.json',
    'name .json',
    'name..json',
  ])(
    'rejects Windows-unsafe file name %s without calling save',
    async (fileName) => {
      const onSave = vi.fn().mockResolvedValue(undefined);
      const modal = mountModal(onSave);

      modal.setFileName(fileName);
      modal.setJsonText('{"type":"codex"}');

      await modal.clickSave();

      expect(onSave).not.toHaveBeenCalled();
      expect(modal.getText()).toContain('auth_files.paste_error_file_name_invalid');
      modal.renderer.unmount();
    }
  );

  it.each([
    'codex-\u202Egpj.json',
    'codex-\u2066account.json',
    'codex-\u200Baccount.json',
  ])('rejects visually misleading file name %s without calling save', async (fileName) => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const modal = mountModal(onSave);

    modal.setFileName(fileName);
    modal.setJsonText('{"type":"codex"}');

    await modal.clickSave();

    expect(onSave).not.toHaveBeenCalled();
    expect(modal.getText()).toContain('auth_files.paste_error_file_name_invalid');
    modal.renderer.unmount();
  });

  it('rejects empty json text without calling save', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const modal = mountModal(onSave);

    modal.setFileName('valid.json');
    modal.setJsonText('   ');

    await modal.clickSave();

    expect(onSave).not.toHaveBeenCalled();
    expect(modal.getText()).toContain('auth_files.paste_error_json_required');
    modal.renderer.unmount();
  });

  it('passes selected type, file name, and json text to save', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const modal = mountModal(onSave);

    modal.setType('cpa');
    modal.setFileName('custom-auth.json');
    modal.setJsonText('{"type":"codex","email":"user@example.com"}');

    await modal.clickSave();

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith(
      'cpa',
      'custom-auth.json',
      '{"type":"codex","email":"user@example.com"}'
    );
    modal.renderer.unmount();
  });

  it('does not save again while a save is already in progress', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const modal = mountModal(onSave, true);

    modal.setFileName('custom-auth.json');
    modal.setJsonText('{"type":"codex","email":"user@example.com"}');

    await modal.clickSave();

    expect(onSave).not.toHaveBeenCalled();
    modal.renderer.unmount();
  });

  it('does not save while disabled', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const modal = mountModal(onSave, false, true);

    modal.setFileName('custom-auth.json');
    modal.setJsonText('{"type":"codex","email":"user@example.com"}');

    await modal.clickSave();

    expect(onSave).not.toHaveBeenCalled();
    modal.renderer.unmount();
  });

  it('renders save error returned by onSave', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('upload failed'));
    const modal = mountModal(onSave);

    modal.setFileName('custom-auth.json');
    modal.setJsonText('{"type":"codex"}');

    await modal.clickSave();

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(modal.getText()).toContain('upload failed');
    modal.renderer.unmount();
  });
});
