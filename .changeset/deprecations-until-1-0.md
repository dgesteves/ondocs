---
'ondocs': patch
---

The warnings for the option names that 0.9 renamed (`buttonLabel`, `data-button-label`, `theme="system"`, a top-level `maxContextChars` and `ondocs init --name`) no longer say the old name works "until 0.10": 0.10 shipped and still accepts them. They now say it works until 1.0, which removes them, and so do the options' docs and the Upgrading page. Nothing else changes: each old name still works, and still warns once.
