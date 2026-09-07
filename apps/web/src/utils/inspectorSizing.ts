export const MIN_INSPECTOR_HEIGHT = 200;
export const FALLBACK_MAX_INSPECTOR_HEIGHT = 1600;
export const MIN_STREAM_HEIGHT = 250;
export const DEFAULT_INSPECTOR_RATIO = 0.45;

export const inspectorBounds = (workspaceHeight?: number) => {
  if (!workspaceHeight || !Number.isFinite(workspaceHeight) || workspaceHeight < 0)
    return { min: MIN_INSPECTOR_HEIGHT, max: FALLBACK_MAX_INSPECTOR_HEIGHT };
  // Both normal minimums cannot fit in a very short window. Scale them together.
  const scale = Math.min(1, workspaceHeight / (MIN_INSPECTOR_HEIGHT + MIN_STREAM_HEIGHT));
  return { min: MIN_INSPECTOR_HEIGHT * scale, max: workspaceHeight - MIN_STREAM_HEIGHT * scale };
};

export const clampInspectorHeight = (value: number, workspaceHeight?: number): number => {
  const { min, max } = inspectorBounds(workspaceHeight);
  const desired = Number.isFinite(value)
    ? value
    : (workspaceHeight ?? 800) * DEFAULT_INSPECTOR_RATIO;
  return Math.min(max, Math.max(min, desired));
};
