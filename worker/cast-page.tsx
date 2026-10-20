import { FarcasterEmbed } from "react-farcaster-embed";
import { renderToString } from "preact-render-to-string";

type CastData = NonNullable<Parameters<typeof FarcasterEmbed>[0]["castData"]>;

// Shim (shim.artlu.xyz) is the sole cast data source: an owner-run caching
// reader for the Farcaster Snapchain. Snapchain stores casts regardless of
// app-level bans, so restricted accounts render here too. farcaster.tv is
// deliberately not used (unofficial, rules unknown).
type ShimEmbed = { url?: string; castId?: { fid?: number; hash?: string } };
type ShimCast = {
	fid?: number;
	hash?: string;
	text?: string;
	/** Unix seconds; the embed does new Date(ts), which wants milliseconds. */
	timestamp?: number;
	embeds?: ShimEmbed[];
	user?: {
		fid?: number;
		username?: string;
		displayName?: string;
		pfpUrl?: string;
		bio?: string;
	};
};

// Shim embeds are raw message items: {url} or {castId} quotes, untyped.
// Warpcast-hosted cast images live on imagedelivery.net; external images
// usually carry an image extension. Everything else renders as a link embed.
function isImageUrl(url: string): boolean {
	return (
		/imagedelivery\.net\//i.test(url) ||
		/\.(png|jpe?g|gif|webp|avif)([?#]|$)/i.test(url)
	);
}

// Quote embeds are dropped, not rendered: the bundle reads
// quote.author.pfp.url unguarded and Shim's message-level embeds carry no
// hydrated author data, so any quote card would either crash the page or
// render as an empty shell. URL embeds render as link cards via openGraph.
function urlOpenGraph(url: string): {
	url: string;
	domain: string;
	title: string;
} {
	try {
		const parsed = new URL(url);
		return { url, domain: parsed.hostname, title: parsed.hostname };
	} catch {
		return { url, domain: "", title: "" };
	}
}

// unfurl.artlu.workers.dev enriches URL embeds with Open Graph data
// (title/description/image); owner-run, cached, CORS-open. Failures fall
// back to hostname-only cards.
type UnfurlResult = {
	ogTitle?: string;
	twitterTitle?: string;
	ogDescription?: string;
	twitterDescription?: string;
	ogImage?: Array<{ url?: string } | string>;
};

async function unfurl(
	url: string,
	env?: { UNFURL?: Fetcher },
): Promise<UnfurlResult | undefined> {
	// In production, a Worker fetching another workers.dev Worker on the same
	// account is blocked (Cloudflare error 1042) — the UNFURL service binding
	// is the sanctioned path. Local dev/tests have no live binding, so after
	// a binding failure we fall back to plain fetch, which is not subject to
	// that restriction.
	const target = `https://unfurl.artlu.workers.dev/?u=${encodeURIComponent(url)}`;
	if (env?.UNFURL) {
		try {
			const res = await env.UNFURL.fetch(target, {
				signal: AbortSignal.timeout(5000),
			});
			if (res.ok) {
				return (await res.json().catch(() => undefined)) as
					| UnfurlResult
					| undefined;
			}
		} catch {
			// Binding unavailable (e.g. local dev) — fall through.
		}
	}
	try {
		const res = await fetch(target, { signal: AbortSignal.timeout(5000) });
		if (!res.ok) return undefined;
		return (await res.json().catch(() => undefined)) as
			| UnfurlResult
			| undefined;
	} catch {
		return undefined;
	}
}

// Quote embeds are hydrated through Shim /h/{fullHash} (message embeds carry
// the full hash). Hydrated quotes map through toCastData, which provides the
// author.pfp the bundle reads unguarded. Hydration failure drops the quote —
// old casts get pruned from Snapchain when storage lapses.
async function fetchQuote(hash: string): Promise<ShimCast | undefined> {
	try {
		const res = await fetch(`https://shim.artlu.xyz/h/${hash}`, {
			signal: AbortSignal.timeout(5000),
		});
		if (!res.ok) return undefined;
		const data = (await res.json().catch(() => undefined)) as {
			cast?: ShimCast;
		};
		return data?.cast ?? undefined;
	} catch {
		return undefined;
	}
}

function toCastData(
	cast: ShimCast,
	unfurled?: Map<string, UnfurlResult | undefined>,
	quotes?: Array<ShimCast | undefined>,
): CastData {
	const images: Array<{
		type: string;
		url: string;
		sourceUrl: string;
		alt: string;
	}> = [];
	const urls: Array<{ type: string; openGraph: Record<string, string | boolean> }> = [];
	for (const embed of cast.embeds ?? []) {
		if (embed.castId?.hash) continue;
		if (embed.url && isImageUrl(embed.url)) {
			images.push({ type: "image", url: embed.url, sourceUrl: embed.url, alt: "" });
		} else if (embed.url) {
			urls.push({
				type: "url",
				openGraph: openGraphFor(embed.url, unfurled?.get(embed.url)),
			});
		}
	}
	const quoteCasts: CastData[] = [];
	for (const quote of quotes ?? []) {
		// Recursion depth 1: hydrated quotes render without their own quotes.
		if (quote?.hash) quoteCasts.push(toCastData(quote));
	}
	// The embed bundle reads e.recasts.count and e.tags.length unguarded, and
	// Shim's message data carries no engagement counts — stub them with zeros
	// so rendering can't crash. The zero-count stats row itself is stripped
	// from the SSR output after render (STATS_ROW below).
	return {
		hash: cast.hash,
		text: cast.text,
		timestamp: cast.timestamp === undefined ? undefined : cast.timestamp * 1000,
		author: {
			fid: cast.user?.fid,
			username: cast.user?.username,
			displayName: cast.user?.displayName,
			pfp: { url: cast.user?.pfpUrl },
			profile: cast.user?.bio ? { bio: { text: cast.user.bio } } : undefined,
		},
		embeds: { images, urls, casts: quoteCasts },
		replies: { count: 0 },
		reactions: { count: 0 },
		recasts: { count: 0 },
		tags: [],
	};
}

function openGraphFor(
	url: string,
	data?: UnfurlResult,
): Record<string, string | boolean> {
	const title = data?.ogTitle ?? data?.twitterTitle ?? urlOpenGraph(url).title;
	const description = data?.ogDescription ?? data?.twitterDescription;
	const first = data?.ogImage?.[0];
	const image = typeof first === "string" ? first : first?.url;
	return {
		url,
		domain: urlOpenGraph(url).domain,
		title,
		...(description ? { description } : {}),
		...(image ? { image, useLargeImage: true } : {}),
	};
}

function escapeHtml(s: string): string {
	return s
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

// Collapse newlines/whitespace and truncate for meta description attributes.
function toDescription(text: string): string {
	const flat = text.replace(/\s+/g, " ").trim();
	return flat.length > 280 ? `${flat.slice(0, 279)}…` : flat;
}

// The bundle renders a replies/recasts/likes row from engagement data the
// Shim doesn't carry — without the toCastData zero stubs rendering would
// crash, with them it would always show hardcoded zeros. Strip the row from
// the SSR output; the Farcaster logo in the same container stays. The stats
// <ul> is the only <ul> in the card and contains no user text, so matching
// on the container class is exact. The replacement re-opens the container
// with data attributes so the client-side live-stats script can find it.
const STATS_ROW = /(<div class="farcaster-embed-stats">)<ul>[\s\S]*?<\/ul>/;

// Live engagement counts, fetched client-side so the SSR path stays
// Shim-only and no fake numbers are ever shipped. farcaster.tv (unofficial
// Warpcast client API) sends access-control-allow-origin: * and answers for
// unsigned/banned authors too, with exact reply/like/recast counts. Any
// failure leaves the row absent — stats are decoration, not content. Only
// the static icons use innerHTML; remote values go through textContent.
const LIVE_STATS_SCRIPT = `<script>
(function () {
  var slot = document.querySelector(".farcaster-embed-stats[data-username]");
  if (!slot) return;
  var u = slot.getAttribute("data-username") || "";
  var h = slot.getAttribute("data-hash") || "";
  if (!u || !/^0x[0-9a-fA-F]+$/.test(h)) return;
  fetch("https://farcaster.tv/" + encodeURIComponent(u) + "/" + h)
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (j) {
      var casts = j && j.result && j.result.casts;
      if (!casts) return;
      var c = null;
      for (var i = casts.length - 1; i >= 0; i--) {
        if (casts[i] && typeof casts[i].hash === "string" && casts[i].hash.indexOf(h) === 0) {
          c = casts[i];
          break;
        }
      }
      if (!c) return;
      var replies = c.replies && c.replies.count;
      var recasts = c.combinedRecastCount != null ? c.combinedRecastCount : c.recasts && c.recasts.count;
      var likes = c.reactions && c.reactions.count;
      if (replies == null && recasts == null && likes == null) return;
      var fmt = function (v) {
        return typeof v === "number" && isFinite(v) ? v.toLocaleString("en-US") : "0";
      };
      var icons = {
        reply: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>',
        recast: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 2.1l4 4-4 4"></path><path d="M3 12.2v-2a4 4 0 0 1 4-4h12.8M7 21.9l-4-4 4-4"></path><path d="M21 11.8v2a4 4 0 0 1-4 4H4.2"></path></svg>',
        like: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06 1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>'
      };
      var href = "https://farcaster.xyz/" + u + "/" + h;
      var ul = document.createElement("ul");
      [[icons.reply, replies], [icons.recast, recasts], [icons.like, likes]].forEach(function (it) {
        var a = document.createElement("a");
        a.className = "farcaster-embed-stats-link";
        a.href = href;
        a.target = "_blank";
        a.rel = "noopener";
        var span = document.createElement("span");
        span.textContent = fmt(it[1]);
        a.innerHTML = it[0];
        a.appendChild(span);
        var li = document.createElement("li");
        li.appendChild(a);
        ul.appendChild(li);
      });
      slot.insertBefore(ul, slot.firstChild);
    })
    .catch(function () {});
})();
</script>`;

function shell(
	title: string,
	bodyHtml: string,
	og?: {
		ogTitle: string;
		description?: string;
		image?: string;
		largeImage?: boolean;
	},
	clientScript?: string,
): string {
	const meta = og
		? [
				`<meta property="og:title" content="${escapeHtml(og.ogTitle)}" />`,
				`<meta name="twitter:card" content="${og.largeImage && og.image ? "summary_large_image" : "summary"}" />`,
				`<meta name="twitter:title" content="${escapeHtml(og.ogTitle)}" />`,
				og.description
					? `<meta property="og:description" content="${escapeHtml(og.description)}" />`
					: "",
				og.description
					? `<meta name="twitter:description" content="${escapeHtml(og.description)}" />`
					: "",
				og.image
					? `<meta property="og:image" content="${escapeHtml(og.image)}" />`
					: "",
				og.image
					? `<meta name="twitter:image" content="${escapeHtml(og.image)}" />`
					: "",
			]
				.filter(Boolean)
				.join("\n")
		: "";
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${title}</title>
${meta}
<link rel="stylesheet" href="/farcaster-embed.css" />
<style>
:root {
  color-scheme: light dark;
  --bg: #fbfbfa;
  --ink: #101014;
  --muted: #77747e;
  --line: #e8e6e3;
  --accent: #7f32e3;
  --accent-soft: #ede7fa;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0e0e12;
    --ink: #f0eff2;
    --muted: #77747e;
    --line: #26262c;
    --accent: #c1b0ff;
    --accent-soft: #241c38;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--ink);
  font: 16px/1.6 system-ui, "Segoe UI", Roboto, sans-serif;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}
.site-header, main, .site-footer {
  max-width: 672px;
  margin: 0 auto;
  padding-inline: 20px;
}
.site-header { padding-top: 24px; padding-bottom: 20px; }
.wordmark {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--muted);
  text-decoration: none;
}
.wordmark:hover { color: var(--ink); }
.wordmark b { color: var(--accent); font-weight: 600; }
main { padding-bottom: 8px; }
.notice { color: var(--muted); font-size: 14px; margin: 18px 0 0; }
.actions { display: flex; flex-wrap: wrap; gap: 10px; margin: 20px 0 0; }
.pill {
  display: inline-block;
  border: 1px solid var(--line);
  border-radius: 999px;
  padding: 8px 16px;
  color: var(--ink);
  text-decoration: none;
  font-size: 14px;
  font-weight: 500;
  transition: border-color 0.15s ease, background-color 0.15s ease,
    color 0.15s ease;
}
.pill:hover, .pill:focus-visible {
  border-color: var(--accent);
  color: var(--accent);
  background: transparent;
}
.pill.primary {
  background: var(--ink);
  border-color: var(--ink);
  color: var(--bg);
}
.pill.primary:hover, .pill.primary:focus-visible {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}
.site-footer {
  margin-top: 20px;
  padding-top: 14px;
  padding-bottom: 32px;
  border-top: 1px solid var(--line);
}
.site-footer a {
  font-size: 12px;
  color: var(--muted);
  text-decoration: none;
}
.site-footer a:hover, .site-footer a:focus-visible { color: var(--ink); }
</style>
</head>
<body>
<header class="site-header">
  <a class="wordmark" href="/">rishcaster<b>.</b></a>
</header>
<main>
${bodyHtml}
</main>
<footer class="site-footer">
  <a href="https://github.com/artlu99/rishcaster">source</a>
</footer>
${clientScript ?? ""}
</body>
</html>`;
}

function castPage(
	username: string,
	hash: string,
	fullHash: string,
	cardHtml: string,
	signed: boolean,
	og: {
		ogTitle: string;
		description?: string;
		image?: string;
		largeImage?: boolean;
	},
): string {
	// signed === false means the author hasn't accepted Farcaster's social
	// smart contract (Network Code) — their profile is read-only/banned on
	// farcaster.xyz, so only the Firefly link is shown. The embed itself
	// still renders for everyone.
	const fcLink =
		signed === false
			? `<p class="notice">The author hasn't signed the social smart contract — the cast may be restricted on farcaster.xyz.</p>`
			: `<p class="actions"><a class="pill primary" href="https://farcaster.xyz/${username}/${hash}">Open on Farcaster</a></p>`;
	return shell(
		`${username}/${hash} · rishcaster`,
		`${cardHtml}${fcLink}
<p class="actions"><a class="pill${signed === false ? " primary" : ""}" href="https://firefly.social/post/farcaster/${fullHash}">Open on Firefly</a></p>`,
		og,
		LIVE_STATS_SCRIPT,
	);
}

function linkOnlyPage(username: string, hash: string): string {
	return shell(
		`${username}/${hash} · rishcaster`,
		`<p class="notice">Cast data is temporarily unavailable.</p>
<p class="actions">
<a class="pill primary" href="https://farcaster.xyz/${username}/${hash}">Open on Farcaster</a>
<a class="pill" href="https://firefly.social/post/farcaster/${hash}">Open on Firefly</a>
</p>`,
	);
}

function notFoundPage(username: string, hash: string): string {
	return shell(
		`${username}/${hash} · rishcaster`,
		`<p class="notice">Cast not found: ${username}/${hash}. The username or hash may be wrong, or the cast was deleted.</p>`,
	);
}

export async function renderCastPage(
	username: string,
	hash: string,
	env?: { UNFURL?: Fetcher },
): Promise<{ status: 200 | 404; html: string }> {
	let reached = false;
	let cast: ShimCast | null = null;
	try {
		const res = await fetch(`https://shim.artlu.xyz/wc/${username}/${hash}`);
		if (res.ok) {
			reached = true;
			const data = (await res.json().catch(() => ({}))) as {
				cast?: ShimCast;
			};
			cast = data.cast ?? null;
		}
	} catch {
		// Shim unreachable — fall through to the link-only page.
	}

	if (cast?.hash) {
		// Enrich up to 3 URL embeds with Open Graph data (fails open) and
		// hydrate up to 3 quote embeds through Shim /h/{fullHash}.
		const urlEmbeds = Array.from(
			new Set(
				(cast.embeds ?? [])
					.map((embed) => embed.url)
					.filter((u): u is string => typeof u === "string" && !isImageUrl(u)),
			),
		).slice(0, 3);
		const quoteHashes = (cast.embeds ?? [])
			.map((embed) => embed.castId?.hash)
			.filter((h): h is string => typeof h === "string")
			.slice(0, 3);
		const unfurls = Promise.allSettled(
			urlEmbeds.map((u) => unfurl(u, env)),
		);
		const quoteFetches = Promise.allSettled(
			quoteHashes.map((h) => fetchQuote(h)),
		);

		// Has the author signed the social smart contract? Unknown (null)
		// fails open: the farcaster.xyz link is shown unless Shim says no.
		let signed: boolean | null = null;
		const fid = cast.fid ?? cast.user?.fid;
		if (fid !== undefined) {
			try {
				const res = await fetch(`https://shim.artlu.xyz/signed/${fid}`);
				if (res.ok) {
					const data = (await res.json().catch(() => ({}))) as {
						signed?: boolean;
					};
					if (typeof data.signed === "boolean") signed = data.signed;
				}
			} catch {
				// Signed-check unavailable — fail open.
			}
		}

		const unfurlResults = await unfurls;
		const unfurlMap = new Map<string, UnfurlResult | undefined>();
		urlEmbeds.forEach((u, i) => {
			const r = unfurlResults[i];
			unfurlMap.set(u, r.status === "fulfilled" ? r.value : undefined);
		});
		const quoteResults = await quoteFetches;
		const quotes = quoteResults.map((r) =>
			r.status === "fulfilled" ? r.value : undefined,
		);
		try {
			const cardHtml = renderToString(
				(await FarcasterEmbed({
					username,
					hash,
					castData: toCastData(cast, unfurlMap, quotes),
				})) as never,
			).replace(
				STATS_ROW,
				() =>
					`<div class="farcaster-embed-stats" data-username="${escapeHtml(username)}" data-hash="${escapeHtml(hash)}">`,
			);
			// OG/Twitter meta so Telegram, Discord, iMessage etc. unfurl the
			// cast: author handle as title, cast text as description, first
			// image embed (else the avatar) as image.
			const handle = cast.user?.username ?? username;
			const ogTitle = cast.user?.displayName
				? `${cast.user.displayName} (@${handle})`
				: `@${handle}`;
			const firstImage = (cast.embeds ?? [])
				.map((embed) => embed.url)
				.find(
					(u): u is string => typeof u === "string" && isImageUrl(u),
				);
			const og = {
				ogTitle,
				description: cast.text ? toDescription(cast.text) : undefined,
				image: firstImage ?? cast.user?.pfpUrl,
				largeImage: firstImage !== undefined,
			};
			return {
				status: 200,
				// signed === false is the only hide trigger; unknown fails open.
				html: castPage(
					username,
					hash,
					cast.hash,
					cardHtml,
					signed !== false,
					og,
				),
			};
		} catch {
			// Embed rendering failed — degrade to links instead of erroring.
			return { status: 200, html: linkOnlyPage(username, hash) };
		}
	}
	if (reached) {
		// Shim answered but has no such cast: genuinely missing or deleted.
		return { status: 404, html: notFoundPage(username, hash) };
	}
	return { status: 200, html: linkOnlyPage(username, hash) };
}
