import type { IO } from "./types";

/**
 * Runs a secure multi-party computation (MPC) using a specified circuit.
 *
 * @param party - The party index joining the computation (0, 1, .. N-1).
 * @param size - The number of parties in the computation.
 * @param circuitBinary - The circuit to run.
 * @param inputBits - The input to the circuit, represented as one bit per byte.
 * @param inputBitsPerParty - The number of input bits for each party.
 * @param io - Input/output channels for communication between the two parties.
 * @returns A promise resolving with the output bits of the circuit.
 */
export default async function nodeSecureMPC({
  party, size, circuitBinary, inputBits, inputBitsPerParty, io, mode = 'auto',
}: {
  party: number,
  size: number,
  circuitBinary: Uint8Array,
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
    circuitBinary?: Uint8Array;
    inputBits?: Uint8Array;
    inputBitsPerParty?: number[];
    io?: IO;
    handleOutput?: (value: Uint8Array) => void;
    handleError?: (error: Error) => void;
  } = {};

  module.emp = emp;

  emp.circuitBinary = circuitBinary;
  emp.inputBits = inputBits;
  emp.inputBitsPerParty = inputBitsPerParty;

  let reject: undefined | ((error: unknown) => void) = undefined;
  const callbackRejector = new Promise((_resolve, rej) => {
    reject = rej;
  });
  reject = reject!;

  emp.io = {
    send: useRejector(io.send.bind(io), reject),
    recv: useRejector(io.recv.bind(io), reject),
  };

  const method = calculateMethod(mode, size, circuitBinary);

  const result = await new Promise<Uint8Array>((resolve, reject) => {
    try {
      emp.handleOutput = resolve;
      emp.handleError = reject;
      callbackRejector.catch(reject);

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
  _circuitBinary: Uint8Array,
) {
  switch (mode) {
    case '2pc':
      return '_run_2pc';
    case 'mpc':
      return '_run_mpc';
    case 'auto':
      // Advantage of 2PC specialization is small and contains "FEQ error" bug
      // for the large circuits, so the performance currently cannot be realized
      // where it matters.
      // Therefore, we default to the general N-party mpc mode, even when there
      // are only 2 parties.
      return '_run_mpc';

    default:
      const _never: never = mode;
      throw new Error('Unexpected mode: ' + mode);
  }
}

function useRejector<F extends (...args: any[]) => any>(
  fn: F,
  reject: (error: unknown) => void,
): F {
  return ((...args: Parameters<F>) => {
    try {
      return fn(...args);
    } catch (error) {
      reject(error);
      throw error;
    }
  }) as F;
}
