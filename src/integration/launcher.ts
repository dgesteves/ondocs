// The launcher on every page, for a framework whose pages a bundler builds (Vite, in Astro and
// Starlight): a script that mounts it, and the stylesheets it needs.
import type { OndocsDialogOptions, OndocsTheme } from '../embed/options';

/** What the dialog shows in one locale, over the dialog's own options. */
export type LocaleDialogOptions = Pick<
  OndocsDialogOptions,
  'labels' | 'placeholder' | 'suggestions' | 'buttonLabel'
> & { title?: string };

/** The dialog's options as a plugin takes them: the embed's, with a theme and locales. */
export interface LauncherDialogOptions extends OndocsDialogOptions {
  theme?: OndocsTheme;
  /** Options for each locale, by its path prefix (`fr`, `pt-br`), over these. */
  locales?: Record<string, LocaleDialogOptions>;
}

/**
 * The launcher's stylesheets and the dialog's, as package imports, for a site's bundler to put in
 * every page's CSS: `ondocs/react/styles.css` and `ondocs/embed/launcher.css`.
 */
export const LAUNCHER_STYLESHEETS: readonly string[] = [
  'ondocs/react/styles.css',
  'ondocs/embed/launcher.css',
];

export interface LauncherScriptOptions {
  /** Where the dialog posts questions; see `dialogEndpoint`. */
  endpoint: string;
  /** The dialog's options, with each locale's under `locales`. */
  dialog?: LauncherDialogOptions;
  /** The dialog's title when `dialog` sets none, such as "Ask Acme Docs". */
  title?: string;
  /**
   * The locales' path prefixes under `base` (`fr`, `pt-br`). A page under one gets that locale's
   * options and sends the locale with each question, for an endpoint with an index per locale.
   */
  locales?: readonly string[];
  /** The dialog's title in each locale, by path prefix, when `dialog` sets none. */
  localeTitles?: Record<string, string>;
  /** The path the site is served under, which the locale prefixes follow. Default `/`. */
  base?: string;
}

/**
 * The source of a browser module that mounts the launcher with `mountAskDialog` from
 * `ondocs/embed`: the button and the shortcut, about 1.5 KB gzipped, with the dialog loaded the
 * first time it is wanted. For a framework that bundles every page's scripts: serve it as a
 * virtual module that each page imports, so the bundler resolves `ondocs/embed` and splits the
 * dialog into a chunk of its own.
 */
export function launcherScript({
  endpoint,
  dialog: options = {},
  title,
  locales = [],
  localeTitles,
  base = '/',
}: LauncherScriptOptions): string {
  const { locales: perLocale, ...dialog } = options;
  const mount = {
    endpoint,
    ...dialog,
    title: dialog.title ?? dialog.labels?.title ?? title,
  };
  if (locales.length === 0) {
    return [
      "import { mountAskDialog } from 'ondocs/embed';",
      `mountAskDialog(${JSON.stringify(mount)});`,
    ].join('\n');
  }
  // Each locale's options over the dialog's, its labels over the dialog's labels.
  const byLocale = Object.fromEntries(
    locales.map((locale) => {
      const own = perLocale?.[locale];
      const labels = { ...dialog.labels, ...own?.labels };
      const localeTitle =
        own?.title ?? own?.labels?.title ?? dialog.title ?? localeTitles?.[locale] ?? mount.title;
      return [
        locale,
        {
          ...own,
          ...(Object.keys(labels).length > 0 ? { labels } : {}),
          ...(localeTitle ? { title: localeTitle } : {}),
          locale,
        },
      ];
    }),
  );
  return [
    "import { mountAskDialog } from 'ondocs/embed';",
    `const options = ${JSON.stringify(mount)};`,
    `const locales = ${JSON.stringify(byLocale)};`,
    // The page's locale, from its path under `base`: `/docs/fr/guides/` is French.
    `const path = location.pathname.slice(${String(base.replace(/\/+$/, '').length)}).replace(/^\\/+/, '');`,
    'const locale = Object.keys(locales).find((key) => path === key || path.startsWith(`${key}/`));',
    'mountAskDialog(locale ? { ...options, ...locales[locale] } : options);',
  ].join('\n');
}
