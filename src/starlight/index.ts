/**
 * ondocs/starlight: a Starlight plugin. After `astro build` it indexes what Starlight's own
 * search indexes, the region Starlight marks `data-pagefind-body` on each page, into
 * `ask-index.json` in the build output (one per locale), and it adds the ask dialog to every
 * page, opened from a floating button (or, with `dialog.navbar`, a button in the header) or
 * ⌘/Ctrl+I.
 *
 * The answers come from an endpoint you deploy next to the site (a function running
 * `createAskHandler` from `ondocs/server`); see the README.
 */

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { StarlightPlugin, StarlightUserConfig } from '@astrojs/starlight/types';

import {
  createIntegration,
  type NavbarButtons,
  type OndocsDialogOptions as AstroDialogOptions,
  type OndocsOptions,
} from '../astro/integration';

/** What the dialog shows; passed to `mountAskDialog` from `ondocs/embed`. */
export interface OndocsDialogOptions extends AstroDialogOptions {
  /**
   * An "Ask AI" button in the header, after the search box: `true`, or the button's label, by
   * default `labels.launcher` ("Ask AI") in each locale. It shows the shortcut, and on a phone it
   * is an icon that stays in the header. The plugin puts its own `Search` component in place of
   * the one the site has, and renders that one inside it, so list ondocs after any other plugin
   * that replaces `Search`. With it, the floating button is off unless `launcher` is set. Off by
   * default.
   */
  navbar?: boolean | string;
}

/**
 * The Astro integration's options, without `content` and `ignore`: the plugin indexes what
 * Starlight's search does. Leave anything else out by marking it `data-pagefind-ignore`.
 */
export type OndocsStarlightOptions = Omit<OndocsOptions, 'content' | 'ignore' | 'dialog'> & {
  dialog?: OndocsDialogOptions;
};

/** @deprecated Use `OndocsStarlightOptions`. Its name from before ask-my-site became ondocs. */
export type AskMySiteStarlightOptions = OndocsStarlightOptions;
/** @deprecated Use `OndocsDialogOptions`. Its name from before ask-my-site became ondocs. */
export type AskMySiteDialogOptions = OndocsDialogOptions;

/**
 * ```ts
 * // astro.config.mjs
 * import starlight from '@astrojs/starlight';
 * import ondocs from 'ondocs/starlight';
 *
 * export default defineConfig({
 *   integrations: [starlight({ title: 'Docs', plugins: [ondocs({ endpoint: '/api/ask' })] })],
 * });
 * ```
 */
export default function ondocs(options: OndocsStarlightOptions = {}): StarlightPlugin {
  return {
    name: 'ondocs',
    hooks: {
      'config:setup'({ config, addIntegration, updateConfig, astroConfig }) {
        const navbar = options.dialog?.navbar
          ? navbarButtons(config, options.dialog, fileURLToPath(astroConfig.root))
          : undefined;
        if (navbar) {
          updateConfig({ components: { ...config.components, Search: OWN_SEARCH } });
        }
        addIntegration(
          createIntegration(options, {
            ...(navbar ? { navbar } : {}),
            // Starlight puts the page title, its Markdown and the page footer (edit link, last
            // updated, pagination; footers are never indexed) in `<main data-pagefind-body>`,
            // except on 404 pages and pages with `pagefind: false`. Heading anchors' labels and
            // banners are `data-pagefind-ignore`; `.sr-only` is text for screen readers, such as
            // a code block's "Terminal window".
            content: '[data-pagefind-body]',
            ignore: '[data-pagefind-ignore], .sr-only',
            // With `dialog.navbar`, the navbar button's look first, then Starlight's colors.
            stylesheets: [
              ...(navbar ? ['ondocs/embed/button.css'] : []),
              'ondocs/starlight/launcher.css',
            ],
            title: `Ask ${siteTitle(config)}`,
            siteTitle: siteTitle(config),
            localeTitles: localeTitles(config),
            ...(siteDescription(config) ? { siteDescription: siteDescription(config) } : {}),
            // Starlight plugins that write llms files, which the integration leaves them to.
            plugins: (config.plugins ?? []).map((plugin) => plugin.name),
            // Starlight serves each locale but the root one under its key: /fr/, /pt-br/.
            ...(config.locales
              ? { locales: Object.keys(config.locales).filter((key) => key !== 'root') }
              : {}),
          }),
        );
      },
    },
  };
}

