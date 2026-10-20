# trishcaster — agent brief

> Audience: coding agents. Prefer facts over prose. Update this file when architecture or commands change.

## Intent

Micro-site that mirrors Farcaster cast URLs for sharing without the Farcaster app.

- Pattern: `/{username}/{castHash}` where `castHash` matches `0x[0-9a-fA-F]+`
- Examples: `/zoo/0x79794547` and `/decent-artlu/0x30102c7a` → SSR cast card + link to `https://farcaster.xyz/{username}/{hash}`
- Data: worker fetches `https://farcaster.tv/{username}/{hash}`; no usable cast → "may be banned" notice; fetch failure → link-only HTML (both still 200)

## Account types

- **Not banned**: signed an onchain smart contract that granted the address a soulbound NFT. Farcaster APIs return their data.
- **Banned**: get **no data** from Farcaster APIs — `farcaster.tv` answers with a zero-hash cast (`0x000…000`) or an empty list.
- Worker signals (`worker/cast-page.tsx`): API reachable but no usable cast → `noDataPage` ("may be banned"); network/HTTP failure → plain link-only page.
- Onchain ban verification via the soulbound NFT is possible but **not implemented** (needs contract address + chain).

## Stack

| Layer | Choice | Notes |
| --- | --- | --- |
| Runtime / package mgr | Bun | lockfile: `bun.lock`; scripts use `bun run` |
| UI (landing) | Preact 11 | SPA assets; entry `src/main.tsx` |
| Cast pages | Hono on Cloudflare Worker | SSR in `worker/` |
| Cast embed | react-farcaster-embed | server entry + `castData`; fetch done in worker |
| SSR | preact-render-to-string | after `await FarcasterEmbed({ castData })` |
| Bundler | Vite 8 | `@preact/preset-vite` + `@cloudflare/vite-plugin` |
| Lint | Biome | `bun run lint` |
| Typecheck | `bun check` | tsc 7–compatible, built into Bun; no `typescript` pkg |
| Tests | bun:test | `bun test worker/cast-route.test.ts` |

## Commands

```sh
bun install
bun run dev          # vite (CF plugin; local worker + assets)
bun run build        # vite build → dist/
bun run typecheck    # bun check (tsc-compatible; reads tsconfig*.json)
bun run preview      # build + vite preview
bun run deploy       # build + wrangler deploy
bun run lint         # biome lint .
bun test             # integration tests (cast route)
bun run cf-typegen   # wrangler types → worker-configuration.d.ts
```

## Layout

```
/
├── index.html                 # SPA shell → /src/main.tsx
├── vite.config.ts             # preact + cloudflare + react→preact aliases
├── wrangler.jsonc             # main=worker/index.ts; not_found_handling=none
├── public/farcaster-embed.css # linked from SSR HTML
├── worker/
│   ├── index.ts               # Hono app; export { app }; default { fetch }
│   ├── cast-page.tsx          # fetch + SSR embed / link fallback
│   ├── cast-route.test.ts     # bun:test; mock.module for server-only/react
│   └── shims/server-only.ts   # empty stub for Next.js marker package
└── src/                       # landing only (App.tsx)
```

## Routes

| Path | Handler | Response |
| --- | --- | --- |
| `/` | static asset `index.html` | landing SPA |
| `/api/` | Hono | `{ "name": "Cloudflare" }` |
| `/:username/:hash` (`0x…`) | Hono SSR | HTML cast card + farcaster.xyz link; "may be banned" notice when API returns no data |
| other missing paths | worker 404 / no SPA fallback | `not_found_handling: none` |

## Conventions for agents

- **Preact, not React** for first-party code. Vite aliases map `react*` → preact for the embed lib.
- **Cast routing is server-side (Hono)**, not client-side routing.
- **Tests**: `mock.module("server-only"|react*)` before importing `./index.ts`; mock `globalThis.fetch` for farcaster.tv.
- **TS worker**: `jsxImportSource: preact`; relative imports need `.tsx` extensions (`nodenext`); tests excluded from `tsconfig.worker.json`.
- **Secrets**: `.env*` / `.dev.vars*` gitignored.

## Key files

| Task | Touch |
| --- | --- |
| Cast SSR / fallback | `worker/cast-page.tsx` |
| Routes | `worker/index.ts` |
| Aliases | `vite.config.ts`, `tsconfig.worker.json` paths |
| Landing | `src/App.tsx` |
| Deploy / CF | `wrangler.jsonc` |

## Status

Cast SSR path shipped. Optional: deploy.
