// tsx cli.ts <portStart> <nParties> <partyIndex> <circuit> <inputBitsPerParty> <inputBits>

import * as net from 'net';
import fs from 'fs/promises';

import { BufferQueue, IO, secureMPC } from "../../src/ts";

async function main() {
  const args = process.argv.slice(2);
  const [portStartStr, nPartiesStr, partyIndexStr, circuitPath] = args.splice(0, 4);

  const portStart = Number(portStartStr);
  const nParties = Number(nPartiesStr);
  const partyIndex = Number(partyIndexStr);

  const inputBitsPerParty = args.splice(0, nParties).map(Number);

  if (args.length !== 1) {
    console.error('Usage: tsx cli.ts <portStart> <nParties> <partyIndex> <circuit> <inputBitsPerParty> <inputBits>');
    console.error(`got: tsx cli.ts ${process.argv.slice(2).join(' ')}`);
    process.exit(1);
  }

  let inputBits: Uint8Array;

  if (args[0] === '.') {
    inputBits = new Uint8Array(0);
  } else {
    inputBits = Uint8Array.from([...args[0]].map(Number));
  }

  const io = await makeTCPSocketIO('127.0.0.1', portStart, nParties, partyIndex);

  const circuit = await fs.readFile(circuitPath, 'utf-8');

  const output = await secureMPC({
    party: partyIndex,
    size: nParties,
    circuit,
    inputBits,
    inputBitsPerParty,
    io,
  });

  console.log([...output].map(x => x ? 1 : 0).join(''));
  process.exit(0);
}

async function makeTCPSocketIO(
  host: string,
  portStart: number,
  nParties: number,
  partyIndex: number,
): Promise<IO> {
  const sockets = await Promise.all(range(nParties).map(i => {
    if (i === partyIndex) {
      return [] as unknown as [WrappedSocket, WrappedSocket];
    }

    return connectToParty(host, portStart, nParties, partyIndex, i);
  }));

  return {
    send: (toParty, channel, data) => {
      const c = channel === 'a' ? 0 : 1;
      sockets[toParty][c].send(data);
    },
    recv: (fromParty, channel, min_len, max_len) => {
      const c = channel === 'a' ? 0 : 1;
      return sockets[fromParty][c].recv(min_len, max_len);
    },
  };
}

function calculatePorts(
  portStart: number,
  nParties: number,
  partyA: number,
  partyB: number,
) {
  let [partyMin, partyMax] = [partyA, partyB];

  if (partyMin > partyMax) {
    [partyMin, partyMax] = [partyMax, partyMin];
  }

  const p = portStart + 2 * (nParties * partyMin + partyMax);

  return tuple(p, p + 1);
}

class WrappedSocket {
  queue = new BufferQueue(64 * 1024);

  constructor(public sock: net.Socket) {
    sock.on('data', data => this.queue.push(data));
  }

  send(data: Uint8Array) {
    this.sock.write(data);
  }

  recv(min_len: number, max_len: number) {
    return this.queue.pop(min_len, max_len);
  }
}

async function connectToParty(
  host: string,
  portStart: number,
  nParties: number,
  partyIndex: number,
  otherPartyIndex: number,
) {
  const [portA, portB] = calculatePorts(
    portStart,
    nParties,
    partyIndex,
    otherPartyIndex,
  );

  let sockA: net.Socket;
  let sockB: net.Socket;

  if (partyIndex < otherPartyIndex) {
    [sockA, sockB] = await Promise.all([
      serveOneTCP(host, portA),
      serveOneTCP(host, portB),
    ]);
  } else {
    [sockA, sockB] = await Promise.all([
      connectTCP(host, portA),
      connectTCP(host, portB),
    ]);
  }

  return tuple(
    new WrappedSocket(sockA),
    new WrappedSocket(sockB),
  );
}

async function connectTCP(host: string, port: number): Promise<net.Socket> {
  for (let i = 0; i < 30; i++) {
    try {
      return await new Promise((resolve, reject) => {
        const sock = net.createConnection({ host, port }, () => {
          sock.off('error', reject);
          resolve(sock);
        });

        sock.once('error', reject);
      });
    } catch (e) {
      await new Promise(resolve => setTimeout(resolve, 20 * (1.3 ** i)));
    }
  }

  throw new Error('failed to connect');
}

function serveOneTCP(host: string, port: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const server = net.createServer((socket) => {
      // Got first connection, stop accepting more
      server.close();
      resolve(socket);
    });

    server.on('error', reject);

    server.listen(port, host, () => {
      // console.log(`Listening for a single connection on ${host}:${port}`);
    });
  });
}

/**
 * Create an array that will be interpreted as a tuple by TypeScript.
 * 
 * For example:
 *   ['one', 'two'] <= TS sees string[] (bad!)
 *   tuple('one', 'two') <= TS sees [string, string] (good!)
 */
function tuple<Args extends unknown[]>(...args: Args) {
  return args;
}

function range(limit: number) {
  let res: number[] = [];

  for (let i = 0; i < limit; i++) {
    res.push(i);
  }

  return res;
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
