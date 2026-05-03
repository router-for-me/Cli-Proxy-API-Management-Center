import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ProviderEditorShell } from '@/components/providers/ProviderEditorShell';

// Codex Phase D round-1 IMPORTANT #2: pin the shell's contract — title,
// back-button, save-button (enabled vs disabled vs loading). Floating
// footer renders inside a portal via SecondaryScreenShell; the test
// asserts on document.body since RTL queries scope to the rendered
// container by default.

function renderShell(overrides: {
  title?: string;
  onBack?: () => void;
  onSave?: () => void | Promise<void>;
  canSave?: boolean;
  loading?: boolean;
  saving?: boolean;
  body?: React.ReactNode;
} = {}) {
  const onBack = overrides.onBack ?? vi.fn();
  const onSave = overrides.onSave ?? vi.fn();
  const result = render(
    <ProviderEditorShell
      title={overrides.title ?? 'Edit Provider'}
      onBack={onBack}
      onSave={onSave}
      canSave={overrides.canSave ?? true}
      loading={overrides.loading ?? false}
      saving={overrides.saving ?? false}
    >
      {overrides.body ?? <div data-testid="body">body</div>}
    </ProviderEditorShell>,
  );
  return { onBack, onSave, ...result };
}

describe('ProviderEditorShell', () => {
  it('renders the provided title and body', () => {
    renderShell({ title: 'Custom Title' });
    expect(screen.getAllByText('Custom Title').length).toBeGreaterThan(0);
    expect(screen.getByTestId('body')).toBeInTheDocument();
  });

  it('renders Back and Save buttons in the floating footer', () => {
    renderShell();
    // SecondaryScreenShell portals the floating action; assert at the
    // document scope rather than the inner container.
    expect(document.body.querySelectorAll('button').length).toBeGreaterThanOrEqual(2);
  });

  it('fires onBack when the floating Back button is clicked', () => {
    const { onBack } = renderShell();
    const backButtons = Array.from(
      document.body.querySelectorAll('button'),
    ).filter((b) => /back/i.test(b.textContent ?? ''));
    expect(backButtons.length).toBeGreaterThan(0);
    fireEvent.click(backButtons[0]);
    expect(onBack).toHaveBeenCalled();
  });

  it('fires onSave when the floating Save button is clicked', () => {
    const { onSave } = renderShell({ canSave: true });
    const saveButton = Array.from(
      document.body.querySelectorAll('button'),
    ).find((b) => /save/i.test(b.textContent ?? ''));
    expect(saveButton).toBeDefined();
    fireEvent.click(saveButton!);
    expect(onSave).toHaveBeenCalled();
  });

  it('disables Save when canSave is false', () => {
    const { onSave } = renderShell({ canSave: false });
    const saveButton = Array.from(
      document.body.querySelectorAll('button'),
    ).find((b) => /save/i.test(b.textContent ?? ''));
    expect(saveButton).toBeDefined();
    expect(saveButton!.hasAttribute('disabled')).toBe(true);
    fireEvent.click(saveButton!);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('does not crash when onSave returns a Promise (covers async save handlers)', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    renderShell({ onSave });
    const saveButton = Array.from(
      document.body.querySelectorAll('button'),
    ).find((b) => /save/i.test(b.textContent ?? ''));
    fireEvent.click(saveButton!);
    expect(onSave).toHaveBeenCalled();
    // Wait for the promise queue to drain so unhandled-rejection
    // listeners (vitest installs them) don't fire.
    await Promise.resolve();
  });
});
