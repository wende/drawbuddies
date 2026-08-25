// The gallery registry.
//
// To add a work-in-progress element: drop a module in this folder exporting a
// default `{ id, title, tier, note, render(root, ctx) }`, then add it to the
// array below. Nothing else needs to change.
//
// `ctx` gives you:
//   opts          the live rough options from the control panel
//   seeds         the seed pool (array)
//   variant(i)    a seed from the pool, wrapped
//   key(name)     a sprite id that is unique to the current settings revision
//   caption(text) / subhead(text) / metric(text)   presentational helpers
//   onTeardown(fn)  cleanup, called before the gallery re-renders

import buttons from "./buttons.js";
import inventory from "./inventory.js";
import bars from "./bars.js";
import panels from "./panels.js";
import inputs from "./inputs.js";

export const elements = [buttons, inventory, bars, panels, inputs];
