---
'ondocs': patch
---

The default instructions ask a how-to answer to quote the exact command, option or config line the sources give, as code, to name the component, rule or function they say it uses, and, when the question names no version or setup, to give the step for each one the sources cover. They also say never to write a command, option or name the sources do not show. The rule that asked for brevity said nothing about the step, and answers to "how do I…" questions often described what to do without the command that does it. The rules stay five, so `instructions: (defaults) => defaults + '\n6. …'` keeps reading in order. With `answerCache`, whose key covers the instructions, cached answers start fresh after upgrading.
