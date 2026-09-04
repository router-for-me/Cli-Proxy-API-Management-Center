import { useTranslation } from 'react-i18next';
import { IconBot } from '@/components/ui/icons';
import type { CredentialSessionSeatUsage } from '@/types';
import styles from './AuthFileSeatGlyphs.module.scss';

type AuthFileSeatGlyphsProps = {
  seats: CredentialSessionSeatUsage[];
  className?: string;
  maxVisible?: number;
};

const MAX_VISIBLE_SEATS = 64;

const stateClass = (seat: CredentialSessionSeatUsage): string => {
  const state = seat.state.trim().toLowerCase();
  if (state === 'frozen' || state === 'retiring' || state === 'disabled') {
    return styles.frozen;
  }
  if (state === 'claimed' || state === 'active' || state === 'in_use' || seat.activeRequests > 0) {
    return styles.inUse;
  }
  if (state === 'available' || state === 'idle') return styles.available;
  return styles.frozen;
};

const statusKey = (seat: CredentialSessionSeatUsage): string => {
  const state = seat.state.trim().toLowerCase();
  if (state === 'frozen' || state === 'retiring' || state === 'disabled') {
    return `auth_files.session_seat_status_${state}`;
  }
  if (state === 'claimed' || state === 'active' || state === 'in_use' || seat.activeRequests > 0) {
    return 'auth_files.session_seat_status_claimed';
  }
  if (state === 'available' || state === 'idle') return 'auth_files.session_seat_status_available';
  return `auth_files.session_seat_status_${state}`;
};

export function AuthFileSeatGlyphs({
  seats,
  className,
  maxVisible = MAX_VISIBLE_SEATS,
}: AuthFileSeatGlyphsProps) {
  const { t } = useTranslation();
  if (seats.length === 0) return null;

  const visibleSeats = seats.slice(0, Math.max(1, maxVisible));
  const hiddenCount = Math.max(0, seats.length - visibleSeats.length);
  const classes = [styles.glyphs, className].filter(Boolean).join(' ');

  return (
    <span
      className={classes}
      role="group"
      aria-label={t('auth_files.session_seat_glyphs_label', { count: seats.length })}
    >
      {visibleSeats.map((seat) => {
        const status = t(statusKey(seat), { defaultValue: seat.state || 'unknown' });
        const tooltip = t('auth_files.session_seat_glyph_tooltip', {
          seatId: seat.seatId,
          status,
          sessions: seat.sessions.length,
          requests: seat.activeRequests,
        });
        return (
          <span
            className={`${styles.glyph} ${stateClass(seat)}`}
            key={seat.seatId}
            data-tooltip={tooltip}
            aria-label={tooltip}
            role="img"
            tabIndex={0}
          >
            <IconBot size={13} />
          </span>
        );
      })}
      {hiddenCount > 0 && (
        <span
          className={styles.overflow}
          data-tooltip={t('auth_files.session_seat_glyphs_overflow', { count: hiddenCount })}
          aria-label={t('auth_files.session_seat_glyphs_overflow', { count: hiddenCount })}
          role="img"
          tabIndex={0}
        >
          +{hiddenCount}
        </span>
      )}
    </span>
  );
}
