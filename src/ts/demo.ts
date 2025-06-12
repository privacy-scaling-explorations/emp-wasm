import { DataConnection, Peer } from 'peerjs';

import BufferedIO from "./BufferedIO.js";
import BufferQueue from "./BufferQueue.js";
import secureMPC from "./secureMPC.js";
import { IO } from "./types";
import assert from './assert.js';
import { channelFromByte } from "./utils.js";

const windowAny = window as any;

windowAny.secureMPC = secureMPC;

windowAny.internalDemo = async function(
  aliceInput: number,
  bobInput: number,
  mode: '2pc' | 'mpc' | 'auto' = 'auto',
): Promise<{ alice: number, bob: number }> {
  const aliceBq = { a: new BufferQueue(), b: new BufferQueue() };
  const bobBq = { a: new BufferQueue(), b: new BufferQueue() };

  const [aliceBits, bobBits] = await Promise.all([
    secureMPC({
      party: 0,
      size: 2,
      circuit: aPlusB32BitCircuit,
      inputBits: numberTo32Bits(aliceInput),
      inputBitsPerParty: [32, 32],
      io: {
        send: (toParty, channel, data) => bobBq[channel].push(data),
        recv: (fromParty, channel, min_len, max_len) => aliceBq[channel].pop(min_len, max_len),
      },
      mode,
    }),
    secureMPC({
      party: 1,
      size: 2,
      circuit: aPlusB32BitCircuit,
      inputBits: numberTo32Bits(bobInput),
      inputBitsPerParty: [32, 32],
      io: {
        send: (toParty, channel, data) => aliceBq[channel].push(data),
        recv: (fromParty, channel, min_len, max_len) => bobBq[channel].pop(min_len, max_len),
      },
      mode,
    }),
  ]);

  return {
    alice: numberFrom32Bits(aliceBits),
    bob: numberFrom32Bits(bobBits),
  };
}

windowAny.internalDemo3 = async function(
  aliceInput: number,
  bobInput: number,
  charlieInput: number,
  mode: '2pc' | 'mpc' | 'auto' = 'auto',
): Promise<{ alice: number, bob: number, charlie: number }> {
  const bqs = new BufferQueueStore();
  const inputs = [aliceInput, bobInput, charlieInput];

  const [aliceBits, bobBits, charlieBits] = await Promise.all([0, 1, 2].map(party => secureMPC({
    party,
    size: 3,
    circuit: aPlusBPlusC32BitCircuit,
    inputBits: numberTo32Bits(inputs[party]),
    inputBitsPerParty: [32, 32, 32],
    io: {
      send: (toParty, channel, data) => bqs.get(party, toParty, channel).push(data),
      recv: (fromParty, channel, min_len, max_len) => bqs.get(fromParty, party, channel).pop(min_len, max_len),
    },
    mode,
  })));

  return {
    alice: numberFrom32Bits(aliceBits),
    bob: numberFrom32Bits(bobBits),
    charlie: numberFrom32Bits(charlieBits),
  };
}

windowAny.consoleDemo = async function(
  party: number,
  input: number,
  mode: '2pc' | 'mpc' | 'auto' = 'auto',
): Promise<void> {
  const otherParty = party === 0 ? 1 : 0;

  const bits = await secureMPC({
    party,
    size: 2,
    circuit: aPlusB32BitCircuit,
    inputBits: numberTo32Bits(input),
    inputBitsPerParty: [32, 32],
    io: makeCopyPasteIO(otherParty),
    mode,
  });

  alert(numberFrom32Bits(bits));
}

windowAny.wsDemo = async function(
  party: number,
  input: number,
  mode: '2pc' | 'mpc' | 'auto' = 'auto',
): Promise<number> {
  const otherParty = party === 0 ? 1 : 0;
  const io = await makeWebSocketIO('ws://localhost:8175/demo', otherParty);

  const bits = await secureMPC({
    party,
    size: 2,
    circuit: aPlusB32BitCircuit,
    inputBits: numberTo32Bits(input),
    inputBitsPerParty: [32, 32],
    io,
    mode,
  });

  io.close();

  return numberFrom32Bits(bits);
}

