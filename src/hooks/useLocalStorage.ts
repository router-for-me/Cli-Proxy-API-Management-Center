/**
 * LocalStorage Hook
 */

import { useCallback, useState } from 'react';

export function useLocalStorage<T>(
  key: string,
  initialValue: T | (() => T)
): [T, (value: T | ((val: T) => T)) => void] {
  const [storedValue, setStoredValue] = useState<T>(() => {
    // Like useState, a function initial value is called only when nothing is stored.
    const resolveInitial = () => (initialValue instanceof Function ? initialValue() : initialValue);
    try {
      const item = window.localStorage.getItem(key);
      return item ? (JSON.parse(item) as T) : resolveInitial();
    } catch (error) {
      console.error(`Error reading localStorage key "${key}":`, error);
      return resolveInitial();
    }
  });

  const setValue = useCallback(
    (value: T | ((val: T) => T)) => {
      setStoredValue((currentValue) => {
        const valueToStore = value instanceof Function ? value(currentValue) : value;

        try {
          window.localStorage.setItem(key, JSON.stringify(valueToStore));
        } catch (error) {
          console.error(`Error setting localStorage key "${key}":`, error);
        }

        return valueToStore;
      });
    },
    [key]
  );

  return [storedValue, setValue];
}
