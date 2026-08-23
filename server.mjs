import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const port = Number(process.env.PORT || 4173);
const jwBase = "https://www.jw.org";
const magazineIndex = `${jwBase}/es/biblioteca/revistas/`;
const cache = { article: null, expiresAt: 0 };
const monthNumber = { enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5, julio: 6, agosto: 7, septiembre: 8, setiembre: 8, octubre: 9, noviembre: 10, diciembre: 11 };
const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml" };

function plain(value = "") {
  return value.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n").replace(/<\/(?:p|div|h[1-6]|li)>/gi, "\n")
    .replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"').replace(/&#(?:x0*([\da-f]+)|0*(\d+));/gi, (_, hex, dec) => String.fromCodePoint(parseInt(hex || dec, hex ? 16 : 10)))
    .replace(/\s+/g, " ").trim();
}
function absolute(url) { return new URL(url, jwBase).href; }
async function fetchText(url) {
  const response = await fetch(url, { headers: { "user-agent": "WatchtowerTimer/1.0 (personal timing tool)" } });
  if (!response.ok) throw new Error(`jw.org respondió ${response.status}`);
  return response.text();
}
function issueUrls(indexHtml) {
  return [...new Set([...indexHtml.matchAll(/href="([^"]*\/es\/biblioteca\/revistas\/atalaya-estudio-[^"]+?\/)"/gi)].map((match) => absolute(match[1])))].slice(0, 16);
}
function rangeFor(context) {
  const text = plain(context).toLowerCase().replace(/[–—]/g, "-");
  let found = text.match(/(\d{1,2})\s*-\s*(\d{1,2})\s+de\s+([a-záéíóú]+)\s+de\s+(\d{4})/i);
  if (found) return [new Date(+found[4], monthNumber[found[3]], +found[1]), new Date(+found[4], monthNumber[found[3]], +found[2], 23, 59, 59)];
  found = text.match(/(\d{1,2})\s+de\s+([a-záéíóú]+)\s*-\s*(\d{1,2})\s+de\s+([a-záéíóú]+)\s+de\s+(\d{4})/i);
  if (found) return [new Date(+found[5], monthNumber[found[2]], +found[1]), new Date(+found[5], monthNumber[found[4]], +found[3], 23, 59, 59)];
  return null;
}
function articleLinkForWeek(issueHtml, today) {
  const cards = /<p class="contextTitle">([\s\S]*?)<\/p>[\s\S]*?<a href="([^"]+)">([\s\S]*?)<\/a>[\s\S]*?<p class="desc">([\s\S]*?)<\/p>/gi;
  for (const match of issueHtml.matchAll(cards)) {
    const range = rangeFor(match[1]);
    if (range && today >= range[0] && today <= range[1] && /Artículo de estudio para la semana/i.test(plain(match[4]))) return { url: absolute(match[2]), week: plain(match[1]) };
  }
  return null;
}
function articleFromHtml(html, sourceUrl, week) {
  const title = plain(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || "");
  const content = html.replace(/<img\b[^>]*>/gi, " [IMAGE] ").replace(/<\/p>/gi, "</p>\n");
  const text = plain(content).replace(/(\d{1,2})\.\s*¿/g, "\n$1. ¿");
  const matches = [...text.matchAll(/(?:^|\n)(\d{1,2})\.\s*¿[\s\S]*?(?=\n\d{1,2}\.\s*¿|\n¿CÓMO PODEMOS|$)/g)];
  const paragraphs = matches.map((match, index) => {
    const body = match[0];
    return { number: +match[1], length: Math.max(40, body.replace(/\s+/g, " ").length), read: /\(\s*lea\b/i.test(body), image: /\[IMAGE\]|\bim[aá]genes?\b/i.test(body) };
  }).filter((item, index) => item.number === index + 1);
  if (!title || paragraphs.length < 5) throw new Error("No se pudo interpretar el artículo semanal");
  return { title, week, sourceUrl, paragraphs };
}
async function currentArticle() {
  if (cache.article && cache.expiresAt > Date.now()) return cache.article;
  const today = new Date();
  const index = await fetchText(magazineIndex);
  const issues = issueUrls(index);
  const issuePages = await Promise.all(issues.map(async (url) => ({ url, html: await fetchText(url) })));
  const match = issuePages.map(({ html }) => articleLinkForWeek(html, today)).find(Boolean);
  if (!match) throw new Error("No se encontró una Atalaya para esta semana");
  const article = articleFromHtml(await fetchText(match.url), match.url, match.week);
  cache.article = article;
  cache.expiresAt = Date.now() + 6 * 60 * 60 * 1000;
  return article;
}
function send(response, status, body, type = "text/plain; charset=utf-8") {
  response.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  response.end(body);
}
const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  try {
    if (url.pathname === "/api/article" || url.pathname === "/article.json") return send(response, 200, JSON.stringify(await currentArticle()), "application/json; charset=utf-8");
    const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
    const file = normalize(join(root, pathname));
    if (!file.startsWith(root)) return send(response, 403, "Acceso denegado");
    return send(response, 200, await readFile(file), mime[extname(file)] || "application/octet-stream");
  } catch (error) {
    if (url.pathname === "/api/article") return send(response, 502, JSON.stringify({ error: "No se pudo actualizar el artículo", detail: error.message }), "application/json; charset=utf-8");
    return send(response, 404, "No se encontró el archivo");
  }
});
server.listen(port, "0.0.0.0", () => console.log(`WatchtowerTimer listo en http://localhost:${port}`));
