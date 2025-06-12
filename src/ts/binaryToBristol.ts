/**
 * Decode the compact binary layout produced by `bristolToBinary`
 * back into a textual Bristol format string.
 *
 * Strict: any malformed input triggers an Error.
 */
export default function binaryToBristol(bytes: Uint8Array): string {
  if (bytes.byteLength < 20) throw new Error("Buffer shorter than 20-byte header");

  const view  = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset  = 0;
  const u32   = () => { const v = view.getUint32(offset, true); offset += 4; return v; };
  const u8    = () => { const v = view.getUint8(offset);        offset += 1; return v; };

  /* ---------- header ---------- */
  const header = [u32(), u32(), u32(), u32(), u32()];
  const lines: string[] = [
    `${header[0]} ${header[1]}`,
    `${header[2]} ${header[3]} ${header[4]}`,
    '',
  ];

  /* ---------- gates ---------- */
  const CODE_TO_NAME = ["INV", "XOR", "AND"] as const;
  const INPUT_COUNT  = [1, 2, 2] as const;
  const OUTPUT_COUNT = [1, 1, 1] as const;
  while (offset < bytes.byteLength) {
    const code = u8();
    if (code > 2) throw new Error(`Unknown gate code ${code} at byte ${offset - 1}`);

    const inCount  = INPUT_COUNT[code];
    const outCount = OUTPUT_COUNT[code];
    const wires: number[] = [];

    for (let i = 0; i < inCount + outCount; i++) {
      if (offset + 4 > bytes.byteLength) throw new Error("Truncated wire index");
      wires.push(u32());
    }
    lines.push(
      `${inCount} ${outCount} ${wires.join(" ")} ${CODE_TO_NAME[code]}`
    );
  }

  if (offset !== bytes.byteLength) throw new Error("Extra bytes after final gate");
  return lines.join("\n");
}
