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
import type { AstroIntegration } from 'astro';

import {
  createIntegration,
  type NavbarButtons,
  type OndocsDialogOptions as AstroDialogOptions,
  type OndocsOptions,
} from '../astro/integration';
import { ENGLISH, translation, type TranslatedLabels } from './translations';

/** What the dialog shows; passed to `mountAskDialog` from `ondocs/embed/standalone`. */
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
 * The Astro integration's options, without `contentSelector` and `ignoreSelector` (or their old
 * names, `content` and `ignore`): the plugin indexes what Starlight's search does. Leave anything
 * else out by marking it `data-pagefind-ignore`.
 */
export type OndocsStarlightOptions = Omit<
  OndocsOptions,
  'contentSelector' | 'ignoreSelector' | 'content' | 'ignore' | 'dialog'
> & {
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
  const plugin: StarlightPlugin = {
    name: 'ondocs',
    hooks: {
      'config:setup'({ config, addIntegration, updateConfig, astroConfig }) {
        const words = builtInWords(config, options);
        const navbar = words.dialog?.navbar
          ? navbarButtons(config, words.dialog, fileURLToPath(astroConfig.root))
          : undefined;
        if (navbar) {
          updateConfig({ components: { ...config.components, Search: OWN_SEARCH } });
        }
        addIntegration(
          createIntegration(words.dialog ? { ...options, dialog: words.dialog } : options, {
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
            title: words.title,
            siteTitle: siteTitle(config),
            localeTitles: words.localeTitles,
            noAnswerMessages: words.noAnswerMessages,
            ...(siteDescription(config) ? { siteDescription: siteDescription(config) } : {}),
            // Starlight plugins that write llms files, which the integration leaves them to.
            plugins: (config.plugins ?? []).map((plugin) => plugin.name),
            // Starlight serves each locale but the root one under its key: /fr/, /pt-br/.
            ...(config.locales
              ? { locales: Object.keys(config.locales).filter((key) => key !== 'root') }
              : {}),
            // Without a root locale, the default one's key, whose files the root gets.
            ...(config.defaultLocale ? { defaultLocale: config.defaultLocale } : {}),
          }),
        );
      },
    },
  };
  // Astro runs the astro:* hooks of anything in its integrations, where `npx astro add` puts the
  // plugin, and there it would otherwise do nothing, silently. Starlight's plugin schema strips
  // the hook, so in Starlight's plugins it never runs.
  const misplaced: AstroIntegration['hooks']['astro:config:setup'] = () => {
    throw new Error(
      "ondocs/starlight is a Starlight plugin, so in Astro's integrations it does nothing: move ondocs() into Starlight's plugins, as in integrations: [starlight({ title: 'Docs', plugins: [ondocs()] })]. npx astro add puts it in integrations. On an Astro site without Starlight, use ondocs/astro instead. See https://ondocs.vercel.app/docs/astro#add-it-to-starlight",
    );
  };
  Object.assign(plugin.hooks, { 'astro:config:setup': misplaced });
  return plugin;
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

/** `text` with the site's title for `{site}`. */
const naming = (text: string, site: string): string => text.replace('{site}', () => site);

/** The language of the pages under no locale's path: the root locale's, else the default one's. */
function rootLanguage({ locales, defaultLocale }: StarlightUserConfig): string {
  if (locales?.root) return locales.root.lang;
  if (!defaultLocale) return 'en';
  return locales?.[defaultLocale]?.lang ?? defaultLocale;
}

/**
 * The plugin's words in each locale's language, where ondocs has them (src/starlight/translations):
 * the dialog's labels, its title, named after the site's title in that language, and the ask
 * route's "I don't know". A locale in the root's language, or in one ondocs has no words in, keeps
 * the root's, as Starlight falls back to the default locale's.
 */
function builtInWords(
  config: StarlightUserConfig,
  options: OndocsStarlightOptions,
): {
  dialog: OndocsDialogOptions | undefined;
  title: string;
  localeTitles: Record<string, string>;
  noAnswerMessages: Record<string, string>;
} {
  const { title, locales } = config;
  const site = siteTitle(config);
  // The root's words: English, the dialog's defaults, unless ondocs has its language.
  const rootWords = translation(rootLanguage(config)) ?? ENGLISH;
  const rootOwn = rootWords === ENGLISH ? undefined : rootWords;
  const routeSite = options.route ? options.route.siteName : undefined;
  const localeLabels: Record<string, TranslatedLabels> = {};
  const localeTitles: Record<string, string> = {};
  const noAnswerMessages: Record<string, string> = rootOwn
    ? { root: naming(rootOwn.noAnswer, routeSite ?? site) }
    : {};
  for (const [key, locale] of Object.entries(locales ?? {})) {
    if (key === 'root') continue;
    const lang = locale.lang ?? key;
    const translated = typeof title === 'string' ? title : (title[lang] ?? title[key]);
    const own = translation(lang);
    localeTitles[key] = naming((own ?? rootWords).title, translated ?? site);
    if (!own || own === rootWords) continue;
    localeLabels[key] = own.labels;
    noAnswerMessages[key] = naming(own.noAnswer, routeSite ?? translated ?? site);
  }
  return {
    dialog: withLabels(options.dialog, rootOwn?.labels, localeLabels),
    title: naming(rootWords.title, site),
    localeTitles,
    noAnswerMessages,
  };
}

/** Whether `value` is an object to spread, as the options' check takes one. */
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * `dialog` with `root`'s labels under its own, and each locale's under that locale's own. Options
 * the check will turn away are left as they are, for it to say what is wrong.
 */
function withLabels(
  dialog: OndocsDialogOptions | undefined,
  root: TranslatedLabels | undefined,
  byLocale: Record<string, TranslatedLabels>,
): OndocsDialogOptions | undefined {
  if (!root && Object.keys(byLocale).length === 0) return dialog;
  const given: unknown = dialog ?? {};
  if (!isRecord(given) || !isRecord(given.labels ?? {}) || !isRecord(given.locales ?? {})) {
    return dialog;
  }
  const { labels, locales } = given as OndocsDialogOptions;
  const merged: NonNullable<OndocsDialogOptions['locales']> = { ...locales };
  for (const [key, own] of Object.entries(byLocale)) {
    const locale: unknown = locales?.[key] ?? {};
    if (!isRecord(locale) || !isRecord(locale.labels ?? {})) return dialog;
    const options = locale as NonNullable<OndocsDialogOptions['locales']>[string];
    merged[key] = { ...options, labels: { ...own, ...options.labels } };
  }
  return {
    ...dialog,
    ...(root ? { labels: { ...root, ...labels } } : {}),
    ...(Object.keys(merged).length > 0 ? { locales: merged } : {}),
  };
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
