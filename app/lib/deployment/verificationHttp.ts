/**
 * Verification Network Safety — Sprint 92, Part 24 (Security and Network Safety).
 *
 * Builders fetches URLs that come from operator/provider-controlled data (a Vercel deployment
 * alias stored on `builders_deployment_vercel`, an asset href parsed out of the returned HTML), so
 * every verification request goes through this module and nothing in the verification engine ever
 * calls `fetch` directly. It provides exactly two things:
 *
 *  1. `validateVerificationUrl` — SSRF screening. HTTPS only, and a deny-list covering localhost,
 *     loopback, RFC1918 private ranges, link-local (which includes the 169.254.169.254 cloud
 *     metadata endpoint), CGNAT, unique-local/link-local IPv6, IPv4-mapped IPv6, the well-known
 *     cloud metadata hostnames, and single-label (internal) hostnames.
 *  2. `safeFetch` — a bounded request. Redirects are followed MANUALLY so every hop is re-screened
 *     with the same rules (a permitted host redirecting to 169.254.169.254 is rejected at the hop,
 *     not followed), with a redirect-count cap and loop detection. Request duration, redirect
 *     count and response size are all bounded; the response body is read through a reader that
 *     stops and cancels the stream at `maxBytes`. No credential is ever attached, no cookie is
 *     ever returned, and only an allow-list of response headers is surfaced as evidence.
 *
 * Nothing here executes returned content — the body is only ever inspected as a string.
 *
 * `fetchImpl`, `now` and `sleep` are injectable throughout so the unit suite never touches a real
 * network and never waits on a real delay (Part 25).
 */

export type UrlRejectionCode = 'missing_url' | 'invalid_url' | 'unsupported_scheme' | 'blocked_host';

export interface UrlSafetyOptions {
  /**
   * TEST-ONLY escape hatch (Part 24's "explicit test-only override that cannot accidentally reach
   * production"). When true, `http://` and loopback hosts are permitted — AND, critically, every
   * NON-loopback host is rejected. The override therefore cannot widen access to a real
   * deployment: it can only ever point verification at a local test server. Nothing in the
   * application wires this to user input; only test fixtures pass it.
   */
  allowInsecureLocalTargets?: boolean;
}

export type UrlValidationResult = { ok: true; url: URL } | { ok: false; code: UrlRejectionCode; message: string };

const CLOUD_METADATA_HOSTNAMES = new Set([
  'metadata.google.internal',
  'metadata.goog',
  'metadata',
  'instance-data',
  'instance-data.ec2.internal',
]);

function isLoopbackHostname(hostname: string): boolean {
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    return true;
  }

  const ipv4 = parseIpv4(hostname);

  if (ipv4) {
    return ipv4[0] === 127;
  }

  const normalised = hostname.replace(/^\[|]$/g, '').toLowerCase();

  return normalised === '::1' || normalised === '0:0:0:0:0:0:0:1';
}

function parseIpv4(hostname: string): [number, number, number, number] | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);

  if (!match) {
    return null;
  }

  const octets = match.slice(1, 5).map((part) => Number(part));

  if (octets.some((octet) => Number.isNaN(octet) || octet > 255)) {
    return null;
  }

  return octets as [number, number, number, number];
}

/** Every range Part 24 requires blocking, plus multicast/reserved space, which is never a legitimate deployment target either. */
function isBlockedIpv4([a, b]: [number, number, number, number]): boolean {
  return (
    a === 0 || // "this network"
    a === 10 || // RFC1918
    a === 127 || // loopback
    (a === 169 && b === 254) || // link-local, includes the 169.254.169.254 metadata endpoint
    (a === 172 && b >= 16 && b <= 31) || // RFC1918
    (a === 192 && b === 168) || // RFC1918
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 192 && b === 0) || // IETF protocol assignments / 192.0.2.0 TEST-NET-1
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    a >= 224 // multicast + reserved
  );
}

