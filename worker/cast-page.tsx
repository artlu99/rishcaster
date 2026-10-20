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
	// Shim's message data carries no engagement counts — stub them with zeros.
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

function shell(
	title: string,
	bodyHtml: string,
	og?: {
		ogTitle: string;
		description?: string;
		image?: string;
		largeImage?: boolean;
	},
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
body { margin: 0; font-family: system-ui, sans-serif; background: #fff; color: #08060d; }
main { max-width: 640px; margin: 0 auto; padding: 24px 16px; }
.cast-link { display: inline-block; margin-top: 16px; margin-right: 16px; }
</style>
</head>
<body>
<main>
${bodyHtml}
<p style="margin-top:24px;font-size:12px;"><a href="https://github.com/artlu99/rishcaster" style="color:#999;text-decoration:none;">source</a></p>
</main>
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
			? `<p>The author hasn't signed the social smart contract — the cast may be restricted on farcaster.xyz.</p>`
			: `<p><a class="cast-link" href="https://farcaster.xyz/${username}/${hash}">Open on Farcaster: ${username}/${hash}</a></p>`;
	return shell(
		`${username}/${hash} · trishcaster`,
		`${cardHtml}${fcLink}
<p><a class="cast-link" href="https://firefly.social/post/farcaster/${fullHash}">Open on Firefly</a></p>`,
		og,
	);
}

function linkOnlyPage(username: string, hash: string): string {
	return shell(
		`${username}/${hash} · trishcaster`,
		`<p>Cast data is temporarily unavailable.</p>
<p><a class="cast-link" href="https://farcaster.xyz/${username}/${hash}">Open on Farcaster: ${username}/${hash}</a></p>
<p><a class="cast-link" href="https://firefly.social/post/farcaster/${hash}">Open on Firefly</a></p>`,
	);
}

function notFoundPage(username: string, hash: string): string {
	return shell(
		`${username}/${hash} · trishcaster`,
		`<p>Cast not found: ${username}/${hash}. The username or hash may be wrong, or the cast was deleted.</p>`,
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
