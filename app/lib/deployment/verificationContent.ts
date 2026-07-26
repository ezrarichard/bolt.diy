/**
 * Verification Content Analysis — Sprint 92, Parts 6/7/9.
 *
 * Pure string analysis over a fetched response: application-shell detection, high-confidence
 * platform error-page detection, and critical-asset discovery. No network, no state — every
 * function here is deterministic and directly unit-testable.
 *
 * Part 7's rule shapes the whole module: a deployment can return HTTP 200 while rendering an
 * error page, but broad text matching would reject legitimate customer content (a real
 * application is perfectly entitled to contain the words "internal server error" in its own copy).
 * So `detectErrorPage` only fires on markers that are (a) platform-emitted machine codes which no
 * hand-written page would contain, (b) the response's own `<title>` matching a small documented
 * list, or (c) a framework error-overlay element. Everything else is left alone.
 */

/** The generated template's own shell — `projectScaffolder.ts` writes `<div id="root"></div>` into every `index.html` it produces, so this is a known fact about Builders-generated applications, not a guess about applications in general. */
export const GENERATED_APP_ROOT_ELEMENT_ID = 'root';

export interface ErrorPageDetection {
  detected: boolean;

  /** A stable machine-readable identifier for the matched pattern, used as the check's `errorCode`. */
  code?: string;
  reason?: string;
}

interface ErrorPagePattern {
  code: string;
  reason: string;

  /** Matched against the raw HTML. Reserved for markers no legitimate page would contain. */
  bodyMarker?: RegExp;

  /** Matched against the extracted `<title>` only — safe for human-readable phrases. */
  titleMarker?: RegExp;
}

/**
 * Part 7 — the complete, deliberately small list. Every entry is either a platform error CODE
 * (Vercel emits these verbatim in its error pages and in the `x-vercel-error` header) or a
 * framework overlay element. The human-readable phrases are matched against `<title>` only.
 */
const ERROR_PAGE_PATTERNS: ErrorPagePattern[] = [
  {
    code: 'vercel_deployment_not_found',
    reason: 'Vercel reports this deployment does not exist (DEPLOYMENT_NOT_FOUND).',
    bodyMarker: /DEPLOYMENT_NOT_FOUND/,
  },
  {
    code: 'vercel_deployment_disabled',
    reason: 'Vercel reports this deployment is paused or disabled.',
    bodyMarker: /DEPLOYMENT_(PAUSED|DISABLED|BLOCKED|DELETED)/,
  },
  {
    code: 'vercel_function_invocation_failed',
    reason: 'A Vercel serverless function failed to execute (FUNCTION_INVOCATION_FAILED).',
    bodyMarker: /FUNCTION_INVOCATION_(FAILED|TIMEOUT)/,
  },
  {
    code: 'vercel_no_build_output',
    reason: 'Vercel served a deployment with no usable build output (NOT_FOUND / NO_RESPONSE_FROM_FUNCTION).',
    bodyMarker: /NO_RESPONSE_FROM_FUNCTION|MIDDLEWARE_INVOCATION_FAILED/,
  },
  {
    code: 'vercel_dns_error',
    reason: 'Vercel could not resolve this deployment (DNS_HOSTNAME_NOT_FOUND).',
    bodyMarker: /DNS_HOSTNAME_(NOT_FOUND|RESOLVE_FAILED)/,
  },
  {
    code: 'framework_error_overlay',
    reason: 'A framework error overlay is being rendered instead of the application.',
    bodyMarker: /<vite-error-overlay|id="__next-build-watcher"[^>]*data-error|nextjs__container_errors/,
  },
  {
    code: 'client_side_exception',
    reason: 'The application crashed on load with an unhandled client-side exception.',
    bodyMarker: /Application error: a (client|server)-side exception has occurred/,
  },
  {
    code: 'no_server_handler',
    reason: 'No route handler responded — the server returned a bare "Cannot GET" page.',
    bodyMarker: /^\s*<pre>Cannot (GET|HEAD) /m,
  },
  {
    code: 'error_page_title',
    reason: 'The page title identifies a platform error page rather than the application.',
    titleMarker:
      /^(\s*)(404|500|502|503)?[\s:—-]*(Application Error|Internal Server Error|Server Error|This page could not be found|Page Not Found|Not Found|Service Unavailable|Bad Gateway|Deployment not found)(\s*)$/i,
  },
];

export function extractTitle(html: string): string | undefined {
  const match = /<title[^>]*>([\s\S]{0,300}?)<\/title>/i.exec(html);
  return match ? match[1].trim() : undefined;
}

