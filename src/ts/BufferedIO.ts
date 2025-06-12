import { EventEmitter } from "ee-typed";
import BufferQueue from "./BufferQueue.js";
import { IO } from "./types";
import assert from "./assert.js";

export default class BufferedIO
  extends EventEmitter<{ error(e: Error): void }>
  implements IO
{
  private bq = { a: new BufferQueue(), b: new BufferQueue() };

  constructor(
    public otherParty: number,
    public send: IO['send'],
    private closeOther?: IO['close'],
  ) {
    super();
  }

  close() {
    if (this.bq.a.isClosed() && this.bq.b.isClosed()) {
      return;
    }

    this.bq.a.close();
    this.bq.b.close();
    this.closeOther?.();
  }

  async recv(fromParty: number, channel: 'a' | 'b', min_len: number, max_len: number): Promise<Uint8Array> {
    assert(fromParty === this.otherParty, 'fromParty !== this.otherParty');
    return await this.bq[channel].pop(min_len, max_len);
  }

  accept(channel: 'a' | 'b', data: Uint8Array) {
    this.bq[channel].push(data);
  }
}
