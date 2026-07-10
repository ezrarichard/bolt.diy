import { useId } from 'react';
import { classNames } from '~/utils/classNames';

/**
 * Sprint 41.2 — Builders logo system.
 *
 * Three reusable, inline-SVG components adapted from the brand SVG source (a compact 64×64
 * icon mark and a large 900×520 icon+wordmark+tagline lockup). Every gradient/filter `id`
 * is generated per-instance via `useId()` so rendering the same component more than once on
 * a page (e.g. header + collapsed sidebar) never collides — SVG `id`s are global to the
 * document, not scoped to the element.
 *
 * No external image hosting, no base64, no canvas — plain inline SVG, matching every other
 * icon in this app (Phosphor via UnoCSS) and letting `currentColor`/CSS apply where used.
 */

/**
 * Sprint 41.4 — one consistent palette, no light/dark variants (removed the Sprint 41.3
 * `variant` prop/theme-store inference entirely — that approach brightened the B's gradient
 * per theme, but the brace and code symbol still shared that SAME bright gradient at full
 * strength, so brightening it made the brace's C-shaped curve read as strongly as the B's
 * actual shape — at a glance the two competing bright strokes fused into a single rounded
 * "C"-like silhouette instead of a "B". Fixed by making the B the only element using the
 * bright gradient; the brace/code symbol now use a flat, dimmer, lower-opacity color so they
 * visually support the B instead of competing with it — same treatment in both themes, since
 * the icon's own card (`fill="#211733"`) never changes anyway.
 *
 * Sprint 41.5 — measured actual rendered pixels (canvas sampling) against the dark card: the
 * brace, blended at 0.75 opacity, landed at ~rgb(155,141,202) — not far enough below the B
 * gradient's own dimmest stop (`#c084fc` = rgb(192,132,252)) to read as clearly secondary once
 * the whole icon sits on a dark page. Two changes, still one palette in both themes: the
 * gradient's bright stop now covers more of the shape (offset pushed from 50%→65%, colors
 * unchanged) so more of the B reads bright, and the detail opacity drops from 0.75→0.55 so
 * the brace/code sit further back from the B regardless of surrounding theme.
 */
const DETAIL_COLOR = '#c4b5fd';
const DETAIL_OPACITY = 0.55;

interface BuildersLogoMarkProps {
  className?: string;
  size?: number;
  title?: string;
}

/** Compact square icon — header, collapsed sidebar, login screen, future favicon. */
export function BuildersLogoMark({ className, size = 32, title = 'Builders' }: BuildersLogoMarkProps) {
  const gradientId = useId();

  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-label={title}
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>{title}</title>
      <defs>
        <linearGradient id={gradientId} x1="8" y1="5" x2="57" y2="59">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="65%" stopColor="#e9d5ff" />
          <stop offset="100%" stopColor="#c084fc" />
        </linearGradient>
      </defs>

      <rect x="1" y="1" width="62" height="62" rx="16" fill="#211733" stroke="#a78bfa" strokeOpacity="0.45" />

      {/* Main B mark — the only element using the bright gradient, so it stays the dominant shape. */}
      <path
        d="M25 12H39C47 12 52 16 52 23C52 27 50 30 46 32C51 34 54 38 54 43C54 50 48 54 39 54H27V46H39C43 46 46 44 46 41C46 38 43 36 39 36H31L27 30H39C43 30 45 28 45 25C45 22 43 20 39 20H27V14H25Z"
        fill={`url(#${gradientId})`}
      />

      {/* Left brace — flat, dimmer color (not the B's gradient) so it supports the B instead of forming a second, equally-bright focal shape. */}
      <path
        d="M24 24C20 24 19 27 19 30C19 33 18 34 16 35C18 36 19 38 19 41C19 44 20 47 24 47"
        fill="none"
        stroke={DETAIL_COLOR}
        strokeOpacity={DETAIL_OPACITY}
        strokeWidth="4"
        strokeLinecap="round"
      />

      {/* Code symbol — same dimmer color, plus a touch thinner than before so it reads as a supporting detail, not a competing shape. */}
      <path
        d="M30 31L27 34L30 37M38 31L41 34L38 37M36 29L33 39"
        fill="none"
        stroke={DETAIL_COLOR}
        strokeOpacity={DETAIL_OPACITY}
        strokeWidth="2"
        strokeLinecap="square"
        strokeLinejoin="miter"
      />

      <rect x="19" y="9" width="4" height="4" rx="1" fill="#f3e8ff" />
      <rect x="24" y="12" width="3" height="3" rx="0.7" fill="#d8b4fe" />
      <rect x="20" y="16" width="3" height="3" rx="0.7" fill="#a855f7" />
    </svg>
  );
}

interface BuildersWordmarkProps {
  className?: string;
  textClassName?: string;
  iconSize?: number;
  title?: string;
}

/** Compact horizontal brand — icon + "Builders" text. Top app header, login screen. */
export function BuildersWordmark({
  className,
  textClassName = 'text-bolt-elements-textPrimary',
  iconSize = 28,
  title = 'Builders',
}: BuildersWordmarkProps) {
  return (
    <span className={classNames('inline-flex items-center gap-2', className)}>
      <BuildersLogoMark size={iconSize} title={title} />
      <span className={classNames('text-[17px] font-bold tracking-tight leading-none', textClassName)}>{title}</span>
    </span>
  );
}

