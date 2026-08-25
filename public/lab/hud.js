import { clearSprites, resetStats, stats } from "../app/rough-skin.js";
import { widgets } from "./widgets/index.js";

const sections = document.getElementById("sections");
const nav = document.getElementById("nav");
const readout = document.getElementById("readout");

const controls = {
  roughness: document.getElementById("roughness"),
  bowing: document.getElementById("bowing"),
  strokeWidth: document.getElementById("strokeWidth"),
  variants: document.getElementById("variants"),
  reroll: document.getElementById("reroll"),
  reset: document.getElementById("reset"),
  theme: document.getElementById("theme")
};

const DEFAULTS = { roughness: 1.3, bowing: 1.2, strokeWidth: 1.5, variants: 4 };

let seedBase = 2400;
let revision = 0;
let teardowns = [];

function isDark() {
  return document.documentElement.classList.contains("dark");
}

function ink() {
  return isDark() ? "#f0ead8" : "#241f18";
}

function panelFill() {
  return isDark() ? "rgba(36, 33, 28, 0.92)" : "rgba(255, 250, 240, 0.92)";
}

function readOptions() {
  return {
    roughness: Number(controls.roughness.value),
    bowing: Number(controls.bowing.value),
    strokeWidth: Number(controls.strokeWidth.value),
    stroke: ink()
  };
}

function seedPool() {
  const count = Number(controls.variants.value);
  return Array.from({ length: count }, (_, i) => seedBase + i * 23);
}

function caption(text) {
  const el = document.createElement("span");
  el.className = "hud-caption";
  el.textContent = text;
  return el;
}

function subhead(text) {
  const el = document.createElement("h3");
  el.className = "hud-subhead";
  el.textContent = text;
  return el;
}

function metric(text) {
  const el = document.createElement("p");
  el.className = "hud-metric";
  el.textContent = text;
  return el;
}

function buildContext() {
  return {
    opts: readOptions(),
    ink: ink(),
    panelFill: panelFill(),
    dark: isDark(),
    seeds: seedPool(),
    variant: (i) => seedPool()[i % seedPool().length],
    key: (name) => `hud-${name}-r${revision}`,
    reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
    caption,
    subhead,
    metric,
    onTeardown: (fn) => teardowns.push(fn)
  };
}

function render() {
  for (const fn of teardowns) {
    try {
      fn();
    } catch (error) {
      console.warn("teardown failed", error);
    }
  }
  teardowns = [];

  revision += 1;
  clearSprites();
  resetStats();

  sections.replaceChildren();
  nav.replaceChildren();

  const ctx = buildContext();

  for (const widget of widgets) {
    const section = document.createElement("section");
    section.className = "hud-section";
    section.id = `sec-${widget.id}`;

    const header = document.createElement("header");
    header.className = "hud-head";

    const title = document.createElement("h2");
    title.textContent = widget.title;

    const tier = document.createElement("span");
    tier.className = "hud-tier";
    tier.textContent = widget.tier;

    header.append(title, tier);
    section.append(header);

    if (widget.note) {
      const note = document.createElement("p");
      note.className = "hud-note";
      note.textContent = widget.note;
      section.append(note);
    }

    const body = document.createElement("div");
    body.className = "hud-body";
    section.append(body);

    try {
      widget.render(body, ctx);
    } catch (error) {
      const failure = document.createElement("pre");
      failure.className = "hud-error";
      failure.textContent = `${widget.id} failed to render\n\n${error?.stack || error}`;
      body.append(failure);
      console.error(error);
    }

    sections.append(section);

    const link = document.createElement("a");
    link.href = `#sec-${widget.id}`;
    link.textContent = widget.title;
    nav.append(link);
  }

  readout.textContent =
    `${stats.generations} generations · ${stats.cacheHits} cache hits · ` +
    `${stats.ms.toFixed(1)}ms · ${document.querySelectorAll("svg").length} svg nodes`;
}

function syncLabels() {
  for (const name of ["roughness", "bowing", "strokeWidth", "variants"]) {
    const output = document.getElementById(`${name}Value`);
    if (output) output.textContent = controls[name].value;
  }
}

for (const name of ["roughness", "bowing", "strokeWidth", "variants"]) {
  controls[name].addEventListener("input", () => {
    syncLabels();
    render();
  });
}

controls.reroll.addEventListener("click", () => {
  seedBase = Math.floor(Math.random() * 100000);
  render();
});

controls.reset.addEventListener("click", () => {
  seedBase = 2400;
  for (const [name, value] of Object.entries(DEFAULTS)) controls[name].value = String(value);
  syncLabels();
  render();
});

controls.theme.addEventListener("click", () => {
  const dark = document.documentElement.classList.toggle("dark");
  controls.theme.textContent = dark ? "Light" : "Dark";
  // Tier 1 data-URIs cannot resolve currentColor, so ink has to be re-baked.
  render();
});

syncLabels();
render();
