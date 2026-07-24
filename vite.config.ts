import { cloudflareDevProxyVitePlugin as remixCloudflareDevProxy, vitePlugin as remixVitePlugin } from '@remix-run/dev';
import react from '@vitejs/plugin-react';
import UnoCSS from 'unocss/vite';
import { defineConfig, type ViteDevServer } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import { optimizeCssModules } from 'vite-plugin-optimize-css-modules';
import tsconfigPaths from 'vite-tsconfig-paths';
import * as dotenv from 'dotenv';

// Load environment variables from multiple files
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });
dotenv.config();

export default defineConfig((config) => {
  return {
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV),
    },
    build: {
      target: 'esnext',
    },
    plugins: [
      nodePolyfills({
        include: ['buffer', 'process', 'util', 'stream'],
        globals: {
          Buffer: true,
          process: true,
          global: true,
        },
        protocolImports: true,
        exclude: ['child_process', 'fs', 'path'],
      }),
      {
        name: 'buffer-polyfill',
        transform(code, id) {
          if (id.includes('env.mjs')) {
            return {
              code: `import { Buffer } from 'buffer';\n${code}`,
              map: null,
            };
          }

          return null;
        },
      },
      config.mode !== 'test' && remixCloudflareDevProxy(),

      /*
       * Builders Design System (Sprint 69) — Remix's Vite plugin injects a JSX/Fast-Refresh
       * transform that expects its own dev-server "preamble" and fails ("Remix Vite plugin
       * can't detect preamble") when Vitest transforms a `.tsx` file directly, which is exactly
       * what component tests need to do. Vitest's `mode` is `'test'`, so component specs get
       * the plain `@vitejs/plugin-react` JSX transform instead (already an installed
       * dependency, previously unused) — dev/build modes are completely unaffected, they still
       * get the real Remix plugin exactly as before. (A variant that ran both plugins together
       * in test mode was tried and rejected: Remix's plugin still attempted its Fast-Refresh
       * transform regardless of array order, since its transform stage isn't ordered the way a
       * plain array position implies.)
       */
      config.mode === 'test'
        ? react()
        : remixVitePlugin({
            future: {
              v3_fetcherPersist: true,
              v3_relativeSplatPath: true,
              v3_throwAbortReason: true,
              v3_lazyRouteDiscovery: true,
            },
          }),
      UnoCSS(),
      tsconfigPaths(),
      chrome129IssuePlugin(),
      config.mode === 'production' && optimizeCssModules({ apply: 'build' }),
    ],
    envPrefix: [
      'VITE_',
      'OPENAI_LIKE_API_BASE_URL',
      'OPENAI_LIKE_API_MODELS',
      'OLLAMA_API_BASE_URL',
      'LMSTUDIO_API_BASE_URL',
      'TOGETHER_API_BASE_URL',

      /*
       * Sprint 34 — BuildersDB's own env vars (app/lib/builders-db/client.ts). Listed
       * individually rather than given a shared prefix so they stay exact matches, same
       * as the custom vars above; deliberately NOT named VITE_SUPABASE_* to avoid any
       * collision with the pre-existing, unrelated "generated app's Supabase" feature
       * (app/lib/stores/supabase.ts) that already owns that name.
       */
      'BUILDERS_DB_SUPABASE_URL',
      'BUILDERS_DB_SUPABASE_ANON_KEY',
    ],
    css: {
      preprocessorOptions: {
        scss: {
          api: 'modern-compiler',
        },
      },
    },
    test: {
      setupFiles: ['./vitest-setup.ts'],
      exclude: [
        '**/node_modules/**',
        '**/dist/**',
        '**/cypress/**',
        '**/.{idea,git,cache,output,temp}/**',
        '**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build}.config.*',
        '**/tests/preview/**', // Exclude preview tests that require Playwright
      ],
    },
  };
});

function chrome129IssuePlugin() {
  return {
    name: 'chrome129IssuePlugin',
    configureServer(server: ViteDevServer) {
      server.middlewares.use((req, res, next) => {
        const raw = req.headers['user-agent']?.match(/Chrom(e|ium)\/([0-9]+)\./);

        if (raw) {
          const version = parseInt(raw[2], 10);

          if (version === 129) {
            res.setHeader('content-type', 'text/html');
            res.end(
              '<body><h1>Please use Chrome Canary for testing.</h1><p>Chrome 129 has an issue with JavaScript modules & Vite local development, see <a href="https://github.com/stackblitz/bolt.new/issues/86#issuecomment-2395519258">for more information.</a></p><p><b>Note:</b> This only impacts <u>local development</u>. `pnpm run build` and `pnpm run start` will work fine in this browser.</p></body>',
            );

            return;
          }
        }

        next();
      });
    },
  };
}
