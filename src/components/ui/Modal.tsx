import { useState, useEffect, useCallback, type PropsWithChildren, type ReactNode } from 'react';
import { IconX } from './icons';

interface ModalProps {
  open: boolean;
  title?: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
  width?: number | string;
}

const CLOSE_ANIMATION_DURATION = 350;

export function Modal({ open, title, onClose, footer, width = 520, children }: PropsWithChildren<ModalProps>) {
  const [isVisible, setIsVisible] = useState(false);
  const [isClosing, setIsClosing] = useState(false);

  useEffect(() => {
    if (open) {
      setIsVisible(true);
      setIsClosing(false);
    }
  }, [open]);

  const handleClose = useCallback(() => {
    setIsClosing(true);
    setTimeout(() => {
      setIsVisible(false);
      setIsClosing(false);
      onClose();
    }, CLOSE_ANIMATION_DURATION);
  }, [onClose]);

  if (!open && !isVisible) return null;

  const overlayClass = `modal-overlay ${isClosing ? 'modal-overlay-closing' : 'modal-overlay-entering'}`;
  const modalClass = `modal ${isClosing ? 'modal-closing' : 'modal-entering'}`;

  return (
    <div className={overlayClass}>
      <div className={modalClass} style={{ width }} role="dialog" aria-modal="true">
        <button className="modal-close-floating" onClick={handleClose} aria-label="Close">
          <IconX size={20} />
        </button>
        <div className="modal-header">
          <div className="modal-title">{title}</div>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}
