# starlight-ondocs

## 0.11.0

### Patch Changes

- [#140](https://github.com/dgesteves/ondocs/pull/140) [`e54b0c0`](https://github.com/dgesteves/ondocs/commit/e54b0c0278bfec3a9cc6f005a90227e64f30d8cc) Thanks [@dgesteves](https://github.com/dgesteves)! - The `ai` peer range is now `^7.0.95`, up from `^7.0.0`. A project that already had ai 7.0.0 to 7.0.50 kept it when it installed ondocs, as it was in range, and the Docusaurus plugin, which Docusaurus loads through jiti, then failed with `TypeError: Cannot read properties of undefined (reading 'discriminatedUnion')`. Update an older ai 7 with `npm i ai@7`. ondocs needs AI SDK 7, as before, and the README now says so.

- [#160](https://github.com/dgesteves/ondocs/pull/160) [`ca7fd7c`](https://github.com/dgesteves/ondocs/commit/ca7fd7c92910bcd9b1bfdac4a3c2ad2da0a1ee98) Thanks [@dgesteves](https://github.com/dgesteves)! - Astro, Starlight and VitePress setups that built without a word, and then could only fail, now say so or work:
  
  - A static Astro or Starlight build, with no adapter and no `endpoint`, now warns that the dialog posts to `/api/ask`, which the build does not serve, and says to run `npx ondocs init`, add an SSR adapter or set `endpoint`. Before, the build was clean and every question got a 404 once the site was deployed. The warning stays off once the site has the endpoint `ondocs init` writes for Vercel, Netlify or Cloudflare.
  - `ondocs/starlight` and `starlight-ondocs` in Astro's `integrations`, where `npx astro add starlight-ondocs` puts them, now stop the build with an error that says to move the plugin into Starlight's `plugins`. Before, Astro ran none of it: no index, no `llms.txt`, no button, and no error.
  - With an SSR adapter and `base`, the dialog now posts under `base` whenever the site's own `src/pages/api/ask.ts` answers there: with route files for both `/api/ask` and `/api/mcp`, with `route: { mcp: false }`, or with `route: false`. Before, it posted to `/api/ask`, outside `base`, and every question got a 404.
  - `withOndocs` now takes a VitePress config as a Promise, as `withPwa` from `@vite-pwa/vitepress` returns it, or as a function of `{ command, mode }`, and returns it in the same shape. Before, it spread either into an object, which dropped the whole config, and the build failed with an error about the site's own files.

- [#136](https://github.com/dgesteves/ondocs/pull/136) [`1e0b9fa`](https://github.com/dgesteves/ondocs/commit/1e0b9fa87406358c5fb607b2a2b69ebe42ead147) Thanks [@dgesteves](https://github.com/dgesteves)! - `starlight-ondocs` now stops `astro build` and `astro dev` with a message that says what to do when the project has no `ondocs` of its own: "install ondocs next to it, at the same version: pnpm add ondocs@…". pnpm gives a project only its direct dependencies, so a Starlight site that installed only `starlight-ondocs`, as its README said, failed with `Rolldown failed to resolve import "ondocs/react/styles.css"`. A project where npm put `ondocs` next to it keeps building as before. The READMEs of both plugin packages now install `ondocs` with them, which also gives the project the `ondocs` command and `ondocs/server` for the endpoint.
- Updated dependencies [[`a11de8b`](https://github.com/dgesteves/ondocs/commit/a11de8bc82ff2623f7e688425f01a9079d2bfa6b), [`e54b0c0`](https://github.com/dgesteves/ondocs/commit/e54b0c0278bfec3a9cc6f005a90227e64f30d8cc), [`0f858d0`](https://github.com/dgesteves/ondocs/commit/0f858d0b878e1d5ad085b33dd6bd5956c1defc71), [`7b5778a`](https://github.com/dgesteves/ondocs/commit/7b5778a5fb7f38961e92e7804ec74e30902c36ce), [`a0d737a`](https://github.com/dgesteves/ondocs/commit/a0d737af1396b9888e5f2cabafe1d30ecec5c915), [`e681093`](https://github.com/dgesteves/ondocs/commit/e681093184c7ff7de3de58b4d70ea10a9aa0ee11), [`85d91b1`](https://github.com/dgesteves/ondocs/commit/85d91b1577dd16696219b478ec1f9bad29828b43), [`dc335f9`](https://github.com/dgesteves/ondocs/commit/dc335f9173eecaddd4be4ceaa3c005f0d132fae1), [`4de2ba7`](https://github.com/dgesteves/ondocs/commit/4de2ba733feb40e3d33e9a5aec32c3294188b6b3), [`d689d33`](https://github.com/dgesteves/ondocs/commit/d689d33d9f3dfd38632f9f3ddff1073aa277de58), [`a49466c`](https://github.com/dgesteves/ondocs/commit/a49466c3507dc60a862514d42c78c1d9e6319428), [`16c725b`](https://github.com/dgesteves/ondocs/commit/16c725b0247eeec8906e38944addc824b82592c1), [`7ab1a9e`](https://github.com/dgesteves/ondocs/commit/7ab1a9e5a00bd15482618d8afe4df0e962390e9e), [`21128c5`](https://github.com/dgesteves/ondocs/commit/21128c554b93fc98d77b0155d0688b6cbdedb3fd), [`273e272`](https://github.com/dgesteves/ondocs/commit/273e272b53ce26ba8a1ad85b341e0be31a8408ca), [`2e27118`](https://github.com/dgesteves/ondocs/commit/2e27118da1e99a3abee8901315fbee9d02acd316), [`bebbd46`](https://github.com/dgesteves/ondocs/commit/bebbd4687bdf88fcafb786aec68379e8ffeec561), [`828a4a3`](https://github.com/dgesteves/ondocs/commit/828a4a311cc55f54c76564d6100cfb315ec67335), [`ca7fd7c`](https://github.com/dgesteves/ondocs/commit/ca7fd7c92910bcd9b1bfdac4a3c2ad2da0a1ee98), [`d387567`](https://github.com/dgesteves/ondocs/commit/d387567939ebf1581ac083cd1e5851c427f58f85)]:
  - ondocs@0.11.0

## 0.10.0

### Patch Changes

- Updated dependencies [[`900f368`](https://github.com/dgesteves/ondocs/commit/900f368f0e5f6ef3aab2a89dded81df82d6476d1), [`c675e01`](https://github.com/dgesteves/ondocs/commit/c675e017d799fb059460dbda0d29fc8587983faf)]:
  - ondocs@0.10.0

## 0.9.0

### Patch Changes

- Updated dependencies [[`9b882ee`](https://github.com/dgesteves/ondocs/commit/9b882eee1b16e8a4c8b08b3f05dcd44644efa580), [`5409b87`](https://github.com/dgesteves/ondocs/commit/5409b874342cf8afd7989c6a5f8d85fea93698d8), [`153760b`](https://github.com/dgesteves/ondocs/commit/153760bdae21429bc9178a8e5103d1f80809c1a9), [`9276df9`](https://github.com/dgesteves/ondocs/commit/9276df928534e4c19e508268a4d9e7d39c2ea00b), [`7858807`](https://github.com/dgesteves/ondocs/commit/78588072a8ba7ae540cab1e135aa04fb53bd834b)]:
  - ondocs@0.9.0

## 0.8.0

### Patch Changes

- Updated dependencies [[`bbe0f87`](https://github.com/dgesteves/ondocs/commit/bbe0f8723f357f6cb2b92841b94fdb875148624c), [`4daccdf`](https://github.com/dgesteves/ondocs/commit/4daccdf03da0f215d69ce82abfd05e25d6e20c65), [`98d1021`](https://github.com/dgesteves/ondocs/commit/98d10215b7b852ab598b9416b2e11b6bda61e8d3), [`d8a3e65`](https://github.com/dgesteves/ondocs/commit/d8a3e653e685582c73d4e183caf4fe4ac59c598d), [`5dbe809`](https://github.com/dgesteves/ondocs/commit/5dbe809ca1c47bf4bb4097749c243e856c1c840c), [`55772ba`](https://github.com/dgesteves/ondocs/commit/55772bad6aaa6d9a91586d184304aa4e9029ae42), [`4773192`](https://github.com/dgesteves/ondocs/commit/4773192edf52134bb4edb5cf60fc2f92f322bbf5)]:
  - ondocs@0.8.0

## 0.7.0

### Patch Changes

- Updated dependencies [[`a7fc5d3`](https://github.com/dgesteves/ondocs/commit/a7fc5d34826e86519eb111e09f5d269a8d7c7395), [`2321172`](https://github.com/dgesteves/ondocs/commit/232117202972837a03ce9bf68ee30d897378aa77), [`1950ef2`](https://github.com/dgesteves/ondocs/commit/1950ef234872153e5dde97ee65025692e8cb9992), [`1d742bb`](https://github.com/dgesteves/ondocs/commit/1d742bb8dfc488ef37bea51cb3079903e2a3956e), [`eefb00c`](https://github.com/dgesteves/ondocs/commit/eefb00cee52eaa28ee51b003022f20ffb4a8e586), [`e3c5e30`](https://github.com/dgesteves/ondocs/commit/e3c5e309fb414d3aa6e9fb24196c42ba634f5308), [`0510866`](https://github.com/dgesteves/ondocs/commit/05108662517942429c110937b0c4ebd9f2562078)]:
  - ondocs@0.7.0
