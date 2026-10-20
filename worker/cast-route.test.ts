/**
 * Cast route integration tests (TDD RED → GREEN).
 *
 * Expected worker export contract (worker/index.ts):
 *   export const app = new Hono();
 *   export default { fetch: app.fetch };
 *
 * Tests call `app.request(...)`. Cloudflare uses the default export.
 */
import { afterEach, beforeEach, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));
// CJS deps (linkify-react) call require("react"); sync preact/compat works.
mock.module("react", () => require("preact/compat"));
mock.module("react-dom", () => require("preact/compat"));
mock.module("react/jsx-runtime", () => require("preact/jsx-runtime"));
mock.module("react/jsx-dev-runtime", () => require("preact/jsx-runtime"));

const { app } = await import("./index.ts");

const CAST_TEXT = "Hello from the cast fixture";

const CAST_FIXTURE = {
	result: {
		casts: [
			{
				hash: "0x895ecc74",
				author: {
					username: "zoo",
					displayName: "Zoo",
					fid: 2,
					pfp: { url: "https://example.com/pfp.png" },
				},
				text: CAST_TEXT,
				timestamp: 1_712_000_000_000,
				replies: { count: 1 },
				reactions: { count: 3 },
				recasts: { count: 0 },
				tags: [],
				embeds: {},
			},
		],
	},
};

// Banned accounts get no data from Farcaster APIs: farcaster.tv answers with
// a single zero-hash cast (or an empty list).
const ZERO_HASH = "0x0000000000000000000000000000000000000000";

const BANNED_FIXTURE = {
	result: {
		casts: [
			{
				hash: ZERO_HASH,
				author: { username: "zoo", displayName: "Zoo", fid: 2 },
				text: "",
				timestamp: 0,
				replies: { count: 0 },
				reactions: { count: 0 },
				recasts: { count: 0 },
				tags: [],
				embeds: {},
			},
		],
	},
};

const originalFetch = globalThis.fetch;

beforeEach(() => {
	globalThis.fetch = mock(async (input: RequestInfo | URL) => {
		const url = String(input);
		if (url === "https://farcaster.tv/zoo/0x895ecc74") {
			return Response.json(CAST_FIXTURE);
		}
		if (url === "https://farcaster.tv/zoo/0xdeadbeef") {
			throw new Error("farcaster.tv unavailable");
		}
		if (url === "https://farcaster.tv/zoo/0x00000000") {
			return Response.json(BANNED_FIXTURE);
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

test("GET /:username/:hash SSR-renders cast card and farcaster.xyz link", async () => {
	const res = await app.request("/zoo/0x895ecc74");
	expect(res.status).toBe(200);
	expect(res.headers.get("content-type") ?? "").toContain("text/html");

	const body = await res.text();
	expect(body).toContain("https://farcaster.xyz/zoo/0x895ecc74");
	expect(body).toContain(CAST_TEXT);

	expect(globalThis.fetch).toHaveBeenCalled();
	const fetchMock = globalThis.fetch as ReturnType<typeof mock>;
	const calledUrl = String(fetchMock.mock.calls[0]?.[0]);
	expect(calledUrl).toBe("https://farcaster.tv/zoo/0x895ecc74");
});

test("GET /:username/:hash falls back to link-only HTML when farcaster.tv fails", async () => {
	const res = await app.request("/zoo/0xdeadbeef");
	expect(res.status).toBe(200);
	expect(res.headers.get("content-type") ?? "").toContain("text/html");

	const body = await res.text();
	expect(body).toContain("https://farcaster.xyz/zoo/0xdeadbeef");
	expect(body).not.toContain(CAST_TEXT);
});

test("GET /:username/:hash says the account may be banned when the API returns no cast data", async () => {
	const res = await app.request("/zoo/0x00000000");
	expect(res.status).toBe(200);

	const body = await res.text();
	expect(body).toContain("https://farcaster.xyz/zoo/0x00000000");
	expect(body).toContain("banned");
	expect(body).not.toContain(CAST_TEXT);
});
