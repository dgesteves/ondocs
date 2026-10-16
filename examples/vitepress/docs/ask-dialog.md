---
# Generated from examples/nextjs/content/docs/ask-dialog.md by scripts/sync-example-docs.mjs. Edit that file instead.
title: 'The ask dialog'
description: 'AskDialog props, the Ask button for your header, the launcher button, shortcuts, theming, accessibility and the useAsk hook.'
---

# The ask dialog

`AskDialog` from `ondocs/react` is a command palette built on Radix Dialog and cmdk. The Docusaurus, Astro and Starlight plugins and the script tag render the same component, so everything here applies to them too, through their `dialog` options or `data-*` attributes. In a React site's header, [`AskButton`](#the-ask-button) renders the dialog with the button that opens it.

## AskDialog props

| Prop                                  | Default                         | Notes                                                                                                       |
| ------------------------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `endpoint`                            | `/api/ask`                      | Where questions are posted. Also `headers` and a custom `fetch`.                                            |
| `open`, `defaultOpen`, `onOpenChange` | uncontrolled                    | Controlled or uncontrolled.                                                                                 |
| `shortcut`                            | `"i"`                           | Opens the dialog with ⌘ or Ctrl; `false` disables it.                                                       |
| `trigger`                             | none                            | An element that opens the dialog, such as a search button.                                                  |
| `launcher`                            | `false`                         | `true` or a label: a floating "Ask AI" button with the shortcut on it.                                      |
| `suggestions`                         | `[]`                            | Questions offered before typing, filtered as you type.                                                      |
| `onNavigate`                          | browser navigation              | `(url, event)` for citations and sources; call `preventDefault()` to route yourself.                        |
| `theme`                               | `"auto"`                        | Follows `data-theme` on `<html>`, then the system; `"light"` or `"dark"` to pin it.                         |
| `classNames`                          | none                            | Extra classes per part: `overlay`, `content`, `input`, `list`, `item`, `answer`, `sources`, `footer`.       |
| `title`                               | "Ask this site"                 | The dialog's accessible name.                                                                               |
| `placeholder`                         | "Ask a question…"               | The input's placeholder.                                                                                    |
| `footer`                              | a disclaimer and keyboard hints | Replaces the footer.                                                                                        |
| `links`                               | `"all"`                         | `"sources"` keeps only the answer's links to its source pages; citations always link.                       |
| `sourceUrls`                          | none                            | `{ pages, base }`: where citations and links go when the endpoint answers from another site's index.        |
| `labels`                              | English                         | Every string the dialog and its button show or announce; see [Labels and languages](#labels-and-languages). |
| `locale`                              | none                            | The page's locale, sent with each question, for an endpoint with an index per locale.                       |
| `followUps`                           | `true`                          | Send the thread with each question, so the endpoint can answer follow-ups; `false` asks each alone.         |
| `question`                            | none                            | Asked as the dialog opens with it, and when it changes while open, each time in a new thread.               |
| `challenge`                           | none                            | `{ turnstile: '<site key>' }`: solve a [bot check](/bot-challenge) before each question.                    |

## Opening the dialog

The dialog opens with ⌘I on macOS and Ctrl+I elsewhere, in React, in the plugins and with the script tag, so ⌘K stays with the site's search. The shortcut does nothing while a text field or editor has focus.

To change the keyboard shortcut, pass another key, as in `shortcut="k"` on a site whose only search is this dialog, or turn it off with `shortcut={false}` and open the dialog from a `trigger` element or the `launcher` button instead. In the plugins, the same option is `dialog: { shortcut: 'k' }`, and with the script tag it is `data-shortcut="k"`.

## Open it from your own button

Any element with a `data-ondocs-open` attribute opens the dialog the page has: the Docusaurus, Starlight or VitePress plugin's, the script tag's, one from `mountAskDialog`, or an [`AskButton`](#the-ask-button)'s. With a value, the attribute is a question, which the dialog asks in a new thread. A form with the attribute asks what its `question` field holds, or its first input, when it is submitted. There is no script to write, so it works in Markdown, MDX, a theme's template or an HTML navbar item:

```html
<button type="button" data-ondocs-open>Ask AI</button>
<button type="button" data-ondocs-open="Do I need a vector database?">
  Do I need a vector database?
</button>
<form data-ondocs-open>
  <input name="question" placeholder="Ask these docs a question…" />
</form>
```

From code, `openAskDialog(question?)` from `ondocs/embed` does the same in any framework, and so does `window.Ondocs.open(question?)` on a page with the script tag. A pointer over the element, or focus on it, loads the dialog's code, as on the launcher. The plugins' `navbar` option puts such a button in the navbar for you: see [Docusaurus](/docusaurus#ask-ai-in-the-docusaurus-navbar), [Starlight](/astro#ask-ai-in-the-starlight-header) and [VitePress](/vitepress#ask-ai-in-the-vitepress-nav-bar). For its look on a button of your own, import `ondocs/embed/button.css` and give the button the `ondocs-button` class, with its label in a `<span class="ondocs-button-label">`.

In React, with a controlled `open`, the `question` prop does the same: set both to open the dialog on a question.

## The Ask button

`AskButton` from `ondocs/react` is the "Ask AI" button for a React site's header, with the shortcut on it, and the `AskDialog` it opens. It takes the dialog's props, except `trigger` and `launcher`:

```tsx
// components/header-ask.tsx
'use client';
import { AskButton } from 'ondocs/react';
import 'ondocs/react/styles.css';
import 'ondocs/embed/button.css';
import { useRouter } from 'next/navigation';

export function HeaderAsk() {
  const router = useRouter();
  return (
    <AskButton
      shortcut="k"
      onNavigate={(url, event) => {
        event.preventDefault();
        router.push(url);
      }}
    />
  );
}
```

Its shortcut, ⌘I or Ctrl+I by default and ⌘K here, opens the dialog, also while the dialog's code is still loading. So do `openAskDialog()` and any element with `data-ondocs-open`, so the page's other ways into the dialog need no code of their own. A question asked that way is asked once, in a new thread, and dropped when the dialog closes.

It renders the plugins' navbar button: the `ondocs-button` class, its label in `ondocs-button-label`, and the key in a `<kbd>`. `ondocs/embed/button.css` gives it their look, filled with the accent, and only the icon on a phone; or style those classes yourself.

| Prop                  | Default                     | Notes                                                                                           |
| --------------------- | --------------------------- | ----------------------------------------------------------------------------------------------- |
| `children`            | `labels.launcher`, "Ask AI" | The button's label.                                                                             |
| `className`           | none                        | Classes for the button, after `ondocs-button`.                                                  |
| `poweredBy`           | `false`                     | `true` or a line of your own: a credit line in the footer; see [Credit ondocs](#credit-ondocs). |
| The `AskDialog` props | as there                    | `open`, `onOpenChange`, `labels`, `suggestions` and the rest, for the dialog it opens.          |

Render one per page, and not on a page that already has a dialog from a plugin, the script tag or `mountAskDialog`: `openAskDialog()` and `data-ondocs-open` would open both.

On Apple devices the key hint shows ⌘ instead of Ctrl. The stylesheet reads that from a `data-ondocs-mac` attribute on `<html>`, which `AskButton` sets once the page has hydrated, so a server-rendered page shows Ctrl until then. To have ⌘ from the first paint, set the attribute in the root layout's `<head>`, as the plugins do:

```tsx
// app/layout.tsx
const MAC_SCRIPT =
  "document.documentElement.toggleAttribute('data-ondocs-mac',/Mac|iPhone|iPad/.test(navigator.platform))";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: MAC_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
```

### Credit ondocs

`poweredBy` adds a line to the end of the dialog's footer, "Answers by ondocs.", whose link opens ondocs.vercel.app in a new tab. It is off by default. `true` shows the `poweredBy` label, so it is translated with the dialog's other labels. A string is the line in your own words, with `{ondocs}` where the link goes:

```tsx
<AskButton poweredBy="Answers and docs MCP by {ondocs}." />
```

A `footer` of your own replaces it with the rest of the footer. The link has `rel="noopener"` and no `noreferrer`, so ondocs's site can see which site a visitor came from (only its origin, under browsers' default referrer policy). `AskDialog` and the plugins' `dialog` options don't take `poweredBy` yet.

## When the dialog's code loads

A page carries only the dialog's shortcut and, with `launcher` or `trigger`, its button. The dialog itself, Radix Dialog, cmdk and the answer, is a separate chunk that your bundler splits off, and it loads the first time the dialog is wanted: a pointer over or focus on its button or trigger, the shortcut, or `open`. A shortcut pressed while it loads is kept, so the dialog opens, with focus in its input, once it arrives; Escape before then cancels it. Focus goes back to where it was when the dialog closes, or to the button that opened it. Call `loadAskDialog()` from `ondocs/react` to load it sooner, such as when the page is idle.

In the plugins' sites this takes the JavaScript ondocs adds to each page from about 22 KB to 3.9 KB with Docusaurus, and from about 88 KB to 2.4 KB with Starlight, which has no React of its own; see [Benchmarks](/benchmarks#bundle-size).

## The launcher button

`launcher` adds a floating "Ask AI" button in the corner of the page, with the shortcut on it. Pass a string to change its label, as in `launcher="Ask the docs"`, and import `ondocs/embed/launcher.css` for its look, or style `.ondocs-launcher` yourself. The plugins and the script tag show it by default; there, `launcher: false` (or `data-launcher="false"`) hides it, and so does the plugins' `navbar: true`, which puts the button in the navbar instead.

## Citations and navigation

Citations in the answer and the entries in the sources list link to the exact section they came from. Pass `onNavigate` to route with your framework's client router, for example `router.push(url)` in Next.js. The dialog closes after a click either way.

When the endpoint answers from another site's index, as on a copy of that site's docs that asks its endpoint, the sources carry that site's URLs. `sourceUrls` sends them to the same pages on this site: `pages` maps a page's URL in the index to its URL here, and the anchor is kept; any other relative URL resolves against `base`, the other site's address, so it opens there. It applies to citations, the sources list and links in the answer, and in the plugins it is `dialog: { sourceUrls }`:

```ts
dialog: {
  sourceUrls: {
    pages: { '/docs/introduction': '/', '/docs/getting-started': '/getting-started' },
    base: 'https://docs.acme.dev',
  },
},
```

## Follow-up questions

The dialog keeps the thread. Once an answer is on screen, typing another question offers "Follow up", and the answer stays in view while you type. The new question goes to the endpoint with the last three questions and their answers, so it can lean on them, as in "and on Netlify?": the endpoint rewrites it into one that stands on its own before it searches (see [Follow-up questions](/ask-endpoint#follow-up-questions)). Earlier questions and answers stay above the current one, each with its own citations, which open its own sources. "New question" starts a new thread, with an empty input. `followUps={false}` asks every question on its own.

## Rating answers

When the endpoint takes feedback (its `onFeedback`), the dialog asks "Was this helpful?" under each answer, with thumbs up and down. After a rating it thanks the reader and offers "Add a comment", a one-line field that Enter sends. Both go to the endpoint, with the answer's id, and nowhere else. `useAsk` has the same as `rate(rating, comment?)`, with `feedbackEnabled` and `rating` in its state. See [Measure and improve answers](/quality#feedback-from-readers).

## Labels and languages

Every string the dialog and its button show or announce, visible or for screen readers, is a label: pass any of them as `labels`, and the rest stay in English. A `{name}` in a label is filled in: `{count}` and `{n}` with numbers, `{title}` with a page's title, `{status}` with an HTTP status. `title`, `placeholder` and `launcher` win over their labels.

```tsx
<AskDialog
  launcher
  locale="fr"
  labels={{
    launcher: 'Demander',
    placeholder: 'Posez une question…',
    newQuestion: 'Nouvelle question',
  }}
/>
```

The endpoint's own words, its "I don't know" answer, its rate limit and budget messages, its other errors and the message for an answer the model failed to write, show as it sends them, so set them there (`noAnswerMessage`, `budget.message`), or replace them in the dialog with `noAnswer`, `rateLimited`, `budgetExceeded`, `serverError` and `answerFailed`. The plugins take labels per locale; see [Docusaurus](/docusaurus#locales-and-versions) and [Astro and Starlight](/astro#locales-in-starlight).

| Label                | Default                                                                                      |
| -------------------- | -------------------------------------------------------------------------------------------- |
| `launcher`           | Ask AI                                                                                       |
| `controlKey`         | Ctrl                                                                                         |
| `title`              | Ask this site                                                                                |
| `description`        | Type a question and press Enter. Answers are generated from this site’s pages and cite them. |
| `placeholder`        | Ask a question…                                                                              |
| `ask`                | Ask                                                                                          |
| `followUp`           | Follow up                                                                                    |
| `suggested`          | Suggested                                                                                    |
| `list`               | Suggestions                                                                                  |
| `stop`               | Stop                                                                                         |
| `escapeKey`          | esc                                                                                          |
| `footer`             | Answers come from this site and can be wrong. Check the sources.                             |
| `footerNoSources`    | Answers come from this site and can be wrong.                                                |
| `footerAsk`          | ask                                                                                          |
| `footerClose`        | close                                                                                        |
| `poweredBy`          | Answers by {ondocs}.                                                                         |
| `searching`          | Searching the site…                                                                          |
| `writing`            | Writing an answer…                                                                           |
| `noAnswerFound`      | No answer found on this site.                                                                |
| `answerReadyOne`     | Answer ready, citing 1 source.                                                               |
| `answerReadyMany`    | Answer ready, citing {count} sources.                                                        |
| `answerTruncated`    | Answer ready, but cut short at its length limit.                                             |
| `truncatedNotice`    | This answer reached its length limit and may be incomplete.                                  |
| `retry`              | Retry                                                                                        |
| `sources`            | Sources                                                                                      |
| `citation`           | Source {n}: {title}                                                                          |
| `newQuestion`        | New question                                                                                 |
| `helpfulQuestion`    | Was this helpful?                                                                            |
| `helpful`            | Yes, it helped                                                                               |
| `notHelpful`         | No, it did not help                                                                          |
| `thanks`             | Thanks for the feedback.                                                                     |
| `addComment`         | Add a comment                                                                                |
| `comment`            | Comment                                                                                      |
| `commentPlaceholder` | What was missing or wrong?                                                                   |
| `send`               | Send                                                                                         |
| `thanksComment`      | Thanks for the comment.                                                                      |
| `feedbackFailed`     | The feedback could not be sent.                                                              |
| `errorNetwork`       | Could not reach the server. Check your connection.                                           |
| `errorUnavailable`   | Answers aren’t available here right now.                                                     |
| `errorNoBody`        | The response had no body.                                                                    |
| `errorInterrupted`   | The answer was interrupted. Please try again.                                                |
| `errorCutOff`        | The answer was cut off. Please try again.                                                    |
| `errorMisconfigured` | Answers aren’t set up on this site yet.                                                      |
| `challengeRequired`  | The check that you’re not a bot didn’t load. Reload the page and try again.                  |
| `challengeFailed`    | The check that you’re not a bot failed. Please try again.                                    |
| `errorUnknown`       | Something went wrong.                                                                        |
| `noAnswer`           | the endpoint's own words                                                                     |
| `rateLimited`        | the endpoint's own words                                                                     |
| `budgetExceeded`     | the endpoint's own words                                                                     |
| `serverError`        | the endpoint's own words                                                                     |
| `answerFailed`       | the endpoint's own words                                                                     |

## Theming the dialog

Import `ondocs/react/styles.css` for the default theme. With `theme="auto"`, the default, it follows a `data-theme="light"` or `"dark"` on `<html>`, as Docusaurus, Starlight and VitePress set it, and the system's light or dark setting on a page without one. To change the dialog's colors, set its CSS custom properties: every color, radius and font is one, so `.ask-dialog { --ask-accent: #7c3aed; --ask-radius: 8px; }` is a complete rebrand. To style it from scratch, skip the stylesheet: every part has a stable `ask-*` class, and `classNames` adds your own, which suits Tailwind.

## Accessibility

Focus moves into the dialog when it opens and returns to where it was when it closes. The answer region is `aria-live="polite"` and `aria-busy` while text streams, and a separate status region announces when the answer is ready. All animation is turned off under `prefers-reduced-motion`. The test suite runs axe on the dialog before and after it answers, and checks that every text color in the light and dark themes keeps a contrast of at least 4.5:1.

## While an answer streams

Sources arrive before the first word, and the answer renders as it streams, batched to one update per animation frame. Closing the dialog, by Escape, a click outside or its parent, stops the answer in flight, so the model is not left generating for nobody. When an answer stops at the model's output limit, the dialog says it may be incomplete. Once an answer is complete, the sources it does not cite are dimmed, and an answer that cites none shows no sources.

## The useAsk hook

`useAsk({ endpoint })` is the hook behind the dialog, for building your own interface. It returns `ask`, `stop` and `reset`, plus `status` (`idle`, `loading`, `streaming`, `done` or `error`), `question`, `answer`, `sources`, `refused`, `truncated`, `retrieval`, `error` and `turns`, the thread's earlier questions with their answers and sources. `ask` adds the answer on screen to `turns` and sends the thread with the next question, and `reset` starts a new thread; `followUps: false` keeps no thread. `error.kind` is `rate-limited`, `http`, `network` or `stream`, with `retryAfter` for rate limits, and `error.reason` is `misconfigured` when the endpoint says it is set up wrong. With `kind` `stream`, it cannot call its model, as without a key for it, which asking again will not fix, so the dialog offers no Retry. With `kind` `http`, it is the endpoint's 500: an index it could not load, or one that does not match its embedding model. That can pass, so the dialog keeps Retry. `stop()` keeps the partial answer.

`AskAnswer` renders an answer with clickable citations from `answer` and `sources`. It renders a small Markdown subset, never HTML, and only turns `[n]` into a link when source `n` exists.
