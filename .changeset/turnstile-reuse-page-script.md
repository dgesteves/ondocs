---
'ondocs': patch
---

When the page has already added Turnstile's script and it is still loading as the dialog opens, the dialog waits for that script instead of adding a second one, so Turnstile no longer runs twice. If Turnstile is still not there 5 seconds later, as with a tag that failed before the dialog opened, the dialog replaces the tag with its own.
