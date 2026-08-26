import { describe, expect, it } from 'vitest';
import { clampInspectorHeight } from './inspectorSizing';

describe('monitor inspector sizing', () => {
  it('uses the available workspace instead of a fixed 560px ceiling', () => {
    expect(clampInspectorHeight(1200, 1000)).toBe(856);
  });

  it('preserves the minimum inspector and stream working areas', () => {
    expect(clampInspectorHeight(40, 900)).toBe(200);
    expect(clampInspectorHeight(900, 700)).toBe(556);
  });
});
