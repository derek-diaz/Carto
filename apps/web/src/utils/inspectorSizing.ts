export const MIN_INSPECTOR_HEIGHT = 200;
export const FALLBACK_MAX_INSPECTOR_HEIGHT = 1600;
export const MIN_STREAM_HEIGHT = 144;

export const clampInspectorHeight = (value: number, workspaceHeight?: number): number => {
  const viewportMax =
    workspaceHeight && Number.isFinite(workspaceHeight)
      ? Math.max(MIN_INSPECTOR_HEIGHT, workspaceHeight - MIN_STREAM_HEIGHT)
      : FALLBACK_MAX_INSPECTOR_HEIGHT;
  return Math.min(viewportMax, Math.max(MIN_INSPECTOR_HEIGHT, value));
};
