const hasAtob = typeof globalThis.atob === 'function';
const hasBtoa = typeof globalThis.btoa === 'function';

export const base64ToBytes = (value: string): Uint8Array => {
  if (hasAtob) {
    const binary = globalThis.atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(value, 'base64'));
  }
  throw new Error('Base64 decoder is unavailable.');
};

export const bytesToBase64 = (bytes: Uint8Array): string => {
  if (hasBtoa) {
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode(...chunk);
    }
    return globalThis.btoa(binary);
  }
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  throw new Error('Base64 encoder is unavailable.');
};
