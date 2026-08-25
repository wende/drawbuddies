import { bakeSprite } from "../../app/rough-skin.js";

// Progress bars are the widget most likely to be built wrong: the naive version
// regenerates the fill every frame, which makes the strokes crawl. Here the fill
// is generated once at full width and revealed with clip-path, so the wobble
// stays anchored to the bar and the animation is paint-only.
const BAR_W = 320;
const BAR_H = 30;

// A Tier 1 sprite is a data-URI, so it has no host document to resolve
// `currentColor` against — the fill colour has to be baked in. One sprite per
// colour, generated once; still nothing per frame, which is the point.
const BARS = [
  { label: "Health", color: "#c65f4e", value: 0.72 },
  { label: "Mana", color: "#4e79c6", value: 0.45 },
  { label: "Stamina", color: "#6fa04e", value: 0.9 },
  { label: "Cooldown", color: "#9b8bb4", value: 0.2 }
];

export default {
  id: "bars",
  title: "Progress bars",
  tier: "Fixed geometry + clip-path",
  note: "The fill is generated once at full width and clipped. Watch the strokes: they must stay put as the value moves.",

  render(root, ctx) {
    const track = bakeSprite("rectangle", BAR_W, BAR_H, { ...ctx.opts, fill: "none" }, ctx.variant(0));

    const list = document.createElement("div");
    list.className = "bar-list";

    const bars = BARS.map((spec) => {
      const wrap = document.createElement("div");
      wrap.className = "bar-wrap";

      const name = document.createElement("span");
      name.className = "bar-label";
      name.textContent = spec.label;

      const bar = document.createElement("div");
      bar.className = "bar";
      bar.style.width = `${BAR_W}px`;
      bar.style.height = `${BAR_H}px`;
      bar.style.backgroundImage = track;

      const inner = document.createElement("div");
      inner.className = "bar-fill";
      inner.style.backgroundImage = bakeSprite(
        "rectangle",
        BAR_W,
        BAR_H,
        { ...ctx.opts, stroke: spec.color, fill: spec.color, fillStyle: "solid" },
        ctx.variant(1)
      );
      // `--pct` is registered with `inherits: false`, so it must be set on the
      // element that owns the clip-path — setting it on the parent silently
      // leaves the child clipped to its 0% initial value.
      inner.style.setProperty("--pct", `${spec.value * 100}%`);
      bar.append(inner);

      const pct = document.createElement("span");
      pct.className = "bar-pct";
      pct.textContent = `${Math.round(spec.value * 100)}%`;

      wrap.append(name, bar, pct);
      list.append(wrap);
      return { fill: inner, pct, value: spec.value };
    });

    root.append(list);

    const toggle = document.createElement("button");
    toggle.className = "lab-action";
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
        for (const entry of bars) {
          entry.value = Math.random();
          entry.fill.style.setProperty("--pct", `${entry.value * 100}%`);
          entry.pct.textContent = `${Math.round(entry.value * 100)}%`;
        }
      }, 900);
    });
    ctx.onTeardown(() => timer && clearInterval(timer));

    root.append(toggle);
    root.append(
      ctx.metric(`1 track + ${BARS.length} colour fills = ${BARS.length + 1} rough calls · 0 per frame`)
    );
  }
};
