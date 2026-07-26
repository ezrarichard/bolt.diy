import { describe, expect, it, vi } from 'vitest';
import {
  isBlockedVerificationHost,
  isTransientFetchFailure,
  isTransientHttpStatus,
  safeFetch,
  validateVerificationUrl,
} from './verificationHttp';

/** A minimal `fetch` double. Bodies are returned via `text()` (no stream), exercising `readBoundedBody`'s fallback path. */
function response(init: { status?: number; headers?: Record<string, string>; body?: string } = {}): Response {
  return {
    status: init.status ?? 200,
    headers: new Headers(init.headers ?? {}),
    text: async () => init.body ?? '',
    body: null,
  } as unknown as Response;
}

function streamingResponse(
  chunks: string[],
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  const encoder = new TextEncoder();

  return {
    status: init.status ?? 200,
    headers: new Headers(init.headers ?? {}),
    text: async () => chunks.join(''),
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }

        controller.close();
      },
    }),
  } as unknown as Response;
}

describe('validateVerificationUrl', () => {
  it('accepts a public https URL', () => {
    const result = validateVerificationUrl('https://my-app-abc123.vercel.app');
    expect(result.ok).toBe(true);
  });

  it('assumes https for a bare host', () => {
    const result = validateVerificationUrl('my-app-abc123.vercel.app');
    expect(result.ok && result.url.protocol).toBe('https:');
  });

  it('rejects a missing URL', () => {
    expect(validateVerificationUrl(undefined)).toMatchObject({ ok: false, code: 'missing_url' });
    expect(validateVerificationUrl('   ')).toMatchObject({ ok: false, code: 'missing_url' });
  });

  it('rejects a syntactically invalid URL', () => {
    expect(validateVerificationUrl('https://')).toMatchObject({ ok: false, code: 'invalid_url' });
  });

  it('rejects a non-http(s) scheme', () => {
    expect(validateVerificationUrl('ftp://example.com')).toMatchObject({ ok: false, code: 'unsupported_scheme' });
    expect(validateVerificationUrl('file:///etc/passwd')).toMatchObject({ ok: false, code: 'unsupported_scheme' });
  });

  it('rejects plain http for a public host', () => {
    expect(validateVerificationUrl('http://example.com')).toMatchObject({ ok: false, code: 'unsupported_scheme' });
  });

  it('rejects localhost and loopback', () => {
    for (const host of ['https://localhost', 'https://app.localhost', 'https://127.0.0.1', 'https://[::1]']) {
      expect(validateVerificationUrl(host)).toMatchObject({ ok: false, code: 'blocked_host' });
    }
  });

  it('rejects private network ranges', () => {
    for (const host of [
      'https://10.0.0.5',
      'https://172.16.4.2',
      'https://172.31.255.1',
      'https://192.168.1.1',
      'https://100.100.0.1',
    ]) {
      expect(validateVerificationUrl(host)).toMatchObject({ ok: false, code: 'blocked_host' });
    }
  });

  it('allows a public address that merely resembles a private one', () => {
    expect(validateVerificationUrl('https://172.32.0.1').ok).toBe(true);
    expect(validateVerificationUrl('https://11.0.0.1').ok).toBe(true);
  });

  it('rejects link-local and the cloud metadata endpoint', () => {
    expect(validateVerificationUrl('https://169.254.169.254')).toMatchObject({ ok: false, code: 'blocked_host' });
    expect(validateVerificationUrl('https://metadata.google.internal')).toMatchObject({
      ok: false,
      code: 'blocked_host',
    });
    expect(validateVerificationUrl('https://[fe80::1]')).toMatchObject({ ok: false, code: 'blocked_host' });
    expect(validateVerificationUrl('https://[fd00::1]')).toMatchObject({ ok: false, code: 'blocked_host' });
  });

  it('rejects an IPv4-mapped IPv6 address wrapping a blocked address', () => {
    expect(isBlockedVerificationHost('::ffff:169.254.169.254')).toBe(true);
    expect(isBlockedVerificationHost('::ffff:127.0.0.1')).toBe(true);
  });

  it('rejects a single-label internal hostname', () => {
    expect(validateVerificationUrl('https://intranet')).toMatchObject({ ok: false, code: 'blocked_host' });
  });

  it('permits http loopback only under the explicit test-only override', () => {
    expect(validateVerificationUrl('http://127.0.0.1:5173', { allowInsecureLocalTargets: true }).ok).toBe(true);
    expect(validateVerificationUrl('http://localhost:3000', { allowInsecureLocalTargets: true }).ok).toBe(true);
  });

  it('the test-only override cannot reach a production host — it fails closed', () => {
    expect(validateVerificationUrl('https://my-app.vercel.app', { allowInsecureLocalTargets: true })).toMatchObject({
      ok: false,
      code: 'blocked_host',
    });
    expect(validateVerificationUrl('https://169.254.169.254', { allowInsecureLocalTargets: true })).toMatchObject({
      ok: false,
      code: 'blocked_host',
    });
  });
});

