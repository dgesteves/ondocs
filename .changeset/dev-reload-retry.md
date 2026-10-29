---
'ondocs': patch
---

`ondocs dev` reads the index again after a reload fails. It noted the file's new modification time before reading it, so when a question arrived while a build was still writing the file, that question got a 500, and every later one was answered from the old index until the file changed again; on a file system that keeps modification times to the second, the finished file often did not. The file now counts as read only once it loads, and questions that arrive during a reload wait for it.
