// Pruebas del reparto de tiempos del temporizador. app.js es un script de navegador
// (sin módulos), así que aquí se cargan sus funciones reales y se ejecutan con un DOM
// mínimo. Así se prueba exactamente el código que se publica.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = await readFile(join(root, "app.js"), "utf8");
const FROM = "function format(seconds)";
const TO = "function isValidArticle(";
if (!source.includes(FROM) || !source.includes(TO)) {
  throw new Error("No se pudieron localizar las funciones de reparto en app.js: revisa los marcadores de tests/timer-schedule.test.mjs");
}
const chunk = source.slice(source.indexOf(FROM), source.indexOf(TO));

// Cualquier propiedad del DOM de mentira se puede leer, escribir y llamar.
function permissive() {
  return new Proxy(function () {}, {
    get: (target, key) => (key === Symbol.toPrimitive ? undefined : permissive()),
    set: () => true,
    apply: () => permissive(),
  });
}

function createTimer(paragraphs, options = {}) {
  const { total = 3600, intro = 90, review = 240, closing = 90 } = options;
  const values = { intro: { value: intro }, review: { value: review }, closing: { value: closing } };
  const els = new Proxy(values, { get: (t, k) => (k in t ? t[k] : permissive()), set: (t, k, v) => { t[k] = v; return true; } });
  const state = { total, elapsed: 0, running: false, lastTick: 0, timer: null, schedule: [], notice: "" };
  const load = new Function("paragraphs", "state", "els", "window", "document", chunk +
    "\nreturn { buildBlocks, blockWeight, addRemainingSchedule, rebuildFullSchedule, activeSegment, passNow, format, weights };");
  const timer = load(paragraphs, state, els, {}, {});
  timer.rebuildFullSchedule();
  return { ...timer, state, els };
}

// Artículo sintético: una pregunta por párrafo, con pesos distintos para que el reparto se note.
const articleOf = (count) => Array.from({ length: count }, (_, index) => ({
  number: index + 1, question: index + 1, parts: 1, length: 400 + index * 30, read: false, image: false, box: false,
}));

const seconds = (value) => Math.round(value * 100) / 100;
const paragraphsOf = (schedule) => schedule.filter((item) => item.kind === "paragraph");
const durations = (segments) => segments.reduce((total, item) => total + item.duration, 0);
const total = (values) => values.reduce((sum, value) => sum + value, 0);
const byKind = (schedule, kind) => schedule.find((item) => item.kind === kind);

// El plan siempre debe terminar al agotar el tiempo; tras un salto, la parte nueva
// (la que empieza en el instante del salto) debe ser continua y empezar en ese instante.
function assertPlan(schedule, total, jump = null) {
  assert.ok(schedule.length, "el plan no puede quedar vacío");
  assert.equal(seconds(schedule.at(-1).end), total, "el plan debe terminar exactamente al agotar el tiempo disponible");
  for (const item of schedule) assert.ok(item.duration >= 0, "duración negativa en " + item.label);
  const tramo = jump == null ? schedule : schedule.filter((item) => item.start >= jump - 0.001);
  if (jump != null) assert.equal(seconds(tramo[0].start), seconds(jump), "el plan nuevo debe empezar justo en el momento del salto");
  tramo.forEach((item, index) => {
    if (index) assert.equal(seconds(item.start), seconds(tramo[index - 1].end), "hueco o solape antes de " + item.label);
  });
}

test("el plan inicial reparte todo el tiempo disponible", () => {
  const timer = createTimer(articleOf(8));
  assertPlan(timer.state.schedule, 3600);
  assert.equal(paragraphsOf(timer.state.schedule).length, 8);
});

test("pasar ahora a mitad del estudio reparte el tiempo sobrante entre las preguntas restantes", () => {
  const timer = createTimer(articleOf(8));
  const bloque = 2;
  const objetivo = timer.state.schedule.find((item) => item.block === bloque);
  timer.state.elapsed = (objetivo.start + objetivo.end) / 2;
  const sobrante = objetivo.end - timer.state.elapsed;
  const antes = paragraphsOf(timer.state.schedule).filter((item) => item.block > bloque).map((item) => item.duration);

  timer.passNow();

  const despues = paragraphsOf(timer.state.schedule).filter((item) => item.block > bloque);
  assert.equal(despues.length, 5, "las preguntas que quedan deben seguir ahí");
  assertPlan(timer.state.schedule, 3600, timer.state.elapsed);
  assert.ok(despues.every((item) => item.duration > 0), "cada pregunta restante debe recibir algo del tiempo sobrante");
  assert.equal(seconds(durations(despues) - total(antes)), seconds(sobrante), "el tiempo sobrante debe repartirse entero, sin perderse");
  const ganado = despues.map((item, index) => item.duration - antes[index]);
  assert.ok(ganado[0] > 0, "las preguntas restantes deben ganar tiempo");
  assert.ok(ganado.every((value) => Math.abs(value - ganado[0]) < 0.01), "todas las preguntas restantes deben ganar los MISMOS segundos: " + ganado.map((v) => Math.round(v * 10) / 10).join(", "));
});

