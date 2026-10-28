---
'ondocs': patch
---

When the page has already added Turnstile's script and it is still loading as the dialog opens, the dialog waits for that script instead of adding a second one, so Turnstile no longer runs twice.
