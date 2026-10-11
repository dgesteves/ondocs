import type { AskDialogLabels } from '../react/labels';
import type { MountAskDialogOptions } from './index';

/**
 * The labels a tag gives: `data-labels`, a JSON object of label names to strings, with any
 * `data-label-<name>` attribute over it (`data-label-launcher`, `data-label-new-question`).
 */
function scriptLabels(data: DOMStringMap): Partial<AskDialogLabels> | undefined {
  const labels: Record<string, string> = {};
  if (data.labels) {
    try {
      const parsed: unknown = JSON.parse(data.labels);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new TypeError('not an object');
      }
      for (const [name, value] of Object.entries(parsed)) {
        if (typeof value === 'string') labels[name] = value;
      }
    } catch {
      console.warn(
        `[ondocs] data-labels must be a JSON object of strings, such as {"launcher":"Demander"}; ignoring ${data.labels}`,
      );
    }
  }
  for (const [key, value] of Object.entries(data)) {
    // `data-label-new-question` is `labelNewQuestion` in the dataset.
    const name = /^label([A-Z]\w*)$/.exec(key)?.[1];
    if (name && value !== undefined)
      labels[`${name.charAt(0).toLowerCase()}${name.slice(1)}`] = value;
  }
  return Object.keys(labels).length > 0 ? labels : undefined;
}

/**
 * The `mountAskDialog` options a `<script>` tag's `data-*` attributes describe: `data-endpoint`,
 * `data-title`, `data-placeholder`, `data-suggestions` (a JSON array of strings),
 * `data-shortcut` and `data-button-label` (`"false"` turns either off), `data-theme`,
 * `data-links` (`all` or `sources`), `data-locale`, `data-turnstile-site-key` (the bot check's
 * Turnstile site key), and the labels, `data-labels` (a JSON object) and `data-label-<name>`.
 */
export function scriptOptions(data: DOMStringMap): MountAskDialogOptions {
  const options: MountAskDialogOptions = {};
  if (data.endpoint) options.endpoint = data.endpoint;
  if (data.locale) options.locale = data.locale;
  const labels = scriptLabels(data);
  if (labels) options.labels = labels;
  if (data.title) options.title = data.title;
  if (data.placeholder) options.placeholder = data.placeholder;
  if (data.suggestions) {
    try {
      const suggestions: unknown = JSON.parse(data.suggestions);
      if (!Array.isArray(suggestions) || !suggestions.every((s) => typeof s === 'string')) {
        throw new TypeError('not an array of strings');
      }
      options.suggestions = suggestions;
    } catch {
      console.warn(
        `[ondocs] data-suggestions must be a JSON array of strings, such as ["How do I install it?"]; ignoring ${data.suggestions}`,
      );
    }
  }
  if (data.shortcut !== undefined) {
    options.shortcut = data.shortcut === 'false' || data.shortcut === '' ? false : data.shortcut;
  }
  if (data.buttonLabel !== undefined) {
    options.buttonLabel =
      data.buttonLabel === 'false' || data.buttonLabel === '' ? false : data.buttonLabel;
  }
  if (data.theme === 'auto' || data.theme === 'light' || data.theme === 'dark') {
    options.theme = data.theme;
  }
  if (data.links === 'all' || data.links === 'sources') options.links = data.links;
  if (data.turnstileSiteKey) options.challenge = { turnstile: data.turnstileSiteKey };
  return options;
}
