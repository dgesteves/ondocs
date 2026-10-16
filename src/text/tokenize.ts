/**
 * The tokenizer shared by BM25 (index and query side) and the mock embedding model.
 *
 * It is deliberately small: Unicode-aware word splitting, diacritic folding, an English stopword
 * list, camelCase expansion for code identifiers, plural stripping, and character pairs for
 * Chinese, Japanese and Korean. Anything smarter (real stemming, word segmentation, language
 * detection) belongs in the embedding model, which already handles it.
 */

const STOPWORDS = new Set(
  (
    'a about above after again against all am an and any are as at be because been before being ' +
    'below between both but by can could did do does doing down during each few for from further ' +
    'had has have having he her here hers herself him himself his how i if in into is it its ' +
    'itself just me more most my myself no nor not now of off on once only or other our ours ' +
    'ourselves out over own same she should so some such than that the their theirs them ' +
    'themselves then there these they this those through to too under until up very was we were ' +
    'what when where which while who whom why will with would you your yours yourself yourselves ' +
    'also may might must shall tell please using use used get got'
  ).split(' '),
);

const WORD = /[\p{L}\p{N}]+/gu;
// Hot path: most text is ASCII plus typographic punctuation (› — “ ” → …), and the Unicode work
// below is the slow part of loading an index. Punctuation only ever separates words, so text whose
// only non-ASCII characters are punctuation can take the ASCII scanner and tokenize identically.
// eslint-disable-next-line no-control-regex
const NEEDS_UNICODE = /[^\x00-\x7f\u00a0\u00ab\u00b7\u00bb\u2000-\u206f\u2190-\u21ff]/;
const HAS_CAMEL = /[\p{Ll}\p{N}]\p{Lu}|\p{Lu}\p{Lu}\p{Ll}/u;
const CAMEL_BOUNDARY = /(?<=[\p{Ll}\p{N}])(?=\p{Lu})|(?<=\p{Lu})(?=\p{Lu}\p{Ll})/u;
const DIACRITICS = /\p{M}+/gu;
// Han, Hiragana, Katakana and Hangul letters, and the prolonged sound mark ー and the kana voicing
// marks, which Unicode gives no script of their own. Chinese and Japanese put no spaces between
// words, and Korean keeps its particles and endings on the word.
const CJK_RUN =
  /[\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}\p{sc=Hangul}\u3099\u309a\u30fc\uff70\uff9e\uff9f]+/gu;