test("el tramo que se deja atrás queda cerrado con el tiempo que se le dedicó", () => {
  const timer = createTimer(articleOf(8));
  const objetivo = timer.state.schedule.find((item) => item.block === 3);
  timer.state.elapsed = objetivo.start + 40;

  timer.passNow();

  const transcurrido = timer.state.schedule.find((item) => item.block === 3);
  assert.equal(seconds(transcurrido.duration), 40, "debe conservarse el tiempo dedicado a la pregunta pasada");
  assert.equal(seconds(transcurrido.end), seconds(timer.state.elapsed));
  assertPlan(timer.state.schedule, 3600); // el plan sigue siendo una línea continua, sin huecos
});

test("pasar ahora en la última pregunta reparte su tiempo entre repaso y conclusión", () => {
  const timer = createTimer(articleOf(8));
  const ultima = paragraphsOf(timer.state.schedule).at(-1);
  timer.state.elapsed = (ultima.start + ultima.end) / 2;
  const sobrante = ultima.end - timer.state.elapsed;

  timer.passNow();

  assertPlan(timer.state.schedule, 3600, timer.state.elapsed);
  const review = byKind(timer.state.schedule, "review");
  const closing = byKind(timer.state.schedule, "closing");
  assert.equal(seconds(review.duration + closing.duration), seconds(3600 - timer.state.elapsed), "todo el tiempo restante debe quedar asignado");
  assert.ok(review.duration >= 240 && closing.duration >= 90, "repaso y conclusión no deben quedarse por debajo de lo configurado");
  assert.equal(seconds(review.duration + closing.duration - 330), seconds(sobrante), "el tiempo sobrante debe acabar en el tramo final");
  assert.equal(seconds(review.duration - 240), seconds(closing.duration - 90), "repaso y conclusión deben ganar los mismos segundos");
});

test("pasar ahora durante la introducción reparte la introducción entre las preguntas", () => {
  const timer = createTimer(articleOf(8));
  const intro = timer.state.schedule[0];
  timer.state.elapsed = intro.duration / 2;
  const sobrante = intro.end - timer.state.elapsed;

  timer.passNow();

  assertPlan(timer.state.schedule, 3600, timer.state.elapsed);
  assert.equal(paragraphsOf(timer.state.schedule).length, 8);
  const inicial = durations(paragraphsOf(createTimer(articleOf(8)).state.schedule));
  assert.ok(durations(paragraphsOf(timer.state.schedule)) > inicial, "las preguntas deben recibir el tiempo que sobraba");
  assert.equal(seconds(durations(paragraphsOf(timer.state.schedule)) - inicial), seconds(sobrante), "lo que sobraba de la introducción debe repartirse entre las preguntas");
});

test("pasar ahora durante el repaso deja el tiempo restante a la conclusión", () => {
  const timer = createTimer(articleOf(8));
  timer.state.elapsed = byKind(timer.state.schedule, "review").start + 10;

  timer.passNow();

  assertPlan(timer.state.schedule, 3600, timer.state.elapsed);
  const closing = byKind(timer.state.schedule, "closing");
  assert.equal(closing.label, "Conclusión");
  assert.equal(seconds(closing.duration), seconds(3600 - timer.state.elapsed));
});

test("una sesión con muchos 'pasar ahora' nunca pierde tiempo ni solapa tramos", () => {
  const timer = createTimer(articleOf(10));
  for (let saltos = 0; saltos < 12; saltos++) {
    const current = timer.activeSegment();
    if (!current || current.kind === "closing") break;
    timer.state.elapsed += Math.max(5, (current.end - current.start) / 3);
    if (timer.state.elapsed >= timer.state.total) break;
    timer.passNow();
    assertPlan(timer.state.schedule, 3600, timer.state.elapsed);
  }
});

test("el reparto se mantiene al cambiar la duración o los ajustes", () => {
  const timer = createTimer(articleOf(8), { total: 1800, intro: 60, review: 120, closing: 60 });
  assertPlan(timer.state.schedule, 1800);
  timer.state.elapsed = 200;
  timer.passNow();
  assertPlan(timer.state.schedule, 1800, timer.state.elapsed);
});
