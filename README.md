# trishcaster — agent brief

> Audience: coding agents. Prefer facts over prose. Update this file when architecture or commands change.

## Intent

Micro-site that mirrors Farcaster cast URLs for sharing without the Farcaster app.

- Pattern: `/{username}/{castHash}` where `castHash` matches `0x[0-9a-fA-F]+` — short or full form
- Examples: `/zoo/0x895ecc74` and `/decent-artlu/0xbb54368f` → SSR cast card + links
- Data: Shim (`https://shim.artlu.xyz/wc/{username}/{hash}`) — an owner-run cached reader for the Farcaster Snapchain. One call returns the full cast, full hash included.
- Missing cast (Shim reports none) → 404 page; Shim unreachable → link-only page (200)
- Banned accounts: embeds render for everyone — but farcaster.xyz hides unsigned authors. Since Oct 15, 2026 (Network School takeover), accounts must accept the "social smart contract" (Network Code); acceptance is an on-chain access NFT. Shim exposes it: `GET https://shim.artlu.xyz/signed/{fid}` → `{"signed":true|false}`. Unsigned authors: the farcaster.xyz footer link is suppressed and only the Firefly link is shown (the check fails open — unknown state shows the link).
- farcaster.tv is deliberately not used: unofficial third party, rules unknown. Note that react-farcaster-embed's own default endpoint is farcaster.tv — always pass `castData` so it never fetches.

## Stack

| Layer | Choice | Notes |
| --- | --- | --- |
| Runtime / package mgr | Bun | lockfile: `bun.lock`; scripts use `bun run` |
| UI (landing) | Preact 11 | SPA assets; entry `src/main.tsx` |
| Cast pages | Hono on Cloudflare Worker | SSR in `worker/` |
| Cast data | Shim API | `/wc/{username}/{shortHash}` → full cast; see Mapping below |
| URL embed cards | unfurl.artlu.workers.dev | `GET /?u={url}` → OG title/description/image (cached, fails open to hostname-only) |
| Cast embed | react-farcaster-embed | rendering only — `castData` always supplied, never fetches |
| SSR | preact-render-to-string | after `await FarcasterEmbed({ castData })` |
| Bundler | Vite 8 | `@preact/preset-vite` + `@cloudflare/vite-plugin` |
| Lint | Biome | `bun run lint` |
| Typecheck | `bun check` | tsc-compatible, built into Bun; no `typescript` pkg |
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
│   ├── cast-page.tsx          # Shim fetch → CastData mapping → SSR / 404 / link fallback
│   ├── cast-route.test.ts     # bun:test; mock.module + exact-URL fetch mock
│   └── shims/server-only.ts   # empty stub for Next.js marker package
└── src/                       # landing only (App.tsx)
```

## Routes

| Path | Handler | Response |
| --- | --- | --- |
| `/` | static asset `index.html` | landing SPA |
| `/api/` | Hono | `{ "name": "Cloudflare" }` |
| `/:username/:hash` (`0x…`) | Hono SSR | 200 cast card + OG/Twitter meta (title = author handle, description = cast text, image = first image embed or avatar) + farcaster.xyz link + Firefly link (full hash); unsigned author (`/signed/{fid}` false): Firefly link only; 404 when Shim reports no such cast; 200 link-only when Shim is unreachable |
| other missing paths | worker 404 / no SPA fallback | `not_found_handling: none` |

## Shim → CastData mapping

Shim returns raw Snapchain message data; `toCastData()` in `worker/cast-page.tsx` adapts it for react-farcaster-embed:

- `timestamp` is unix **seconds** → multiplied by 1000 (the embed does `new Date(ts)`)
- `embeds` are untyped `{url}` / `{castId}` items → bucketed into `images` / `urls` / `casts`; image heuristic = `imagedelivery.net` host or image extension. **Quotes are hydrated** through Shim `GET /h/{fullHash}` (depth 1) and mapped like any cast; hydration failure (e.g. pruned casts) drops the quote. URL embeds render as link cards via `openGraph` (see unfurl above)
- message-level data has no engagement counts → `replies`/`reactions`/`recasts` stubbed to `{ count: 0 }` and `tags: []` — the embed bundle reads `e.recasts.count` and `e.tags.length` **unguarded** and crashes without them (it also reads `quote.author.pfp.url` unguarded — never emit quotes without hydrated authors)
- `author` mapped from `user` (`pfpUrl` → `pfp.url`, `bio` → `profile.bio.text`)

## Conventions for agents

- **Preact, not React** for first-party code. Vite aliases map `react*` → preact for the embed lib.
- **Cast routing is server-side (Hono)**, not client-side routing.
- **Tests**: `mock.module("server-only"|react*)` before importing `./index.ts`; mock `globalThis.fetch` by exact Shim URL — unexpected URLs throw, which is how fallback paths get tested.
- **TS worker**: `jsxImportSource: preact`; relative imports need `.tsx` extensions (`nodenext`); tests excluded from `tsconfig.worker.json`.
- **Secrets**: `.env*` / `.dev.vars*` gitignored.

## Key files

| Task | Touch |
| --- | --- |
| Shim fetch / mapping / SSR fallbacks | `worker/cast-page.tsx` |
| Routes | `worker/index.ts` |
| Aliases | `vite.config.ts`, `tsconfig.worker.json` paths |
| Landing | `src/App.tsx` |
| Deploy / CF | `wrangler.jsonc` |

## Status

Shim-only data path shipped; farcaster.tv removed. Optional: deploy.