const HAS_CJK = new RegExp(CJK_RUN.source, 'u');
// Question words, which split a run of Chinese (simplified and traditional), Japanese or Korean
// and are dropped, as the English stopwords are. Left in, `怎么安装插件` would add `怎么` and `么安`
// to `安装`, `装插` and `插件`: pairs a page rarely has, which weigh against it in the relevance gate.
const CJK_QUESTION_WORDS = new RegExp(
  (
    '为什么 為什麼 怎么样 怎麼樣 怎么 怎麼 怎样 怎樣 如何 什么 什麼 哪里 哪裡 哪儿 哪兒 哪个 哪個 哪些 ' +
    '是否 吗 嗎 呢 どうやって どうすれば どのように どこ どれ なに なぜ でしょうか ですか ますか ' +
    '어떻게 무엇 어디 언제'
  )
    .split(' ')
    .join('|'),
  'u',
);
// "don't" and "dont" should match, so apostrophes inside a word are dropped rather than split on.
const INNER_APOSTROPHE = /(?<=[\p{L}\p{N}])['\u2019](?=[\p{L}\p{N}])/gu;

const CHAR_S = 115;
const CHAR_U = 117;
const CHAR_I = 105;

/** Stopword removal and plural stripping (`-s`, but not `-ss`, `-us` or `-is`) on a lowercase word. */
function normalizeTerm(term: string): string | null {
  const length = term.length;
  if (length < 2 || STOPWORDS.has(term)) return null;
  if (length > 3 && term.charCodeAt(length - 1) === CHAR_S) {
    const previous = term.charCodeAt(length - 2);
    if (previous !== CHAR_S && previous !== CHAR_U && previous !== CHAR_I) {
      return term.slice(0, -1);
    }
  }
  return term;
}

/** The words of non-ASCII text, folded: `Café` is `cafe`, `ｎｐｍ` is `npm`. */
function pushWords(terms: string[], text: string): void {
  for (const match of text.normalize('NFKD').replace(DIACRITICS, '').matchAll(WORD)) {
    const word = match[0];
    pushWord(terms, word, word !== word.toLowerCase());
  }
}

/**
 * A run of Chinese, Japanese or Korean as overlapping pairs of characters: `安装插件` is `安装`,
 * `装插` and `插件`, so `安装` in a question finds `安装插件` on a page. A run of one character is
 * that character. Folded with NFKC, not NFKD as other text is, so kana keep their voicing marks
 * (`デ` stays `デ`, and half-width `ﾃﾞ` becomes `デ`) and Hangul its syllables, then paired by
 * code point, so a character outside the BMP is never cut in two.
 */
function pushBigrams(terms: string[], run: string): void {
  for (const part of run.normalize('NFKC').replace(DIACRITICS, '').split(CJK_QUESTION_WORDS)) {
    const chars = Array.from(part);
    if (chars.length === 1) terms.push(part);
    for (let i = 1; i < chars.length; i += 1) terms.push(`${chars[i - 1] ?? ''}${chars[i] ?? ''}`);
  }
}

function pushWord(terms: string[], word: string, hasUpper: boolean): void {
  const lower = hasUpper ? word.toLowerCase() : word;
  const whole = normalizeTerm(lower);
  if (whole) terms.push(whole);
  if (hasUpper && HAS_CAMEL.test(word)) {
    for (const part of word.split(CAMEL_BOUNDARY)) {
      const term = normalizeTerm(part.toLowerCase());
      if (term && term !== whole) terms.push(term);
    }
  }
}

/**
 * Splits text into normalized terms.
 *
 * `createAskHandler` yields `createaskhandler`, `create`, `ask` and `handler`, so a query can match
 * an identifier whole or by its parts.
 */
export function tokenize(text: string): string[] {
  let input = text;
  if (input.includes("'") || input.includes('\u2019')) input = input.replace(INNER_APOSTROPHE, '');
  const terms: string[] = [];

  if (NEEDS_UNICODE.test(input)) {
    if (!HAS_CJK.test(input)) {
      pushWords(terms, input);
      return terms;
    }
    // Runs of Chinese, Japanese and Korean are split into pairs; the text around them into words.
    let end = 0;
    for (const match of input.matchAll(CJK_RUN)) {
      if (match.index > end) pushWords(terms, input.slice(end, match.index));
      pushBigrams(terms, match[0]);
      end = match.index + match[0].length;
    }
    if (end < input.length) pushWords(terms, input.slice(end));
    return terms;
  }

  // ASCII fast path: a character scanner, no regex match objects. Loading an index tokenizes
  // every chunk, so this loop dominates cold-start time.
  const length = input.length;
  let i = 0;
  while (i < length) {
    let code = input.charCodeAt(i);
    while (i < length && !isWordChar(code)) code = input.charCodeAt(++i);
    const start = i;
    let hasUpper = false;
    while (i < length && isWordChar(code)) {
      if (code <= 90 && code >= 65) hasUpper = true;
      code = input.charCodeAt(++i);
    }
    if (i > start) pushWord(terms, input.slice(start, i), hasUpper);
  }
  return terms;
}

/** [A-Za-z0-9] */
function isWordChar(code: number): boolean {
  return (code >= 97 && code <= 122) || (code >= 65 && code <= 90) || (code >= 48 && code <= 57);
}
