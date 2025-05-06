/**
 * Converts a byte value to a channel identifier.
 * @param byte - The byte value to convert
 * @returns The channel identifier ('a' or 'b')
 * @throws {Error} If the byte doesn't correspond to a valid channel
 */
export function channelFromByte(byte: number): 'a' | 'b' {
  switch (byte) {
    case 'a'.charCodeAt(0):
      return 'a';
    case 'b'.charCodeAt(0):
      return 'b';
    default:
      throw new Error('Invalid channel');
  }
}

/**
 * Converts a channel identifier to its byte representation.
 * @param channel - The channel identifier ('a' or 'b')
 * @returns The byte representation of the channel
 * @throws {Error} If the channel is invalid
 */
export function byteFromChannel(channel: 'a' | 'b'): number {
  switch (channel) {
    case 'a':
      return 'a'.charCodeAt(0);
    case 'b':
      return 'b'.charCodeAt(0);
    default:
      throw new Error('Invalid channel');
  }
}
