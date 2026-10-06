import { ApiError } from './errors.mjs';

// Keyboard, pointer, clipboard, power, resize and extended keyboard input.
const MUTATING = new Set([4, 5, 6, 250, 251, 255]);
export function createRfbFilter(canControl) {
  let state = 'version', pending = Buffer.alloc(0);
  function length(buffer) {
    switch (buffer[0]) {
      case 0: return 20;
      case 2: return buffer.length >= 4 ? 4 + 4 * buffer.readUInt16BE(2) : null;
      case 3: return 10;
      case 4: return 8;
      case 5: return 6;
      case 6: return buffer.length >= 8 ? 8 + Math.abs(buffer.readInt32BE(4)) : null;
      case 150: return 10;
      case 248: return buffer.length >= 9 ? 9 + buffer[8] : null;
      case 250: return 4;
      case 251: return buffer.length >= 8 ? 8 + 16 * buffer[6] : null;
      case 255: if (buffer.length < 2) return null; if (buffer[1] !== 0) throw new ApiError(400, 'rfb_protocol', 'Unsupported extended message'); return 12;
      default: throw new ApiError(400, 'rfb_protocol', 'Unsupported RFB message');
    }
  }
  return chunk => {
    pending = Buffer.concat([pending, Buffer.from(chunk)]);
    if (pending.length > 1024 * 1024) throw new ApiError(413, 'rfb_limit', 'RFB input exceeds limit');
    const result = [];
    while (pending.length) {
      let size;
      switch (state) {
        case 'version': size = 12; break;
        case 'security': size = 1; break;
        case 'init': size = 1; break;
        case 'normal': size = length(pending); break;
        default: throw new Error('Invalid RFB filter state');
      }
      if (size == null || pending.length < size) break;
      if (size > 1024 * 1024) throw new ApiError(413, 'rfb_limit', 'RFB message exceeds limit');
      const message = pending.subarray(0, size); pending = pending.subarray(size);
      switch (state) {
        case 'version': if (message.toString('ascii') !== 'RFB 003.008\n') throw new ApiError(400, 'rfb_protocol', 'RFB 3.8 required'); state = 'security'; result.push(message); break;
        case 'security': if (message[0] !== 1) throw new ApiError(400, 'rfb_protocol', 'Unexpected upstream security type'); state = 'init'; result.push(message); break;
        case 'init': state = 'normal'; result.push(message); break;
        case 'normal': if (!MUTATING.has(message[0]) || canControl()) result.push(message); break;
      }
    }
    return result;
  };
}
