import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { articleFromHtml, fetchText, issueUrls, magazineIndex, weeklyArticles } from "./scripts/article-source.mjs";

const root = fileURLToPath(new URL(".", import.meta.url));
const port = Number(process.env.PORT || 4173);
const cache = { article: null, expiresAt: 0 };
const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml" };

async function currentArticle() {
  if (cache.article && cache.expiresAt > Date.now()) return cache.article;
  const today = new Date();
  const issues = issueUrls(await fetchText(magazineIndex));
  const pages = await Promise.all(issues.map(async (url) => ({ url, html: await fetchText(url) })));
  let card = null;
  for (const { html } of pages) {
    card = weeklyArticles(html).find((item) => today >= item.start && today <= item.end);
    if (card) break;
  }
  if (!card) throw new Error("No se encontró una Atalaya para esta semana");
  const article = articleFromHtml(await fetchText(card.url), card.url, card.week);
  cache.article = article;
  cache.expiresAt = Date.now() + 6 * 60 * 60 * 1000;
  return article;
}
function send(response, status, body, type = "text/plain; charset=utf-8") {
  response.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  response.end(body);
}
const server = createServer(async (request, response) => {
  const url = new URL(request.url, "http://" + request.headers.host);
  const isArticle = url.pathname === "/api/article" || url.pathname === "/article.json";
  try {
    if (isArticle) return send(response, 200, JSON.stringify(await currentArticle()), "application/json; charset=utf-8");
    const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
    const file = normalize(join(root, pathname));
    if (!file.startsWith(root)) return send(response, 403, "Acceso denegado");
    return send(response, 200, await readFile(file), mime[extname(file)] || "application/octet-stream");
  } catch (error) {
    if (isArticle) return send(response, 502, JSON.stringify({ error: "No se pudo actualizar el artículo", detail: error.message }), "application/json; charset=utf-8");
    return send(response, 404, "No se encontró el archivo");
  }
});
server.listen(port, "0.0.0.0", () => console.log("WatchtowerTimer listo en http://localhost:" + port));