/** The `Search` component Starlight renders unless the site or a plugin replaces it. */
const STARLIGHT_SEARCH = '@astrojs/starlight/components/Search.astro';
/** The plugin's own, which renders the site's `Search` and the navbar button after it. */
const OWN_SEARCH = 'ondocs/starlight/Search.astro';

/**
 * The navbar button's label and Ctrl key: `navbar` when it is a label, else `labels.launcher`
 * (the locale's, then the dialog's), else "Ask AI"; and `labels.controlKey`, else "Ctrl".
 */
function navbarButton(
  { navbar, labels = {} }: OndocsDialogOptions,
  own: OndocsDialogOptions['labels'] = {},
): { label: string; controlKey: string } {
  return {
    label: typeof navbar === 'string' ? navbar : (own.launcher ?? labels.launcher ?? 'Ask AI'),
    controlKey: own.controlKey ?? labels.controlKey ?? 'Ctrl',
  };
}

/**
 * With `dialog.navbar`, what the plugin's `Search` renders: the `Search` component the site had
 * (a relative path resolved from the project root, as Starlight resolves it), whether Starlight
 * would have rendered it, and the button's label and Ctrl key in each locale.
 */
export function navbarButtons(
  config: Pick<StarlightUserConfig, 'components' | 'locales' | 'pagefind'>,
  dialog: OndocsDialogOptions | undefined,
  root: string,
): NavbarButtons | undefined {
  const navbar = dialog?.navbar;
  const search = config.components?.Search ?? STARLIGHT_SEARCH;
  // Without the option, or with the plugin's Search already in place (the plugin listed twice).
  if (!navbar || search === OWN_SEARCH) return undefined;
  const locales = Object.keys(config.locales ?? {}).filter((key) => key !== 'root');
  return {
    search: search.startsWith('.') ? resolve(root, search) : search,
    // Starlight's header renders its own Search only with Pagefind, and any replacement always.
    renderSearch: config.pagefind !== false || search !== STARLIGHT_SEARCH,
    shortcut: dialog.shortcut === false ? '' : (dialog.shortcut ?? 'i').toUpperCase(),
    buttons: {
      '': navbarButton(dialog),
      ...Object.fromEntries(
        locales.map((key) => [key, navbarButton(dialog, dialog.locales?.[key]?.labels)]),
      ),
    },
  };
}

/** The dialog's title in each locale but the root one, from the site title in its language. */
function localeTitles({ title, locales }: StarlightUserConfig): Record<string, string> {
  const titles: Record<string, string> = {};
  for (const [key, locale] of Object.entries(locales ?? {})) {
    if (key === 'root') continue;
    const lang = locale.lang ?? key;
    const translated = typeof title === 'string' ? title : (title[lang] ?? title[key]);
    if (translated) titles[key] = `Ask ${translated}`;
  }
  return titles;
}

/** The site title, in the default locale's language when it is translated. */
function siteTitle({ title, locales, defaultLocale }: StarlightUserConfig): string {
  if (typeof title === 'string') return title;
  const lang = (locales?.root ?? (defaultLocale ? locales?.[defaultLocale] : undefined))?.lang;
  return (lang ? title[lang] : undefined) ?? Object.values(title)[0] ?? 'this site';
}

/** The site description, in the default locale's language when it is translated. */
function siteDescription({ description }: StarlightUserConfig): string | undefined {
  const value: unknown = description;
  if (typeof value === 'string') return value;
  if (typeof value !== 'object' || value === null) return undefined;
  const first: unknown = Object.values(value)[0];
  return typeof first === 'string' ? first : undefined;
}
