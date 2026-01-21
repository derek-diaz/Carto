export class RingBuffer<T> {
  private items: T[] = [];
  private maxSize: number;

  constructor(maxSize: number) {
    this.maxSize = Math.max(1, maxSize);
  }

  setMaxSize(maxSize: number): void {
    this.maxSize = Math.max(1, maxSize);
    if (this.items.length > this.maxSize) {
      this.items = this.items.slice(this.items.length - this.maxSize);
    }
  }

  push(item: T): void {
    this.items.push(item);
    if (this.items.length > this.maxSize) {
      this.items.shift();
    }
  }

  clear(): void {
    this.items = [];
  }

  toArray(): T[] {
    return [...this.items];
  }

  size(): number {
    return this.items.length;
  }
}
