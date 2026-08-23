let paragraphs = [
  { length: 64 }, { length: 76 }, { length: 162 }, { length: 114 }, { length: 104, read: true },
  { length: 129 }, { length: 149 }, { length: 139, read: true, image: true }, { length: 144, read: true }, { length: 103 },
  { length: 86 }, { length: 106 }, { length: 144, read: true }, { length: 100 }, { length: 127 },
  { length: 102 }, { length: 151 }, { length: 85, read: true }, { length: 101, image: true }, { length: 101 },
];

const $ = (id) => document.getElementById(id);
const state = { total: 60 * 60, elapsed: 0, running: false, lastTick: 0, timer: null, schedule: [] };
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
function weights(from = 0) {
  return paragraphs.slice(from).map((p) => p.length + (p.image ? 42 : 0) + (p.read ? 35 : 0));
}
function segment(kind, label, start, duration, paragraph = null) {
  return { kind, label, start, end: start + Math.max(0, duration), duration: Math.max(0, duration), paragraph };
}
function addRemainingSchedule(start, paragraphFrom = 0) {
  const values = settings();
  let available = Math.max(0, state.total - start);
  const closing = Math.min(values.closing, available);
  available -= closing;
  const review = Math.min(values.review, available);
  available -= review;
  const paragraphWeights = weights(paragraphFrom);
  const totalWeight = paragraphWeights.reduce((sum, weight) => sum + weight, 0);
  const schedule = [];
  let cursor = start;
  paragraphWeights.forEach((weight, index) => {
    const number = paragraphFrom + index + 1;
    const duration = totalWeight ? available * weight / totalWeight : 0;
    schedule.push(segment("paragraph", `Párrafo ${number}`, cursor, duration, number));
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
  els.cardNumber.textContent = current.paragraph || "—";
  els.cardTitle.textContent = current.kind === "intro" ? "Comienza con tus comentarios iniciales"
    : current.kind === "review" ? "Haz las tres preguntas de repaso"
    : current.kind === "closing" ? "Cierra el estudio con tu conclusión"
    : `Tiempo asignado al párrafo ${current.paragraph}`;
  els.eventList.innerHTML = "";
  if (current.paragraph) {
    const item = paragraphs[current.paragraph - 1];
    if (item.read) els.eventList.insertAdjacentHTML("beforeend", '<span class="event-tag">📖 lea</span>');
    if (item.image) els.eventList.insertAdjacentHTML("beforeend", '<span class="event-tag">🖼️ imagen</span>');
    if (!item.read && !item.image) els.eventList.insertAdjacentHTML("beforeend", '<span class="event-tag">Comentario</span>');
  }
  els.paragraphTime.innerHTML = `${format(current.end - state.elapsed)}<br><small>restantes</small>`;
  els.fill.style.width = `${progress(current) * 100}%`;
}
function drawMap(current) {
  els.list.innerHTML = paragraphs.map((p, index) => {
    const icon = p.image ? "🖼️" : p.read ? "📖" : "";
    const selected = current.paragraph === index + 1 ? "is-current" : "";
    return `<span class="paragraph-chip ${selected} ${icon ? "has-event" : ""}" title="Párrafo ${index + 1}${p.read ? ": lea" : ""}${p.image ? ": imagen" : ""}">${index + 1}${icon ? `<i class="chip-icon">${icon}</i>` : ""}</span>`;
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
  els.note.textContent = current.paragraph ? "El siguiente párrafo empieza automáticamente al terminar esta cuenta atrás." : "El estudio cambiará automáticamente al siguiente tramo.";
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
function reset() { stopTimer(); state.elapsed = 0; rebuildFullSchedule(); render(); }
function setTotal(minutes) {
  state.total = minutes * 60;
  els.total.value = minutes;
  document.querySelectorAll(".preset").forEach((button) => button.classList.toggle("is-active", +button.dataset.total === minutes));
  reset();
}
function passNow() {
  const current = activeSegment();
  if (!current || current.kind === "closing") return;
  const index = state.schedule.indexOf(current);
  if (current.kind === "paragraph") state.schedule = [...state.schedule.slice(0, index), ...addRemainingSchedule(state.elapsed, current.paragraph)];
  else if (current.kind === "intro") state.schedule = [...addRemainingSchedule(state.elapsed)];
  else state.schedule = [...state.schedule.slice(0, index), segment("closing", "Conclusión", state.elapsed, state.total - state.elapsed)];
  render();
}
function isValidArticle(article) {
  return article && typeof article.title === "string" && Array.isArray(article.paragraphs)
    && article.paragraphs.length >= 5 && article.paragraphs.every((item) => Number.isFinite(item.length) && item.length > 0);
}
function displayArticle(article, status) {
  els.articleTitle.textContent = article.title;
  els.articleMeta.textContent = article.week || "Atalaya de esta semana";
  els.articleBadge.textContent = `${article.paragraphs.length} párrafos`;
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
