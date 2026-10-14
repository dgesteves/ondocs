---
'ondocs': patch
---

The dialog's `aria-describedby` no longer names an element that is not in the page when the site has `@radix-ui/react-dialog` 1.2. Radix 1.2 adds the id of its own `Dialog.Description` to the `aria-describedby` the dialog is given, and the dialog gave its description an id of its own, so the second id pointed at nothing. The dialog now leaves both ids to Radix, which names its description once on 1.1 and 1.2. What a screen reader announces is unchanged.
