import { describe, expect, it } from 'vitest';
import { clampInspectorHeight, DEFAULT_INSPECTOR_RATIO, inspectorBounds } from './inspectorSizing';

describe('monitor inspector sizing', () => {
  it('uses the available workspace instead of a fixed 560px ceiling', () => {
    expect(clampInspectorHeight(1200, 1000)).toBe(750);
  });

  it('preserves the minimum inspector and stream working areas', () => {
    expect(clampInspectorHeight(40, 900)).toBe(200);
    expect(clampInspectorHeight(900, 700)).toBe(450);
  });

  it.each([600, 900, 1400])('starts near 55/45 in a %ipx workspace', (height) => {
    expect(clampInspectorHeight(height * DEFAULT_INSPECTOR_RATIO, height)).toBe(height * 0.45);
  });

  it('fits both regions into windows shorter than their combined minimums', () => {
    const { min, max } = inspectorBounds(360);
    expect(min).toBe(160);
    expect(max).toBe(160);
    expect(clampInspectorHeight(900, 360)).toBe(160);
    expect(360 - max).toBe(200);
  });

  it('restores a preferred split after a temporarily small window', () => {
    const ratio = 0.6;
    expect(clampInspectorHeight(1000 * ratio, 1000)).toBe(600);
    expect(clampInspectorHeight(500 * ratio, 500)).toBe(250);
    expect(clampInspectorHeight(1000 * ratio, 1000)).toBe(600);
    expect(Number.isFinite(clampInspectorHeight(Number.NaN))).toBe(true);
  });
});
