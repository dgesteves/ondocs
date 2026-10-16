---
'ondocs': patch
---

`remoteIndex` no longer lets a site that stops answering hold up every question. Before, once the index was due for a check, every request waited for that check, so a hung site held them all until the platform's own fetch gave up.

- Each fetch of the index is given up after 10 seconds, for the response and the file together, also when a custom `fetch` ignores the abort signal. The new `timeoutSeconds` option changes it, up to 2147483, the longest a timer can wait: raise it for a very large index on a slow link. A check that times out keeps the index it has. A first fetch that times out fails its request with an error that names the option, and the next request tries again.
- The request that finds the index due still waits for the check, now for at most `timeoutSeconds`, so it gets a redeployed index at once. This also holds on a Worker, which cancels what a request started once it has answered. Requests that arrive during the check no longer wait for it: they are answered from the index in memory.
- A check whose connection drops part-way through the file now keeps the index it has. Before, it failed every request waiting on it with a 500. A first fetch that drops names the index's URL in its error, as other failed fetches do.
