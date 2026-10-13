import type { ThemeRegistration } from 'shiki';

/**
 * The code colours of the three sibling sites (ondocs, onsystem and signoff-ui): the theme pair
 * signoff-ui's docs highlight with, token for token, so the same code reads the same on each.
 * The code background is the family's code surface (`--code` in app/globals.css). Every colour
 * keeps 4.5:1 on it, in its theme (test/website.test.tsx checks).
 */
export interface CodePalette {
  bg: string;
  fg: string;
  keyword: string;
  string: string;
  number: string;
  comment: string;
  punctuation: string;
  tag: string;
  attribute: string;
  fn: string;
  property: string;
}

export const CODE_PALETTES: Record<'light' | 'dark', CodePalette> = {
  dark: {
    bg: '#101317',
    fg: '#e8eaed',
    keyword: '#67e8f9',
    string: '#f5c27a',
    number: '#f9a8d4',
    comment: '#8b94a0',
    punctuation: '#a1a9b4',
    tag: '#67e8f9',
    attribute: '#f9a8d4',
    fn: '#f1f3f5',
    property: '#c9d1d9',
  },
  light: {
    bg: '#f6f7f9',
    fg: '#0d0f12',
    keyword: '#155e75',
    string: '#9a3412',
    number: '#9d174d',
    comment: '#525b67',
    punctuation: '#4b5563',
    tag: '#155e75',
    attribute: '#9d174d',
    fn: '#0d0f12',
    property: '#1f2937',
  },
};

/** A Shiki theme from a palette, with the same scopes as signoff-ui's. */
export function codeTheme(type: 'light' | 'dark'): ThemeRegistration {
  const c = CODE_PALETTES[type];
  return {
    name: `ondocs-${type}`,
    type,
    colors: { 'editor.background': c.bg, 'editor.foreground': c.fg },
    settings: [
      { settings: { foreground: c.fg, background: c.bg } },
      {
        scope: ['comment', 'punctuation.definition.comment'],
        settings: { foreground: c.comment, fontStyle: 'italic' },
      },
      {
        scope: [
          'keyword',
          'storage',
          'storage.type',
          'keyword.operator.new',
          'keyword.control',
          'variable.language',
        ],
        settings: { foreground: c.keyword },
      },
      {
        scope: ['string', 'string.quoted', 'string.template', 'markup.inline.raw'],
        settings: { foreground: c.string },
      },
      {
        scope: ['constant.numeric', 'constant.language', 'constant.character', 'support.constant'],
        settings: { foreground: c.number },
      },
      {
        scope: ['punctuation', 'meta.brace', 'keyword.operator', 'meta.tag.punctuation'],
        settings: { foreground: c.punctuation },
      },
      {
        scope: ['entity.name.tag', 'support.class.component', 'entity.name.type', 'support.type'],
        settings: { foreground: c.tag },
      },
      { scope: ['entity.other.attribute-name'], settings: { foreground: c.attribute } },
      {
        scope: ['entity.name.function', 'support.function', 'meta.function-call'],
        settings: { foreground: c.fn },
      },
      {
        scope: ['variable.other.property', 'meta.object-literal.key', 'support.type.property-name'],
        settings: { foreground: c.property },
      },
      { scope: ['markup.inserted'], settings: { foreground: c.keyword } },
      { scope: ['markup.deleted'], settings: { foreground: c.number } },
    ],
  };
}