function isBlockedIpv6(rawHostname: string): boolean {
  const host = rawHostname.replace(/^\[|]$/g, '').toLowerCase();

  if (!host.includes(':')) {
    return false;
  }

  if (host === '::' || host === '::1') {
    return true;
  }

  // IPv4-mapped/compatible (`::ffff:169.254.169.254`) — screen the embedded IPv4 with the same rules.
  const embedded = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(host);

  if (embedded) {
    const ipv4 = parseIpv4(embedded[1]);
    return ipv4 ? isBlockedIpv4(ipv4) : true;
  }

  const firstGroup = host.split(':')[0];

  // fc00::/7 unique-local, fe80::/10 link-local.
  return /^f[cd]/.test(firstGroup) || /^fe[89ab]/.test(firstGroup);
}

/** True for a host verification must never be pointed at. Also used to re-screen every redirect hop. */
export function isBlockedVerificationHost(hostname: string): boolean {
  const host = hostname.toLowerCase();

  if (CLOUD_METADATA_HOSTNAMES.has(host)) {
    return true;
  }

  if (isLoopbackHostname(host)) {
    return true;
  }

  const ipv4 = parseIpv4(host);

  if (ipv4) {
    return isBlockedIpv4(ipv4);
  }

  if (isBlockedIpv6(host)) {
    return true;
  }

  /*
   * A single-label hostname ("intranet", "router") can only resolve through a local search domain —
   * never a public deployment. Rejected rather than resolved, since this module deliberately does
   * no DNS itself (resolution happens inside `fetch`, after this screening, which is why the
   * deny-list is written against literals and names rather than resolved addresses).
   */
  return !host.includes('.');
}

export function validateVerificationUrl(
  raw: string | undefined | null,
  options: UrlSafetyOptions = {},
): UrlValidationResult {
  if (!raw || !raw.trim()) {
    return { ok: false, code: 'missing_url', message: 'No deployment URL is available to verify.' };
  }

  const candidate = raw.trim();
  const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(candidate) ? candidate : `https://${candidate}`;

  let url: URL;

  try {
    url = new URL(withScheme);
  } catch {
    return { ok: false, code: 'invalid_url', message: `"${candidate}" is not a valid URL.` };
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ok: false, code: 'unsupported_scheme', message: `Unsupported URL scheme: ${url.protocol}` };
  }

  if (options.allowInsecureLocalTargets) {
    /*
     * The override is loopback-ONLY on purpose — see `UrlSafetyOptions.allowInsecureLocalTargets`.
     * A caller that mistakenly leaves it enabled cannot reach a real deployment; it fails closed.
     */
    if (!isLoopbackHostname(url.hostname)) {
      return {
        ok: false,
        code: 'blocked_host',
        message: 'Local-target verification is restricted to loopback addresses.',
      };
    }

    return { ok: true, url };
  }

  if (url.protocol !== 'https:') {
    return { ok: false, code: 'unsupported_scheme', message: 'Verification requires an https:// URL.' };
  }

  if (isBlockedVerificationHost(url.hostname)) {
    return {
      ok: false,
      code: 'blocked_host',
      message: `Refusing to verify a private, loopback or metadata address (${url.hostname}).`,
    };
  }

  return { ok: true, url };
}

export type SafeFetchErrorCode =
  | UrlRejectionCode
  | 'timeout'
  | 'network_error'
  | 'redirect_loop'
  | 'too_many_redirects'
  | 'unsafe_redirect'
  | 'cancelled';

/** Response headers that may be surfaced as evidence. `set-cookie`, `authorization` echoes and anything else are dropped outright (Part 19/24). */
const EVIDENCE_HEADER_ALLOWLIST = [
  'content-type',
  'content-length',
  'cache-control',
  'content-security-policy',
  'strict-transport-security',
  'x-content-type-options',
  'x-frame-options',
  'referrer-policy',
  'x-vercel-error',
  'x-vercel-id',
  'server',
  'age',
] as const;

export interface SafeFetchOptions {
  method?: 'GET' | 'HEAD';
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  allowInsecureLocalTargets?: boolean;
  fetchImpl?: typeof fetch;
  now?: () => number;

