import { globSync } from 'fast-glob';
import fs from 'node:fs/promises';
import { basename } from 'node:path';
import { defineConfig, presetIcons, presetUno, transformerDirectives } from 'unocss';

const iconPaths = globSync('./icons/*.svg');

const collectionName = 'bolt';

const customIconCollection = iconPaths.reduce(
  (acc, iconPath) => {
    const [iconName] = basename(iconPath).split('.');

    acc[collectionName] ??= {};
    acc[collectionName][iconName] = async () => fs.readFile(iconPath, 'utf8');

    return acc;
  },
  {} as Record<string, Record<string, () => Promise<string>>>,
);

const BASE_COLORS = {
  white: '#FFFFFF',
  gray: {
    50: '#FAFAFA',
    100: '#F5F5F5',
    200: '#E5E5E5',
    300: '#D4D4D4',
    400: '#A3A3A3',
    500: '#737373',
    600: '#525252',
    700: '#404040',
    800: '#262626',
    900: '#171717',
    950: '#0A0A0A',
  },
  accent: {
    50: '#F6F7F9',
    100: '#EEF0F3',
    200: '#DDE1E7',
    300: '#C0C6D0',
    400: '#9AA2B0',
    500: '#6B7280',
    600: '#4B5563',
    700: '#374151',
    800: '#1F2937',
    900: '#111827',
    950: '#0B0F16',
  },
  green: {
    50: '#F0FDF4',
    100: '#DCFCE7',
    200: '#BBF7D0',
    300: '#86EFAC',
    400: '#4ADE80',
    500: '#22C55E',
    600: '#16A34A',
    700: '#15803D',
    800: '#166534',
    900: '#14532D',
    950: '#052E16',
  },
  orange: {
    50: '#FFFAEB',
    100: '#FEEFC7',
    200: '#FEDF89',
    300: '#FEC84B',
    400: '#FDB022',
    500: '#F79009',
    600: '#DC6803',
    700: '#B54708',
    800: '#93370D',
    900: '#792E0D',
  },
  red: {
    50: '#FEF2F2',
    100: '#FEE2E2',
    200: '#FECACA',
    300: '#FCA5A5',
    400: '#F87171',
    500: '#EF4444',
    600: '#DC2626',
    700: '#B91C1C',
    800: '#991B1B',
    900: '#7F1D1D',
    950: '#450A0A',
  },
};

const COLOR_PRIMITIVES = {
  ...BASE_COLORS,
  alpha: {
    white: generateAlphaPalette(BASE_COLORS.white),
    gray: generateAlphaPalette(BASE_COLORS.gray[900]),
    red: generateAlphaPalette(BASE_COLORS.red[500]),
    accent: generateAlphaPalette(BASE_COLORS.accent[500]),
  },
};

