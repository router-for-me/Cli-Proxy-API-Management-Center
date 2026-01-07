import { useState, useCallback } from 'react';

export interface ConfirmState {
  open: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  confirmVariant?: 'primary' | 'danger';
  loading?: boolean;
  onConfirm: () => void | Promise<void>;
}

const initialState: ConfirmState = {
  open: false,
  title: '',
  message: '',
  onConfirm: () => {},
};

/**
 * Hook for managing confirmation modal state.
 * Usage:
 * ```tsx
 * const { confirmState, openConfirm, closeConfirm, setLoading } = useConfirmModal();
 * 
 * const handleDelete = () => {
 *   openConfirm({
 *     title: 'Delete Item',
 *     message: 'Are you sure?',
 *     confirmVariant: 'danger',
 *     onConfirm: async () => {
 *       setLoading(true);
 *       await deleteItem();
 *       closeConfirm();
 *     }
 *   });
 * };
 * 
 * <ConfirmModal {...confirmState} onCancel={closeConfirm} />
 * ```
 */
export function useConfirmModal() {
  const [confirmState, setConfirmState] = useState<ConfirmState>(initialState);

  const openConfirm = useCallback((config: Omit<ConfirmState, 'open'>) => {
    setConfirmState({ ...config, open: true, loading: false });
  }, []);

  const closeConfirm = useCallback(() => {
    setConfirmState(initialState);
  }, []);

  const setLoading = useCallback((loading: boolean) => {
    setConfirmState(prev => ({ ...prev, loading }));
  }, []);

  return {
    confirmState,
    openConfirm,
    closeConfirm,
    setLoading,
  };
}
