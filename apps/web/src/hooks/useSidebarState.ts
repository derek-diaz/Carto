import { useState, useSyncExternalStore } from 'react';

const storageKey = 'carto.sidebarCollapsed';
const compactQuery = '(max-width: 980px)';
const subscribe = (onChange: () => void) => {
  const media = window.matchMedia(compactQuery);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
};
const getSnapshot = () => window.matchMedia(compactQuery).matches;

export function useSidebarState() {
  const compact = useSyncExternalStore(subscribe, getSnapshot, () => false);
  const [preference, setPreference] = useState<boolean | null>(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      return stored === 'true' ? true : stored === 'false' ? false : null;
    } catch {
      return null;
    }
  });
  const collapsed = preference ?? compact;
  const toggle = () => {
    const next = !collapsed;
    setPreference(next);
    try {
      localStorage.setItem(storageKey, String(next));
    } catch {
      // The sidebar still works when preferences cannot be saved.
    }
  };
  return { collapsed, toggle };
}
