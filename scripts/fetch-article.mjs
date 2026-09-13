// Actualiza article.json con el artículo de estudio de la semana desde jw.org.
// Se ejecuta en CI (GitHub Actions) y también puede usarse localmente:
//   node scripts/fetch-article.mjs
// Si no se puede obtener el artículo de la semana, NO toca article.json y sale con
// código distinto de cero. Es deliberado: así el despliegue no se hace, el sitio
// conserva el último artículo publicado y el fallo se ve en Actions. Antes salía con
// código 0, de modo que el workflow publicaba la copia antigua del repositorio y la
// web retrocedía a un artículo de semanas atrás sin que nadie se enterara.
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { articleFromHtml, fetchText, issueUrls, magazineIndex, weeklyArticles } from "./article-source.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

// Recorre las ediciones publicadas y devuelve la semana que contiene "today".
// La edición de estudio se publica con meses de antelación, así que la semana
// actual puede estar en cualquiera de los números del índice.
async function findWeeklyCard(today) {
  const issues = issueUrls(await fetchText(magazineIndex));
  const pages = await Promise.all(issues.map(async (url) => ({ url, html: await fetchText(url) })));
  const published = [];
  for (const { html } of pages) {
    for (const card of weeklyArticles(html)) {
      published.push(card);
      if (today >= card.start && today <= card.end) return card;
    }
  }
  const weeks = published.map((card) => "  - " + card.week + " -> " + card.url).join("\n");
  throw new Error("ninguna edición de estudio cubre la semana de hoy (" + today.toISOString().slice(0, 10) + ").\nSemanas publicadas:\n" + (weeks || "  (ninguna)"));
}

async function main() {
  const card = await findWeeklyCard(new Date());
  const article = articleFromHtml(await fetchText(card.url), card.url, card.week);
  await writeFile(join(root, "article.json"), JSON.stringify(article, null, 2) + "\n", "utf8");
  console.log("article.json actualizado: \"" + article.title + "\" (" + article.paragraphs.length + " párrafos, " + article.week + ")");
}

main().catch((error) => {
  console.error("No se pudo actualizar article.json: " + error.message);
  console.error("Se conserva article.json y no se despliega: el sitio mantiene el último artículo publicado.");
  process.exit(1);
});
