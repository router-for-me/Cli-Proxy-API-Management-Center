/**
 * Payload Presets Hook
 *
 * Manages saving and loading payload rule presets in localStorage.
 */

import { useCallback } from 'react';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import type { PayloadPreset } from '@/types/visualConfig';
import { makeClientId } from '@/types/visualConfig';

const STORAGE_KEY = 'payloadPresets';

type PresetRules = Pick<
  PayloadPreset,
  | 'payloadDefaultRules'
  | 'payloadDefaultRawRules'
  | 'payloadOverrideRules'
  | 'payloadOverrideRawRules'
  | 'payloadFilterRules'
>;

export function usePayloadPresets() {
  const [presets, setPresets] = useLocalStorage<PayloadPreset[]>(STORAGE_KEY, []);

  const savePreset = useCallback(
    (
      name: string,
      currentRules: PresetRules,
    ) => {
      const deep = <T>(v: T): T => structuredClone(v);

      setPresets((prev) => {
        const existing = prev.findIndex((p) => p.name === name);
        const entry: PayloadPreset = {
          id: existing >= 0 ? prev[existing].id : makeClientId(),
          name,
          payloadDefaultRules: deep(currentRules.payloadDefaultRules),
          payloadDefaultRawRules: deep(currentRules.payloadDefaultRawRules),
          payloadOverrideRules: deep(currentRules.payloadOverrideRules),
          payloadOverrideRawRules: deep(currentRules.payloadOverrideRawRules),
          payloadFilterRules: deep(currentRules.payloadFilterRules),
          createdAt: existing >= 0 ? prev[existing].createdAt : Date.now(),
        };

        if (existing >= 0) {
          const next = [...prev];
          next[existing] = entry;
          return next;
        }
        return [...prev, entry];
      });

      return name;
    },
    [setPresets],
  );

  const applyPreset = useCallback(
    (id: string): PresetRules | null => {
      const preset = presets.find((p) => p.id === id);
      if (!preset) return null;
      const deep = <T>(v: T): T => structuredClone(v);
      return {
        payloadDefaultRules: deep(preset.payloadDefaultRules),
        payloadDefaultRawRules: deep(preset.payloadDefaultRawRules),
        payloadOverrideRules: deep(preset.payloadOverrideRules),
        payloadOverrideRawRules: deep(preset.payloadOverrideRawRules),
        payloadFilterRules: deep(preset.payloadFilterRules),
      };
    },
    [presets],
  );

  const deletePreset = useCallback(
    (id: string) => {
      setPresets((prev) => prev.filter((p) => p.id !== id));
    },
    [setPresets],
  );

  const renamePreset = useCallback(
    (id: string, newName: string) => {
      setPresets((prev) =>
        prev.map((p) => (p.id === id ? { ...p, name: newName } : p)),
      );
    },
    [setPresets],
  );

  const presetExists = useCallback(
    (name: string): boolean => presets.some((p) => p.name === name),
    [presets],
  );

  return { presets, savePreset, applyPreset, deletePreset, renamePreset, presetExists } as const;
}
