import type { IO } from "./types";

type Module = {
  emp?: {
    circuit?: string;
    inputBits?: Uint8Array;
    inputBitsPerParty?: number[];
    io?: IO;
    handleOutput?: (value: Uint8Array) => void;
  };
  _run_2pc(party: number, size: number): void;
  _run_mpc(party: number, size: number): void;
  onRuntimeInitialized: () => void;
};

let running = false;

declare const createModule: () => Promise<Module>

/**
 * Runs a secure multi-party computation (MPC) using a specified circuit.
 *
 * @param party - The party index joining the computation (0, 1, .. N-1).
 * @param size - The number of parties in the computation.
 * @param circuit - The circuit to run.
 * @param inputBits - The input bits for the circuit, represented as one bit per byte.
 * @param inputBitsPerParty - The number of input bits for each party.
 * @param io - Input/output channels for communication between the two parties.
 * @returns A promise resolving with the output bits of the circuit.
 */
async function secureMPC({
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
  const module = await createModule();

  if (running) {
    throw new Error('Can only run one secureMPC at a time');
  }

  running = true;

  const emp: {
    circuit?: string;
    inputBits?: Uint8Array;
    inputBitsPerParty?: number[];
    io?: IO;
    handleOutput?: (value: Uint8Array) => void
    handleError?: (error: Error) => void;
  } = {};

  module.emp = emp;

  emp.circuit = circuit;
  emp.inputBits = inputBits;
  emp.inputBitsPerParty = inputBitsPerParty;
  emp.io = io;

  const method = calculateMethod(mode, size, circuit);

  const result = new Promise<Uint8Array>((resolve, reject) => {
    try {
      emp.handleOutput = resolve;
      emp.handleError = reject;

      module[method](party, size);
    } catch (error) {
      reject(error);
    }
  });

  try {
    return await result;
  } finally {
    running = false;
  }
}

function calculateMethod(
  mode: '2pc' | 'mpc' | 'auto',
  size: number,

  // Currently unused, but some 2-party circuits might perform better with
  // _runMPC
  _circuit: string,
) {
  switch (mode) {
    case '2pc':
      return '_run_2pc';
    case 'mpc':
      return '_run_mpc';
    case 'auto':
      return size === 2 ? '_run_2pc' : '_run_mpc';

    default:
      const _never: never = mode;
      throw new Error('Unexpected mode: ' + mode);
  }
}

let requestId = 0;

const pendingRequests: {
  [id: number]: {
    resolve: (data: Uint8Array) => void;
    reject: (error: Error) => void;
  };
} = {};

onmessage = async (event) => {
  const message = event.data;

  if (message.type === 'start') {
    const { party, size, circuit, inputBits, inputBitsPerParty, mode } = message;

    // Create a proxy IO object to communicate with the main thread
    const io: IO = {
      send: (toParty, channel, data) => {
        postMessage({ type: 'io_send', toParty, channel, data });
      },
      recv: (fromParty, channel, len) => {
        return new Promise((resolve, reject) => {
          const id = requestId++;
          pendingRequests[id] = { resolve, reject };
          postMessage({ type: 'io_recv', fromParty, channel, len, id });
        });
      },
    };

    try {
      const result = await secureMPC({
        party,
        size,
        circuit,
        inputBits,
        inputBitsPerParty,
        io,
        mode,
      });

      postMessage({ type: 'result', result });
    } catch (error) {
      postMessage({ type: 'error', error: (error as Error).stack });
    }
  } else if (message.type === 'io_recv_response') {
    const { id, data } = message;
    if (pendingRequests[id]) {
      pendingRequests[id].resolve(data);
      delete pendingRequests[id];
    }
  } else if (message.type === 'io_recv_error') {
    const { id, error } = message;
    if (pendingRequests[id]) {
      pendingRequests[id].reject(new Error(error));
      delete pendingRequests[id];
    }
  }
};
