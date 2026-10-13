<script setup lang="ts">
import { suggestions } from '../suggestions';
</script>

<!-- The question box at the top of the first page, in the default theme's doc-before slot:
     outside .vp-doc, so the index and the page's Markdown copy leave it out. Plain markup: the
     form and the chips open the dialog through their data-ondocs-open attribute, which the ondocs
     plugin listens for. -->
<template>
  <section class="demo-ask" aria-label="Ask these docs">
    <p class="demo-ask__title">
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <path
          d="M12 2.5c.6 4.9 3.6 7.9 8.5 8.5-4.9.6-7.9 3.6-8.5 8.5-.6-4.9-3.6-7.9-8.5-8.5 4.9-.6 7.9-3.6 8.5-8.5Z"
          fill="currentColor"
        />
      </svg>
      Try it: ask these docs a question
    </p>
    <form class="demo-ask__form" data-ondocs-open>
      <input
        class="demo-ask__input"
        name="question"
        type="text"
        placeholder="Ask these docs a question…"
        aria-label="Ask these docs a question"
        maxlength="500"
        autocomplete="off"
        enterkeyhint="send"
      />
      <button class="demo-ask__submit" type="submit">Ask</button>
    </form>
    <div class="demo-ask__chips">
      <span>Or try:</span>
      <button
        v-for="question in suggestions"
        :key="question"
        type="button"
        class="demo-ask__chip"
        :data-ondocs-open="question"
      >
        {{ question }}
      </button>
    </div>
  </section>
</template>

<style scoped>
.demo-ask {
  margin: 0 0 32px;
  padding: 18px 20px 20px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  background: var(--vp-c-bg-soft);
}

.demo-ask__title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 12px;
  color: var(--vp-c-text-1);
  font-size: 18px;
  font-weight: 600;
  line-height: 1.4;
}

.demo-ask__title svg {
  flex: none;
  color: var(--vp-c-brand-1);
}

.demo-ask__form {
  display: flex;
  gap: 8px;
}

@media (max-width: 479px) {
  .demo-ask__title {
    font-size: 16px;
  }
}

.demo-ask__input {
  flex: 1;
  min-width: 0;
  height: 44px;
  padding: 0 14px;
  border: 1px solid var(--vp-c-border);
  border-radius: 8px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  font-size: 15px;
}

.demo-ask__input::placeholder {
  color: var(--vp-c-text-2);
}

.demo-ask__input:focus-visible {
  border-color: var(--vp-c-brand-1);
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: 0;
}

.demo-ask__submit {
  flex: none;
  height: 44px;
  padding: 0 20px;
  border-radius: 8px;
  background: var(--demo-accent);
  color: var(--vp-button-brand-text);
  font-size: 15px;
  font-weight: 600;
}

.demo-ask__submit:hover {
  background: var(--demo-accent-hover);
}

.demo-ask__chips {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 14px;
  font-size: 14px;
}

.demo-ask__chips > span {
  color: var(--vp-c-text-2);
}

.demo-ask__chip {
  padding: 6px 12px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 999px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  line-height: 1.4;
  text-align: left;
}

.demo-ask__chip:hover {
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
}

.demo-ask__submit:focus-visible,
.demo-ask__chip:focus-visible {
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: 2px;
}
</style>