windowAny.rtcDemo = async function(
  pairingCode: string,
  party: number,
  input: number,
  mode: '2pc' | 'mpc' | 'auto' = 'auto',
): Promise<number> {
  const io = await makePeerIO(pairingCode, party);

  const bits = await secureMPC({
    party,
    size: 2,
    circuit: aPlusB32BitCircuit,
    inputBits: numberTo32Bits(input),
    inputBitsPerParty: [32, 32],
    io,
    mode,
  });

  io.close();

  return numberFrom32Bits(bits);
}

async function makeWebSocketIO(url: string, otherParty: number) {
  const sock = new WebSocket(url);
  sock.binaryType = 'arraybuffer';

  await new Promise((resolve, reject) => {
    sock.onopen = resolve;
    sock.onerror = reject;
  });

  // You don't have to use BufferedIO, but it's a bit easier to use, otherwise
  // you need to implement io.recv(len) returning a promise to exactly len
  // bytes
  const io = new BufferedIO(
    otherParty,
    (toParty, channel, data) => {
      assert(toParty === otherParty, 'Unexpected party');
      const channelBuf = new Uint8Array(data.length + 1);

      // emp-wasm requires an a-channel and a b-channel between each pair of
      // participants. We implement this by actually using a single underlying
      // channel and prefixing each message with a byte indicating the channel.
      // BufferedIO assumes this too. If you're not using BufferedIO, you can
      // provide these multiple channels with a method of your choosing.
      channelBuf[0] = channel.charCodeAt(0);

      channelBuf.set(data, 1);
      sock.send(channelBuf);
    },
    () => sock.close(),
  );

  sock.onmessage = (event: MessageEvent) => {
    if (!(event.data instanceof ArrayBuffer)) {
      console.error('Unrecognized event.data');
      return;
    }

    const channelBuf = new Uint8Array(event.data);
    const channel = channelFromByte(channelBuf[0]);

    io.accept(channel, channelBuf.slice(1));
  };

  sock.onerror = (e) => {
    io.emit('error', new Error(`WebSocket error: ${e}`));
  };

  sock.onclose = () => io.close();

  return io;
}

async function makePeerIO(pairingCode: string, party: number) {
  const otherParty = party === 0 ? 1 : 0;
  const peer = new Peer(`emp-wasm-${pairingCode}-${party}`);

  await new Promise((resolve, reject) => {
    peer.on('open', resolve);
    peer.on('error', reject);
  });

  let conn: DataConnection;

  if (party === 0) {
    const connPromise = new Promise<DataConnection>(
      resolve => peer.on('connection', resolve),
    );

    const notifyConn = peer.connect(`emp-wasm-${pairingCode}-1`);
    notifyConn.on('open', () => notifyConn.close());

    conn = await connPromise;
  } else {
    conn = peer.connect(`emp-wasm-${pairingCode}-0`);

    await new Promise<void>((resolve, reject) => {
      conn.on('open', resolve);
      conn.on('error', reject);

      peer.on('connection', (notifyConn) => {
        notifyConn.close();
        conn.close();

        conn = peer.connect(`emp-wasm-${pairingCode}-0`);
        conn.on('open', resolve);
        conn.on('error', reject);
      });
    });
  }

  const io = new BufferedIO(
    otherParty,
    (toParty, channel, data) => {
      assert(toParty === otherParty, 'Unexpected party');
      const channelBuf = new Uint8Array(data.length + 1);
      channelBuf[0] = channel.charCodeAt(0);
      channelBuf.set(data, 1);
      conn.send(channelBuf);
    },
    () => peer.destroy(),
  );

  conn.on('data', (data) => {
    let channelBuf: Uint8Array;

    if (data instanceof ArrayBuffer) {
      channelBuf = new Uint8Array(data);
    } else if (data instanceof Uint8Array) {
      channelBuf = data;
    } else {
      io.emit('error', new Error('Received unrecognized data type'));
      return;
    }

    const channel = channelFromByte(channelBuf[0]);

    io.accept(channel, channelBuf.slice(1));
  });

  conn.on('close', () => io.close());

  return io;
}

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

/**
 * Creates an I/O interface for secure communication using a BufferQueue.
 * @returns An object with `send` and `recv` methods for communication.
 */
