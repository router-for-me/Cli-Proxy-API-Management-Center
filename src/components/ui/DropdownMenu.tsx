import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import styles from './DropdownMenu.module.scss';

export interface DropdownMenuItem {
  key: string;
  label: ReactNode;
  icon?: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  tone?: 'default' | 'danger';
}

interface DropdownMenuProps {
  items: DropdownMenuItem[];
  ariaLabel: string;
  triggerLabel?: ReactNode;
  triggerIcon?: ReactNode;
  triggerClassName?: string;
  align?: 'start' | 'end';
  disabled?: boolean;
}

const MENU_OFFSET = 6;
const MIN_MENU_WIDTH = 168;
const VIEWPORT_PADDING = 8;

export function DropdownMenu({
  items,
  ariaLabel,
  triggerLabel,
  triggerIcon,
  triggerClassName,
  align = 'end',
  disabled = false,
}: DropdownMenuProps) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const menuId = useId();

  const enabledIndices = useMemo(
    () => items.map((item, index) => (item.disabled ? -1 : index)).filter((value) => value >= 0),
    [items]
  );

  const focusItem = useCallback((index: number) => {
    const node = itemRefs.current[index];
    if (node) {
      node.focus();
    }
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    setActiveIndex(-1);
    setPosition(null);
  }, []);

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const menuWidth = menuRef.current?.offsetWidth ?? MIN_MENU_WIDTH;
    const menuHeight = menuRef.current?.offsetHeight ?? 0;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let left = align === 'end' ? rect.right - menuWidth : rect.left;
    left = Math.max(VIEWPORT_PADDING, Math.min(left, viewportWidth - menuWidth - VIEWPORT_PADDING));

    let top = rect.bottom + MENU_OFFSET;
    if (top + menuHeight > viewportHeight - VIEWPORT_PADDING) {
      top = Math.max(VIEWPORT_PADDING, rect.top - menuHeight - MENU_OFFSET);
    }

    setPosition({ top, left });
  }, [align]);

  const open = useCallback(() => {
    if (disabled) return;
    setIsOpen(true);
    const firstEnabled = enabledIndices[0] ?? -1;
    setActiveIndex(firstEnabled);
  }, [disabled, enabledIndices]);

  useLayoutEffect(() => {
    if (!isOpen) return;
    // Measure trigger / menu DOM after open to position the portal-rendered menu.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    updatePosition();
  }, [isOpen, updatePosition]);

  useEffect(() => {
    if (!isOpen) return;

    const handlePointer = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (triggerRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      close();
    };

    const handleScroll = () => updatePosition();
    const handleResize = () => updatePosition();

    document.addEventListener('mousedown', handlePointer);
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleResize);

    return () => {
      document.removeEventListener('mousedown', handlePointer);
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleResize);
    };
  }, [close, isOpen, updatePosition]);

  useEffect(() => {
    if (!isOpen || activeIndex < 0) return;
    focusItem(activeIndex);
  }, [activeIndex, focusItem, isOpen]);

  const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      open();
    }
  };

  const moveActive = useCallback(
    (delta: 1 | -1) => {
      if (enabledIndices.length === 0) return;
      const currentPosition = enabledIndices.indexOf(activeIndex);
      const nextPosition =
        currentPosition === -1
          ? delta === 1
            ? 0
            : enabledIndices.length - 1
          : (currentPosition + delta + enabledIndices.length) % enabledIndices.length;
      setActiveIndex(enabledIndices[nextPosition]);
    },
    [activeIndex, enabledIndices]
  );

  const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        close();
        triggerRef.current?.focus();
        break;
      case 'ArrowDown':
        event.preventDefault();
        moveActive(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        moveActive(-1);
        break;
      case 'Home':
        event.preventDefault();
        if (enabledIndices.length > 0) setActiveIndex(enabledIndices[0]);
        break;
      case 'End':
        event.preventDefault();
        if (enabledIndices.length > 0) setActiveIndex(enabledIndices[enabledIndices.length - 1]);
        break;
      case 'Tab':
        close();
        break;
      default:
        break;
    }
  };

  const handleItemClick = (item: DropdownMenuItem) => {
    if (item.disabled) return;
    close();
    item.onClick();
  };

  const triggerClasses = [styles.trigger, isOpen ? styles.triggerOpen : '', triggerClassName]
    .filter(Boolean)
    .join(' ');

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={triggerClasses}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls={isOpen ? menuId : undefined}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => (isOpen ? close() : open())}
        onKeyDown={handleTriggerKeyDown}
      >
        {triggerIcon}
        {triggerLabel}
      </button>
      {isOpen && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={menuRef}
              id={menuId}
              role="menu"
              aria-label={ariaLabel}
              tabIndex={-1}
              className={styles.menu}
              style={
                position
                  ? { top: position.top, left: position.left }
                  : { visibility: 'hidden', top: 0, left: 0 }
              }
              onKeyDown={handleMenuKeyDown}
            >
              {items.map((item, index) => {
                const itemClasses = [
                  styles.item,
                  item.tone === 'danger' ? styles.itemDanger : '',
                  index === activeIndex ? styles.itemActive : '',
                ]
                  .filter(Boolean)
                  .join(' ');
                return (
                  <button
                    key={item.key}
                    ref={(node) => {
                      itemRefs.current[index] = node;
                    }}
                    type="button"
                    role="menuitem"
                    tabIndex={index === activeIndex ? 0 : -1}
                    className={itemClasses}
                    disabled={item.disabled}
                    onMouseEnter={() => !item.disabled && setActiveIndex(index)}
                    onClick={() => handleItemClick(item)}
                  >
                    {item.icon ? <span className={styles.itemIcon}>{item.icon}</span> : null}
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>,
            document.body
          )
        : null}
    </>
  );
}
