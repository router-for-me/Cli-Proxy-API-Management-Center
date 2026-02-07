import { useState, useEffect, useCallback, useRef, type PropsWithChildren, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { IconX } from './icons';

interface ModalProps {
  open: boolean;
  title?: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
  width?: number | string;
  className?: string;
  closeDisabled?: boolean;
}

const CLOSE_ANIMATION_DURATION = 350;
const MODAL_LOCK_CLASS = 'modal-open';
let activeModalCount = 0;

const scrollLockSnapshot = {
  scrollY: 0,
  contentScrollTop: 0,
  contentEl: null as HTMLElement | null,
  bodyPosition: '',
  bodyTop: '',
  bodyLeft: '',
  bodyRight: '',
  bodyWidth: '',
  bodyOverflow: '',
  htmlOverflow: '',
};

const resolveContentScrollContainer = () => {
  if (typeof document === 'undefined') return null;
  const contentEl = document.querySelector('.content');
  return contentEl instanceof HTMLElement ? contentEl : null;
};

const lockScroll = () => {
  if (typeof document === 'undefined') return;
  if (activeModalCount === 0) {
    const body = document.body;
    const html = document.documentElement;
    const contentEl = resolveContentScrollContainer();

    scrollLockSnapshot.scrollY = window.scrollY || window.pageYOffset || html.scrollTop || 0;
    scrollLockSnapshot.contentEl = contentEl;
    scrollLockSnapshot.contentScrollTop = contentEl?.scrollTop ?? 0;
    scrollLockSnapshot.bodyPosition = body.style.position;
    scrollLockSnapshot.bodyTop = body.style.top;
    scrollLockSnapshot.bodyLeft = body.style.left;
    scrollLockSnapshot.bodyRight = body.style.right;
    scrollLockSnapshot.bodyWidth = body.style.width;
    scrollLockSnapshot.bodyOverflow = body.style.overflow;
    scrollLockSnapshot.htmlOverflow = html.style.overflow;

    body.classList.add(MODAL_LOCK_CLASS);
    html.classList.add(MODAL_LOCK_CLASS);

    body.style.position = 'fixed';
    body.style.top = `-${scrollLockSnapshot.scrollY}px`;
    body.style.left = '0';
    body.style.right = '0';
    body.style.width = '100%';
    body.style.overflow = 'hidden';
    html.style.overflow = 'hidden';
  }
  activeModalCount += 1;
};

const unlockScroll = () => {
  if (typeof document === 'undefined') return;
  activeModalCount = Math.max(0, activeModalCount - 1);
  if (activeModalCount === 0) {
    const body = document.body;
    const html = document.documentElement;
    const scrollY = scrollLockSnapshot.scrollY;
    const contentScrollTop = scrollLockSnapshot.contentScrollTop;
    const contentEl = scrollLockSnapshot.contentEl;

    body.classList.remove(MODAL_LOCK_CLASS);
    html.classList.remove(MODAL_LOCK_CLASS);

    body.style.position = scrollLockSnapshot.bodyPosition;
    body.style.top = scrollLockSnapshot.bodyTop;
    body.style.left = scrollLockSnapshot.bodyLeft;
    body.style.right = scrollLockSnapshot.bodyRight;
    body.style.width = scrollLockSnapshot.bodyWidth;
    body.style.overflow = scrollLockSnapshot.bodyOverflow;
    html.style.overflow = scrollLockSnapshot.htmlOverflow;

    if (contentEl) {
      contentEl.scrollTo({ top: contentScrollTop, left: 0, behavior: 'auto' });
    }
    window.scrollTo({ top: scrollY, left: 0, behavior: 'auto' });

    scrollLockSnapshot.scrollY = 0;
    scrollLockSnapshot.contentScrollTop = 0;
    scrollLockSnapshot.contentEl = null;
  }
};

export function Modal({
  open,
  title,
  onClose,
  footer,
  width = 520,
  className,
  closeDisabled = false,
  children
}: PropsWithChildren<ModalProps>) {
  const [isVisible, setIsVisible] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const startClose = useCallback(
    (notifyParent: boolean) => {
      if (closeTimerRef.current !== null) return;
      setIsClosing(true);
      closeTimerRef.current = window.setTimeout(() => {
        setIsVisible(false);
        setIsClosing(false);
        closeTimerRef.current = null;
        if (notifyParent) {
          onClose();
        }
      }, CLOSE_ANIMATION_DURATION);
    },
    [onClose]
  );

  useEffect(() => {
    let cancelled = false;

    if (open) {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
      queueMicrotask(() => {
        if (cancelled) return;
        setIsVisible(true);
        setIsClosing(false);
      });
    } else if (isVisible) {
      queueMicrotask(() => {
        if (cancelled) return;
        startClose(false);
      });
    }

    return () => {
      cancelled = true;
    };
  }, [open, isVisible, startClose]);

  const handleClose = useCallback(() => {
    startClose(true);
  }, [startClose]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
      }
    };
  }, []);

  const shouldLockScroll = open || isVisible;

  useEffect(() => {
    if (!shouldLockScroll) return;
    lockScroll();
    return () => unlockScroll();
  }, [shouldLockScroll]);

  if (!open && !isVisible) return null;

  const overlayClass = `modal-overlay ${isClosing ? 'modal-overlay-closing' : 'modal-overlay-entering'}`;
  const modalClass = `modal ${isClosing ? 'modal-closing' : 'modal-entering'}${className ? ` ${className}` : ''}`;

  const modalContent = (
    <div className={overlayClass}>
      <div className={modalClass} style={{ width }} role="dialog" aria-modal="true">
        <button
          type="button"
          className="modal-close-floating"
          onClick={closeDisabled ? undefined : handleClose}
          aria-label="Close"
          disabled={closeDisabled}
        >
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

  if (typeof document === 'undefined') {
    return modalContent;
  }

  return createPortal(modalContent, document.body);
}
