import type { PropsWithChildren, ReactNode } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from './dialog';

interface ModalProps {
  open: boolean;
  title?: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
  width?: number | string;
}

export function Modal({ 
  open, 
  title, 
  onClose, 
  footer, 
  width = 520, 
  children 
}: PropsWithChildren<ModalProps>) {
  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent 
        className="gap-0 p-0" 
        style={{ maxWidth: typeof width === 'number' ? `${width}px` : width }}
        showCloseButton={true}
      >
        {title && (
          <DialogHeader className="px-4 py-3 border-b border-border">
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
        )}
        <div className="p-4 text-xs space-y-4">{children}</div>
        {footer && (
          <DialogFooter className="px-4 py-3 border-t border-border">
            {footer}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