describe('safeFetch', () => {
  it('returns a bounded success for a 200 HTML response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      response({
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
        body: '<html><body>hi</body></html>',
      }),
    );

    const result = await safeFetch('https://app.vercel.app', { fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(result.ok).toBe(true);
    expect(result.ok && result.status).toBe(200);
    expect(result.ok && result.body).toContain('hi');
    expect(result.ok && result.contentType).toContain('text/html');
  });

  it('never attaches credentials and always requests manual redirect handling', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response());
    await safeFetch('https://app.vercel.app', { fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://app.vercel.app/',
      expect.objectContaining({ credentials: 'omit', redirect: 'manual', method: 'GET' }),
    );
  });

  it('follows a safe redirect and reports the final URL', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(response({ status: 308, headers: { location: 'https://app.vercel.app/home' } }))
      .mockResolvedValueOnce(response({ status: 200, body: 'ok' }));

    const result = await safeFetch('https://app.vercel.app', { fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(result.ok && result.finalUrl).toBe('https://app.vercel.app/home');
    expect(result.ok && result.redirectCount).toBe(1);
  });

  it('refuses to follow a redirect to a blocked host', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(response({ status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data' } }));

    const result = await safeFetch('https://app.vercel.app', { fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(result).toMatchObject({ ok: false, code: 'unsafe_redirect' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('detects a redirect loop', async () => {
    const fetchImpl = vi.fn().mockImplementation((url: string) =>
      Promise.resolve(
        response({
          status: 302,
          headers: { location: url.includes('/a') ? 'https://app.vercel.app/b' : 'https://app.vercel.app/a' },
        }),
      ),
    );

    const result = await safeFetch('https://app.vercel.app/a', { fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(result).toMatchObject({ ok: false, code: 'redirect_loop' });
  });

  it('enforces the redirect limit', async () => {
    let hop = 0;
    const fetchImpl = vi.fn().mockImplementation(() => {
      hop += 1;
      return Promise.resolve(response({ status: 302, headers: { location: `https://app.vercel.app/hop-${hop}` } }));
    });

    const result = await safeFetch('https://app.vercel.app', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      maxRedirects: 2,
    });

    expect(result).toMatchObject({ ok: false, code: 'too_many_redirects' });
  });

  it('bounds the response size and cancels the stream', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(streamingResponse(['a'.repeat(100), 'b'.repeat(100)]));

    const result = await safeFetch('https://app.vercel.app', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      maxBytes: 120,
    });

    expect(result.ok && result.truncated).toBe(true);
    expect(result.ok && result.body.length).toBeLessThanOrEqual(120);
  });

  it('classifies an abort as a timeout', async () => {
    const fetchImpl = vi.fn().mockImplementation(() => {
      const error = new Error('aborted');
      error.name = 'AbortError';

      return Promise.reject(error);
    });

    const result = await safeFetch('https://app.vercel.app', { fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(result).toMatchObject({ ok: false, code: 'timeout' });
  });

  it('classifies a network failure', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('getaddrinfo ENOTFOUND'));

    const result = await safeFetch('https://app.vercel.app', { fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(result).toMatchObject({ ok: false, code: 'network_error' });
  });

  it('returns cancelled when the caller aborts', async () => {
    const controller = new AbortController();
    controller.abort();

    const fetchImpl = vi.fn();
    const result = await safeFetch('https://app.vercel.app', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      signal: controller.signal,
    });

    expect(result).toMatchObject({ ok: false, code: 'cancelled' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects an unsafe URL before issuing any request', async () => {
    const fetchImpl = vi.fn();
    const result = await safeFetch('https://127.0.0.1', { fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(result).toMatchObject({ ok: false, code: 'blocked_host' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('only surfaces allow-listed response headers, never cookies', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      response({
        headers: {
          'content-type': 'text/html',
          'set-cookie': 'session=super-secret',
          'x-vercel-error': 'NOT_FOUND',
        },
      }),
    );

    const result = await safeFetch('https://app.vercel.app', { fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(result.ok && result.headers).toEqual(expect.objectContaining({ 'x-vercel-error': 'NOT_FOUND' }));
    expect(result.ok && JSON.stringify(result.headers)).not.toContain('super-secret');
  });

  it('drops caller-supplied headers on a cross-origin redirect', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(response({ status: 302, headers: { location: 'https://elsewhere.example.com/' } }))
      .mockResolvedValueOnce(response({ status: 200, body: 'ok' }));

    await safeFetch('https://project.supabase.co/rest/v1/', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      headers: { apikey: 'public-anon-key' },
    });

    expect(JSON.stringify(fetchImpl.mock.calls[0][1].headers)).toContain('public-anon-key');
    expect(JSON.stringify(fetchImpl.mock.calls[1][1].headers)).not.toContain('public-anon-key');
  });
});

describe('transient classification', () => {
  it('treats timeouts and network errors as transient, and nothing else', () => {
    expect(isTransientFetchFailure('timeout')).toBe(true);
    expect(isTransientFetchFailure('network_error')).toBe(true);
    expect(isTransientFetchFailure('blocked_host')).toBe(false);
    expect(isTransientFetchFailure('redirect_loop')).toBe(false);
  });

  it('treats warm-up statuses as transient, and a real application error as not', () => {
    expect(isTransientHttpStatus(404)).toBe(true);
    expect(isTransientHttpStatus(503)).toBe(true);
    expect(isTransientHttpStatus(502)).toBe(true);
    expect(isTransientHttpStatus(500)).toBe(false);
    expect(isTransientHttpStatus(403)).toBe(false);
    expect(isTransientHttpStatus(200)).toBe(false);
  });
});
