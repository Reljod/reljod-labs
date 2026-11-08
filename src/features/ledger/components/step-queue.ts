/**
 * Steps arrive from the stream faster or slower than Ledger can play them.
 * The queue hands them over in order and ends once the stream is done.
 */
export class StepQueue<T> implements AsyncIterable<T> {
  private items: T[] = [];
  private closed = false;
  private wake: (() => void) | null = null;

  push(item: T) {
    this.items.push(item);
    this.wake?.();
  }

  close() {
    this.closed = true;
    this.wake?.();
  }

  static from<T>(items: T[]) {
    const queue = new StepQueue<T>();
    for (const item of items) queue.push(item);
    queue.close();
    return queue;
  }

  async *[Symbol.asyncIterator]() {
    while (true) {
      const next = this.items.shift();
      if (next !== undefined) {
        yield next;
        continue;
      }
      if (this.closed) return;
      await new Promise<void>((resolve) => {
        this.wake = resolve;
      });
      this.wake = null;
    }
  }
}
