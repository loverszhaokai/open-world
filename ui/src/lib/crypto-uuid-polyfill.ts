/**
 * crypto.randomUUID polyfill for non-secure contexts.
 *
 * Browsers expose crypto.randomUUID() only in a secure context (HTTPS, or
 * localhost). A self-hosted instance is commonly served over plain HTTP on a
 * LAN address, where the API is absent and every call site throws — including
 * the onboarding wizard, which leaves first-run setup unusable.
 *
 * crypto.getRandomValues() IS available in non-secure contexts, so this builds
 * a spec-compliant RFC 4122 v4 UUID from it, falling back to Math.random()
 * only if getRandomValues is missing as well. Where the native implementation
 * exists it is left untouched.
 */
function randomBytes16(): Uint8Array {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return bytes;
}

function uuidv4(): string {
  const b = randomBytes16();
  b[6] = (b[6] & 0x0f) | 0x40; // version 4
  b[8] = (b[8] & 0x3f) | 0x80; // variant 10
  const hex: string[] = [];
  for (let i = 0; i < 256; i++) hex.push((i + 0x100).toString(16).slice(1));
  return (
    hex[b[0]] + hex[b[1]] + hex[b[2]] + hex[b[3]] + "-" +
    hex[b[4]] + hex[b[5]] + "-" +
    hex[b[6]] + hex[b[7]] + "-" +
    hex[b[8]] + hex[b[9]] + "-" +
    hex[b[10]] + hex[b[11]] + hex[b[12]] + hex[b[13]] + hex[b[14]] + hex[b[15]]
  );
}

if (typeof globalThis.crypto === "undefined") {
  (globalThis as { crypto?: unknown }).crypto = {};
}
if (typeof globalThis.crypto.randomUUID !== "function") {
  Object.defineProperty(globalThis.crypto, "randomUUID", {
    value: uuidv4,
    configurable: true,
    writable: true,
  });
}

export {};
