// The launcher on every page, for a framework whose pages a bundler builds (Vite, in Astro,
// Starlight and VitePress): a script that mounts it, and the stylesheets it needs.
import { warnDeprecated } from '../deprecation';
import type { OndocsDialogOptions, OndocsTheme } from '../embed/options';
import { trimTrailingSlashes } from '../text/slashes';

/** What the dialog shows in one locale, over the dialog's own options. */
export type LocaleDialogOptions = Pick<
  OndocsDialogOptions,
  'labels' | 'placeholder' | 'suggestions' | 'launcher' | 'buttonLabel'
> & { title?: string };

/** The dialog's options as a plugin takes them: the embed's, with a theme and locales. */
export interface LauncherDialogOptions extends OndocsDialogOptions {
  theme?: OndocsTheme;
  /** Options for each locale, by its path prefix (`fr`, `pt-br`), over these. */
  locales?: Record<string, LocaleDialogOptions>;
  /**
   * An "Ask AI" button in the site's navbar, which the plugin renders: `true`, or its label.
   * `launcherScript` only reads it to leave the floating button off, unless `launcher` is set.
   */
  navbar?: boolean | string;
}

/**
 * `dialog` as `mountAskDialog` takes it: without `navbar`, the button the plugin puts in the
 * navbar, and with it, without the floating button unless `launcher` asks for one.
 */
function withoutNavbar<Options extends { navbar?: boolean | string; launcher?: boolean | string }>(
  dialog: Options,
): Omit<Options, 'navbar'> {
  const { navbar, ...rest } = dialog;
  return navbar === undefined || navbar === false || rest.launcher !== undefined
    ? rest
    : { ...rest, launcher: false };
}

/**
 * `options` with `buttonLabel`, the launcher's name before 0.9, moved to `launcher` (which wins
 * when both are set), and a warning that names it `where`, such as `dialog.`.
 */
function withLauncher<Options extends Pick<OndocsDialogOptions, 'launcher' | 'buttonLabel'>>(
  options: Options,
  where: string,
): Omit<Options, 'buttonLabel'> {
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- read to move it to `launcher`
  const { buttonLabel, ...rest } = options;
  if (buttonLabel === undefined) return rest;
  warnDeprecated(`${where}buttonLabel`, `${where}launcher`);
  return rest.launcher === undefined ? { ...rest, launcher: buttonLabel } : rest;
}

/**
 * `dialog` with `buttonLabel`, the launcher's name before 0.9, moved to `launcher`, its own and
 * each locale's, with a warning while the site builds rather than in visitors' browsers.
 */
function withLauncherOptions(dialog: LauncherDialogOptions): LauncherDialogOptions {
  const { locales, ...own } = withLauncher(dialog, 'dialog.');
  if (!locales) return own;
  return {
    ...own,
    locales: Object.fromEntries(
      Object.entries(locales).map(([locale, options]) => [
        locale,
        withLauncher(options, `dialog.locales.${locale}.`),
      ]),
    ),
  };
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
  /**
   * The site moves between pages without loading them, as VitePress does: when a navigation
   * changes `<html lang>`, the launcher mounts again with the new page's locale. Only matters with
   * `locales`. Default `false`.
   */
  spa?: boolean;
}

/**
 * The source of a browser module that mounts the launcher with `mountAskDialog` from
 * `ondocs/embed/standalone`: the button and the shortcut, about 1.5 KB gzipped, with the dialog
 * loaded the first time it is wanted. For a framework that bundles every page's scripts: serve it
 * as a virtual module that each page imports, so the bundler resolves `ondocs/embed/standalone`
 * and keeps the dialog in a chunk of its own. That chunk has React, Radix and cmdk built in, so
 * the site needs none of them installed.
 */
export function launcherScript({
  endpoint,
  dialog: options = {},
  title,
  locales = [],
  localeTitles,
  base = '/',
  spa = false,
}: LauncherScriptOptions): string {
  const { locales: perLocale, ...dialog } = withoutNavbar(withLauncherOptions(options));
  const mount = {
    endpoint,
    ...dialog,
    title: dialog.title ?? dialog.labels?.title ?? title,
  };
  if (locales.length === 0) {
    return [
      "import { mountAskDialog } from 'ondocs/embed/standalone';",
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
  const pathUnderBase = `location.pathname.slice(${String(trimTrailingSlashes(base).length)}).replace(/^\\/+/, '')`;
  const head = [
    "import { mountAskDialog } from 'ondocs/embed/standalone';",
    `const options = ${JSON.stringify(mount)};`,
    `const locales = ${JSON.stringify(byLocale)};`,
  ];
  if (!spa) {
    return [
      ...head,
      // The page's locale, from its path under `base`: `/docs/fr/guides/` is French.
      `const path = ${pathUnderBase};`,
      'const locale = Object.keys(locales).find((key) => path === key || path.startsWith(`${key}/`));',
      'mountAskDialog(locale ? { ...options, ...locales[locale] } : options);',
    ].join('\n');
  }
  return [
    ...head,
    'const localeOf = (path) => Object.keys(locales).find((key) => path === key || path.startsWith(`${key}/`));',
    'const mount = (locale) => mountAskDialog(locale ? { ...options, ...locales[locale] } : options);',
    `let locale = localeOf(${pathUnderBase});`,
    'let mounted = mount(locale);',
    // A navigation to a page in another locale changes <html lang>: mount for that locale.
    'new MutationObserver(() => {',
    `  const next = localeOf(${pathUnderBase});`,
    '  if (next === locale) return;',
    '  locale = next;',
    '  mounted.unmount();',
    '  mounted = mount(locale);',
    "}).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });",
  ].join('\n');
}

/**
 * Radix and cmdk start their modules with "use client", a React Server Components directive that
 * means nothing in a browser bundle, and Vite warns about each one at length. This blanks it out
 * in those packages only (with spaces, so source positions do not move). A Vite plugin, for the
 * site's bundler where the launcher's dialog is bundled.
 */
export function quietUseClient() {
  return {
    name: 'ondocs:quiet-use-client',
    transform(code: string, id: string) {
      if (!/[\\/]node_modules[\\/](?:@radix-ui[\\/][^\\/]+|cmdk)[\\/]/.test(id)) return null;
      const blanked = code.replace(/^(["'])use client\1;?/, (directive) =>
        ' '.repeat(directive.length),
      );
      return blanked === code ? null : { code: blanked, map: null };
    },
  };
}
