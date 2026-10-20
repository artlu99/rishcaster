import { Hono } from "hono";
import { renderCastPage } from "./cast-page.tsx";

export const app = new Hono<{ Bindings: Env }>();

app.get("/api/", (c) => c.json({ name: "Cloudflare" }));

app.get("/:username/:hash{0x[0-9a-fA-F]+}", async (c) => {
	const { username, hash } = c.req.param();
	const { status, html } = await renderCastPage(username, hash, c.env);
	return c.html(html, status);
});

export default {
	fetch: app.fetch,
} satisfies ExportedHandler<Env>;