  /** Operator cancellation (Part 20). Aborts the in-flight request and returns `{ code: 'cancelled' }`. */
  signal?: AbortSignal;

  /**
   * Extra request headers, for the ONE case Part 10 permits: a transiently-held public Supabase
   * anon key used for a read-only health query. Deliberately DROPPED on any redirect that leaves
   * the original origin, so a redirect can never exfiltrate them to another host. Never logged,
   * never placed in evidence, never persisted — the caller holds the value in memory only.
   */
  headers?: Record<string, string>;
}

export interface SafeFetchSuccess {
  ok: true;
  status: number;
  finalUrl: string;
  contentType?: string;
  headers: Record<string, string>;
  body: string;
  bytes: number;

  /** True when the response was longer than `maxBytes` and reading stopped early. */
  truncated: boolean;
  redirectCount: number;
  durationMs: number;
}

export interface SafeFetchFailure {
  ok: false;
  code: SafeFetchErrorCode;
  message: string;
  status?: number;
  finalUrl?: string;
  redirectCount: number;
  durationMs: number;
}

export type SafeFetchResult = SafeFetchSuccess | SafeFetchFailure;

export const DEFAULT_VERIFICATION_TIMEOUT_MS = 15_000;
export const DEFAULT_VERIFICATION_MAX_BYTES = 512 * 1024;
export const DEFAULT_VERIFICATION_MAX_REDIRECTS = 5;

function collectHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};

  for (const name of EVIDENCE_HEADER_ALLOWLIST) {
    const value = headers.get(name);

    if (value) {
      result[name] = value;
    }
  }

  return result;
}

