import { builtinModules } from 'node:module';

import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import { defineConfig, globalIgnores } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const RUNTIME_NEUTRAL =
  'This code runs in edge runtimes, Workers and browsers, which have no Node.js built-ins: use a Web API, or move the code to src/node, src/integration or src/cli. See ARCHITECTURE.md.';

// The example app is linted by its own `lint` script, after it is built: type-aware rules need
// the package's dist types, the generated index and Next's route types, which a fresh clone lacks.
// It reuses this file, and from its directory the `examples/**` ignore no longer matches. The
// Cloudflare Worker template is checked with its own dependencies (tsc and its tests), in the
// workers-ai deploy recipe.
export default defineConfig(
  globalIgnores([
    '**/dist',
    '**/coverage',
    '**/.next',
    '**/next-env.d.ts',
    'bench/results',
    'test/fixtures',
    'examples/**',
    'templates/**',
  ]),
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
      parserOptions: {
        projectService: {
          allowDefaultProject: [
            '*.js',
            '*.mjs',
            'bench/*.mjs',
            'scripts/*.mjs',
            'scripts/assets/*.mjs',
          ],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      // An empty string means "missing" wherever `||` is used on strings here.
      '@typescript-eslint/prefer-nullish-coalescing': [
        'error',
        { ignorePrimitives: { string: true } },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // packages/ only re-exports entries of the package, whose types exist once it is built.
    files: ['**/*.{js,mjs}', 'packages/*/index.d.ts'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    files: ['**/*.tsx', 'src/react/**/*.ts'],
    extends: [reactHooks.configs.flat['recommended-latest']],
  },
  {
    // The entries that run anywhere, edge runtimes, Workers and browsers included (ondocs,
    // ondocs/server, ondocs/react, ondocs/embed and ondocs/mock), and what they import. tsdown
    // builds them for the `node` platform, which only governs how built-ins resolve.
    files: ['src/*.ts', 'src/{embed,loaders,mock,react,search,server,text}/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: builtinModules.map((name) => ({ name, message: RUNTIME_NEUTRAL })),
          patterns: [{ group: ['node:*'], message: RUNTIME_NEUTRAL }],
        },
      ],
    },
  },
  {
    files: ['test/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  prettier,
);
