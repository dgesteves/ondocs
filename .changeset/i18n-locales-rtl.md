---
'ondocs': minor
---

The Starlight plugin words the dialog in French, German and Spanish on a locale in one of them: the button, every label, the title and the route's "I don't know", under the labels you give in `dialog.locales`. A new `route.noAnswerMessage` option sets the route's "I don't know", for every locale or per locale (`{ root: '…', fr: '…' }`). The MCP route the Astro and Starlight integrations serve with an adapter now reads each locale's index, so `search` and `list_pages` take a `locale`, as the dialog's questions do. `ondocs dev` serves each locale's index beside the root one (`dist/fr/ask-index.json`), on the ask and MCP endpoints.

On a right-to-left page, code blocks, inline code and the sources' URLs stay left to right, questions and answers run in the direction of their own text, and the selected suggestion's bar, list indents and the floating button follow the page's direction. ⌘I and Ctrl+I open the dialog on keyboard layouts that type no Latin letters, such as Russian or Greek.
