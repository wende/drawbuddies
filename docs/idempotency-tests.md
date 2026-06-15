# Idempotency test ideas

Notes for a future iteration — **nothing here is implemented yet.** The goal is a
small set of tests that lock in idempotency, the property that actually bites a
collaborative app: reconnects, full re-syncs, and duplicate broadcasts all replay
ops, so applying the same op more than once must not change state.

Ranked by payoff.

## 1. Remote-op replay is a no-op (highest value)

The point of the sync layer (`applyRemote*` in `public/index.html`): applying an op
you've already applied changes nothing. Guards against state drift on reconnect /
duplicate messages.

- `applyRemoteUpsert(s)` twice → `shapes` is byte-identical (no duplicate, same content).
- `applyRemoteRemove(id)` on a missing id → no-op.
- `applyRemoteClear()` / `applyRemoteReplace(list)` applied twice → identical state.
- Property form: for any op `o`, `apply(apply(state, o), o) === apply(state, o)`.

## 2. Server upsert/replace idempotency (`src/index.ts`)

**Easiest to test today** — `CanvasRoom` is already an exported module, so
`@cloudflare/vitest-pool-workers` can drive it with no refactor.

- `upsertShape(s)` twice → exactly one row, same `data`, same `ord` (z-order preserved).
- The same `add` sent twice doesn't double-count toward `MAX_SHAPES`.
- `replaceAll(list)` is order-preserving and stable when repeated.

## 3. Serialize ⇄ hydrate round-trip

The persistence / wire boundary should be lossless and stable.

- `serializeShape(hydrateShape(data))` deep-equals `data` for valid input.
- `hydrateShapeList` is a fixpoint — feeding its serialized output back in yields the
  same list (and drops the same junk every time).
- `save()` then `load()` reproduces equal shapes.

## 4. Pure geometry helpers (cheap fixpoint checks)

- `round1(round1(x)) === round1(x)`; same for `roundPoint`.
- `translateGeom(g, 0, 0)` equals `g`; translate-then-inverse ≈ original.
- `normalizedBox` of an already-normalized geom is stable.
- `simplifyPoints` reaches a fixpoint (a second pass removes nothing) — catches
  re-simplification drift on shapes that get re-rendered repeatedly.

## The practical catch

Group 2 is testable now. Groups 1, 3, and 4 live inside the IIFE in
`public/index.html`, so nothing is importable — that's the only blocker.

Minimal unlock (not module sprawl): pull just the **pure, side-effect-free** helpers
— `round1`, `roundPoint`, `serializeShape`, `hydrateShape`, `translateGeom`,
`normalizedBox`, `simplifyPoints`, `pointBounds` — into one `public/shapes.js` that
the HTML loads via `<script>` and tests import. One file of pure functions, no build
step; it also de-duplicates them against future reuse.

## Suggested order when picking this up

1. Add vitest + `@cloudflare/vitest-pool-workers`; write the group-2 server tests
   (zero refactor).
2. Extract the pure helpers to `public/shapes.js` to unlock groups 3 and 4.
3. Add the group-1 remote-op replay tests last (they need the shape list + apply
   functions reachable from a test, the largest of the three lifts).
