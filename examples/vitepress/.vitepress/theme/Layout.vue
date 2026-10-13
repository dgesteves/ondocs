<script setup lang="ts">
import DefaultTheme from 'vitepress/theme';

const { Layout } = DefaultTheme;
</script>

<!-- The live demo's notice, in the default theme's layout-top slot: outside .vp-doc, so the
     index and the pages' Markdown copies leave it out. -->
<template>
  <Layout>
    <template #layout-top>
      <p class="demo-notice">
        Live demo of ondocs on VitePress ·
        <a href="https://ondocs.vercel.app">ondocs.vercel.app</a> ·
        <a href="https://github.com/dgesteves/ondocs">GitHub</a>
      </p>
    </template>
  </Layout>
</template>

<style>
/* The theme moves the navigation, the sidebar and the content down by this much. */
:root {
  --vp-layout-top-height: 32px;
}

.demo-notice {
  position: fixed;
  inset: 0 0 auto;
  z-index: var(--vp-z-index-layout-top);
  height: var(--vp-layout-top-height);
  margin: 0;
  padding: 0 16px;
  overflow: hidden;
  border-bottom: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-alt);
  color: var(--vp-c-text-1);
  font-size: 13px;
  line-height: 31px;
  text-align: center;
  white-space: nowrap;
  text-overflow: ellipsis;
}

/* Two lines on a phone, so both links show. */
@media (max-width: 519px) {
  :root {
    --vp-layout-top-height: 48px;
  }

  .demo-notice {
    padding: 6px 16px 5px;
    line-height: 18px;
    white-space: normal;
  }
}

.demo-notice a {
  color: var(--vp-c-brand-1);
  text-decoration: underline;
  text-underline-offset: 2px;
}
</style>
