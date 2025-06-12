import { expect } from "chai";

import bristolToBinary from '../src/ts/bristolToBinary';
import binaryToBristol from '../src/ts/binaryToBristol';

const normalise = (s: string) =>
  s
    .trim()
    .replace(/\r?\n/g, "\n")          // LF only
    .split("\n")
    .map(l => l.trimEnd())            // drop trailing spaces/tabs
    .join("\n");

describe("Bristol ⇆ Binary round-trip", () => {
  const samples: string[] = [
    `106601 107113
512 0 160

1 1 177 749 INV
2 1 30 31 3599 XOR
1 1 55 4100 INV
1 1 62 4246 INV
1 1 83 3297 INV`,
    // a smaller second sample to be sure different sizes round-trip
    `2 3
1 0 0

1 1 0 1 INV
2 1 0 1 2 AND`,
  ];

  samples.forEach((src, i) => {
    it(`sample ${i + 1} should round-trip exactly`, () => {
      const bin   = bristolToBinary(src);
      const text  = binaryToBristol(bin);
      expect(normalise(text)).to.equal(normalise(src));
    });
  });

  it("decoding an opcode-corrupted buffer should throw", () => {
    const good = bristolToBinary(samples[0]);

    // Byte 20 (index 20) is the first gate's opcode. 0/1/2 are valid; 0xFF is not.
    const bad  = new Uint8Array(good);
    bad[20] = 0xFF;

    expect(() => binaryToBristol(bad)).to.throw();
  });
});
