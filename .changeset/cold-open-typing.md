---
'ondocs': patch
---

What a visitor types straight after ⌘I is no longer lost while the dialog's code loads. Before, the keys went nowhere until the dialog was on screen: in headless Chrome with its CPU slowed four times, the first one or two letters on the script embed and the first seven on a React page, and the whole question when the code took 1.5 s to arrive. The keys typed on the page between opening the dialog and its input taking focus now go to the input, which opens with them (with Backspace applied), and typing goes on from there. They are not sent until the visitor sends them, and a page's own key handlers no longer see them (a Space no longer scrolls the page under the dialog). A text field, an IME's composition and the shortcuts keep their keys, and opening the dialog on a question, or closing it, drops what was typed. This applies to the script tag, `mountAskDialog`, the Starlight, Astro and VitePress plugins, `AskDialog`, `AskButton` and the Docusaurus plugin.

On React hosts (`AskDialog`, `AskButton`, Docusaurus), the dialog now renders as it opens once its code has loaded, for example after a pointer over the button. Before, `Suspense` held its first render back by about 300 ms, which also cost those keys: 313 to 314 ms from ⌘I to the dialog, now 12 to 13 ms.

The script tag's launcher, `embed.global.js`, is 0.2 KB larger: 3.5 KB gzipped.
