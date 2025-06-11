/**
 * A queue for managing buffered data that allows pushing and popping of data chunks.
 */
export default class BufferQueue {
  private buffer: Uint8Array;
  private bufferStart: number;
  private bufferEnd: number;
  private pendingPops: { min_len: number, max_len: number }[];
  private pendingPopsResolvers: {
    resolve: ((value: Uint8Array) => void),
    reject: (e: Error) => void,
  }[];
  private closed: boolean = false;

  constructor(initialCapacity: number = 1024) {
    this.buffer = new Uint8Array(initialCapacity);
    this.bufferStart = 0;
    this.bufferEnd = 0;
    this.pendingPops = [];
    this.pendingPopsResolvers = [];
  }

  /**
   * Ensures that the buffer has enough capacity to accommodate additional bytes.
   * If not, it resizes the buffer by doubling its current size.
   * @param additionalLength - The additional length of data to be accommodated.
   */
  private _ensureCapacity(additionalLength: number): void {
    const required = this.bufferEnd + additionalLength;
    if (required > this.buffer.length) {
      let newLength = this.buffer.length * 2;
      while (newLength < required) {
        newLength *= 2;
      }
      const newBuffer = new Uint8Array(newLength);
      newBuffer.set(this.buffer.subarray(this.bufferStart, this.bufferEnd));
      this.bufferEnd -= this.bufferStart;
      this.bufferStart = 0;
      this.buffer = newBuffer;
    }
  }

  /**
   * Pushes new data into the buffer and resolves any pending pop requests if possible.
   * @param data - The data to push into the buffer (must be a Uint8Array).
   */
  push(data: Uint8Array): void {
    if (!(data instanceof Uint8Array)) {
      throw new TypeError('Data must be a Uint8Array');
    }

    if (this.closed) {
      throw new Error('Buffer is closed');
    }

    this._ensureCapacity(data.length);
    this.buffer.set(data, this.bufferEnd);
    this.bufferEnd += data.length;
    this._resolvePendingPops();
  }

  /**
   * Pops a specified number of bytes from the buffer.
   * Returns a Promise that resolves with a Uint8Array of the requested length.
   * @param len - The number of bytes to pop from the buffer.
   * @returns A promise resolving with the popped data as a Uint8Array.
   */
  pop(min_len: number, max_len: number): Promise<Uint8Array> {
    if (typeof min_len !== 'number' || typeof max_len !== 'number' || min_len < 0 || max_len < 0 || min_len > max_len) {
      return Promise.reject(new Error('Invalid min/max lengths'));
    }

    if (this.bufferEnd - this.bufferStart >= min_len) {
      const available_len = this.bufferEnd - this.bufferStart;
      const provide_len = Math.min(max_len, available_len);
      const result = this.buffer.slice(this.bufferStart, this.bufferStart + provide_len);
      this.bufferStart += result.length;
      this._compactBuffer();
      return Promise.resolve(result);
    } else if (!this.closed) {
      return new Promise((resolve, reject) => {
        this.pendingPops.push({ min_len, max_len });
        this.pendingPopsResolvers.push({ resolve, reject });
      });
    } else {
      return Promise.reject(new Error('Buffer is closed'));
    }
  }

  /**
   * Closes the buffer queue, preventing any further data from being pushed.
   */
  close(): void {
    this.closed = true;

    if (this.pendingPops.length > 0) {
      this._rejectPendingPops(new Error('Buffer is closed'));
    }
  }

  /**
   * Checks if the buffer queue is closed.
   * @returns True if the buffer queue is closed, false otherwise.
   */
  isClosed(): boolean {
    return this.closed;
  }

  /**
   * Resolves pending pop requests if enough data is available in the buffer.
   */
  private _resolvePendingPops(): void {
    while (this.pendingPops.length > 0) {
      const { min_len, max_len } = this.pendingPops[0];
      if (this.bufferEnd - this.bufferStart >= min_len) {
        const available_len = this.bufferEnd - this.bufferStart;
        const provide_len = Math.min(max_len, available_len);
        const data = this.buffer.slice(this.bufferStart, this.bufferStart + provide_len);
        this.bufferStart += data.length;
        this.pendingPops.shift();
        const { resolve } = this.pendingPopsResolvers.shift()!;
        resolve(data);
      } else {
        break;
      }
    }
    this._compactBuffer();
  }

  private _rejectPendingPops(error: Error): void {
    while (this.pendingPops.length > 0) {
      this.pendingPops.shift();
      const { reject } = this.pendingPopsResolvers.shift()!;
      reject(error);
    }
  }

  /**
   * Compacts the buffer by resetting the start and end pointers if all data has been consumed.
   */
  private _compactBuffer(): void {
    if (this.bufferStart === this.bufferEnd) {
      this.bufferStart = 0;
      this.bufferEnd = 0;
    } else if (this.bufferStart > 0) {
      this.buffer.set(this.buffer.subarray(this.bufferStart, this.bufferEnd));
      this.bufferEnd -= this.bufferStart;
      this.bufferStart = 0;
    }
  }
}
