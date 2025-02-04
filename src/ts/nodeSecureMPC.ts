import type { IO } from "./types";

/**
 * Runs a secure multi-party computation (MPC) using a specified circuit.
 *
 * @param party - The party index joining the computation (0, 1, .. N-1).
 * @param size - The number of parties in the computation.
 * @param circuit - The circuit to run.
 * @param inputBits - The input to the circuit, represented as one bit per byte.
 * @param inputBitsPerParty - The number of input bits for each party.
 * @param io - Input/output channels for communication between the two parties.
 * @returns A promise resolving with the output bits of the circuit.
 */
export default async function nodeSecureMPC({
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
  if (typeof process === 'undefined' || typeof process.versions === 'undefined' || !process.versions.node) {
    throw new Error('Not running in Node.js');
  }

  let module = await ((await import('../../build/jslib.js')).default());

  const emp: {
    circuit?: string;
    inputBits?: Uint8Array;
    inputBitsPerParty?: number[];
    io?: IO;
    handleOutput?: (value: Uint8Array) => void;
    handleError?: (error: Error) => void;
  } = {};

  module.emp = emp;

  emp.circuit = circuit;
  emp.inputBits = inputBits;
  emp.inputBitsPerParty = inputBitsPerParty;
  emp.io = io;

  const method = calculateMethod(mode, size, circuit);

  const result = await new Promise<Uint8Array>((resolve, reject) => {
    try {
      emp.handleOutput = resolve;
      emp.handleError = reject;

      module[method](party, size);
    } catch (error) {
      reject(error);
    }
  });

  return result;
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