/** Part 7. `vercelErrorHeader` is the `x-vercel-error` response header, which Vercel sets on its own error pages and never on a successfully-served application. */
export function detectErrorPage(html: string, vercelErrorHeader?: string): ErrorPageDetection {
  if (vercelErrorHeader) {
    return {
      detected: true,
      code: 'vercel_error_header',
      reason: `Vercel returned an error response (x-vercel-error: ${vercelErrorHeader}).`,
    };
  }

  const title = extractTitle(html);

  for (const pattern of ERROR_PAGE_PATTERNS) {
    if (pattern.bodyMarker?.test(html)) {
      return { detected: true, code: pattern.code, reason: pattern.reason };
    }

    if (title && pattern.titleMarker?.test(title)) {
      return { detected: true, code: pattern.code, reason: `${pattern.reason} (title: "${title}")` };
    }
  }

  return { detected: false };
}

export interface ApplicationShellAnalysis {
  hasHtmlDocument: boolean;
  hasBody: boolean;
  hasRootElement: boolean;
  hasModuleScript: boolean;

  /** True when the document parses as HTML but renders nothing — a `<body>` whose only child is an empty root div AND which loads no script at all. */
  isEmptyShell: boolean;
  title?: string;
}

/**
 * Part 6 step 5. "Shell present" for a Builders-generated application means: a real HTML document,
 * a `<body>`, the template's own `#root` mount point, and at least one script that would populate
 * it. An empty `#root` on its own is NORMAL (that is exactly what a client-rendered Vite build
 * ships) — it is only a failure when nothing is loaded to fill it, which is what `isEmptyShell`
 * distinguishes.
 */
export function analyseApplicationShell(html: string): ApplicationShellAnalysis {
  const hasHtmlDocument = /<html[\s>]/i.test(html) || /<!doctype\s+html/i.test(html);
  const hasBody = /<body[\s>]/i.test(html);
  const hasRootElement = new RegExp(`id=["']${GENERATED_APP_ROOT_ELEMENT_ID}["']`, 'i').test(html);
  const hasModuleScript = /<script[^>]+src=["'][^"']+["']/i.test(html);
  const bodyMatch = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(html);
  const bodyInner = bodyMatch ? bodyMatch[1] : '';
  const bodyWithoutEmptyMounts = bodyInner.replace(/<div[^>]*>\s*<\/div>/gi, '').trim();

  return {
    hasHtmlDocument,
    hasBody,
    hasRootElement,
    hasModuleScript,
    isEmptyShell: hasBody && bodyWithoutEmptyMounts.length === 0 && !hasModuleScript,
    title: extractTitle(html),
  };
}

export type DiscoveredAssetKind = 'script' | 'stylesheet' | 'icon';

export interface DiscoveredAsset {
  kind: DiscoveredAssetKind;
  url: string;

  /** Same-origin assets are the ones this deployment is responsible for; a third-party CDN asset is never treated as critical (Part 9). */
  sameOrigin: boolean;

  /** A same-origin script or stylesheet is critical — without it the page cannot render. An icon never is. */
  critical: boolean;
}

/**
 * Part 9 — discovers the assets the returned HTML itself references. Bounded by `maxAssets` and
 * ordered scripts-then-stylesheets-then-icon so the bound always keeps the most critical ones.
 * Only `src`/`href` values already present in the document are returned; nothing is constructed or
 * guessed.
 */
export function discoverCriticalAssets(html: string, baseUrl: string, maxAssets = 6): DiscoveredAsset[] {
  let base: URL;

  try {
    base = new URL(baseUrl);
  } catch {
    return [];
  }

  const found: DiscoveredAsset[] = [];
  const seen = new Set<string>();

  const push = (rawHref: string, kind: DiscoveredAssetKind) => {
    let resolved: URL;

    try {
      resolved = new URL(rawHref, base);
    } catch {
      return;
    }

    if (resolved.protocol !== 'https:' && resolved.protocol !== 'http:') {
      return;
    }

    const url = resolved.toString();

    if (seen.has(url)) {
      return;
    }

    seen.add(url);

    const sameOrigin = resolved.origin === base.origin;
    found.push({ kind, url, sameOrigin, critical: sameOrigin && kind !== 'icon' });
  };

  for (const match of html.matchAll(/<script[^>]+src=["']([^"']+)["'][^>]*>/gi)) {
    push(match[1], 'script');
  }

  for (const match of html.matchAll(/<link[^>]+>/gi)) {
    const tag = match[0];
    const hrefMatch = /href=["']([^"']+)["']/i.exec(tag);

    if (!hrefMatch) {
      continue;
    }

    if (/rel=["'][^"']*stylesheet[^"']*["']/i.test(tag)) {
      push(hrefMatch[1], 'stylesheet');
    } else if (/rel=["'][^"']*icon[^"']*["']/i.test(tag)) {
      push(hrefMatch[1], 'icon');
    }
  }

  const order: Record<DiscoveredAssetKind, number> = { script: 0, stylesheet: 1, icon: 2 };

  return found.sort((a, b) => order[a.kind] - order[b.kind]).slice(0, maxAssets);
}

/** Part 6 step 4 — an HTML response is expected for the application shell; anything else means the deployment is not serving the app. */
export function isHtmlContentType(contentType: string | undefined): boolean {
  if (!contentType) {
    return false;
  }

  return /^(text\/html|application\/xhtml\+xml)/i.test(contentType.trim());
}
