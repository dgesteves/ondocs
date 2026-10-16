---
'ondocs': patch
---

`remoteIndex` no longer holds up questions while it checks the site again. The request that finds the index due, every five minutes by default, and any during the check are answered from the index in memory while the check runs in the background. Before, each of them waited for the check, so a site that stopped answering held every question until the platform's own fetch gave up.

- Each fetch of the index is given up after 10 seconds, for the response and the file together, also when a custom `fetch` ignores the abort signal. The new `timeoutSeconds` option changes it: raise it for a very large index on a slow link. A check that times out keeps the index it has; a first fetch that times out fails its request, and the next request tries again.
- A check whose connection drops part-way through the file now keeps the index it has. Before, it failed every request waiting on it with a 500. A first fetch that drops names the index's URL in its error, as other failed fetches do.