function makeCopyPasteIO(otherParty: number): IO {
  const bq = { a: new BufferQueue(), b: new BufferQueue() };

  (window as any).write = function (base64: string): void {
    const data = decodeBase64(base64);

    let channel: 'a' | 'b';

    if (data[0] === 'a'.charCodeAt(0)) {
      channel = 'a';
    } else if (data[0] === 'b'.charCodeAt(0)) {
      channel = 'b';
    } else {
      throw new Error('Invalid channel');
    }

    bq[channel].push(data.slice(1));
  };

  return {
    send: makeConsoleSend(otherParty),
    recv: (fromParty, channel, min_len, max_len) => {
      assert(fromParty === otherParty, 'Unexpected party');
      return bq[channel].pop(min_len, max_len);
    },
  };
}

/**
 * Creates a function for sending data via console output using Base64 encoding.
 * The data is sent in batches to optimize performance.
 * @returns A function that takes Uint8Array data and logs it to the console.
 */
function makeConsoleSend(otherParty: number): IO['send'] {
  let buffer: Uint8Array[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  const TIME_WINDOW = 1_000;

  function currentChannel() {
    const firstByte = buffer?.[0]?.[0];

    switch (firstByte) {
      case 'a'.charCodeAt(0):
        return 'a';
      case 'b'.charCodeAt(0):
        return 'b';
      default:
        return undefined;
    }
  }

  function flush() {
    if (buffer.length === 0) {
      return;
    }

    const totalLength = buffer.reduce((acc, arr) => acc + arr.length, 0);
    const concatenated = new Uint8Array(totalLength);
    let offset = 0;
    buffer.forEach(arr => {
      concatenated.set(arr, offset);
      offset += arr.length;
    });

    let binary = '';
    for (let byte of concatenated) {
      binary += String.fromCharCode(byte);
    }

    const base64 = btoa(binary);
    console.log(`write('${base64}')`);

    buffer = [];
    timer = null;
  }

  return function (toParty: number, channel: 'a' | 'b', data: Uint8Array): void {
    assert(toParty === otherParty, 'Unexpected party');
    assert(data instanceof Uint8Array, 'Input must be a Uint8Array');

    if (currentChannel() !== channel) {
      flush();
      buffer.push(new Uint8Array([channel.charCodeAt(0)]));
    }

    buffer.push(data);

    if (!timer) {
      timer = setTimeout(flush, TIME_WINDOW);
    }
  };
}

/**
 * Decodes a Base64-encoded string into a Uint8Array.
 *
 * @param base64Str - The Base64-encoded string to decode and process.
 * @throws {TypeError} If the input is not a string.
 * @throws {Error} If Base64 decoding fails.
 * @returns A Uint8Array representing the decoded binary data.
 */
function decodeBase64(base64Str: string): Uint8Array {
  if (typeof base64Str !== 'string') {
    throw new TypeError('Input must be a Base64-encoded string');
  }

  let decodedArray: Uint8Array;

  try {
    const binaryStr = atob(base64Str);
    const len = binaryStr.length;
    decodedArray = new Uint8Array(len);

    for (let i = 0; i < len; i++) {
      decodedArray[i] = binaryStr.charCodeAt(i);
    }
  } catch (error) {
    throw new Error(
      'Failed to decode Base64 string: ' + (error as Error).message,
    );
  }

  return decodedArray;
}

const aPlusB32BitCircuit = `244 308
32 32 32

2 1 0 32 276 XOR
2 1 1 33 64 XOR
2 1 0 32 65 AND
2 1 64 65 277 XOR
2 1 2 34 66 XOR
2 1 1 33 67 AND
2 1 65 64 68 AND
1 1 67 69 INV
1 1 68 70 INV
2 1 69 70 71 AND
1 1 71 72 INV
2 1 66 72 278 XOR
2 1 3 35 73 XOR
2 1 2 34 74 AND
2 1 72 66 75 AND
1 1 74 76 INV
1 1 75 77 INV
2 1 76 77 78 AND
1 1 78 79 INV
2 1 73 79 279 XOR
2 1 4 36 80 XOR
2 1 3 35 81 AND
2 1 79 73 82 AND
1 1 81 83 INV
1 1 82 84 INV
2 1 83 84 85 AND
1 1 85 86 INV
2 1 80 86 280 XOR
2 1 5 37 87 XOR
2 1 4 36 88 AND
2 1 86 80 89 AND
1 1 88 90 INV
1 1 89 91 INV
2 1 90 91 92 AND
1 1 92 93 INV
2 1 87 93 281 XOR
2 1 6 38 94 XOR
2 1 5 37 95 AND
2 1 93 87 96 AND
1 1 95 97 INV
1 1 96 98 INV
2 1 97 98 99 AND
1 1 99 100 INV
2 1 94 100 282 XOR
2 1 7 39 101 XOR
2 1 6 38 102 AND
2 1 100 94 103 AND
1 1 102 104 INV
1 1 103 105 INV
2 1 104 105 106 AND
1 1 106 107 INV
2 1 101 107 283 XOR
2 1 8 40 108 XOR
2 1 7 39 109 AND
2 1 107 101 110 AND
1 1 109 111 INV
1 1 110 112 INV
2 1 111 112 113 AND
1 1 113 114 INV
2 1 108 114 284 XOR
2 1 9 41 115 XOR
2 1 8 40 116 AND
2 1 114 108 117 AND
1 1 116 118 INV
1 1 117 119 INV
2 1 118 119 120 AND
1 1 120 121 INV
2 1 115 121 285 XOR
2 1 10 42 122 XOR
2 1 9 41 123 AND
2 1 121 115 124 AND
1 1 123 125 INV
1 1 124 126 INV
2 1 125 126 127 AND
1 1 127 128 INV
2 1 122 128 286 XOR
2 1 11 43 129 XOR
2 1 10 42 130 AND
2 1 128 122 131 AND
1 1 130 132 INV
1 1 131 133 INV
2 1 132 133 134 AND
1 1 134 135 INV
2 1 129 135 287 XOR
2 1 12 44 136 XOR
2 1 11 43 137 AND
2 1 135 129 138 AND
1 1 137 139 INV
1 1 138 140 INV
2 1 139 140 141 AND
1 1 141 142 INV
2 1 136 142 288 XOR
2 1 13 45 143 XOR
2 1 12 44 144 AND
2 1 142 136 145 AND
1 1 144 146 INV
1 1 145 147 INV
2 1 146 147 148 AND
1 1 148 149 INV
2 1 143 149 289 XOR
2 1 14 46 150 XOR
2 1 13 45 151 AND
2 1 149 143 152 AND
1 1 151 153 INV
1 1 152 154 INV
2 1 153 154 155 AND
1 1 155 156 INV
2 1 150 156 290 XOR
2 1 15 47 157 XOR
2 1 14 46 158 AND
2 1 156 150 159 AND
1 1 158 160 INV
1 1 159 161 INV
2 1 160 161 162 AND
1 1 162 163 INV
2 1 157 163 291 XOR
2 1 16 48 164 XOR
2 1 15 47 165 AND
2 1 163 157 166 AND
1 1 165 167 INV
1 1 166 168 INV
2 1 167 168 169 AND
1 1 169 170 INV
2 1 164 170 292 XOR
2 1 17 49 171 XOR
2 1 16 48 172 AND
2 1 170 164 173 AND
1 1 172 174 INV
1 1 173 175 INV
2 1 174 175 176 AND
1 1 176 177 INV
2 1 171 177 293 XOR
2 1 18 50 178 XOR
2 1 17 49 179 AND
2 1 177 171 180 AND
1 1 179 181 INV
1 1 180 182 INV
2 1 181 182 183 AND
1 1 183 184 INV
2 1 178 184 294 XOR
2 1 19 51 185 XOR
2 1 18 50 186 AND
2 1 184 178 187 AND
1 1 186 188 INV
1 1 187 189 INV
2 1 188 189 190 AND
1 1 190 191 INV
2 1 185 191 295 XOR
2 1 20 52 192 XOR
2 1 19 51 193 AND
2 1 191 185 194 AND
1 1 193 195 INV
1 1 194 196 INV
2 1 195 196 197 AND
1 1 197 198 INV
2 1 192 198 296 XOR
2 1 21 53 199 XOR
2 1 20 52 200 AND
2 1 198 192 201 AND
1 1 200 202 INV
1 1 201 203 INV
2 1 202 203 204 AND
1 1 204 205 INV
2 1 199 205 297 XOR
2 1 22 54 206 XOR
2 1 21 53 207 AND
2 1 205 199 208 AND
1 1 207 209 INV
1 1 208 210 INV
2 1 209 210 211 AND
1 1 211 212 INV
2 1 206 212 298 XOR
2 1 23 55 213 XOR
2 1 22 54 214 AND
2 1 212 206 215 AND
1 1 214 216 INV
1 1 215 217 INV
2 1 216 217 218 AND
1 1 218 219 INV
2 1 213 219 299 XOR
2 1 24 56 220 XOR
2 1 23 55 221 AND
2 1 219 213 222 AND
1 1 221 223 INV
1 1 222 224 INV
2 1 223 224 225 AND
1 1 225 226 INV
2 1 220 226 300 XOR
2 1 25 57 227 XOR
2 1 24 56 228 AND
2 1 226 220 229 AND
1 1 228 230 INV
1 1 229 231 INV
2 1 230 231 232 AND
1 1 232 233 INV
2 1 227 233 301 XOR
2 1 26 58 234 XOR
2 1 25 57 235 AND
2 1 233 227 236 AND
1 1 235 237 INV
1 1 236 238 INV
2 1 237 238 239 AND
1 1 239 240 INV
2 1 234 240 302 XOR
2 1 27 59 241 XOR
2 1 26 58 242 AND
2 1 240 234 243 AND
1 1 242 244 INV
1 1 243 245 INV
2 1 244 245 246 AND
1 1 246 247 INV
2 1 241 247 303 XOR
2 1 28 60 248 XOR
2 1 27 59 249 AND
2 1 247 241 250 AND
1 1 249 251 INV
1 1 250 252 INV
2 1 251 252 253 AND
1 1 253 254 INV
2 1 248 254 304 XOR
2 1 29 61 255 XOR
2 1 28 60 256 AND
2 1 254 248 257 AND
1 1 256 258 INV
1 1 257 259 INV
2 1 258 259 260 AND
1 1 260 261 INV
2 1 255 261 305 XOR
2 1 30 62 262 XOR
2 1 29 61 263 AND
2 1 261 255 264 AND
1 1 263 265 INV
1 1 264 266 INV
2 1 265 266 267 AND
1 1 267 268 INV
2 1 262 268 306 XOR
2 1 31 63 269 XOR
2 1 30 62 270 AND
2 1 268 262 271 AND
1 1 270 272 INV
1 1 271 273 INV
2 1 272 273 274 AND
1 1 274 275 INV
2 1 269 275 307 XOR
`;

const aPlusBPlusC32BitCircuit = `488 584
96 0 32

2 1 0 32 96 XOR
2 1 96 64 552 XOR
2 1 1 33 97 XOR
2 1 0 32 98 AND
2 1 97 98 99 XOR
2 1 99 65 100 XOR
2 1 96 64 101 AND
2 1 100 101 553 XOR
2 1 2 34 102 XOR
2 1 1 33 103 AND
2 1 98 97 104 AND
1 1 103 105 INV
1 1 104 106 INV
2 1 105 106 107 AND
1 1 107 108 INV
2 1 102 108 109 XOR
2 1 109 66 110 XOR
2 1 99 65 111 AND
2 1 101 100 112 AND
1 1 111 113 INV
1 1 112 114 INV
2 1 113 114 115 AND
1 1 115 116 INV
2 1 110 116 554 XOR
2 1 3 35 117 XOR
2 1 2 34 118 AND
2 1 108 102 119 AND
1 1 118 120 INV
1 1 119 121 INV
2 1 120 121 122 AND
1 1 122 123 INV
2 1 117 123 124 XOR
2 1 124 67 125 XOR
2 1 109 66 126 AND
2 1 116 110 127 AND
1 1 126 128 INV
1 1 127 129 INV
2 1 128 129 130 AND
1 1 130 131 INV
2 1 125 131 555 XOR
2 1 4 36 132 XOR
2 1 3 35 133 AND
2 1 123 117 134 AND
1 1 133 135 INV
1 1 134 136 INV
2 1 135 136 137 AND
1 1 137 138 INV
2 1 132 138 139 XOR
2 1 139 68 140 XOR
2 1 124 67 141 AND
2 1 131 125 142 AND
1 1 141 143 INV
1 1 142 144 INV
2 1 143 144 145 AND
1 1 145 146 INV
2 1 140 146 556 XOR
2 1 5 37 147 XOR
2 1 4 36 148 AND
2 1 138 132 149 AND
1 1 148 150 INV
1 1 149 151 INV
2 1 150 151 152 AND
1 1 152 153 INV
2 1 147 153 154 XOR
2 1 154 69 155 XOR
2 1 139 68 156 AND
2 1 146 140 157 AND
1 1 156 158 INV
1 1 157 159 INV
2 1 158 159 160 AND
1 1 160 161 INV
2 1 155 161 557 XOR
2 1 6 38 162 XOR
2 1 5 37 163 AND
2 1 153 147 164 AND
1 1 163 165 INV
1 1 164 166 INV
2 1 165 166 167 AND
1 1 167 168 INV
2 1 162 168 169 XOR
2 1 169 70 170 XOR
2 1 154 69 171 AND
2 1 161 155 172 AND
1 1 171 173 INV
1 1 172 174 INV
2 1 173 174 175 AND
1 1 175 176 INV
2 1 170 176 558 XOR
2 1 7 39 177 XOR
2 1 6 38 178 AND
2 1 168 162 179 AND
1 1 178 180 INV
1 1 179 181 INV
2 1 180 181 182 AND
1 1 182 183 INV
2 1 177 183 184 XOR
2 1 184 71 185 XOR
2 1 169 70 186 AND
2 1 176 170 187 AND
1 1 186 188 INV
1 1 187 189 INV
2 1 188 189 190 AND
1 1 190 191 INV
2 1 185 191 559 XOR
2 1 8 40 192 XOR
2 1 7 39 193 AND
2 1 183 177 194 AND
1 1 193 195 INV
1 1 194 196 INV
2 1 195 196 197 AND
1 1 197 198 INV
2 1 192 198 199 XOR
2 1 199 72 200 XOR
2 1 184 71 201 AND
2 1 191 185 202 AND
1 1 201 203 INV
1 1 202 204 INV
2 1 203 204 205 AND
1 1 205 206 INV
2 1 200 206 560 XOR
2 1 9 41 207 XOR
2 1 8 40 208 AND
2 1 198 192 209 AND
1 1 208 210 INV
1 1 209 211 INV
2 1 210 211 212 AND
1 1 212 213 INV
2 1 207 213 214 XOR
2 1 214 73 215 XOR
2 1 199 72 216 AND
2 1 206 200 217 AND
1 1 216 218 INV
1 1 217 219 INV
2 1 218 219 220 AND
1 1 220 221 INV
2 1 215 221 561 XOR
2 1 10 42 222 XOR
2 1 9 41 223 AND
2 1 213 207 224 AND
1 1 223 225 INV
1 1 224 226 INV
2 1 225 226 227 AND
1 1 227 228 INV
2 1 222 228 229 XOR
2 1 229 74 230 XOR
2 1 214 73 231 AND
2 1 221 215 232 AND
1 1 231 233 INV
1 1 232 234 INV
2 1 233 234 235 AND
1 1 235 236 INV
2 1 230 236 562 XOR
2 1 11 43 237 XOR
2 1 10 42 238 AND
2 1 228 222 239 AND
1 1 238 240 INV
1 1 239 241 INV
2 1 240 241 242 AND
1 1 242 243 INV
2 1 237 243 244 XOR
2 1 244 75 245 XOR
2 1 229 74 246 AND
2 1 236 230 247 AND
1 1 246 248 INV
1 1 247 249 INV
2 1 248 249 250 AND
1 1 250 251 INV
2 1 245 251 563 XOR
2 1 12 44 252 XOR
2 1 11 43 253 AND
2 1 243 237 254 AND
1 1 253 255 INV
1 1 254 256 INV
2 1 255 256 257 AND
1 1 257 258 INV
2 1 252 258 259 XOR
2 1 259 76 260 XOR
2 1 244 75 261 AND
2 1 251 245 262 AND
1 1 261 263 INV
1 1 262 264 INV
2 1 263 264 265 AND
1 1 265 266 INV
2 1 260 266 564 XOR
2 1 13 45 267 XOR
2 1 12 44 268 AND
2 1 258 252 269 AND
1 1 268 270 INV
1 1 269 271 INV
2 1 270 271 272 AND
1 1 272 273 INV
2 1 267 273 274 XOR
2 1 274 77 275 XOR
2 1 259 76 276 AND
2 1 266 260 277 AND
1 1 276 278 INV
1 1 277 279 INV
2 1 278 279 280 AND
1 1 280 281 INV
2 1 275 281 565 XOR
2 1 14 46 282 XOR
2 1 13 45 283 AND
2 1 273 267 284 AND
1 1 283 285 INV
1 1 284 286 INV
2 1 285 286 287 AND
1 1 287 288 INV
2 1 282 288 289 XOR
2 1 289 78 290 XOR
2 1 274 77 291 AND
2 1 281 275 292 AND
1 1 291 293 INV
1 1 292 294 INV
2 1 293 294 295 AND
1 1 295 296 INV
2 1 290 296 566 XOR
2 1 15 47 297 XOR
2 1 14 46 298 AND
2 1 288 282 299 AND
1 1 298 300 INV
1 1 299 301 INV
2 1 300 301 302 AND
1 1 302 303 INV
2 1 297 303 304 XOR
2 1 304 79 305 XOR
2 1 289 78 306 AND
2 1 296 290 307 AND
1 1 306 308 INV
1 1 307 309 INV
2 1 308 309 310 AND
1 1 310 311 INV
2 1 305 311 567 XOR
2 1 16 48 312 XOR
2 1 15 47 313 AND
2 1 303 297 314 AND
1 1 313 315 INV
1 1 314 316 INV
2 1 315 316 317 AND
1 1 317 318 INV
2 1 312 318 319 XOR
2 1 319 80 320 XOR
2 1 304 79 321 AND
2 1 311 305 322 AND
1 1 321 323 INV
1 1 322 324 INV
2 1 323 324 325 AND
1 1 325 326 INV
2 1 320 326 568 XOR
2 1 17 49 327 XOR
2 1 16 48 328 AND
2 1 318 312 329 AND
1 1 328 330 INV
1 1 329 331 INV
2 1 330 331 332 AND
1 1 332 333 INV
2 1 327 333 334 XOR
2 1 334 81 335 XOR
2 1 319 80 336 AND
2 1 326 320 337 AND
1 1 336 338 INV
1 1 337 339 INV
2 1 338 339 340 AND
1 1 340 341 INV
2 1 335 341 569 XOR
2 1 18 50 342 XOR
2 1 17 49 343 AND
2 1 333 327 344 AND
1 1 343 345 INV
1 1 344 346 INV
2 1 345 346 347 AND
1 1 347 348 INV
2 1 342 348 349 XOR
2 1 349 82 350 XOR
2 1 334 81 351 AND
2 1 341 335 352 AND
1 1 351 353 INV
1 1 352 354 INV
2 1 353 354 355 AND
1 1 355 356 INV
2 1 350 356 570 XOR
2 1 19 51 357 XOR
2 1 18 50 358 AND
2 1 348 342 359 AND
1 1 358 360 INV
1 1 359 361 INV
2 1 360 361 362 AND
1 1 362 363 INV
2 1 357 363 364 XOR
2 1 364 83 365 XOR
2 1 349 82 366 AND
2 1 356 350 367 AND
1 1 366 368 INV
1 1 367 369 INV
2 1 368 369 370 AND
1 1 370 371 INV
2 1 365 371 571 XOR
2 1 20 52 372 XOR
2 1 19 51 373 AND
2 1 363 357 374 AND
1 1 373 375 INV
1 1 374 376 INV
2 1 375 376 377 AND
1 1 377 378 INV
2 1 372 378 379 XOR
2 1 379 84 380 XOR
2 1 364 83 381 AND
2 1 371 365 382 AND
1 1 381 383 INV
1 1 382 384 INV
2 1 383 384 385 AND
1 1 385 386 INV
2 1 380 386 572 XOR
2 1 21 53 387 XOR
2 1 20 52 388 AND
2 1 378 372 389 AND
1 1 388 390 INV
1 1 389 391 INV
2 1 390 391 392 AND
1 1 392 393 INV
2 1 387 393 394 XOR
2 1 394 85 395 XOR
2 1 379 84 396 AND
2 1 386 380 397 AND
1 1 396 398 INV
1 1 397 399 INV
2 1 398 399 400 AND
1 1 400 401 INV
2 1 395 401 573 XOR
2 1 22 54 402 XOR
2 1 21 53 403 AND
2 1 393 387 404 AND
1 1 403 405 INV
1 1 404 406 INV
2 1 405 406 407 AND
1 1 407 408 INV
2 1 402 408 409 XOR
2 1 409 86 410 XOR
2 1 394 85 411 AND
2 1 401 395 412 AND
1 1 411 413 INV
1 1 412 414 INV
2 1 413 414 415 AND
1 1 415 416 INV
2 1 410 416 574 XOR
2 1 23 55 417 XOR
2 1 22 54 418 AND
2 1 408 402 419 AND
1 1 418 420 INV
1 1 419 421 INV
2 1 420 421 422 AND
1 1 422 423 INV
2 1 417 423 424 XOR
2 1 424 87 425 XOR
2 1 409 86 426 AND
2 1 416 410 427 AND
1 1 426 428 INV
1 1 427 429 INV
2 1 428 429 430 AND
1 1 430 431 INV
2 1 425 431 575 XOR
2 1 24 56 432 XOR
2 1 23 55 433 AND
2 1 423 417 434 AND
1 1 433 435 INV
1 1 434 436 INV
2 1 435 436 437 AND
1 1 437 438 INV
2 1 432 438 439 XOR
2 1 439 88 440 XOR
2 1 424 87 441 AND
2 1 431 425 442 AND
1 1 441 443 INV
1 1 442 444 INV
2 1 443 444 445 AND
1 1 445 446 INV
2 1 440 446 576 XOR
2 1 25 57 447 XOR
2 1 24 56 448 AND
2 1 438 432 449 AND
1 1 448 450 INV
1 1 449 451 INV
2 1 450 451 452 AND
1 1 452 453 INV
2 1 447 453 454 XOR
2 1 454 89 455 XOR
2 1 439 88 456 AND
2 1 446 440 457 AND
1 1 456 458 INV
1 1 457 459 INV
2 1 458 459 460 AND
1 1 460 461 INV
2 1 455 461 577 XOR
2 1 26 58 462 XOR
2 1 25 57 463 AND
2 1 453 447 464 AND
1 1 463 465 INV
1 1 464 466 INV
2 1 465 466 467 AND
1 1 467 468 INV
2 1 462 468 469 XOR
2 1 469 90 470 XOR
2 1 454 89 471 AND
2 1 461 455 472 AND
1 1 471 473 INV
1 1 472 474 INV
2 1 473 474 475 AND
1 1 475 476 INV
2 1 470 476 578 XOR
2 1 27 59 477 XOR
2 1 26 58 478 AND
2 1 468 462 479 AND
1 1 478 480 INV
1 1 479 481 INV
2 1 480 481 482 AND
1 1 482 483 INV
2 1 477 483 484 XOR
2 1 484 91 485 XOR
2 1 469 90 486 AND
2 1 476 470 487 AND
1 1 486 488 INV
1 1 487 489 INV
2 1 488 489 490 AND
1 1 490 491 INV
2 1 485 491 579 XOR
2 1 28 60 492 XOR
2 1 27 59 493 AND
2 1 483 477 494 AND
1 1 493 495 INV
1 1 494 496 INV
2 1 495 496 497 AND
1 1 497 498 INV
2 1 492 498 499 XOR
2 1 499 92 500 XOR
2 1 484 91 501 AND
2 1 491 485 502 AND
1 1 501 503 INV
1 1 502 504 INV
2 1 503 504 505 AND
1 1 505 506 INV
2 1 500 506 580 XOR
2 1 29 61 507 XOR
2 1 28 60 508 AND
2 1 498 492 509 AND
1 1 508 510 INV
1 1 509 511 INV
2 1 510 511 512 AND
1 1 512 513 INV
2 1 507 513 514 XOR
2 1 514 93 515 XOR
2 1 499 92 516 AND
2 1 506 500 517 AND
1 1 516 518 INV
1 1 517 519 INV
2 1 518 519 520 AND
1 1 520 521 INV
2 1 515 521 581 XOR
2 1 30 62 522 XOR
2 1 29 61 523 AND
2 1 513 507 524 AND
1 1 523 525 INV
1 1 524 526 INV
2 1 525 526 527 AND
1 1 527 528 INV
2 1 522 528 529 XOR
2 1 529 94 530 XOR
2 1 514 93 531 AND
2 1 521 515 532 AND
1 1 531 533 INV
1 1 532 534 INV
2 1 533 534 535 AND
1 1 535 536 INV
2 1 530 536 582 XOR
2 1 31 63 537 XOR
2 1 30 62 538 AND
2 1 528 522 539 AND
1 1 538 540 INV
1 1 539 541 INV
2 1 540 541 542 AND
1 1 542 543 INV
2 1 537 543 544 XOR
2 1 544 95 545 XOR
2 1 529 94 546 AND
2 1 536 530 547 AND
1 1 546 548 INV
1 1 547 549 INV
2 1 548 549 550 AND
1 1 550 551 INV
2 1 545 551 583 XOR
`;
