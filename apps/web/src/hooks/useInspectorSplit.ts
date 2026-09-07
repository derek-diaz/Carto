import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import {
  clampInspectorHeight,
  DEFAULT_INSPECTOR_RATIO,
  inspectorBounds
} from '../utils/inspectorSizing';

const RATIO_KEY = 'carto.monitor.inspectorRatio.v1';
const LEGACY_HEIGHT_KEY = 'carto.monitor.inspectorHeight.v3';
const readPreference = () => {
  try {
    const ratio = Number(localStorage.getItem(RATIO_KEY));
    const height = Number(localStorage.getItem(LEGACY_HEIGHT_KEY));
    return {
      ratio: ratio > 0 && ratio < 1 ? ratio : null,
      height: height > 0 && Number.isFinite(height) ? height : null
    };
  } catch {
    return { ratio: null, height: null };
  }
};

export function useInspectorSplit(active: boolean, resizable: boolean) {
  const [preference] = useState(readPreference);
  const ratioRef = useRef(preference.ratio);
  const workspaceRef = useRef<HTMLElement | null>(null);
  const [size, setSize] = useState({ height: preference.height ?? 360, workspace: 0 });
  const heightRef = useRef(size.height);
  const [expanded, setExpanded] = useState(false);
  const dragCleanup = useRef<(() => void) | null>(null);

  useLayoutEffect(() => {
    const workspace = workspaceRef.current;
    if (!active || !workspace) return;
    const measure = () => {
      if (dragCleanup.current) return;
      const available = workspace.getBoundingClientRect().height;
      if (!available) return;
      // Adopt the existing saved pixel height once, then resize proportionally.
      if (ratioRef.current === null)
        ratioRef.current = preference.height
          ? clampInspectorHeight(preference.height, available) / available
          : DEFAULT_INSPECTOR_RATIO;
      const height = clampInspectorHeight(ratioRef.current * available, available);
      heightRef.current = height;
      workspace.style.setProperty('--monitor-inspector-height', `${height}px`);
      setSize((previous) =>
        previous.height === height && previous.workspace === available
          ? previous
          : { height, workspace: available }
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(workspace);
    return () => {
      observer.disconnect();
      dragCleanup.current?.();
    };
  }, [active, resizable, preference]);
  useEffect(() => () => dragCleanup.current?.(), []);

  const commit = (height: number, available: number) => {
    heightRef.current = height;
    ratioRef.current = height / available;
    setSize({ height, workspace: available });
    workspaceRef.current?.style.setProperty('--monitor-inspector-height', `${height}px`);
    try {
      localStorage.setItem(RATIO_KEY, String(ratioRef.current));
      localStorage.setItem(LEGACY_HEIGHT_KEY, String(Math.round(height)));
    } catch {
      /* Keep the session preference when storage is unavailable. */
    }
  };
  const onResizeStart = (event: PointerEvent<HTMLButtonElement>) => {
    if (!resizable || event.button !== 0 || !event.isPrimary) return;
    const workspace = workspaceRef.current;
    if (!workspace) return;
    event.preventDefault();
    const handle = event.currentTarget;
    handle.focus();
    dragCleanup.current?.();
    handle.setPointerCapture(event.pointerId);
    const pointerId = event.pointerId;
    const available = workspace.getBoundingClientRect().height;
    const startHeight = expanded ? available : heightRef.current;
    const startY = event.clientY;
    let nextHeight = heightRef.current;
    let frame = 0;
    let moved = false;
    const paint = () => {
      frame = 0;
      workspace.style.setProperty('--monitor-inspector-height', `${nextHeight}px`);
    };
    const move = (next: globalThis.PointerEvent) => {
      if (next.pointerId !== pointerId || (next.clientY === startY && !moved)) return;
      if (!moved) {
        moved = true;
        setExpanded(false);
        workspace.dataset.resizing = 'true';
      }
      nextHeight = clampInspectorHeight(startHeight + startY - next.clientY, available);
      if (!frame) frame = requestAnimationFrame(paint);
    };
    const cleanup = () => {
      if (frame) cancelAnimationFrame(frame);
      delete workspace.dataset.resizing;
      globalThis.removeEventListener('pointermove', move);
      globalThis.removeEventListener('pointerup', end);
      globalThis.removeEventListener('pointercancel', end);
      if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
      dragCleanup.current = null;
    };
    const end = (next: globalThis.PointerEvent) => {
      if (next.pointerId !== pointerId) return;
      cleanup();
      if (moved) commit(nextHeight, available);
    };
    dragCleanup.current = cleanup;
    globalThis.addEventListener('pointermove', move);
    globalThis.addEventListener('pointerup', end);
    globalThis.addEventListener('pointercancel', end);
  };
  const onResizeKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!resizable) return;
    const available = workspaceRef.current?.getBoundingClientRect().height;
    if (!available) return;
    const step = event.shiftKey ? 48 : 24;
    const bounds = inspectorBounds(available);
    const target = {
      ArrowUp: heightRef.current + step,
      ArrowDown: heightRef.current - step,
      Home: bounds.min,
      End: bounds.max
    }[event.key];
    if (target === undefined) return;
    event.preventDefault();
    setExpanded(false);
    commit(clampInspectorHeight(target, available), available);
  };
  const bounds = inspectorBounds(size.workspace);
  return {
    workspaceRef,
    height: size.height,
    expanded,
    onResizeStart,
    onResizeKeyDown,
    toggleExpanded: () => setExpanded((previous) => !previous),
    close: () => setExpanded(false),
    separator: {
      min: Math.round(bounds.min),
      max: Math.round(bounds.max),
      value: Math.round(size.height)
    }
  };
}
