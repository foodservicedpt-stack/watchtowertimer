// Pruebas del parser del artículo semanal. No usan red: trabajan sobre
// extractos reales de jw.org guardados en tests/fixtures.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { weekRange, weeklyArticles, articleLinkForWeek, articleFromHtml } from "../scripts/article-source.mjs";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const julio = await readFile(join(fixtures, "atalaya-julio-2026.html"), "utf8");
const octubre = await readFile(join(fixtures, "atalaya-octubre-2026.html"), "utf8");

const day = (year, month, dayOfMonth) => new Date(year, month - 1, dayOfMonth, 12, 0, 0);
const localDay = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

function assertRange(range, start, end) {
  assert.ok(range, `se esperaba un rango ${start}..${end} y llegó ${range}`);
  assert.equal(localDay(range[0]), start);
  assert.equal(localDay(range[1]), end);
  // El último día debe cubrirse entero: si no, la búsqueda falla el domingo.
  assert.equal(range[1].getHours(), 23, "el rango debe terminar al final del día");
}

test("weekRange entiende todos los formatos de semana de jw.org", () => {
  assertRange(weekRange("17-23 DE AGOSTO DE 2026"), "2026-08-17", "2026-08-23");
  assertRange(weekRange("28 DE SEPTIEMBRE-4 DE OCTUBRE DE 2026"), "2026-09-28", "2026-10-04");
  assertRange(weekRange("31 DE AGOSTO-6 DE SEPTIEMBRE DE 2026"), "2026-08-31", "2026-09-06");
  // Semanas a caballo entre dos años: el año aparece en las dos fechas.
  assertRange(weekRange("28 DE DICIEMBRE DE 2026-3 DE ENERO DE 2027"), "2026-12-28", "2027-01-03");
  // Guion largo (como lo publica jw.org en algunos idiomas).
  assertRange(weekRange("7-13 DE SEPTIEMBRE DE 2026".replace("-", "\u2013")), "2026-09-07", "2026-09-13");
  // Textos que no son una semana no deben producir un rango falso.
  assert.equal(weekRange("LA ATALAYA (EDICIÓN DE ESTUDIO)"), null);
  assert.equal(weekRange("BIOGRAFÍA"), null);
});

test("weeklyArticles lista TODAS las semanas de la edición, incluida la primera", () => {
  // Regresión: la primera tarjeta de cada edición se perdía porque el encabezado
  // de la revista se emparejaba con su enlace y su descripción.
  assert.deepEqual(weeklyArticles(julio).map((card) => card.week), [
    "7-13 DE SEPTIEMBRE DE 2026",
    "14-20 DE SEPTIEMBRE DE 2026",
    "21-27 DE SEPTIEMBRE DE 2026",
    "28 DE SEPTIEMBRE-4 DE OCTUBRE DE 2026",
  ]);
});

test("articleLinkForWeek encuentra el artículo de la primera semana del número", () => {
  const found = articleLinkForWeek(julio, day(2026, 9, 9));
  assert.ok(found, "no se encontró el artículo del 7 al 13 de septiembre de 2026");
  assert.equal(found.week, "7-13 DE SEPTIEMBRE DE 2026");
  assert.match(found.url, /Aprendamos-de-los-gabaonitas/);
});

test("articleLinkForWeek cubre también el último día de la semana", () => {
  assert.equal(articleLinkForWeek(julio, day(2026, 9, 13)).week, "7-13 DE SEPTIEMBRE DE 2026");
  assert.equal(articleLinkForWeek(julio, day(2026, 10, 4)).week, "28 DE SEPTIEMBRE-4 DE OCTUBRE DE 2026");
});

test("articleLinkForWeek resuelve semanas a caballo entre meses y años", () => {
  assert.equal(articleLinkForWeek(octubre, day(2026, 12, 30)).week, "28 DE DICIEMBRE DE 2026-3 DE ENERO DE 2027");
  assert.equal(articleLinkForWeek(octubre, day(2027, 1, 3)).week, "28 DE DICIEMBRE DE 2026-3 DE ENERO DE 2027");
});

test("articleLinkForWeek no inventa un artículo para una fecha fuera de la edición", () => {
  assert.equal(articleLinkForWeek(julio, day(2026, 11, 15)), null);
});

function studyPage(spec) {
  const body = spec.map((paragraph, index) => {
    const questionPid = 5000 + paragraph.rel;
    const question = paragraph.question ? `<p class="qu" data-pid="${5000 + index}">${paragraph.question}</p>` : "";
    return `${question}<p data-pid="${9000 + index}" data-rel-pid="[${questionPid}]"><span class="parNum" data-pnum="${index + 1}">${index + 1}</span>${paragraph.text}</p>`;
  }).join("");
  return `<html><body><h1>Artículo de prueba</h1><main><div class="bodyTxt">${body}</div></main></body></html>`;
}

test("articleFromHtml extrae párrafos, pregunta compartida y apartados a) b)", () => {
  const html = studyPage([
    { rel: 0, question: "1, 2. ¿Qué aprendemos? a) del texto b) del contexto", text: "Primer párrafo." },
    { rel: 0, text: "Segundo párrafo." },
    { rel: 2, question: "3. ¿Cómo lo aplicamos?", text: "Tercer párrafo." },
    { rel: 3, text: "Cuarto párrafo." },
    { rel: 4, text: "Quinto párrafo." },
    { rel: 5, text: "Sexto párrafo." },
  ]);
  const article = articleFromHtml(html, "https://example.test/articulo", "7-13 DE SEPTIEMBRE DE 2026");
  assert.equal(article.title, "Artículo de prueba");
  assert.equal(article.week, "7-13 DE SEPTIEMBRE DE 2026");
  assert.deepEqual(article.paragraphs.map((paragraph) => paragraph.number), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(article.paragraphs.map((paragraph) => paragraph.question), [1, 1, 3, 4, 5, 6]);
  assert.equal(article.paragraphs[0].parts, 2);
  assert.equal(article.paragraphs[1].parts, 2);
});

test("articleFromHtml falla en vez de publicar un artículo mal leído", () => {
  const broken = studyPage([
    { rel: 0, question: "1. ¿Qué aprendemos?", text: "Primero." },
    { rel: 1, text: "Segundo." },
    { rel: 2, text: "Tercero." },
  ]);
  assert.throws(() => articleFromHtml(broken, "https://example.test/roto", "7-13 DE SEPTIEMBRE DE 2026"), /No se pudo interpretar/);
});
