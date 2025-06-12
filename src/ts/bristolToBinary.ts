/**
 * **Strict** converter from a (restricted) Bristol-format string to a compact
 * binary representation.
 *
 *  Layout (little-endian)
 *  ┌────────────┬─────────────────────────────────────────────┐
 *  │ bytes 0-19 │ five 32-bit unsigned ints (exactly as given)│
 *  │ …          │ repeated gate records                       │
 *  │            │   1 byte  gate-type  (0 INV, 1 XOR, 2 AND)  │
 *  │            │   INV : 2 × uint32  (in,  out)              │
 *  │            │   XOR/AND: 3 × uint32 (in1,in2,out)         │
 *  └────────────┴─────────────────────────────────────────────┘
 *
 *  Any deviation from the expected syntax throws an Error.
 */
export default function bristolToBinary(source: string): Uint8Array {
  /* ---------- helpers ---------- */
  const toInt = (tok: string, ctx: string) => {
    if (!/^-?\d+$/.test(tok)) throw new Error(`Expected integer for ${ctx}, got "${tok}"`);
    return Number(tok);
  };

  /* ---------- split lines (keep blank lines for validation) ---------- */
  const rawLines = source.split(/\r?\n/);
  if (rawLines.length < 3) throw new Error("Input too short – missing header or gates");

  /* ---------- header ---------- */
  const h1 = rawLines[0].trim().split(/\s+/);
  const h2 = rawLines[1].trim().split(/\s+/);
  if (h1.length !== 2) throw new Error("Header line 1: expected exactly 2 numbers");
  if (h2.length !== 3) throw new Error("Header line 2: expected exactly 3 numbers");
  const header = [...h1, ...h2].map((t, i) => toInt(t, `header[${i}]`));

  /* ---------- gate parsing ---------- */
  const GATE_CODE = { INV: 0, XOR: 1, AND: 2 } as const;
  type Gate = { code: number; wires: number[] };

  const gates: Gate[] = [];
  for (let ln = 2; ln < rawLines.length; ln++) {
    const line = rawLines[ln].trim();
    if (line === "") continue; // allow a single blank separator – still not “ignored”
    const parts = line.split(/\s+/);

    if (parts.length < 5) throw new Error(`Line ${ln + 1}: too few tokens`);

    const inCount  = toInt(parts[0], "input-count");
    const outCount = toInt(parts[1], "output-count");
    const gateType = parts[parts.length - 1] as keyof typeof GATE_CODE;

    if (!(gateType in GATE_CODE)) throw new Error(`Line ${ln + 1}: unknown gate type "${gateType}"`);

    /* verify the (k inputs, l outputs) pair agrees with the opcode */
    const expected = gateType === "INV" ? [1, 1] : [2, 1];
    if (inCount !== expected[0] || outCount !== expected[1]) {
      throw new Error(
        `Line ${ln + 1}: counts ${inCount}-in/${outCount}-out contradict gate type ${gateType}`
      );
    }

    const wireTokens = parts.slice(2, 2 + inCount + outCount);
    if (wireTokens.length !== inCount + outCount) {
      throw new Error(`Line ${ln + 1}: expected ${inCount + outCount} wire indices`);
    }

    const wires = wireTokens.map((t, i) => toInt(t, `wire[${i}]`));

    /* ensure no trailing garbage */
    if (parts.length !== 2 + wires.length + 1) {
      throw new Error(`Line ${ln + 1}: unexpected extra tokens`);
    }

    gates.push({ code: GATE_CODE[gateType], wires });
  }

  if (gates.length === 0) throw new Error("No gate definitions found");

  /* ---------- allocate & write ---------- */
  const byteLength =
    5 * 4 +
    gates.reduce((sum, g) => sum + 1 + g.wires.length * 4, 0);

  const buf = new ArrayBuffer(byteLength);
  const view = new DataView(buf);
  let off = 0;
  const w32 = (v: number) => { view.setUint32(off, v >>> 0, true); off += 4; };
  const w8  = (v: number) => { view.setUint8(off, v); off += 1; };

  header.forEach(w32);
  gates.forEach(({ code, wires }) => {
    w8(code);
    wires.forEach(w32);
  });

  return new Uint8Array(buf);
}
