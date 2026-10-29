---
'ondocs': patch
---

The default instructions ask a how-to answer to quote the exact command, option or config line from the sources, as code, to name the component, rule or function it uses, and to give the step for each version or setup the sources cover. The rule that asked for brevity said nothing about the step, and answers to "how do I…" questions often described what to do without the command that does it. The rules stay five, so `instructions: (defaults) => defaults + '\n6. …'` keeps reading in order. With `answerCache`, whose key covers the instructions, cached answers start fresh after upgrading.
