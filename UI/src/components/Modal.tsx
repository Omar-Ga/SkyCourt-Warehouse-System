import React, { useEffect, useRef, useSyncExternalStore } from 'react';
import { X } from 'lucide-react';
import ReactDOM from 'react-dom';

type ModalProps = {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  footer?: React.ReactNode;
  primaryActionText?: string;
  onPrimaryAction?: () => void;
  isPrimaryActionDisabled?: boolean;
  secondaryActionText?: string;
  onSecondaryAction?: () => void;
};

// Module-level modal stack for reactive stacking, z-index hierarchy, and topmost dismissal
let modalStack: string[] = [];
const stackListeners = new Set<() => void>();

function notifyStack() {
  stackListeners.forEach((fn) => fn());
}

function pushModal(id: string) {
  if (!modalStack.includes(id)) {
    modalStack = [...modalStack, id];
    notifyStack();
  }
}

function removeModal(id: string) {
  if (modalStack.includes(id)) {
    modalStack = modalStack.filter((m) => m !== id);
    notifyStack();
  }
}

function subscribeModalStack(listener: () => void) {
  stackListeners.add(listener);
  return () => {
    stackListeners.delete(listener);
  };
}

function getModalStackSnapshot() {
  return modalStack;
}

export const Modal = ({ 
  isOpen, 
  onClose, 
  title, 
  children, 
  size = 'md', 
  footer,
  primaryActionText,
  onPrimaryAction,
  isPrimaryActionDisabled,
  secondaryActionText,
  onSecondaryAction
}: ModalProps) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);
  const mouseDownOnBackdrop = useRef(false);

  const idRef = useRef<string>('');
  if (!idRef.current) {
    idRef.current = 'modal_' + Math.random().toString(36).substring(2, 9);
  }
  const modalId = idRef.current;

  // Subscribe to modal stack reactively
  const stack = useSyncExternalStore(subscribeModalStack, getModalStackSnapshot);
  const stackIndex = stack.indexOf(modalId);
  const isTopmost = stack.length > 0 && stack[stack.length - 1] === modalId;
  const backdropZIndex = 50 + (stackIndex >= 0 ? stackIndex : 0) * 10;

  // Track active modal in stack and manage body scroll lock
  useEffect(() => {
    if (isOpen) {
      pushModal(modalId);
      document.body.style.overflow = 'hidden';

      return () => {
        removeModal(modalId);
        if (modalStack.length === 0) {
          document.body.style.overflow = 'unset';
        }
      };
    } else {
      removeModal(modalId);
      if (modalStack.length === 0) {
        document.body.style.overflow = 'unset';
      }
    }
  }, [isOpen, modalId]);

  // Focus management: capture previous active element, set initial focus, restore on close
  useEffect(() => {
    if (isOpen) {
      previousActiveElement.current = document.activeElement as HTMLElement;
      requestAnimationFrame(() => {
        if (!modalRef.current) return;
        const focusables = modalRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        const visible = Array.from(focusables).filter(
          (el) => el.offsetParent !== null || el.offsetWidth > 0 || el.offsetHeight > 0
        );
        if (visible.length > 0) {
          visible[0].focus();
        }
      });
    } else if (previousActiveElement.current) {
      previousActiveElement.current.focus?.();
      previousActiveElement.current = null;
    }

    return () => {
      if (previousActiveElement.current) {
        previousActiveElement.current.focus?.();
        previousActiveElement.current = null;
      }
    };
  }, [isOpen]);

  // Keyboard navigation: Escape key & focus wrap (topmost modal only)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isTopmost) return;

      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }

      if (e.key === 'Tab' && modalRef.current) {
        const focusable = modalRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        const visible = Array.from(focusable).filter(
          (el) => el.offsetParent !== null || el.offsetWidth > 0 || el.offsetHeight > 0
        );
        if (visible.length === 0) {
          e.preventDefault();
          return;
        }

        const firstElement = visible[0];
        const lastElement = visible[visible.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === firstElement || !modalRef.current.contains(document.activeElement)) {
            lastElement.focus();
            e.preventDefault();
          }
        } else {
          if (document.activeElement === lastElement || !modalRef.current.contains(document.activeElement)) {
            firstElement.focus();
            e.preventDefault();
          }
        }
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, isTopmost, onClose]);

  // Backdrop mouse handlers: dismiss on genuine backdrop click (not dragging from inside modal)
  const handleBackdropMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      mouseDownOnBackdrop.current = true;
    } else {
      mouseDownOnBackdrop.current = false;
    }
  };

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget && mouseDownOnBackdrop.current && isTopmost) {
      onClose();
    }
    mouseDownOnBackdrop.current = false;
  };

  if (!isOpen) return null;

  const sizeClasses = {
    sm: 'max-w-md',
    md: 'max-w-2xl',
    lg: 'max-w-4xl',
    xl: 'max-w-6xl',
  };

  const hasFooter = footer || primaryActionText || secondaryActionText;

  const content = (
    <div 
      className="modal-backdrop animate-fade-in"
      style={{ zIndex: backdropZIndex }}
      onMouseDown={handleBackdropMouseDown}
      onClick={handleBackdropClick}
    >
      <div 
        ref={modalRef}
        className={`modal animate-scale-in ${sizeClasses[size]}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2 id="modal-title" className="text-xl font-semibold m-0">{title}</h2>
          <button 
            type="button"
            onClick={onClose}
            className="p-1 rounded-full hover:bg-gray-100 transition-colors"
            aria-label="إغلاق"
          >
            <X size={20} />
          </button>
        </div>
        <div className="modal-content">
          {children}
        </div>
        {hasFooter && (
          <div className="modal-footer">
            {footer}
            {secondaryActionText && (
              <button type="button" className="btn btn-outline" onClick={onSecondaryAction || onClose}>
                {secondaryActionText}
              </button>
            )}
            {primaryActionText && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={onPrimaryAction}
                disabled={isPrimaryActionDisabled}
              >
                {primaryActionText}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );

  return ReactDOM.createPortal(content, document.getElementById('modal-root') || document.body);
};