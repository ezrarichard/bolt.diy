import { describe, expect, it } from 'vitest';
import {
  analyseApplicationShell,
  detectErrorPage,
  discoverCriticalAssets,
  extractTitle,
  isHtmlContentType,
} from './verificationContent';

/** The exact shape `projectScaffolder.ts` generates, after a production Vite build. */
const GENERATED_SHELL = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Riverside Dental Clinic</title>
    <script type="module" crossorigin src="/assets/index-a1b2c3.js"></script>
    <link rel="stylesheet" href="/assets/index-d4e5f6.css" />
    <link rel="icon" href="/favicon.svg" />
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>`;

describe('analyseApplicationShell', () => {
  it('accepts a generated application shell', () => {
    const shell = analyseApplicationShell(GENERATED_SHELL);

    expect(shell).toMatchObject({
      hasHtmlDocument: true,
      hasBody: true,
      hasRootElement: true,
      hasModuleScript: true,
      isEmptyShell: false,
    });
    expect(shell.title).toBe('Riverside Dental Clinic');
  });

  it('flags a document with a root element but no script as an empty shell', () => {
    const shell = analyseApplicationShell('<html><body><div id="root"></div></body></html>');

    expect(shell.isEmptyShell).toBe(true);
  });

  it('does not flag a server-rendered page with content but no root div', () => {
    const shell = analyseApplicationShell('<html><body><h1>Welcome</h1></body></html>');

    expect(shell.isEmptyShell).toBe(false);
    expect(shell.hasRootElement).toBe(false);
  });

  it('reports a non-HTML payload as having no document', () => {
    const shell = analyseApplicationShell('{"error":"nope"}');

    expect(shell.hasHtmlDocument).toBe(false);
    expect(shell.hasBody).toBe(false);
  });
});

describe('detectErrorPage', () => {
  it('does not fire on a legitimate application page', () => {
    expect(detectErrorPage(GENERATED_SHELL).detected).toBe(false);
  });

  it('does not fire on customer copy that merely mentions errors', () => {
    const page = `<html><head><title>Riverside Dental Clinic</title></head><body>
      <h1>Support</h1><p>If you see an internal server error, please contact us. Page not found? Try search.</p>
      <script src="/assets/index.js"></script></body></html>`;

    expect(detectErrorPage(page).detected).toBe(false);
  });

  it('fires on the x-vercel-error header', () => {
    const detection = detectErrorPage(GENERATED_SHELL, 'DEPLOYMENT_NOT_FOUND');

    expect(detection).toMatchObject({ detected: true, code: 'vercel_error_header' });
  });

  it('fires on a Vercel platform error code in the body, even with HTTP 200', () => {
    const detection = detectErrorPage('<html><body>404: NOT_FOUND<br>Code: DEPLOYMENT_NOT_FOUND</body></html>');

    expect(detection).toMatchObject({ detected: true, code: 'vercel_deployment_not_found' });
  });

  it('fires on a failed serverless function', () => {
    expect(detectErrorPage('<html><body>FUNCTION_INVOCATION_FAILED</body></html>')).toMatchObject({
      detected: true,
      code: 'vercel_function_invocation_failed',
    });
  });

  it('fires on a client-side exception page', () => {
    const detection = detectErrorPage(
      '<html><body><div id="root"></div>Application error: a client-side exception has occurred</body></html>',
    );

    expect(detection).toMatchObject({ detected: true, code: 'client_side_exception' });
  });

  it('fires on a framework error overlay', () => {
    expect(detectErrorPage('<html><body><vite-error-overlay></vite-error-overlay></body></html>')).toMatchObject({
      detected: true,
      code: 'framework_error_overlay',
    });
  });

  it('fires on an error-page title', () => {
    for (const title of ['404: This page could not be found', 'Internal Server Error', 'Application Error']) {
      expect(detectErrorPage(`<html><head><title>${title}</title></head><body></body></html>`).detected).toBe(true);
    }
  });

  it('does not fire when the error phrase is only part of a longer real title', () => {
    expect(
      detectErrorPage('<html><head><title>Not Found Furniture — Vintage Store</title></head><body></body></html>')
        .detected,
    ).toBe(false);
  });
});

describe('discoverCriticalAssets', () => {
  it('discovers the primary bundle, stylesheet and icon, marking only same-origin script/css critical', () => {
    const assets = discoverCriticalAssets(GENERATED_SHELL, 'https://app.vercel.app/');

    expect(assets.map((asset) => asset.kind)).toEqual(['script', 'stylesheet', 'icon']);
    expect(assets[0]).toMatchObject({ url: 'https://app.vercel.app/assets/index-a1b2c3.js', critical: true });
    expect(assets[1]).toMatchObject({ url: 'https://app.vercel.app/assets/index-d4e5f6.css', critical: true });
    expect(assets[2].critical).toBe(false);
  });

  it('never treats a third-party asset as critical', () => {
    const assets = discoverCriticalAssets(
      '<html><head><script src="https://cdn.example.com/analytics.js"></script></head><body></body></html>',
      'https://app.vercel.app/',
    );

    expect(assets[0]).toMatchObject({ sameOrigin: false, critical: false });
  });

  it('bounds the number of assets returned, keeping scripts first', () => {
    const html = `<html><head>
      <link rel="stylesheet" href="/a.css" /><link rel="stylesheet" href="/b.css" />
      <script src="/one.js"></script><script src="/two.js"></script><script src="/three.js"></script>
    </head><body></body></html>`;

    const assets = discoverCriticalAssets(html, 'https://app.vercel.app/', 3);

    expect(assets).toHaveLength(3);
    expect(assets.every((asset) => asset.kind === 'script')).toBe(true);
  });

  it('returns nothing for HTML with no assets', () => {
    expect(discoverCriticalAssets('<html><body>hi</body></html>', 'https://app.vercel.app/')).toEqual([]);
  });
});

describe('content-type helpers', () => {
  it('accepts HTML content types only', () => {
    expect(isHtmlContentType('text/html; charset=utf-8')).toBe(true);
    expect(isHtmlContentType('application/xhtml+xml')).toBe(true);
    expect(isHtmlContentType('application/json')).toBe(false);
    expect(isHtmlContentType(undefined)).toBe(false);
  });

  it('extracts a title', () => {
    expect(extractTitle('<title>  Hello  </title>')).toBe('Hello');
    expect(extractTitle('<html><body></body></html>')).toBeUndefined();
  });
});
