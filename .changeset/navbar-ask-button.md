---
'ondocs': minor
---

"Ask AI" can go in the navbar. `dialog: { navbar: true }` in the Docusaurus, Starlight and VitePress plugins puts the button after the search box (in Starlight's header, and VitePress's nav bar), filled with the site's accent color, with the shortcut on it, ⌘I on a Mac and Ctrl I elsewhere, chosen without a hydration mismatch; on a phone it is an icon that stays in the navbar rather than the menu. A string sets its label, which is otherwise `labels.launcher` in each locale. With it, the floating button is off unless `launcher` is set; without it, nothing changes.

The dialog also opens from anywhere on the page, with a question or without. Any element with a `data-ondocs-open` attribute opens it, its value a question to ask in a new thread, and a form with the attribute asks what its `question` field holds. `openAskDialog(question?)` from `ondocs/embed`, `window.Ondocs.open(question?)` with the script tag and `open(question?)` on what `mountAskDialog` returns do the same from code, and `AskDialog` takes a `question` prop. The button's look is `ondocs/embed/button.css`, for a button of your own. The script tag's launcher grows from 2.9 to 3.2 KB gzipped.
