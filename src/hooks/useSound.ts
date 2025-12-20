import { useState, useCallback, useEffect } from 'react';
import { sounds, isMuted, setMuted, toggleMute } from '@/lib/sound';

export const useSound = () => {
  const [muted, setMutedState] = useState(isMuted());

  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'cli-proxy-sound-muted') {
        setMutedState(e.newValue === 'true');
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const toggle = useCallback(() => {
    const newValue = toggleMute();
    setMutedState(newValue);
    return newValue;
  }, []);

  const setMute = useCallback((value: boolean) => {
    setMuted(value);
    setMutedState(value);
  }, []);

  return {
    muted,
    toggle,
    setMute,
    click: sounds.click,
    hover: sounds.hover,
    success: sounds.success,
    error: sounds.error,
    delete: sounds.delete,
    notify: sounds.notify,
    toggleSound: sounds.toggle,
  };
};

export default useSound;
