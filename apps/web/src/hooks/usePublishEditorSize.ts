import { useEffect, useRef, useState } from 'react';
import { clampEditorHeight } from '../utils/publishComposer';
const KEY = 'carto.publish.editorHeight';
let sessionHeight = 280;
export function usePublishEditorSize() {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [height] = useState(() => {
    try {
      const value = localStorage.getItem(KEY);
      return value ? clampEditorHeight(Number(value)) : sessionHeight;
    } catch {
      return sessionHeight;
    }
  });
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const save = () => {
      try {
        localStorage.setItem(KEY, String(sessionHeight));
      } catch {
        /* Session sizing still works. */
      }
    };
    const observer = new ResizeObserver(() => {
      sessionHeight = clampEditorHeight(element.getBoundingClientRect().height);
      if (timer) clearTimeout(timer);
      timer = setTimeout(save, 200);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      if (timer) clearTimeout(timer);
      save();
    };
  }, []);
  return { ref, height };
}
