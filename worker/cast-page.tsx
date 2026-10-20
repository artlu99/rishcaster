import { FarcasterEmbed } from "react-farcaster-embed";
import { renderToString } from "preact-render-to-string";

type CastData = NonNullable<Parameters<typeof FarcasterEmbed>[0]["castData"]>;

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
.cast-link { display: inline-block; margin-top: 16px; }
</style>
</head>
<body>
<main>
${bodyHtml}
</main>
</body>
</html>`;
}

function page(username: string, hash: string, cardHtml = ""): string {
	const href = `https://farcaster.xyz/${username}/${hash}`;
	return shell(
		`${username}/${hash} · trishcaster`,
		`${cardHtml}<p><a class="cast-link" href="${href}">Open on Farcaster: ${username}/${hash}</a></p>`,
	);
}

// The API answered but returned no usable cast. Banned accounts get no data
// from the Farcaster APIs (a zero-hash cast or an empty list), so that is the
// likely cause; a missing cast looks the same.
function noDataPage(username: string, hash: string): string {
	return page(
		username,
		hash,
		`<p>No cast data came back from the Farcaster API — the account may be banned, or the cast may not exist.</p>`,
	);
}

function pickCast(
	data: {
		result?: { casts?: Array<{ hash?: string } & Record<string, unknown>> };
	},
	hash: string,
): CastData | null {
	const casts = data.result?.casts;
	if (!casts?.length) return null;
	if (casts[0]?.hash === "0x0000000000000000000000000000000000000000") {
		return null;
	}
	const match = casts.findLast((c) => c.hash?.includes(hash));
	return (match as CastData) ?? null;
}

export async function renderCastPage(
	username: string,
	hash: string,
): Promise<string> {
	try {
		const res = await fetch(`https://farcaster.tv/${username}/${hash}`);
		if (!res.ok) return page(username, hash);
		const data = (await res.json()) as {
			result?: { casts?: Array<{ hash?: string } & Record<string, unknown>> };
		};
		const castData = pickCast(data, hash);
		if (!castData) return noDataPage(username, hash);
		const vnode = await FarcasterEmbed({ username, hash, castData });
		return page(username, hash, renderToString(vnode as never));
	} catch {
		return page(username, hash);
	}
}
