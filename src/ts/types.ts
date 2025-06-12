export type IO = {
  send: (toParty: number, channel: 'a' | 'b', data: Uint8Array) => void;
  recv: (fromParty: number, channel: 'a' | 'b', min_len: number, max_len: number) => Promise<Uint8Array>;
  on?: (event: 'error', listener: (error: Error) => void) => void;
  off?: (event: 'error', listener: (error: Error) => void) => void;
  close?: () => void;
};
