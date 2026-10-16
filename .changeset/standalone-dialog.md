---
'ondocs': patch
---

The Astro, Starlight and VitePress plugins no longer need React. Their dialog now comes prebuilt with its own React, Radix and cmdk, from the new `ondocs/embed/standalone`, so a site installs `ondocs`, `ai` and `@ai-sdk/openai` and nothing else. Before, a Vue or Astro site without React had to install `react`, `react-dom`, `@radix-ui/react-dialog` and `cmdk`, or its build failed. The dialog still loads only the first time it is wanted, in a chunk of its own: 92.6 KB gzipped on the Starlight example (93.6 KB before) and 95.6 KB on the VitePress one (96.8 KB before). A site that installed the four packages only for the dialog can remove them. On an Astro site with React islands, the dialog no longer shares their React.

`ondocs/embed/standalone` has the same `mountAskDialog` and `openAskDialog` as `ondocs/embed`, for an app with a bundler and no React. `launcherScript` from `ondocs/integration` now mounts the launcher with it.
