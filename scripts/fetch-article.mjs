// Actualiza article.json con el artículo de estudio de la semana desde jw.org.
// Se ejecuta en CI (GitHub Actions) y también puede usarse localmente:
//   node scripts/fetch-article.mjs
// Si jw.org no responde o no se encuentra el artículo, NO modifica article.json
// y termina con código 0 (para no romper el despliegue).
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const jwBase = "https://www.jw.org";
const magazineIndex = `${jwBase}/es/biblioteca/revistas/`;
const monthNumber = { enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5, julio: 6, agosto: 7, septiembre: 8, setiembre: 8, octubre: 9, noviembre: 10, diciembre: 11 };

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

async function main() {
  const today = new Date();
  const index = await fetchText(magazineIndex);
  const issues = issueUrls(index);
  const issuePages = await Promise.all(issues.map(async (url) => ({ url, html: await fetchText(url) })));
  const match = issuePages.map(({ html }) => articleLinkForWeek(html, today)).find(Boolean);
  if (!match) throw new Error("No se encontró una Atalaya para esta semana");
  const article = articleFromHtml(await fetchText(match.url), match.url, match.week);
  await writeFile(join(root, "article.json"), JSON.stringify(article, null, 2) + "\n", "utf8");
  console.log(`article.json actualizado: "${article.title}" (${article.paragraphs.length} párrafos, ${article.week})`);
}

main().catch((error) => {
  console.error("No se pudo actualizar article.json:", error.message, "— se conserva la copia existente.");
  process.exit(0);
});
