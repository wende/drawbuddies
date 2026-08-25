import { clearSprites, resetStats, stats } from "../app/rough-skin.js";
import { elements } from "./elements/index.js";

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

const DEFAULTS = { roughness: 1.4, bowing: 1.5, strokeWidth: 1.6, variants: 4 };

// Deterministic by default so Playwright screenshots diff cleanly. "Re-roll"
// deliberately breaks determinism; it is for eyeballing, not for CI.
let seedBase = 1000;
let revision = 0;
let teardowns = [];

function readOptions() {
  return {
    roughness: Number(controls.roughness.value),
    bowing: Number(controls.bowing.value),
    strokeWidth: Number(controls.strokeWidth.value),
    stroke: "currentColor"
  };
}

function seedPool() {
  const count = Number(controls.variants.value);
  return Array.from({ length: count }, (_, i) => seedBase + i * 17);
}

function caption(text) {
  const el = document.createElement("span");
  el.className = "lab-caption";
  el.textContent = text;
  return el;
}

function subhead(text) {
  const el = document.createElement("h4");
  el.className = "lab-subhead";
  el.textContent = text;
  return el;
}

function metric(text) {
  const el = document.createElement("p");
  el.className = "lab-metric";
  el.textContent = text;
  return el;
}

function buildContext(opts, seeds) {
  return {
    opts,
    seeds,
    variant: (i) => seeds[i % seeds.length],
    key: (name) => `sk-${name}-r${revision}`,
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

  const opts = readOptions();
  const seeds = seedPool();

  for (const element of elements) {
    const section = document.createElement("section");
    section.className = "lab-section";
    section.id = `sec-${element.id}`;

    const header = document.createElement("header");
    header.className = "lab-head";

    const title = document.createElement("h3");
    title.textContent = element.title;

    const tier = document.createElement("span");
    tier.className = "lab-tier";
    tier.textContent = element.tier;

    header.append(title, tier);
    section.append(header);

    if (element.note) {
      const note = document.createElement("p");
      note.className = "lab-note";
      note.textContent = element.note;
      section.append(note);
    }

    const body = document.createElement("div");
    body.className = "lab-body";
    section.append(body);

    try {
      element.render(body, buildContext(opts, seeds));
    } catch (error) {
      const failure = document.createElement("pre");
      failure.className = "lab-error";
      failure.textContent = `${element.id} failed to render\n\n${error?.stack || error}`;
      body.append(failure);
      console.error(error);
    }

    sections.append(section);

    const link = document.createElement("a");
    link.href = `#sec-${element.id}`;
    link.textContent = element.title;
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
  seedBase = 1000;
  for (const [name, value] of Object.entries(DEFAULTS)) controls[name].value = String(value);
  syncLabels();
  render();
});

controls.theme.addEventListener("click", () => {
  const dark = document.documentElement.classList.toggle("dark");
  controls.theme.textContent = dark ? "☀︎ Light" : "☾ Dark";
});

// Rendered exactly once on load. Excalifont deliberately does not trigger a
// re-render: the sprites are geometry-only, and DOM text reflows on its own when
// the font arrives. Re-rendering here would reset the stats readout mid-interaction.
syncLabels();
render();