interface BuildersFullLogoProps {
  className?: string;
  title?: string;
}

/**
 * Large icon + wordmark + tagline lockup — login screen / About section only. Not for the
 * sidebar (fixed at 900×520 viewBox aspect ratio, far too wide for the 72–320px sidebar).
 */
export function BuildersFullLogo({ className, title = 'Builders' }: BuildersFullLogoProps) {
  const gradientId = useId();
  const textGradientId = useId();
  const glowId = useId();
  const titleId = useId();
  const descId = useId();

  return (
    <svg
      className={className}
      viewBox="0 0 900 520"
      role="img"
      aria-labelledby={`${titleId} ${descId}`}
      xmlns="http://www.w3.org/2000/svg"
    >
      <title id={titleId}>{title}</title>
      <desc id={descId}>Builders AI Product Engineering Workspace logo</desc>

      <defs>
        <linearGradient id={gradientId} x1="240" y1="90" x2="640" y2="420" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#f4eaff" />
          <stop offset="42%" stopColor="#d3b0ff" />
          <stop offset="100%" stopColor="#8d46f5" />
        </linearGradient>

        <linearGradient id={textGradientId} x1="220" y1="350" x2="680" y2="440" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#f5edff" />
          <stop offset="50%" stopColor="#d2adff" />
          <stop offset="100%" stopColor="#9b59ff" />
        </linearGradient>

        <filter id={glowId} x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="8" result="blur" />
          <feColorMatrix
            in="blur"
            type="matrix"
            values="0.62 0 0 0 0  0 0.31 0 0 0  0 0 1 0 0  0 0 0 0.45 0"
            result="purpleBlur"
          />
          <feMerge>
            <feMergeNode in="purpleBlur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Icon glow */}
      <g opacity="0.3" filter={`url(#${glowId})`}>
        <path
          d="M365 78H520C605 78 659 119 659 185C659 232 632 263 591 278C639 293 668 329 668 378C668 453 609 489 520 489H382V424H516C561 424 587 407 587 376C587 344 561 329 516 329H427V264H510C552 264 577 247 577 216C577 186 552 170 510 170H382V118L365 118Z"
          fill="#9555ff"
        />
      </g>

      {/* Pixel fragments */}
      <g fill={`url(#${gradientId})`}>
        <rect x="306" y="66" width="18" height="18" rx="3" />
        <rect x="336" y="69" width="12" height="12" rx="2" />
        <rect x="322" y="93" width="20" height="20" rx="3" />
        <rect x="350" y="96" width="27" height="27" rx="4" />
        <rect x="303" y="118" width="13" height="13" rx="2" />
        <rect x="326" y="127" width="22" height="22" rx="3" />
        <rect x="355" y="132" width="17" height="17" rx="3" />
        <rect x="319" y="158" width="10" height="10" rx="2" />
        <rect x="337" y="162" width="18" height="18" rx="3" />
        <path d="M317 188H332V202H324V211H306V197H317Z" fill={`url(#${gradientId})`} />
      </g>

      {/* Main B mark */}
      <path
        d="M367 80H521C605 80 657 120 657 185C657 230 633 261 591 278C640 293 667 328 667 378C667 451 609 488 521 488H386V424H516C561 424 587 406 587 376C587 344 561 328 516 328H434L392 268H511C552 268 578 249 578 217C578 187 552 170 511 170H386V116H367Z"
        fill={`url(#${gradientId})`}
        filter={`url(#${glowId})`}
      />

      {/* Left curly brace */}
      <path
        d="M360 191C333 191 324 207 324 231V254C324 272 315 284 299 289C315 295 324 307 324 325V350C324 374 333 390 360 390V358C350 358 347 351 347 340V317C347 298 338 288 325 289C338 287 347 276 347 258V235C347 224 350 217 360 217Z"
        fill={`url(#${gradientId})`}
      />

      {/* Code symbol */}
      <g fill="none" stroke={`url(#${gradientId})`} strokeWidth="13" strokeLinecap="square" strokeLinejoin="miter">
        <path d="M390 273L370 293L390 313" />
        <path d="M438 273L458 293L438 313" />
        <path d="M424 258L406 327" />
      </g>

      {/* Wordmark */}
      <text
        x="450"
        y="430"
        textAnchor="middle"
        fill={`url(#${textGradientId})`}
        fontFamily="Inter, Arial, sans-serif"
        fontSize="92"
        fontWeight="800"
        letterSpacing="-5"
      >
        Build<tspan>Ξ</tspan>rs
      </text>

      {/* Tagline */}
      <text
        x="450"
        y="483"
        textAnchor="middle"
        fill="#bd8bff"
        fontFamily="Inter, Arial, sans-serif"
        fontSize="19"
        fontWeight="500"
        letterSpacing="7"
      >
        AI PRODUCT ENGINEERING WORKSPACE
      </text>
    </svg>
  );
}
