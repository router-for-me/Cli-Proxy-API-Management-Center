import { createContext, useContext } from 'react';
import { buildResetDisplay } from '@/utils/quota';
import { browserResetDisplay, type QuotaObservation } from './observationFormat';

export const AuthFileObservation = createContext<QuotaObservation | undefined>(undefined);

export function useAuthFileResetDisplay() {
  return useContext(AuthFileObservation) ? browserResetDisplay : buildResetDisplay;
}

export function useAuthFileTimeZone(at?: string) {
  const observation = useContext(AuthFileObservation);
  if (!observation) return undefined;
  const instant = at && Number.isFinite(Date.parse(at)) ? new Date(at) : new Date();
  return new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' })
    .formatToParts(instant)
    .find((part) => part.type === 'timeZoneName')?.value;
}
