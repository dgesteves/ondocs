---
'ondocs': patch
---

Answers on a site with versioned docs cite the version readers use. The Docusaurus plugin now indexes each docs plugin's last version, the one at `/docs`, and leaves `/docs/next` and the older versions out of the index, llms.txt and the `.md` copies; `versions: 'all'` indexes every version, as before. A site without versions indexes what it did.

Retrieval counts copies of a section once: chunks with the same title, heading and text, such as one section in several versions or a page served at two paths, return one hit, at the shortest URL (`/docs/intro` over `/docs/next/intro` and `/docs/1.0/intro`), and leave the other places to other sections. Before, every copy scored the same and the copy whose URL sorted first, often an old version's, was cited first, with the rest filling the sources. This applies to the ask endpoint, the MCP `search` tool and `ondocs eval`; `retrieval: { collapseCopies: false }` turns it off, for a `retrieve` hook that picks a version itself.
