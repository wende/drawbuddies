import { bakeSprite, stats } from "../../app/rough-skin.js";

const BAR_W = 280;
const BAR_H = 22;
const CD_SIZE = 72;

const BARS = [
  { id: "hp", label: "Health", pct: 65, fill: "#8a3b24" },
  { id: "mp", label: "Mana", pct: 42, fill: "#2f5f8a" },
  { id: "st", label: "Stamina", pct: 88, fill: "#3f6d3a" },
  { id: "xp", label: "Insight", pct: 23, fill: "#b8860b" },
  { id: "cd", label: "Cooldown", pct: 20, fill: "#9b8bb4" }
];

const SPELLS = [
  { glyph: "🔥", pct: 70, fill: "#8a3b24" },
  { glyph: "❄️", pct: 35, fill: "#2f5f8a" },
  { glyph: "⚡", pct: 100, fill: "#b8860b" }
];

export default {
  id: "vitals",
  title: "Vitals & cooldowns",
  tier: "Clip a full-width fill — never regenerate",
  note:
    "Track and fill are generated once at full size. Progress is a clip-path inset driven by " +
    "--pct on the fill itself (@property, inherits: false). The wobble stays anchored as the " +
    "bar advances. Radial sweeps use the same trick with a conic mask. Colours are baked — a " +
    "data-URI cannot resolve currentColor.",
  render(root, ctx) {
    const before = stats.generations;
    const track = bakeSprite("rectangle", BAR_W, BAR_H, { ...ctx.opts, fill: "transparent" }, ctx.variant(0));
    const fills = {};
    for (const bar of BARS) {
      fills[bar.id] = bakeSprite(
        "rectangle",
        BAR_W,
        BAR_H,
        { ...ctx.opts, fill: bar.fill, fillStyle: "solid", stroke: bar.fill },
        ctx.variant(0)
      );
    }

    const list = document.createElement("div");
    list.className = "hud-meters";
    const entries = [];

    for (const bar of BARS) {
      const row = document.createElement("div");
      row.className = "hud-meter";

      const label = document.createElement("span");
      label.textContent = bar.label;

      const trackEl = document.createElement("div");
      trackEl.className = "hud-bar";
      trackEl.style.backgroundImage = track;

      const fillEl = document.createElement("div");
      fillEl.className = "hud-bar-fill";
      fillEl.style.backgroundImage = fills[bar.id];
      fillEl.style.setProperty("--pct", `${bar.pct}%`);
      trackEl.append(fillEl);

      const number = document.createElement("span");
      number.className = "hud-n";
      number.textContent = `${bar.pct}%`;

      row.append(label, trackEl, number);
      list.append(row);
      entries.push({ fill: fillEl, pct: number, value: bar.pct / 100 });
    }

    root.append(list);

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "hud-pulse";
    toggle.textContent = "Animate";
    let timer = null;
    toggle.addEventListener("click", () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
        toggle.textContent = "Animate";
        toggle.classList.remove("is-on");
        return;
      }
      toggle.textContent = "Stop";
      toggle.classList.add("is-on");
      timer = setInterval(() => {
        for (const entry of entries) {
          entry.value = Math.random();
          const next = Math.round(entry.value * 100);
          entry.fill.style.setProperty("--pct", `${next}%`);
          entry.pct.textContent = `${next}%`;
        }
      }, 900);
    });
    ctx.onTeardown(() => timer && clearInterval(timer));
    root.append(toggle);

    root.append(ctx.subhead("Radial cooldown sweeps"));

    const cdTrack = bakeSprite("ellipse", CD_SIZE, CD_SIZE, { ...ctx.opts, fill: "transparent" }, ctx.variant(1));
    const cds = document.createElement("div");
    cds.className = "hud-cooldowns";

    for (const spell of SPELLS) {
      const wrap = document.createElement("div");
      wrap.className = "hud-cd";
      wrap.style.backgroundImage = cdTrack;

      const fill = bakeSprite(
        "ellipse",
        CD_SIZE,
        CD_SIZE,
        { ...ctx.opts, fill: spell.fill, fillStyle: "solid", stroke: spell.fill },
        ctx.variant(1)
      );
      const fillEl = document.createElement("div");
      fillEl.className = "hud-cd-fill";
      fillEl.style.backgroundImage = fill;
      fillEl.style.setProperty("--pct", `${spell.pct}%`);

      const glyph = document.createElement("span");
      glyph.className = "hud-cd-label";
      glyph.textContent = spell.glyph;

      wrap.append(fillEl, glyph);
      cds.append(wrap);
    }

    root.append(cds);

    const calls = stats.generations - before;
    root.append(
      ctx.metric(
        `1 track + ${BARS.length} colour fills + ${SPELLS.length} radials = ${calls} rough calls · 0 per frame`
      )
    );
  }
};
