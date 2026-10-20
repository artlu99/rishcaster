import { FarcasterEmbed } from "react-farcaster-embed";
import { renderToString } from "preact-render-to-string";

type CastData = NonNullable<Parameters<typeof FarcasterEmbed>[0]["castData"]>;

// Shim (shim.artlu.xyz) is the sole cast data source: an owner-run caching
// reader for the Farcaster Snapchain. Snapchain stores signed casts
// regardless of app-level bans, so banned accounts render here too and no
// ban signal exists or is needed. farcaster.tv is deliberately not used
// (unofficial, rules unknown).
type ShimEmbed = { url?: string; castId?: { fid?: number; hash?: string } };
type ShimCast = {
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

function toCastData(cast: ShimCast): CastData {
	const images: Array<{
		type: string;
		url: string;
		sourceUrl: string;
		alt: string;
	}> = [];
	const urls: Array<{ type: string }> = [];
	const quotes: CastData[] = [];
	for (const embed of cast.embeds ?? []) {
		if (embed.castId?.hash) {
			quotes.push({ hash: embed.castId.hash, author: { fid: embed.castId.fid } });
		} else if (embed.url && isImageUrl(embed.url)) {
			images.push({ type: "image", url: embed.url, sourceUrl: embed.url, alt: "" });
		} else if (embed.url) {
			urls.push({ type: "url" });
		}
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
		embeds: { images, urls, casts: quotes },
		replies: { count: 0 },
		reactions: { count: 0 },
		recasts: { count: 0 },
		tags: [],
	};
}

function shell(title: string, bodyHtml: string): string {
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${title}</title>
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
</main>
</body>
</html>`;
}

function castPage(
	username: string,
	hash: string,
	fullHash: string,
	cardHtml: string,
): string {
	return shell(
		`${username}/${hash} · trishcaster`,
		`${cardHtml}<p><a class="cast-link" href="https://farcaster.xyz/${username}/${hash}">Open on Farcaster: ${username}/${hash}</a></p>
<p><a class="cast-link" href="https://firefly.social/post/farcaster/${fullHash}">Open on Firefly</a></p>`,
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
		try {
			const cardHtml = renderToString(
				(await FarcasterEmbed({
					username,
					hash,
					castData: toCastData(cast),
				})) as never,
			);
			return {
				status: 200,
				html: castPage(username, hash, cast.hash, cardHtml),
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
