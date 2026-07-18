/**
 * Shared FNV-1a (32-bit) hash — Sprint 44.2.
 *
 * Used wherever this codebase needs a deterministic, non-cryptographic change-detection
 * fingerprint (manifest structure, file content, Product Package content) rather than a
 * security boundary. Deliberately not Node's `crypto` module — this runs in the browser,
 * a Cloudflare Worker, and the Node test runner alike, and a plain hash is enough for
 * "did this change" comparisons.
 */
export function fnv1aHash(text: string): string {
  let hash = 0x811c9dc5;

  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }

  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
