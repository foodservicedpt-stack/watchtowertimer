let paragraphs = [
  { length: 64 }, { length: 76 }, { length: 162 }, { length: 114 }, { length: 104, read: true },
  { length: 129 }, { length: 149 }, { length: 139, read: true, image: true }, { length: 144, read: true }, { length: 103 },
  { length: 86 }, { length: 106 }, { length: 144, read: true }, { length: 100 }, { length: 127 },
  { length: 102 }, { length: 151 }, { length: 85, read: true }, { length: 101, image: true }, { length: 101 },
];

const $ = (id) => document.getElementById(id);
const state = { total: 60 * 60, elapsed: 0, running: false, lastTick: 0, timer: null, schedule: [], notice: "" };
const els = {
  clock: $("clock"), phase: $("phase-label"), ring: $("progress-ring"), ringValue: $("progress-value"), start: $("start-pause"),
  expected: $("expected-paragraph"), cardNumber: $("paragraph-number"), cardTitle: $("paragraph-title"), eventList: $("event-list"),
  paragraphTime: $("paragraph-time"), fill: $("segment-fill"), list: $("paragraph-list"), note: $("redistribution-note"),
  total: $("total-minutes"), intro: $("intro-seconds"), review: $("review-seconds"), closing: $("closing-seconds"), notes: $("notes"),
  articleTitle: $("article-title"), articleMeta: $("article-meta"), articleBadge: $("article-badge"), articleStatus: $("article-status"),
};

function format(seconds) {
  const value = Math.max(0, Math.round(seconds));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}
function settings() { return { intro: +els.intro.value, review: +els.review.value, closing: +els.closing.value }; }
function isCircuitMode() { return state.total === 30 * 60; }

