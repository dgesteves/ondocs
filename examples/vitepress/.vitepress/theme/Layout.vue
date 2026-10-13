<script setup lang="ts">
import { useData } from 'vitepress';
import DefaultTheme from 'vitepress/theme';

import AskBox from './AskBox.vue';

const { Layout } = DefaultTheme;
const { page } = useData();
</script>

<!-- The live demo's notice, in the default theme's layout-top slot, and the first page's question
     box, in its doc-before slot: both outside .vp-doc, so the index and the pages' Markdown copies
     leave them out. The notice's button opens the dialog through its data-ondocs-open attribute. -->
<template>
  <Layout>
    <template #layout-top>
      <p class="demo-notice">
        <span>Live demo of ondocs on VitePress.</span>
        <button type="button" class="demo-try" data-ondocs-open>
          ✦ Try it: ask these docs a question
        </button>
        <span>
          <a href="https://ondocs.vercel.app">ondocs.vercel.app</a> ·
          <a href="https://github.com/dgesteves/ondocs">GitHub</a>
        </span>
      </p>
    </template>
    <template #doc-before>
      <AskBox v-if="page.relativePath === 'index.md'" />
    </template>
  </Layout>
</template>

<style>
/* The theme moves the navigation, the sidebar and the content down by this much. */
:root {
  --vp-layout-top-height: 40px;
}

/* The demo's buttons, in the brand color the navbar button has: a shade darker than the brand
   button in light mode, for 4.5:1 with their white label. */
:root {
  --demo-accent: var(--vp-c-brand-2);
  --demo-accent-hover: var(--vp-c-brand-1);
}

.dark {
  --demo-accent: var(--vp-c-brand-3);
  --demo-accent-hover: var(--vp-c-brand-2);
}

.demo-notice {
  position: fixed;
  inset: 0 0 auto;
  z-index: var(--vp-z-index-layout-top);
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 4px 10px;
  height: var(--vp-layout-top-height);
  margin: 0;
  padding: 0 16px;
  overflow: hidden;
  border-bottom: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-alt);
  color: var(--vp-c-text-1);
  font-size: 13px;
  line-height: 20px;
  text-align: center;
}

/* Narrower, the links on a line of their own, and on a phone the button too. */
@media (max-width: 719px) {
  :root {
    --vp-layout-top-height: 64px;
  }

  .demo-notice {
    align-content: center;
    padding: 6px 16px;
  }

  .demo-notice > span:last-child {
    flex-basis: 100%;
  }
}

@media (max-width: 479px) {
  :root {
    --vp-layout-top-height: 88px;
  }

  .demo-notice > span:first-child {
    flex-basis: 100%;
  }
}

.demo-notice a {
  color: var(--vp-c-brand-1);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.demo-try {
  padding: 3px 12px;
  border-radius: 999px;
  background: var(--demo-accent);
  color: var(--vp-button-brand-text);
  font-size: 13px;
  font-weight: 600;
  line-height: 20px;
}

.demo-try:hover {
  background: var(--demo-accent-hover);
}

.demo-try:focus-visible {
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: 2px;
}
</style>
