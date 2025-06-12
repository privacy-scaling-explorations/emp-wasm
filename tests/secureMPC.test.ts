import fs from 'fs/promises';
import { exec } from 'child_process';
import { promisify } from 'util';

import { expect } from 'chai';
import { BufferQueue, secureMPC } from "../src/ts";

describe('Secure MPC', () => {
  it('3 + 5 == 8 (2pc)', async function () {
    // Note: This tends to run a bit slower than mpc mode, but that's because
    // of the cold start. Running mpc first is slower than running 2pc first.
    expect(await internalDemo(3, 5, '2pc')).to.deep.equal({ alice: 8, bob: 8 });
  });

  it('3 + 5 == 8 (mpc)', async function () {
    expect(await internalDemo(3, 5, 'mpc')).to.deep.equal({ alice: 8, bob: 8 });
  });

  it('3 + 5 == 8 (auto)', async function () {
    expect(await internalDemo(3, 5, 'auto')).to.deep.equal({ alice: 8, bob: 8 });
  });

  it('3 + 5 == 8 (5 parties)', async function () {
    this.timeout(20_000);
    expect(await internalDemoN(3, 5, 5)).to.deep.equal([8, 8, 8, 8, 8]);
  });

  for (let nParties = 2; nParties <= 4; nParties++) {
    for (const flavor of ['internal    ', 'subprocesses']) {
      it(`sha1("") == "da..09" | ${nParties} parties | ${flavor}`, async function () {
        this.timeout(60_000);

        let outputs: string[];

        if (flavor === 'internal    ') {
          outputs = await internalDemoSha1N(nParties);
        } else {
          outputs = await subprocessesSha1N(nParties);
        }

        for (const output of outputs) {
          expect(output).to.equal('da39a3ee5e6b4b0d3255bfef95601890afd80709');
        }
      });
    }
  }
});

class BufferQueueStore {
  bqs = new Map<string, BufferQueue>();

  get(from: number | string, to: number | string, channel: 'a' | 'b') {
    const key = `${from}-${to}-${channel}`;

    if (!this.bqs.has(key)) {
      this.bqs.set(key, new BufferQueue());
    }

    return this.bqs.get(key)!;
  }
}

async function internalDemo(
  aliceInput: number,
  bobInput: number,
  mode: '2pc' | 'mpc' | 'auto' = 'auto',
): Promise<{ alice: number, bob: number }> {
  const bqs = new BufferQueueStore();
  const add32BitCircuit = await getCircuit('adder_32bit.txt');

  const [aliceBits, bobBits] = await Promise.all([
    secureMPC({
      party: 0,
      size: 2,
      circuit: add32BitCircuit,
      inputBits: numberTo32Bits(aliceInput),
      inputBitsPerParty: [32, 32],
      io: {
        send: (toParty, channel, data) => {
          expect(toParty).to.equal(1);
          bqs.get('alice', 'bob', channel).push(data);
        },
        recv: async (fromParty, channel, min_len, max_len) => {
          expect(fromParty).to.equal(1);
          return bqs.get('bob', 'alice', channel).pop(min_len, max_len);
        },
      },
      mode,
    }),
    secureMPC({
      party: 1,
      size: 2,
      circuit: add32BitCircuit,
      inputBits: numberTo32Bits(bobInput),
      inputBitsPerParty: [32, 32],
      io: {
        send: (toParty, channel, data) => {
          expect(toParty).to.equal(0);
          bqs.get('bob', 'alice', channel).push(data);
        },
        recv: async (fromParty, channel, min_len, max_len) => {
          expect(fromParty).to.equal(0);
          return bqs.get('alice', 'bob', channel).pop(min_len, max_len);
        },
      },
      mode,
    }),
  ]);

  return {
    alice: numberFrom32Bits(aliceBits),
    bob: numberFrom32Bits(bobBits),
  };
}