/** Reads at most `maxBytes`, then cancels the stream — an unbounded/hostile response can never exhaust memory. Falls back to `text()` for a fetch implementation whose response exposes no stream (common in test doubles). */
async function readBoundedBody(
  response: Response,
  maxBytes: number,
): Promise<{ body: string; bytes: number; truncated: boolean }> {
  const stream = response.body as ReadableStream<Uint8Array> | null | undefined;

  if (!stream || typeof stream.getReader !== 'function') {
    const text = await response.text();
    const bytes = text.length;

    return bytes > maxBytes
      ? { body: text.slice(0, maxBytes), bytes, truncated: true }
      : { body: text, bytes, truncated: false };
  }

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let body = '';
  let bytes = 0;
  let truncated = false;

  try {
    for (;;) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      if (!value) {
        continue;
      }

      bytes += value.byteLength;

      if (bytes >= maxBytes) {
        const remaining = value.byteLength - (bytes - maxBytes);
        body += decoder.decode(value.slice(0, Math.max(remaining, 0)));
        truncated = true;
        break;
      }

      body += decoder.decode(value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }

  return { body, bytes, truncated };
}

/** Custom headers travel only while the request stays on the origin the caller aimed at. */
function sameOriginAsInitial(current: URL, original: URL): boolean {
  return current.origin === original.origin;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
}

/**
 * One bounded, SSRF-screened request. Redirects are resolved here rather than by `fetch` (via
 * `redirect: 'manual'`) so that every `Location` is validated with `validateVerificationUrl`
 * before being followed, loops are detected by exact-URL revisit, and the hop count is capped.
 */
export async function safeFetch(rawUrl: string, options: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => Date.now());
  const timeoutMs = options.timeoutMs ?? DEFAULT_VERIFICATION_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_VERIFICATION_MAX_BYTES;
  const maxRedirects = options.maxRedirects ?? DEFAULT_VERIFICATION_MAX_REDIRECTS;
  const startedAt = now();

  const initial = validateVerificationUrl(rawUrl, options);

  if (!initial.ok) {
    return { ok: false, code: initial.code, message: initial.message, redirectCount: 0, durationMs: now() - startedAt };
  }

  let current = initial.url;
  const visited = new Set<string>([current.toString()]);
  let redirectCount = 0;

  for (;;) {
    if (options.signal?.aborted) {
      return {
        ok: false,
        code: 'cancelled',
        message: 'Verification was cancelled.',
        redirectCount,
        durationMs: now() - startedAt,
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onExternalAbort = () => controller.abort();
    options.signal?.addEventListener('abort', onExternalAbort);

    let response: Response;

    try {
      response = await fetchImpl(current.toString(), {
        method: options.method ?? 'GET',
        redirect: 'manual',
        signal: controller.signal,

        // No credential of any kind is attached — no cookies, no Authorization, no custom auth header.
        credentials: 'omit',
        headers: {
          Accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
          ...(sameOriginAsInitial(current, initial.url) ? (options.headers ?? {}) : {}),
        },
      });
    } catch (error) {
      const cancelled = options.signal?.aborted === true;
      const durationMs = now() - startedAt;

      if (cancelled) {
        return { ok: false, code: 'cancelled', message: 'Verification was cancelled.', redirectCount, durationMs };
      }

      if (isAbortError(error)) {
        return {
          ok: false,
          code: 'timeout',
          message: `Request timed out after ${timeoutMs}ms.`,
          finalUrl: current.toString(),
          redirectCount,
          durationMs,
        };
      }

      return {
        ok: false,
        code: 'network_error',
        message: error instanceof Error ? error.message : 'Network request failed.',
        finalUrl: current.toString(),
        redirectCount,
        durationMs,
      };
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onExternalAbort);
    }

    const isRedirect = response.status >= 300 && response.status < 400 && response.headers.has('location');

    if (!isRedirect) {
      const { body, bytes, truncated } =
        (options.method ?? 'GET') === 'HEAD'
          ? { body: '', bytes: 0, truncated: false }
          : await readBoundedBody(response, maxBytes);

      return {
        ok: true,
        status: response.status,
        finalUrl: current.toString(),
        contentType: response.headers.get('content-type') ?? undefined,
        headers: collectHeaders(response.headers),
        body,
        bytes,
        truncated,
        redirectCount,
        durationMs: now() - startedAt,
      };
    }

    redirectCount += 1;

    if (redirectCount > maxRedirects) {
      return {
        ok: false,
        code: 'too_many_redirects',
        message: `Exceeded the ${maxRedirects}-redirect limit.`,
        status: response.status,
        finalUrl: current.toString(),
        redirectCount,
        durationMs: now() - startedAt,
      };
    }

    const location = response.headers.get('location') as string;
    let next: URL;

    try {
      next = new URL(location, current);
    } catch {
      return {
        ok: false,
        code: 'unsafe_redirect',
        message: `Redirect target is not a valid URL: ${location}`,
        status: response.status,
        finalUrl: current.toString(),
        redirectCount,
        durationMs: now() - startedAt,
      };
    }

    const hop = validateVerificationUrl(next.toString(), options);

    if (!hop.ok) {
      return {
        ok: false,
        code: 'unsafe_redirect',
        message: `Refusing to follow redirect to ${next.host}: ${hop.message}`,
        status: response.status,
        finalUrl: current.toString(),
        redirectCount,
        durationMs: now() - startedAt,
      };
    }

    if (visited.has(hop.url.toString())) {
      return {
        ok: false,
        code: 'redirect_loop',
        message: `Redirect loop detected at ${hop.url.toString()}.`,
        status: response.status,
        finalUrl: current.toString(),
        redirectCount,
        durationMs: now() - startedAt,
      };
    }

    visited.add(hop.url.toString());
    current = hop.url;
  }
}

/** Part 18 — failures worth one more attempt while a fresh serverless deployment warms up / an alias propagates. A persistent application error is deliberately absent from this list. */
export function isTransientFetchFailure(code: SafeFetchErrorCode): boolean {
  return code === 'timeout' || code === 'network_error';
}

/** Part 18 — HTTP statuses that are transient immediately after a deployment (alias not yet propagated, cold start, gateway warm-up). */
export function isTransientHttpStatus(status: number): boolean {
  return (
    status === 404 ||
    status === 408 ||
    status === 425 ||
    status === 429 ||
    status === 502 ||
    status === 503 ||
    status === 504
  );
}
