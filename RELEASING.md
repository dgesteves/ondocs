# Releasing

`ondocs`, `docusaurus-plugin-ondocs` and `starlight-ondocs` release together, at one version, from [`.github/workflows/release.yml`](.github/workflows/release.yml). Nothing is published from a laptop.

## How a release happens

1. A pull request with a changeset merges to `main`. The release workflow opens or updates the release pull request, `chore: release`, which moves the versions, the changelogs, the Worker template and the docs' jsDelivr pins.
2. CI runs on the release pull request (see [the release GitHub App](#the-release-github-app)), and it can be merged once `ci-ok` passes (or it merges by itself, with `RELEASE_AUTO_MERGE`, below).
3. The merge runs the release workflow again. With no changesets left, it publishes to npm what npm doesn't have yet, pushes the three packages' tags, creates the GitHub release for `ondocs`, then checks npm, the docs and jsDelivr.

On a push to `main`, the workflow runs three jobs:

- **Validate**, with read permissions: `pnpm validate` (lint, the tests, the package checks and the four example builds).
- **Version or publish**, the only job that can write or publish (`id-token` is for npm trusted publishing), and only on a push: install, build, then `changesets/action`, which opens the release pull request or runs `changeset publish`. Then the GitHub release for `ondocs` alone, with its `CHANGELOG.md` entry as the notes, marked as the latest. The plugins get their tags and no release. npm can take minutes to serve a version it has just accepted (npm's time for `ondocs@0.10.0` is almost 3 minutes after its publish job ended), so when the job has just published `ondocs`, the release step waits up to about 10 minutes for npm to serve it, then fails if it still doesn't, saying to re-run the job.
- **Check npm, jsDelivr and the docs**, with read permissions. After a publish, it checks that all three packages are on npm at the version and that the plugins install with that `ondocs` (`scripts/check-published.mjs npm`, which waits up to about 10 minutes for npm), that every `ondocs/...` import the docs show resolves in the published package (`scripts/check-doc-imports.mjs`), and that jsDelivr's `ondocs@MAJOR.MINOR` and `ondocs@MAJOR` serve the new version, for the script and the dialog it loads (`scripts/check-published.mjs jsdelivr`, which purges them and waits up to about 5 minutes). After any other push to `main`, it checks only the docs' imports, against npm's latest, and a miss, or a failed download, is a warning: the docs deploy from `main`, so they can be ahead of npm until the next release.

The docs' imports are the `ondocs/...` modules the pages name in quotes or backticks, and the names the pages take from them: those of import statements (`import { createAskHandler } from 'ondocs/server'`), and those the prose gives a module in backticks (`` `openAskDialog(question?)` from `ondocs/embed` ``, `` `AskDialog` from `ondocs/react` ``). Each module must be in the package's `exports`, its files in the package, and each name in the module's types. A name the prose mentions any other way is not checked.

The Version or publish job runs no tests and no example builds: the dependencies' test and build code runs in jobs with no write token and no OIDC token. It also installs without the pnpm store cache, which those jobs can save. Every action is pinned to a commit, with its version in a comment, and Dependabot moves both.

## The release GitHub App

A push made with the workflow's own token starts no workflows, so without an App the release pull request gets no CI of its own, and `main` won't take it. The workflow then starts CI on it itself (`gh workflow run ci.yml`). If the pull request still shows no checks, push an empty commit to `changeset-release/main`, as before.

With a GitHub App, the release pull request runs CI like any other. To set it up, once:

1. Create a GitHub App on your account (Settings, Developer settings, GitHub Apps), with no webhook and two repository permissions: Contents, read and write; Pull requests, read and write.
2. Install it on this repository only.
3. Add two repository secrets (Settings, Secrets and variables, Actions): `RELEASE_APP_ID`, the App's client ID (or its app ID), and `RELEASE_APP_PRIVATE_KEY`, a private key generated on the App's page.

The workflow uses the App when both secrets are set, and its own token otherwise. The version commit and the GitHub release are then the App's.

To have each release pull request merge by itself once its CI passes, also allow auto-merge (Settings, General) and add a repository variable `RELEASE_AUTO_MERGE` set to `true`. A merged changeset is then on npm as soon as the release pull request's CI passes, so leave it off while releases are timed by hand.

## A dry run

Run the workflow by hand on a branch: Actions, Release, Run workflow, or

```sh
gh workflow run release.yml --ref <branch>
```

It runs on that branch, and publishes, pushes and creates nothing:

- Validate runs as usual.
- Version or publish does not run. In its place, **Dry run**, with read permissions only, gets a read-only token from the App when the secrets are set (so a failure there shows the App isn't set up), builds, then runs `pnpm version-packages` and shows the diff the release pull request would have, packs the three packages into the runner and prints their versions and dependencies, and prints the GitHub release the version would get (`check-published.mjs release --dry-run`).
- The checks read what npm and jsDelivr serve for the version on the branch, without purging, and report the docs' imports that npm's latest lacks as warnings.

Do one after any change to the workflow, before the next release.

## When a step fails

Re-running the failed jobs is safe. `changeset publish` publishes only the versions npm doesn't have, and the release step creates `ondocs@X.Y.Z`'s tag and release only when they are missing and npm has the version. A missing tag is created at the run's commit.

- **npm has only some of the packages.** The plugins pin `ondocs` at their own version, so `npm i docusaurus-plugin-ondocs` fails with ETARGET while `ondocs` is missing. Re-run the Version or publish job.
- **A plugin's tag is missing.** `changesets/action` creates the tags through the API and only warns when one fails. Create it at the release's merge commit: `git tag docusaurus-plugin-ondocs@X.Y.Z <commit> && git push origin docusaurus-plugin-ondocs@X.Y.Z`.
- **The GitHub release is missing**, or the release step says npm still doesn't serve `ondocs@X.Y.Z`. Once `npm view ondocs@X.Y.Z version` prints the version, re-run the Version or publish job: it publishes nothing more, and creates the release. Or create it by hand: `gh release create ondocs@X.Y.Z --title ondocs@X.Y.Z --latest --notes-file <its CHANGELOG.md entry>`.
- **The docs show an import the release lacks.** The docs describe something npm doesn't have. Release it, or fix the docs. `pnpm build && pnpm check:doc-imports` checks them against this checkout, and `node scripts/check-doc-imports.mjs --npm ondocs@latest` against npm.
- **jsDelivr still serves the old version.** Re-run the Check job, or purge by hand: `curl https://purge.jsdelivr.net/npm/ondocs@MAJOR.MINOR/dist/embed.global.js`, and the same for `dist/embed-dialog.global.js` and `ondocs@MAJOR`. Browsers keep a range for up to 7 days, and no purge reaches them.

## Before 1.0

Each minor release moves the docs' script tags from `ondocs@0.X` to `ondocs@0.Y` (`scripts/sync-cdn-range.mjs`, in the release pull request). From 1.0 the docs can pin `ondocs@1`, and minors stop moving them.

The plugin packages' GitHub releases for 0.9.0 and 0.10.0 came from before this workflow. They can be deleted, keeping their tags (`gh release delete docusaurus-plugin-ondocs@0.10.0`, without `--cleanup-tag`), so the releases page shows only `ondocs`.