async function internalDemoN(
  p0Input: number,
  p1Input: number,
  size: number
): Promise<number[]> {
  const bqs = new BufferQueueStore();
  const add32BitCircuit = await getCircuit('adder_32bit.txt');

  const inputBitsPerParty = new Array(size).fill(0);
  inputBitsPerParty[0] = 32;
  inputBitsPerParty[1] = 32;

  const outputBits = await Promise.all(new Array(size).fill(0).map((_0, party) => secureMPC({
    party,
    size,
    circuit: add32BitCircuit,
    inputBits: (() => {
      if (party === 0) {
        return numberTo32Bits(p0Input);
      }

      if (party === 1) {
        return numberTo32Bits(p1Input);
      }

      return new Uint8Array(0);
    })(),
    inputBitsPerParty,
    io: {
      send: (toParty, channel, data) => {
        bqs.get(party, toParty, channel).push(data);
      },
      recv: async (fromParty, channel, min_len, max_len) => {
        return bqs.get(fromParty, party, channel).pop(min_len, max_len);
      },
    }
  })));

  return outputBits.map(bits => numberFrom32Bits(bits));
}

/**
 * Converts a number into its 32-bit binary representation.
 *
 * @param x - The number to convert.
 * @returns A 32-bit binary representation of the number in the form of a Uint8Array.
 */
function numberTo32Bits(x: number): Uint8Array {
  const result = new Uint8Array(32);

  for (let i = 0; i < 32; i++) {
    result[i] = (x >>> i) & 1;
  }

  return result;
}

/**
 * Converts a 32-bit binary representation back into a number.
 *
 * @param arr - A 32-bit binary array.
 * @returns The number represented by the 32-bit array.
 */
function numberFrom32Bits(arr: Uint8Array): number {
  let result = 0;

  for (let i = 0; i < 32; i++) {
    result |= arr[i] << i;
  }

  return result;
}

async function internalDemoSha1N(
  size: number,
): Promise<string[]> {
  const bqs = new BufferQueueStore();
  const sha1Circuit = await getCircuit('sha-1.txt');

  const inputBitsPerParty = new Array(size).fill(0);
  inputBitsPerParty[0] = 512;

  const outputBits = await Promise.all(new Array(size).fill(0).map((_0, party) => secureMPC({
    party,
    size,
    circuit: sha1Circuit,
    inputBits: (() => {
      if (party === 0) {
        const bits = new Uint8Array(512);
        bits[0] = 1; // A single leading 1 to make a valid sha1 block.
        return bits;
      }

      return new Uint8Array(0);
    })(),
    inputBitsPerParty,
    io: {
      send: (toParty, channel, data) => {
        bqs.get(party, toParty, channel).push(data);
      },
      recv: async (fromParty, channel, min_len, max_len) => {
        return bqs.get(fromParty, party, channel).pop(min_len, max_len);
      },
    }
  })));

  return outputBits.map(bits => bitsToHex(bits));
}

async function subprocessesSha1N(
  size: number,
): Promise<string[]> {
  const sha1CircuitPath = import.meta.resolve(`../circuits/sha-1.txt`).slice(7);
  const cliPath = import.meta.resolve('./helpers/cli.ts').slice(7);

  const inputBitsPerParty = new Array(size).fill(0);
  inputBitsPerParty[0] = 512;

  const execAsync = promisify(exec);

  const outputBits = await Promise.all(new Array(size).fill(0).map(async (_0, party) => {
    const inputBits = (() => {
      if (party === 0) {
        const bits = new Uint8Array(512);
        bits[0] = 1; // A single leading 1 to make a valid sha1 block.
        return bits;
      }

      return new Uint8Array(0);
    })();

    const cmd = [
      'tsx',
      cliPath,
      8000,
      size,
      party,
      sha1CircuitPath,
      ...inputBitsPerParty,
      inputBits.length === 0 ? '.' : [...inputBits].join(''),
    ].join(' ');

    const { stdout, stderr } = await execAsync(cmd);

    if (stderr.trim() !== '') {
      throw new Error(stderr);
    }

    return Uint8Array.from(stdout.trim().split('').map(Number));
  }));

  return outputBits.map(bits => bitsToHex(bits));
}

function bitsToHex(bits: Uint8Array): string {
  if (bits.length % 8 !== 0) {
    throw new Error('Invalid number of bits.');
  }

  let hexParts: string[] = [];

  for (let i = 0; i < bits.length; i += 4) {
    let nibble = 0;

    for (let j = 0; j < 4; j++) {
      nibble |= bits[i + j] << (3 - j);
    }

    hexParts.push(nibble.toString(16));
  }

  return hexParts.join('');
}

async function getCircuit(name: string) {
  const txt = await fs.readFile(
    import.meta.resolve(`../circuits/${name}`).slice(7),
    'utf-8',
  );

  return txt;
}
