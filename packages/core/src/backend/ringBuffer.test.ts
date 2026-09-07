import { describe, expect, it } from 'vitest';
import { createRingBuffer } from './ringBuffer';
describe('ring buffer retention', () => {
  it('retains chronological order through wraps, shrinking, growing and clearing', () => {
    const buffer = createRingBuffer<number>(3);
    for (let i = 0; i < 10; i++) buffer.push(i);
    expect(buffer.toArray()).toEqual([7, 8, 9]);
    buffer.setMaxSize(2);
    expect(buffer.toArray()).toEqual([8, 9]);
    buffer.setMaxSize(4);
    buffer.push(10);
    buffer.push(11);
    buffer.push(12);
    expect(buffer.toArray()).toEqual([9, 10, 11, 12]);
    buffer.clear();
    expect(buffer.size()).toBe(0);
    buffer.push(13);
    expect(buffer.toArray()).toEqual([13]);
  });
  it('does not expose its internal storage to callers', () => {
    const buffer = createRingBuffer<number>(2);
    buffer.push(1);
    buffer.toArray().push(2);
    expect(buffer.toArray()).toEqual([1]);
  });
});
