import { EventEmitter } from "ee-typed";
import type { IO } from "./types";
import workerCode from "./workerCode.js";
import nodeSecureMPC from "./nodeSecureMPC.js";

export type SecureMPC = typeof secureMPC;

const getWorkerUrl = (() => {
  let url: string | undefined;

  return () => {
    if (!url) {
      const blob = new Blob([workerCode], { type: 'application/javascript' });
      url = URL.createObjectURL(blob);
    }

    return url;
  }
})();

export default function secureMPC({
  party, size, circuit, inputBits, inputBitsPerParty, io, mode = 'auto',
}: {
  party: number,
  size: number,
  circuit: string,
  inputBits: Uint8Array,
  inputBitsPerParty: number[],
  io: IO,
  mode?: '2pc' | 'mpc' | 'auto',
}): Promise<Uint8Array> {
  if (typeof Worker === 'undefined') {
    return nodeSecureMPC({
      party, size, circuit, inputBits, inputBitsPerParty, io, mode,
    });
  }

  const ev = new EventEmitter<{ cleanup(): void }>();

  const result = new Promise<Uint8Array>((resolve, reject) => {
    const worker = new Worker(getWorkerUrl(), { type: 'module' });
    ev.on('cleanup', () => worker.terminate());

    io.on?.('error', reject);
    ev.on('cleanup', () => io.off?.('error', reject));

    worker.postMessage({
      type: 'start',
      party,
      size,
      circuit,
      inputBits,
      inputBitsPerParty,
      mode,
    });

    worker.onmessage = async (event) => {
      const message = event.data;

      if (message.type === 'io_send') {
        // Forward the send request to the main thread's io.send
        const { toParty, channel, data } = message;
        io.send(toParty, channel, data);
      } else if (message.type === 'io_recv') {
        const { fromParty, channel, min_len, max_len } = message;
        // Handle the recv request from the worker
        try {
          const data = await io.recv(fromParty, channel, min_len, max_len);
          worker.postMessage({ type: 'io_recv_response', id: message.id, data });
        } catch (error) {
          worker.postMessage({
            type: 'io_recv_error',
            id: message.id,
            error: (error as Error).message,
          });
        }
      } else if (message.type === 'result') {
        // Resolve the promise with the result from the worker
        resolve(message.result);
      } else if (message.type === 'error') {
        // Reject the promise if an error occurred
        reject(new Error(message.error));
      } else if (message.type === 'log') {
        console.log('Worker log:', message.msg);
      } else {
        console.error('Unexpected message from worker:', message);
      }
    };

    worker.onerror = reject;
  });

  return result.finally(() => ev.emit('cleanup'));
}