// Agrupa los párrafos en "bloques de estudio": los párrafos que comparten la
// misma pregunta se analizan juntos (p. ej. la pregunta "1, 2." engloba los
// párrafos 1 y 2, así que forman un único bloque).
function buildBlocks() {
  const blocks = [];
  let current = null;
  paragraphs.forEach((p, index) => {
    const number = p.number || index + 1;
    const question = p.question || number;
    if (!current || current.question !== question) {
      current = { question, paragraphs: [] };
      blocks.push(current);
    }
    current.paragraphs.push({ ...p, number });
  });
  return blocks;
}
function blockFirst(block) { return block.paragraphs[0].number; }
function blockLast(block) { return block.paragraphs[block.paragraphs.length - 1].number; }
function blockParts(block) { return Math.max(1, block.paragraphs[0]?.parts || 1); }
function blockWeight(block) {
  let base = 0;
  for (const p of block.paragraphs) base += p.length + (p.image ? 42 : 0) + (p.read ? 35 : 0) + (p.box ? 35 : 0);
  // Una pregunta con varias partes (a), b), c)...) necesita un poco más de tiempo.
  base += (blockParts(block) - 1) * 40;
  return base;
}
function weights(from = 0) {
  const blocks = buildBlocks();
  const span = Math.max(1, blocks.length - 1);
  return blocks.slice(from).map((block, index) => {
    // Posición 0..1 a lo largo del artículo: los primeros bloques reciben un
    // poco menos de tiempo y los últimos un poco más (la discusión suele
    // desarrollarse y alargarse hacia el final).
    const position = Math.min(1, (from + index) / span);
    return blockWeight(block) * (0.9 + 0.2 * position);
  });
}
function segment(kind, label, start, duration, block = null) {
  return { kind, label, start, end: start + Math.max(0, duration), duration: Math.max(0, duration), block };
}
// Reparte el tiempo que queda desde "start" entre las preguntas que faltan, el repaso
// y la conclusión. Si ya no queda ninguna pregunta —se ha pasado en la última—, repaso
// y conclusión se reparten todo: antes ese rato se perdía y el estudio terminaba antes
// que el reloj, con la cuenta atrás parada en 0:00.
function addRemainingSchedule(start, blockFrom = 0) {
  const values = settings();
  let available = Math.max(0, state.total - start);
  const blocks = buildBlocks();
  const blockWeights = weights(blockFrom);
  const totalWeight = blockWeights.reduce((sum, weight) => sum + weight, 0);
  let review;
  let closing;
  if (totalWeight) {
    closing = Math.min(values.closing, available);
    available -= closing;
    review = Math.min(values.review, available);
    available -= review;
  } else {
    const tail = values.review + values.closing;
    review = tail ? available * values.review / tail : 0;
    closing = available - review;
    available = 0;
  }
  const schedule = [];
  let cursor = start;
  blockWeights.forEach((weight, index) => {
    const block = blocks[blockFrom + index];
    const first = blockFirst(block);
    const last = blockLast(block);
    const label = first === last ? `Pregunta ${block.question}` : `Pregunta ${block.question} · párrs. ${first}–${last}`;
    const duration = available * weight / totalWeight;
    schedule.push(segment("paragraph", label, cursor, duration, blockFrom + index));
    cursor += duration;
  });
  schedule.push(segment("review", "Repaso", cursor, review));
  cursor += review;
  schedule.push(segment("closing", "Conclusión", cursor, closing));
  return schedule;
}
function rebuildFullSchedule() {
  const intro = Math.min(settings().intro, state.total);
  state.schedule = [segment("intro", "Introducción", 0, intro), ...addRemainingSchedule(intro)];
}
function activeSegment() {
  return state.schedule.find((item) => state.elapsed < item.end) || state.schedule.at(-1);
}
function progress(segment) {
  if (!segment?.duration) return 1;
  return Math.min(1, Math.max(0, (state.elapsed - segment.start) / segment.duration));
}
function updateCard(current) {
  const block = current.block != null ? buildBlocks()[current.block] : null;
  els.cardNumber.textContent = block ? block.question : "—";
  els.cardTitle.textContent = current.kind === "intro" ? "Comienza con tus comentarios iniciales"
    : current.kind === "review" ? "Haz las tres preguntas de repaso"
    : current.kind === "closing" ? "Cierra el estudio con tu conclusión"
    : block.paragraphs.length > 1 ? `Pregunta ${block.question} · párrafos ${blockFirst(block)}–${blockLast(block)}`
    : `Pregunta ${block.question}`;
  els.eventList.innerHTML = "";
  if (block) {
    let flags = 0;
    if (block.paragraphs.some((p) => p.read)) { els.eventList.insertAdjacentHTML("beforeend", '<span class="event-tag">📖 lea</span>'); flags++; }
    if (block.paragraphs.some((p) => p.image)) { els.eventList.insertAdjacentHTML("beforeend", '<span class="event-tag">🖼️ imagen</span>'); flags++; }
    if (block.paragraphs.some((p) => p.box)) { els.eventList.insertAdjacentHTML("beforeend", '<span class="event-tag">📦 recuadro</span>'); flags++; }
    const parts = blockParts(block);
    if (parts > 1) els.eventList.insertAdjacentHTML("beforeend", `<span class="event-tag">${Array.from({ length: parts }, (_, i) => String.fromCharCode(97 + i)).join(" · ")}</span>`);
    if (flags === 0 && parts <= 1) els.eventList.insertAdjacentHTML("beforeend", '<span class="event-tag">Comentario</span>');
  }
  els.paragraphTime.innerHTML = `${format(current.end - state.elapsed)}<br><small>restantes</small>`;
  els.fill.style.width = `${progress(current) * 100}%`;
}
function drawMap(current) {
  els.list.innerHTML = buildBlocks().map((block, blockIndex) => {
    const first = blockFirst(block);
    const last = blockLast(block);
    const icon = block.paragraphs.some((p) => p.image) ? "🖼️" : block.paragraphs.some((p) => p.read) ? "📖" : block.paragraphs.some((p) => p.box) ? "📦" : "";
    const selected = current.block === blockIndex ? "is-current" : "";
    const label = first === last ? `${first}` : `${first}–${last}`;
    // El tiempo asignado a cada pregunta se ve en el mapa: al pasar de pregunta los
    // números cambian, que es exactamente lo que se reparte.
    const tramo = state.schedule.find((item) => item.block === blockIndex);
    const asignado = tramo ? format(tramo.duration) : "";
    const cabecera = first === last ? `Pregunta ${block.question} · párr. ${first}` : `Pregunta ${block.question} · párrs. ${first}–${last}`;
    const title = asignado ? `${cabecera} · ${asignado}` : cabecera;
    return `<span class="paragraph-chip ${selected} ${icon ? "has-event" : ""}" title="${title}">${label}${asignado ? `<small class="chip-time">${asignado}</small>` : ""}${icon ? `<i class="chip-icon">${icon}</i>` : ""}</span>`;
  }).join("");
}
function render() {
  const current = activeSegment();
  const remaining = state.total - state.elapsed;
  const percentage = Math.min(100, state.elapsed / state.total * 100);
  els.clock.textContent = format(remaining);
  els.ring.style.background = `conic-gradient(#8bc4ad ${percentage * 3.6}deg, rgba(255,255,255,.15) 0deg)`;
  els.ringValue.textContent = `${Math.round(percentage)}%`;
  els.phase.textContent = state.running ? current.label.toUpperCase() : state.elapsed ? "EN PAUSA" : "LISTO PARA EMPEZAR";
  els.start.textContent = state.running ? "Pausar" : state.elapsed ? "Continuar" : "Iniciar";
  els.expected.textContent = current.label;
  els.note.textContent = state.notice || (current.block != null ? "La siguiente pregunta empieza automáticamente al terminar esta cuenta atrás." : "El estudio cambiará automáticamente al siguiente tramo.");
  updateCard(current); drawMap(current);
}
function stopTimer() {
  state.running = false;
  if (state.timer) window.clearInterval(state.timer);
  state.timer = null;
}
function advanceClock() {
  const now = Date.now();
  state.elapsed += (now - state.lastTick) / 1000;
  state.lastTick = now;
  if (state.elapsed >= state.total) { state.elapsed = state.total; stopTimer(); }
  render();
}
function startPause() {
  if (state.running) { stopTimer(); render(); return; }
  state.running = true;
  state.lastTick = Date.now();
  state.timer = window.setInterval(advanceClock, 200);
  render();
}
function reset() { stopTimer(); state.elapsed = 0; state.notice = ""; rebuildFullSchedule(); render(); }
function setTotal(minutes) {
  state.total = minutes * 60;
  els.total.value = minutes;
  document.querySelectorAll(".preset").forEach((button) => button.classList.toggle("is-active", +button.dataset.total === minutes));
  reset();
}
// "Pasar ahora": el tiempo que todavía tenía asignado este tramo se reparte entre los
// que quedan. Si ya no queda ninguna pregunta, va a repaso y conclusión.
// El tramo que se deja atrás se cierra en el instante del salto: así el plan sigue
// siendo una línea continua, no se pierde el rato ya dedicado y el mapa lo refleja.
function passNow() {
  const current = activeSegment();
  if (!current || current.kind === "closing") return;
  const kept = state.schedule.slice(0, state.schedule.indexOf(current));
  const spent = { ...current, end: state.elapsed, duration: Math.max(0, state.elapsed - current.start) };
  const sobrante = Math.max(0, current.end - state.elapsed);
  if (current.kind === "intro") {
    state.schedule = [...kept, spent, ...addRemainingSchedule(state.elapsed, 0)];
    state.notice = `Introducción acortada: ${format(sobrante)} repartidos entre las ${buildBlocks().length} preguntas.`;
  } else if (current.kind === "paragraph") {
    const restantes = Math.max(0, buildBlocks().length - current.block - 1);
    state.schedule = [...kept, spent, ...addRemainingSchedule(state.elapsed, current.block + 1)];
    state.notice = restantes
      ? `${format(sobrante)} repartidos entre las ${restantes} preguntas restantes.`
      : `Última pregunta: ${format(sobrante)} repartidos entre el repaso y la conclusión.`;
  } else {
    state.schedule = [...kept, spent, segment("closing", "Conclusión", state.elapsed, state.total - state.elapsed)];
    state.notice = `Repaso acortado: ${format(sobrante)} para la conclusión.`;
  }
  render();
}
function isValidArticle(article) {
  return article && typeof article.title === "string" && Array.isArray(article.paragraphs)
    && article.paragraphs.length >= 5 && article.paragraphs.every((item) => Number.isFinite(item.length) && item.length > 0);
}
function displayArticle(article, status) {
  els.articleTitle.textContent = article.title;
  els.articleMeta.textContent = article.week || "Atalaya de esta semana";
  const questionCount = buildBlocks().length;
  els.articleBadge.textContent = questionCount < article.paragraphs.length ? `${questionCount} preguntas · ${article.paragraphs.length} párrs.` : `${article.paragraphs.length} párrafos`;
  els.articleStatus.textContent = status;
}
async function loadWeeklyArticle() {
  try {
    const response = await fetch("./article.json", { cache: "no-store" });
    if (!response.ok) throw new Error("No se pudo consultar la Atalaya actual");
    const article = await response.json();
    if (!isValidArticle(article)) throw new Error("La estructura del artículo no es válida");
    paragraphs = article.paragraphs;
    displayArticle(article, "Actualizado automáticamente desde jw.org");
    if (!state.running) reset();
  } catch {
    displayArticle({ title: els.articleTitle.textContent, week: els.articleMeta.textContent, paragraphs }, "Usando la copia integrada del artículo");
  }
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

$("start-pause").addEventListener("click", startPause);
$("reset").addEventListener("click", reset);
$("next-paragraph").addEventListener("click", passNow);
document.querySelectorAll(".preset").forEach((button) => button.addEventListener("click", () => setTotal(+button.dataset.total)));
els.total.addEventListener("change", () => setTotal(Math.min(70, Math.max(20, +els.total.value || 60))));
[els.intro, els.review, els.closing].forEach((input) => {
  input.addEventListener("input", reset);
  input.addEventListener("change", reset);
});
$("toggle-settings").addEventListener("click", (event) => { const panel = $("settings"); panel.hidden = !panel.hidden; event.currentTarget.setAttribute("aria-expanded", String(!panel.hidden)); });
els.notes.value = localStorage.getItem("watchtower-timer-notes") || "";
els.notes.addEventListener("input", () => localStorage.setItem("watchtower-timer-notes", els.notes.value));
$("clear-notes").addEventListener("click", () => { els.notes.value = ""; localStorage.removeItem("watchtower-timer-notes"); els.notes.focus(); });
rebuildFullSchedule();
render();
loadWeeklyArticle();