export default defineConfig({
  safelist: [...Object.keys(customIconCollection[collectionName] || {}).map((x) => `i-bolt:${x}`)],
  shortcuts: {
    'bolt-ease-cubic-bezier': 'ease-[cubic-bezier(0.4,0,0.2,1)]',
    'transition-theme': 'transition-[background-color,border-color,color] duration-150 bolt-ease-cubic-bezier',
    kdb: 'bg-bolt-elements-code-background text-bolt-elements-code-text py-1 px-1.5 rounded-md',
    'max-w-chat': 'max-w-[var(--chat-max-width)]',

    /*
     * Builders Design System (Sprint 69) — radius scale. Fixed pixel values rather than Uno's
     * own rounded-md/lg/xl scale, so the 4-step scale is explicit and documented (see
     * docs/design-system/Builders-Design-System.md) instead of borrowing a generic preset scale
     * whose steps aren't named for this app's own surface hierarchy.
     */
    'builders-radius-sm': 'rounded-[6px]',
    'builders-radius-md': 'rounded-[10px]',
    'builders-radius-lg': 'rounded-[16px]',
    'builders-radius-pill': 'rounded-full',

    /*
     * Builders Design System (Sprint 69) — restrained shadows. Never used on large surfaces,
     * only on floating/elevated elements (dropdowns, popovers, modals) per the sprint's "avoid
     * large or bright shadows" direction.
     */
    'builders-shadow-sm': 'shadow-[0_1px_2px_rgba(0,0,0,0.24)]',
    'builders-shadow-md': 'shadow-[0_4px_16px_rgba(0,0,0,0.32)]',
    'builders-shadow-lg': 'shadow-[0_12px_32px_rgba(0,0,0,0.40)]',

    /*
     * Builders Design System (Sprint 69) — the one focus treatment every interactive primitive
     * should use. `focus-visible` only (never plain `focus`), so mouse clicks don't show a ring
     * but keyboard/AT navigation always does. `motion-reduce:transition-none` respects
     * `prefers-reduced-motion` per the sprint's Motion section.
     */
    'builders-focus-ring':
      'outline-none focus-visible:ring-2 focus-visible:ring-builders-border-focus focus-visible:ring-offset-2 focus-visible:ring-offset-builders-bg-app',

    /*
     * Builders Design System (Sprint 69) — the one transition treatment for hover/focus/state
     * changes on interactive primitives. Deliberately short and respects reduced-motion.
     */
    'builders-transition': 'transition-all duration-150 bolt-ease-cubic-bezier motion-reduce:transition-none',
  },
  rules: [
    /**
     * This shorthand doesn't exist in Tailwind and we overwrite it to avoid
     * any conflicts with minified CSS classes.
     */
    ['b', {}],
  ],
  theme: {
    colors: {
      ...COLOR_PRIMITIVES,

      /**
       * Builders Design System (Sprint 69) — semantic tokens, additive alongside `bolt.elements`
       * above (never a replacement). Every value here is a passthrough to a `--builders-*` CSS
       * custom property defined in `app/styles/builders-tokens.scss`; this block exists only so
       * those tokens are usable as ordinary UnoCSS utility classes
       * (`bg-builders-surface-elevated`, `text-builders-text-secondary`,
       * `border-builders-status-success-border`, ...) instead of raw `[var(--builders-...)]`
       * arbitrary values everywhere they're used.
       */
      builders: {
        bg: {
          app: 'var(--builders-bg-app)',
          sidebar: 'var(--builders-bg-sidebar)',
        },
        surface: {
          primary: 'var(--builders-surface-primary)',
          elevated: 'var(--builders-surface-elevated)',
          recessed: 'var(--builders-surface-recessed)',
          interactive: 'var(--builders-surface-interactive)',
          hover: 'var(--builders-surface-hover)',
          selected: 'var(--builders-surface-selected)',
        },
        overlay: {
          backdrop: 'var(--builders-overlay-backdrop)',
        },
        text: {
          primary: 'var(--builders-text-primary)',
          secondary: 'var(--builders-text-secondary)',
          tertiary: 'var(--builders-text-tertiary)',
          muted: 'var(--builders-text-muted)',
          disabled: 'var(--builders-text-disabled)',
          inverse: 'var(--builders-text-inverse)',
          link: 'var(--builders-text-link)',
        },
        border: {
          subtle: 'var(--builders-border-subtle)',
          default: 'var(--builders-border-default)',
          strong: 'var(--builders-border-strong)',
          focus: 'var(--builders-border-focus)',
          selected: 'var(--builders-border-selected)',
        },
        brand: {
          primary: 'var(--builders-brand-primary)',
          secondary: 'var(--builders-brand-secondary)',
          hover: 'var(--builders-brand-hover)',
          active: 'var(--builders-brand-active)',
          subtleSurface: 'var(--builders-brand-subtle-surface)',
        },
        status: {
          success: {
            text: 'var(--builders-status-success-text)',
            border: 'var(--builders-status-success-border)',
            bg: 'var(--builders-status-success-bg)',
          },
          warning: {
            text: 'var(--builders-status-warning-text)',
            border: 'var(--builders-status-warning-border)',
            bg: 'var(--builders-status-warning-bg)',
          },
          error: {
            text: 'var(--builders-status-error-text)',
            border: 'var(--builders-status-error-border)',
            bg: 'var(--builders-status-error-bg)',
          },
          info: {
            text: 'var(--builders-status-info-text)',
            border: 'var(--builders-status-info-border)',
            bg: 'var(--builders-status-info-bg)',
          },
          active: {
            text: 'var(--builders-status-active-text)',
            border: 'var(--builders-status-active-border)',
            bg: 'var(--builders-status-active-bg)',
          },
          pending: {
            text: 'var(--builders-status-pending-text)',
            border: 'var(--builders-status-pending-border)',
            bg: 'var(--builders-status-pending-bg)',
          },
          completed: {
            text: 'var(--builders-status-completed-text)',
            border: 'var(--builders-status-completed-border)',
            bg: 'var(--builders-status-completed-bg)',
          },
          blocked: {
            text: 'var(--builders-status-blocked-text)',
            border: 'var(--builders-status-blocked-border)',
            bg: 'var(--builders-status-blocked-bg)',
          },
          approval: {
            text: 'var(--builders-status-approval-text)',
            border: 'var(--builders-status-approval-border)',
            bg: 'var(--builders-status-approval-bg)',
          },
          working: {
            text: 'var(--builders-status-working-text)',
            border: 'var(--builders-status-working-border)',
            bg: 'var(--builders-status-working-bg)',
          },
        },
      },
      bolt: {
        elements: {
          borderColor: 'var(--bolt-elements-borderColor)',
          borderColorActive: 'var(--bolt-elements-borderColorActive)',
          background: {
            depth: {
              1: 'var(--bolt-elements-bg-depth-1)',
              2: 'var(--bolt-elements-bg-depth-2)',
              3: 'var(--bolt-elements-bg-depth-3)',
              4: 'var(--bolt-elements-bg-depth-4)',
            },
          },
          textPrimary: 'var(--bolt-elements-textPrimary)',
          textSecondary: 'var(--bolt-elements-textSecondary)',
          textTertiary: 'var(--bolt-elements-textTertiary)',
          code: {
            background: 'var(--bolt-elements-code-background)',
            text: 'var(--bolt-elements-code-text)',
          },
          button: {
            primary: {
              background: 'var(--bolt-elements-button-primary-background)',
              backgroundHover: 'var(--bolt-elements-button-primary-backgroundHover)',
              text: 'var(--bolt-elements-button-primary-text)',
            },
            secondary: {
              background: 'var(--bolt-elements-button-secondary-background)',
              backgroundHover: 'var(--bolt-elements-button-secondary-backgroundHover)',
              text: 'var(--bolt-elements-button-secondary-text)',
            },
            danger: {
              background: 'var(--bolt-elements-button-danger-background)',
              backgroundHover: 'var(--bolt-elements-button-danger-backgroundHover)',
              text: 'var(--bolt-elements-button-danger-text)',
            },
          },
          item: {
            contentDefault: 'var(--bolt-elements-item-contentDefault)',
            contentActive: 'var(--bolt-elements-item-contentActive)',
            contentAccent: 'var(--bolt-elements-item-contentAccent)',
            contentDanger: 'var(--bolt-elements-item-contentDanger)',
            backgroundDefault: 'var(--bolt-elements-item-backgroundDefault)',
            backgroundActive: 'var(--bolt-elements-item-backgroundActive)',
            backgroundAccent: 'var(--bolt-elements-item-backgroundAccent)',
            backgroundDanger: 'var(--bolt-elements-item-backgroundDanger)',
          },
          actions: {
            background: 'var(--bolt-elements-actions-background)',
            code: {
              background: 'var(--bolt-elements-actions-code-background)',
            },
          },
          artifacts: {
            background: 'var(--bolt-elements-artifacts-background)',
            backgroundHover: 'var(--bolt-elements-artifacts-backgroundHover)',
            borderColor: 'var(--bolt-elements-artifacts-borderColor)',
            inlineCode: {
              background: 'var(--bolt-elements-artifacts-inlineCode-background)',
              text: 'var(--bolt-elements-artifacts-inlineCode-text)',
            },
          },
          messages: {
            background: 'var(--bolt-elements-messages-background)',
            linkColor: 'var(--bolt-elements-messages-linkColor)',
            code: {
              background: 'var(--bolt-elements-messages-code-background)',
            },
            inlineCode: {
              background: 'var(--bolt-elements-messages-inlineCode-background)',
              text: 'var(--bolt-elements-messages-inlineCode-text)',
            },
          },
          icon: {
            success: 'var(--bolt-elements-icon-success)',
            error: 'var(--bolt-elements-icon-error)',
            primary: 'var(--bolt-elements-icon-primary)',
            secondary: 'var(--bolt-elements-icon-secondary)',
            tertiary: 'var(--bolt-elements-icon-tertiary)',
          },
          preview: {
            addressBar: {
              background: 'var(--bolt-elements-preview-addressBar-background)',
              backgroundHover: 'var(--bolt-elements-preview-addressBar-backgroundHover)',
              backgroundActive: 'var(--bolt-elements-preview-addressBar-backgroundActive)',
              text: 'var(--bolt-elements-preview-addressBar-text)',
              textActive: 'var(--bolt-elements-preview-addressBar-textActive)',
            },
          },
          terminals: {
            background: 'var(--bolt-elements-terminals-background)',
            buttonBackground: 'var(--bolt-elements-terminals-buttonBackground)',
          },
          dividerColor: 'var(--bolt-elements-dividerColor)',
          loader: {
            background: 'var(--bolt-elements-loader-background)',
            progress: 'var(--bolt-elements-loader-progress)',
          },
          prompt: {
            background: 'var(--bolt-elements-prompt-background)',
          },
          sidebar: {
            dropdownShadow: 'var(--bolt-elements-sidebar-dropdownShadow)',
            buttonBackgroundDefault: 'var(--bolt-elements-sidebar-buttonBackgroundDefault)',
            buttonBackgroundHover: 'var(--bolt-elements-sidebar-buttonBackgroundHover)',
            buttonText: 'var(--bolt-elements-sidebar-buttonText)',
          },
          cta: {
            background: 'var(--bolt-elements-cta-background)',
            text: 'var(--bolt-elements-cta-text)',
          },
        },
      },
    },
  },
  transformers: [transformerDirectives()],
  presets: [
    presetUno({
      dark: {
        light: '[data-theme="light"]',
        dark: '[data-theme="dark"]',
      },
    }),
    presetIcons({
      warn: true,
      collections: {
        ...customIconCollection,
      },
      unit: 'em',
    }),
  ],
});

/**
 * Generates an alpha palette for a given hex color.
 *
 * @param hex - The hex color code (without alpha) to generate the palette from.
 * @returns An object where keys are opacity percentages and values are hex colors with alpha.
 *
 * Example:
 *
 * ```
 * {
 *   '1': '#FFFFFF03',
 *   '2': '#FFFFFF05',
 *   '3': '#FFFFFF08',
 * }
 * ```
 */
function generateAlphaPalette(hex: string) {
  return [1, 2, 3, 4, 5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].reduce(
    (acc, opacity) => {
      const alpha = Math.round((opacity / 100) * 255)
        .toString(16)
        .padStart(2, '0');

      acc[opacity] = `${hex}${alpha}`;

      return acc;
    },
    {} as Record<number, string>,
  );
}
