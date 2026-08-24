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
  const bodyStart = html.indexOf('<div class="bodyTxt">');
  const body = bodyStart >= 0 ? html.slice(bodyStart, html.indexOf("</main>", bodyStart)) : html;
  // Preguntas de estudio (<p class="qu">), indexadas por data-pid.
  const questions = new Map();
  for (const match of body.matchAll(/<p\b[^>]*class="[^"]*\bqu\b[^"]*"[^>]*>([\s\S]*?)<\/p>/g)) {
    const pid = match[0].match(/data-pid="(\d+)"/);
    if (pid) questions.set(pid[1], plain(match[1]));
  }
  // Párrafos reales: cada <p> lleva un <span class="parNum" data-pnum="N">.
  const paragraphs = [];
  for (const block of body.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)) {
    const pnum = block[1].match(/data-pnum="(\d+)"/);
    if (!pnum) continue;
    const number = +pnum[1];
    const text = plain(block[1].replace(/<span class="parNum[^"]*"[^>]*>[\s\S]*?<\/span>/g, ""));
    const rel = block[0].match(/data-rel-pid="\[([\d,\s]+)\]"/);
    const questionText = rel ? rel[1].split(",").map((id) => questions.get(id.trim()) || "").join(" ") : "";
    paragraphs.push({
      number,
      length: Math.max(40, text.replace(/\s+/g, " ").length),
      read: /\blea\b/i.test(text),
      image: /\bim[aá]gen/i.test(text) || /\bim[aá]gen/i.test(questionText),
    });
  }
  paragraphs.sort((a, b) => a.number - b.number);
  const contiguous = paragraphs.every((paragraph, index) => paragraph.number === index + 1);
  if (!title || paragraphs.length < 5 || !contiguous) throw new Error("No se pudo interpretar el artículo semanal");
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
