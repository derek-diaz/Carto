export type RingBuffer<T> = {
  setMaxSize: (maxSize: number) => void;
  push: (item: T) => void;
  clear: () => void;
  toArray: () => T[];
  size: () => number;
};

export const createRingBuffer = <T>(maxSize: number): RingBuffer<T> => {
  let items: T[] = [];
  let capacity = Math.max(1, maxSize);

  const setMaxSize = (nextMaxSize: number): void => {
    capacity = Math.max(1, nextMaxSize);
    if (items.length > capacity) {
      items = items.slice(items.length - capacity);
    }
  };

  const push = (item: T): void => {
    items.push(item);
    if (items.length > capacity) {
      items.shift();
    }
  };

  const clear = (): void => {
    items = [];
  };

  const toArray = (): T[] => [...items];

  const size = (): number => items.length;

  return {
    setMaxSize,
    push,
    clear,
    toArray,
    size
  };
};
