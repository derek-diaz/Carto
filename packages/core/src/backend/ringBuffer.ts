export type RingBuffer<T> = {
  setMaxSize: (maxSize: number) => void;
  push: (item: T) => void;
  clear: () => void;
  toArray: () => T[];
  size: () => number;
};

export const createRingBuffer = <T>(maxSize: number): RingBuffer<T> => {
  const normalize = (value: number) =>
    Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1;
  let capacity = normalize(maxSize);
  let items: T[] = [];
  let start = 0;
  let count = 0;
  const toArray = (): T[] =>
    Array.from({ length: count }, (_, index) => items[(start + index) % capacity]);
  const setMaxSize = (nextMaxSize: number): void => {
    const next = normalize(nextMaxSize);
    if (next === capacity) return;
    items = toArray().slice(-next);
    capacity = next;
    count = items.length;
    start = 0;
  };
  const push = (item: T): void => {
    items[(start + count) % capacity] = item;
    if (count < capacity) count++;
    else start = (start + 1) % capacity;
  };
  const clear = (): void => {
    items = [];
    start = 0;
    count = 0;
  };
  return { setMaxSize, push, clear, toArray, size: () => count };
};
