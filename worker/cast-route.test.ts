/**
 * Cast route integration tests.
 *
 * worker/index.ts contract:
 *   export const app = new Hono();
 *   export default { fetch: app.fetch };
 *
 * Tests call `app.request(...)`. Cloudflare uses the default export.
 * Shim (shim.artlu.xyz) is the sole data source; globalThis.fetch is mocked
 * and routed by exact URL — unexpected URLs throw, exercising fallbacks.
 */
import { afterEach, beforeEach, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));
// CJS deps (linkify-react) call require("react"); sync preact/compat works.
mock.module("react", () => require("preact/compat"));
mock.module("react-dom", () => require("preact/compat"));
mock.module("react/jsx-runtime", () => require("preact/jsx-runtime"));
mock.module("react/jsx-dev-runtime", () => require("preact/jsx-runtime"));

const { app } = await import("./index.ts");

const CAST_TEXT = "omg so relevant!";
const SHORT_HASH = "0x895ecc74";
const FULL_HASH = "0x895ecc7415208bfb6105a8cb675f391f19cb9e2c";

// Shape as returned by shim.artlu.xyz /wc/{username}/{shortHash}:
// Snapchain message data — unix-SECOND timestamp, raw {url}/{castId} embeds.
const SHIM_CAST = {
	fid: 10215,
	hash: FULL_HASH,
	text: CAST_TEXT,
	embeds: [
		{ url: "https://imagedelivery.net/BXluQx4ige9GuW0Ia56BHw/0eeef320/original" },
	],
	timestamp: 1_792_425_174,
	user: {
		fid: 10215,
		username: "zoo",
		displayName: "zoo",
		pfpUrl: "https://imagedelivery.net/BXluQx4ige9GuW0Ia56BHw/ab8e1aa9/original",
		bio: "primus amanuensis @qbase",
	},
};

const originalFetch = globalThis.fetch;

// decent-artlu's cast: same data, but fid 3319217 has NOT signed, and its
// URL embed has no unfurl mock — hostname fallback must still render.
const ARTLU_CAST = {
	...SHIM_CAST,
	fid: 3319217,
	embeds: [{ url: "https://example.com/article" }],
};
// fid with no /signed mock: its signed-check fetch throws (fail-open path).
const UNKNOWN_SIGNED_CAST = { ...SHIM_CAST, fid: 7777777 };
// Regression: the real /zoo/0x79794547 cast — a quote embed + a URL embed.
// The bundle reads quote.author.pfp.url unguarded; quotes are dropped and
// URL embeds render as link cards.
const QUOTE_URL_CAST = {
	...SHIM_CAST,
	hash: "0x797945472e1ed7dfe53da94c03ad972ef7fc5fd4",
	embeds: [
		{ castId: { fid: 3854, hash: "0xa7c5f47033da848d6d16dac11c61838634a50c23" } },
		{
			url: "https://newrepublic.com/article/180487/balaji-srinivasan-network-state-plutocrat",
		},
	],
};

beforeEach(() => {
	globalThis.fetch = mock(async (input: RequestInfo | URL) => {
		const url = String(input);
		if (url === `https://shim.artlu.xyz/wc/zoo/${SHORT_HASH}`) {
			return Response.json({ success: true, cast: SHIM_CAST });
		}
		if (url === "https://shim.artlu.xyz/wc/zoo/0x11111111") {
			return Response.json({ success: true, cast: UNKNOWN_SIGNED_CAST });
		}
		if (url === "https://shim.artlu.xyz/wc/zoo/0x79794547") {
			return Response.json({ success: true, cast: QUOTE_URL_CAST });
		}
		if (
			url ===
			`https://unfurl.artlu.workers.dev/?u=${encodeURIComponent("https://newrepublic.com/article/180487/balaji-srinivasan-network-state-plutocrat")}`
		) {
			return Response.json({
				ogTitle: "Balaji and the Network State",
				ogDescription: "A test description",
				ogImage: [{ url: "https://img.example.test/cover.jpg" }],
			});
		}
		if (url === "https://shim.artlu.xyz/signed/10215") {
			return Response.json({ success: true, signed: true });
		}
		if (url === "https://shim.artlu.xyz/wc/decent-artlu/0xbb54368f") {
			return Response.json({ success: true, cast: ARTLU_CAST });
		}
		if (url === "https://shim.artlu.xyz/signed/3319217") {
			return Response.json({ success: true, signed: false });
		}
		if (url === "https://shim.artlu.xyz/wc/zoo/0xdeadbeef") {
			return Response.json({ success: false, error: "cast not found" });
		}
		if (url === "https://shim.artlu.xyz/wc/zoo/0x00000000") {
			throw new Error("shim unavailable");
		}
		throw new Error(`Unexpected fetch in test: ${url}`);
	}) as typeof fetch;
});

