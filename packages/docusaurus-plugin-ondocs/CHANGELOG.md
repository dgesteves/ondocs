# docusaurus-plugin-ondocs

## 0.16.2

### Patch Changes

- Updated dependencies [[`6516f98`](https://github.com/dgesteves/ondocs/commit/6516f98db474e4627ac7e4be3acead7ae9a401d3)]:
  - ondocs@0.16.2

## 0.16.1

### Patch Changes

- Updated dependencies [[`f4ec04a`](https://github.com/dgesteves/ondocs/commit/f4ec04ac61ea322256047c61ede18249bfee7eb5)]:
  - ondocs@0.16.1

## 0.16.0

### Patch Changes

- Updated dependencies [[`3280f3b`](https://github.com/dgesteves/ondocs/commit/3280f3bc95e65c03be99e3878b310fb750dd1eaa)]:
  - ondocs@0.16.0

## 0.15.0

### Patch Changes

- Updated dependencies [[`8d1741e`](https://github.com/dgesteves/ondocs/commit/8d1741e47e7cf015b72167cd980395cb5cc26094)]:
  - ondocs@0.15.0

## 0.14.1

### Patch Changes

- Updated dependencies [[`8753cad`](https://github.com/dgesteves/ondocs/commit/8753cade6afe5fc9d421bf313cda7ecf12117c55)]:
  - ondocs@0.14.1

## 0.14.0

### Patch Changes

- Updated dependencies [[`bc14395`](https://github.com/dgesteves/ondocs/commit/bc1439506b98bcd8a6dc2d94c602a4916155d7bc), [`c52ed52`](https://github.com/dgesteves/ondocs/commit/c52ed5235a5a7f8e67913bf85dd61d153d7b11b6), [`6569079`](https://github.com/dgesteves/ondocs/commit/6569079a9e1193e44ea737ae6c1395c774651c3d), [`305a88b`](https://github.com/dgesteves/ondocs/commit/305a88b320448a39ab128835c1df2f6ad89a6e09), [`1a40dc1`](https://github.com/dgesteves/ondocs/commit/1a40dc1c5c1c95cecc69597280c3e88d9039499b), [`84dedbc`](https://github.com/dgesteves/ondocs/commit/84dedbc90ed5c98227af5e9b1aef33e614de6c41)]:
  - ondocs@0.14.0

## 0.13.1

### Patch Changes

- Updated dependencies [[`b1820a8`](https://github.com/dgesteves/ondocs/commit/b1820a8a475a3b773c4ac62c63efc3d047e58ae7)]:
  - ondocs@0.13.1

## 0.13.0

### Patch Changes

- Updated dependencies [[`56905fd`](https://github.com/dgesteves/ondocs/commit/56905fd5a9784eb7e1b128fd736714fca9cf4da2), [`37e1840`](https://github.com/dgesteves/ondocs/commit/37e1840748eb05406b8103daeb043f2b928739d1), [`8518a90`](https://github.com/dgesteves/ondocs/commit/8518a904d52d01bde8a9699e8865e7783c5f01ee)]:
  - ondocs@0.13.0

## 0.12.0

### Patch Changes

- Updated dependencies [[`4b368af`](https://github.com/dgesteves/ondocs/commit/4b368af4cc17f0c92ab4f56cde0856d839f0d1bc), [`856edfd`](https://github.com/dgesteves/ondocs/commit/856edfd1abeafbdd3cd763a4bb2350225e9f57ec), [`30843b9`](https://github.com/dgesteves/ondocs/commit/30843b955e3fd29e1ef3efb4b76616ce8b344aa5), [`a4a7fe2`](https://github.com/dgesteves/ondocs/commit/a4a7fe26b1e79d1085875f7791bdea7260008d6d)]:
  - ondocs@0.12.0

## 0.11.0

### Patch Changes

- [#140](https://github.com/dgesteves/ondocs/pull/140) [`e54b0c0`](https://github.com/dgesteves/ondocs/commit/e54b0c0278bfec3a9cc6f005a90227e64f30d8cc) Thanks [@dgesteves](https://github.com/dgesteves)! - The `ai` peer range is now `^7.0.95`, up from `^7.0.0`. A project that already had ai 7.0.0 to 7.0.50 kept it when it installed ondocs, as it was in range, and the Docusaurus plugin, which Docusaurus loads through jiti, then failed with `TypeError: Cannot read properties of undefined (reading 'discriminatedUnion')`. Update an older ai 7 with `npm i ai@7`. ondocs needs AI SDK 7, as before, and the README now says so.

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
