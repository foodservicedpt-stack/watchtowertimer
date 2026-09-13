// Extracción del artículo de estudio semanal de jw.org.
// Lo comparten scripts/fetch-article.mjs (CI y uso local) y server.mjs.
const jwBase = "https://www.jw.org";
export const magazineIndex = `${jwBase}/es/biblioteca/revistas/`;
const monthNumber = { enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5, julio: 6, agosto: 7, septiembre: 8, setiembre: 8, octubre: 9, noviembre: 10, diciembre: 11 };

export function plain(value = "") {
  return value.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n").replace(/<\/(?:p|div|h[1-6]|li)>/gi, "\n")
    .replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"').replace(/&#(?:x0*([\da-f]+)|0*(\d+));/gi, (_, hex, dec) => String.fromCodePoint(parseInt(hex || dec, hex ? 16 : 10)))
    .replace(/\s+/g, " ").trim();
}
export function absolute(url) { return new URL(url, jwBase).href; }
export async function fetchText(url) {
  const response = await fetch(url, { headers: { "user-agent": "WatchtowerTimer/1.0 (personal timing tool)" } });
  if (!response.ok) throw new Error(`jw.org respondió ${response.status}`);
  return response.text();
}
export function issueUrls(indexHtml) {
  return [...new Set([...indexHtml.matchAll(/href="([^"]*\/es\/biblioteca\/revistas\/atalaya-estudio-[^"]+?\/)"/gi)].map((match) => absolute(match[1])))].slice(0, 16);
}
// Rango de fechas de una semana publicada por jw.org. Formatos reales:
//   "17-23 DE AGOSTO DE 2026"
//   "28 DE SEPTIEMBRE-4 DE OCTUBRE DE 2026"
//   "28 DE DICIEMBRE DE 2026-3 DE ENERO DE 2027"
// El patrón cubre TODO el texto: así el año "2026" no puede confundirse con un día.
export function weekRange(context) {
  const text = plain(context).toLowerCase().replace(/[\u2013\u2014]/g, "-").replace(/\s+/g, " ").trim();
  const both = text.match(/^(\d{1,2}) de ([a-záéíóú]+)(?: de (\d{4}))?(?:\s*-\s*|\s+a\s+)(\d{1,2}) de ([a-záéíóú]+) de (\d{4})$/);
  if (both) {
    const startMonth = monthNumber[both[2]];
    const endMonth = monthNumber[both[5]];
    if (startMonth == null || endMonth == null) return null;
    const endYear = +both[6];
    // Si la primera fecha no trae año y la semana cruza el fin de año, empieza el año anterior.
    const startYear = both[3] ? +both[3] : (startMonth > endMonth ? endYear - 1 : endYear);
    return range(startYear, startMonth, +both[1], endYear, endMonth, +both[4]);
  }
  const same = text.match(/^(\d{1,2})-(\d{1,2}) de ([a-záéíóú]+) de (\d{4})$/);
  if (same) {
    const month = monthNumber[same[3]];
    if (month == null) return null;
    return range(+same[4], month, +same[1], +same[4], month, +same[2]);
  }
  return null;
}
function range(startYear, startMonth, startDay, endYear, endMonth, endDay) {
  const start = new Date(startYear, startMonth, startDay);
  const end = new Date(endYear, endMonth, endDay, 23, 59, 59, 999);
  return start <= end ? [start, end] : null;
}
// Tarjetas del índice de una edición. Cada una arranca en su <p class="contextTitle">,
// así que se trocea el HTML por ese marcador: la semana de una tarjeta nunca se puede
// emparejar con el enlace ni la descripción de la siguiente (era el fallo original,
// que se comía el primer artículo de cada número).
function cards(issueHtml) {
  const starts = [...issueHtml.matchAll(/<p class="contextTitle">/gi)].map((match) => match.index);
  return starts.map((start, index) => {
    const chunk = issueHtml.slice(start, index + 1 < starts.length ? starts[index + 1] : issueHtml.length);
    const week = chunk.match(/<p class="contextTitle">([\s\S]*?)<\/p>/i)?.[1];
    const link = chunk.match(/<a\s[^>]*href="([^"]+)"/i)?.[1];
    const desc = chunk.match(/<p class="desc">([\s\S]*?)<\/p>/i)?.[1];
    return { week: plain(week || ""), url: link ? absolute(link) : "", desc: plain(desc || "") };
  });
}
export function weeklyArticles(issueHtml) {
  const found = [];
  for (const card of cards(issueHtml)) {
    const range = weekRange(card.week);
    if (!range || !card.url) continue;
    if (!/art[íi]culo de estudio para la semana/i.test(card.desc)) continue;
    found.push({ week: card.week, url: card.url, start: range[0], end: range[1] });
  }
  return found;
}
export function articleLinkForWeek(issueHtml, today) {
  return weeklyArticles(issueHtml).find((card) => today >= card.start && today <= card.end) || null;
}
export function articleFromHtml(html, sourceUrl, week) {
  const title = plain(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || "");
  const bodyStart = html.indexOf('<div class="bodyTxt">');
  const body = bodyStart >= 0 ? html.slice(bodyStart, html.indexOf("</main>", bodyStart)) : html;
  const questions = new Map();
  const questionNumber = new Map();
  const questionParts = new Map();
  for (const match of body.matchAll(/<p\b[^>]*class="[^"]*\bqu\b[^"]*"[^>]*>([\s\S]*?)<\/p>/g)) {
    const pid = match[0].match(/data-pid="(\d+)"/);
    if (!pid) continue;
    const qtext = plain(match[1]);
    questions.set(pid[1], qtext);
    const leading = qtext.match(/^\s*(\d+)/);
    if (leading) questionNumber.set(pid[1], +leading[1]);
    const letters = new Set([...qtext.matchAll(/\b([a-z])\s*\)/gi)].map((m) => m[1].toLowerCase()));
    questionParts.set(pid[1], Math.max(1, letters.size));
  }
  const paragraphs = [];
  for (const block of body.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)) {
    const pnum = block[1].match(/data-pnum="(\d+)"/);
    if (!pnum) continue;
    const number = +pnum[1];
    const text = plain(block[1].replace(/<span class="parNum[^"]*"[^>]*>[\s\S]*?<\/span>/g, ""));
    const rel = block[0].match(/data-rel-pid="\[([\d,\s]+)\]"/);
    const relIds = rel ? rel[1].split(",").map((id) => id.trim()).filter(Boolean) : [];
    const questionText = relIds.map((id) => questions.get(id) || "").join(" ");
    const firstPid = relIds[0];
    paragraphs.push({
      number,
      question: firstPid ? (questionNumber.get(firstPid) || number) : number,
      parts: firstPid ? (questionParts.get(firstPid) || 1) : 1,
      length: Math.max(40, text.replace(/\s+/g, " ").length),
      read: /\blea\b/i.test(text),
      image: /\bim[aá]gen/i.test(text) || /\bim[aá]gen/i.test(questionText),
      box: /\brecuadro\b/i.test(text) || /\brecuadro\b/i.test(questionText),
    });
  }
  paragraphs.sort((a, b) => a.number - b.number);
  const contiguous = paragraphs.every((paragraph, index) => paragraph.number === index + 1);
  if (!title || paragraphs.length < 5 || !contiguous) throw new Error("No se pudo interpretar el artículo semanal");
  return { title, week, sourceUrl, paragraphs };
}