afterEach(() => {
	globalThis.fetch = originalFetch;
});

test("GET /api/ returns Cloudflare JSON", async () => {
	const res = await app.request("/api/");
	expect(res.status).toBe(200);
	expect(await res.json()).toEqual({ name: "Cloudflare" });
});

test("GET /:username/:hash SSR-renders the cast card from Shim data", async () => {
	const res = await app.request(`/zoo/${SHORT_HASH}`);
	expect(res.status).toBe(200);
	expect(res.headers.get("content-type") ?? "").toContain("text/html");

	const body = await res.text();
	expect(body).toContain(CAST_TEXT);
	expect(body).toContain(`https://farcaster.xyz/zoo/${SHORT_HASH}`);
	// The Firefly link uses the full hash Shim resolved.
	expect(body).toContain(`https://firefly.social/post/farcaster/${FULL_HASH}`);

	const fetchMock = globalThis.fetch as ReturnType<typeof mock>;
	expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
		`https://shim.artlu.xyz/wc/zoo/${SHORT_HASH}`,
	);
});

test("GET /:username/:hash hides the farcaster link when the author has not signed", async () => {
	const res = await app.request("/decent-artlu/0xbb54368f");
	expect(res.status).toBe(200);

	const body = await res.text();
	// The embed still renders for unsigned authors...
	expect(body).toContain(CAST_TEXT);
	expect(body).toContain(
		`https://firefly.social/post/farcaster/${FULL_HASH}`,
	);
	// URL embed unfurl failed (no mock) — hostname fallback still renders.
	expect(body).toContain("example.com");
	// ...but the farcaster.xyz footer link is suppressed.
	expect(body).not.toContain("Open on Farcaster");
	expect(body).not.toContain(
		"https://farcaster.xyz/decent-artlu/0xbb54368f",
	);
	expect(body).toContain("social smart contract");
});

test("GET /:username/:hash fails open when the signed-check is unavailable", async () => {
	const res = await app.request("/zoo/0x11111111");
	expect(res.status).toBe(200);

	const body = await res.text();
	expect(body).toContain("Open on Farcaster");
	expect(body).toContain("https://farcaster.xyz/zoo/0x11111111");
	expect(body).not.toContain("social smart contract");
});

test("GET /:username/:hash renders quote+url embed casts without crashing", async () => {
	const res = await app.request("/zoo/0x79794547");
	expect(res.status).toBe(200);

	const body = await res.text();
	expect(body).not.toContain("temporarily unavailable");
	expect(body).toContain("newrepublic.com");
	// URL embed enriched via unfurl.
	expect(body).toContain("Balaji and the Network State");
	expect(body).toContain("A test description");
	expect(body).toContain("Open on Farcaster");
});

test("GET /:username/:hash returns 404 when Shim reports no such cast", async () => {
	const res = await app.request("/zoo/0xdeadbeef");
	expect(res.status).toBe(404);

	const body = await res.text();
	expect(body).toContain("not found");
	expect(body).not.toContain(CAST_TEXT);
});

test("GET /:username/:hash falls back to a link-only page when Shim is unreachable", async () => {
	const res = await app.request("/zoo/0x00000000");
	expect(res.status).toBe(200);

	const body = await res.text();
	expect(body).toContain("https://farcaster.xyz/zoo/0x00000000");
	expect(body).not.toContain(CAST_TEXT);
});
