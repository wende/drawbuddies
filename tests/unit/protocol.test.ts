/**
 * Unit tests for src/protocol.ts — the only thing between an untrusted
 * client payload and the Durable Object. These are the shape guards that
 * keep malformed JSON / bad ids / oversize coords / spoofed shape types
 * from corrupting a room's SQLite state.
 *
 * Run with: npm run test:unit
 */
import { describe, expect, it } from "vitest";
import {
  MAX_AVATAR_SHAPES,
  MAX_PLAYER_COORD,
  sanitizePlayer,
  sanitizePlayerMove,
  sanitizeShape,
} from "../../src/protocol.js";

// A fully valid shape payload. Tests strip down or mutate this.
function validShape(overrides: Record<string, unknown> = {}) {
  return {
    id: "shape-1",
    type: "rectangle",
    geom: { x1: 0, y1: 0, x2: 10, y2: 10 },
    options: { stroke: "#000" },
    ...overrides,
  };
}

describe("sanitizeShape", () => {
  it("rejects null, undefined, primitives, and arrays", () => {
    expect(sanitizeShape(null)).toBeNull();
    expect(sanitizeShape(undefined)).toBeNull();
    expect(sanitizeShape("rectangle")).toBeNull();
    expect(sanitizeShape(42)).toBeNull();
    expect(sanitizeShape(true)).toBeNull();
    expect(sanitizeShape([])).toBeNull();
  });

  it("returns a normalized shape for a valid input", () => {
    const result = sanitizeShape(validShape());
    expect(result).toEqual({
      id: "shape-1",
      type: "rectangle",
      geom: { x1: 0, y1: 0, x2: 10, y2: 10 },
      options: { stroke: "#000" },
    });
  });

  it("strips fields outside the {id, type, geom, options} contract", () => {
    // The server treats geom/options as opaque blobs but should still
    // never echo back random top-level fields a client tries to add.
    const result = sanitizeShape({
      ...validShape(),
      drawable: { sets: "secret" },
      evil: "ignored",
    });
    expect(result).toEqual({
      id: "shape-1",
      type: "rectangle",
      geom: { x1: 0, y1: 0, x2: 10, y2: 10 },
      options: { stroke: "#000" },
    });
    expect(result).not.toHaveProperty("drawable");
    expect(result).not.toHaveProperty("evil");
  });

  describe("id validation", () => {
    it("rejects missing, empty, and non-string ids", () => {
      expect(sanitizeShape(validShape({ id: undefined }))).toBeNull();
      expect(sanitizeShape(validShape({ id: "" }))).toBeNull();
      expect(sanitizeShape(validShape({ id: 123 }))).toBeNull();
      expect(sanitizeShape(validShape({ id: null }))).toBeNull();
      expect(sanitizeShape(validShape({ id: { hack: true } }))).toBeNull();
    });

    it("rejects ids longer than 128 chars", () => {
      expect(sanitizeShape(validShape({ id: "a".repeat(129) }))).toBeNull();
      // Boundary: 128 is allowed.
      expect(sanitizeShape(validShape({ id: "a".repeat(128) }))).not.toBeNull();
    });
  });

  describe("type validation (renderer allow-list)", () => {
    it("rejects missing, non-string, and unknown types", () => {
      expect(sanitizeShape(validShape({ type: undefined }))).toBeNull();
      expect(sanitizeShape(validShape({ type: 42 }))).toBeNull();
      expect(sanitizeShape(validShape({ type: "hacker" }))).toBeNull();
      expect(sanitizeShape(validShape({ type: "RECTANGLE" }))).toBeNull(); // case-sensitive
      expect(sanitizeShape(validShape({ type: "" }))).toBeNull();
    });

    it("accepts every type the client renderer knows about", () => {
      // The allow-list lives in protocol.ts; mirror it here so a drift on
      // either side fails this test loudly.
      const allowed = [
        "smart",
        "curve",
        "line",
        "rectangle",
        "ellipse",
        "path",
        "text",
        "group",
      ];
      for (const type of allowed) {
        const result = sanitizeShape(validShape({ type }));
        expect(result?.type, `type "${type}" should be accepted`).toBe(type);
      }
    });
  });

  describe("geom / options validation", () => {
    it("rejects missing or non-object geom", () => {
      expect(sanitizeShape(validShape({ geom: undefined }))).toBeNull();
      expect(sanitizeShape(validShape({ geom: "x" }))).toBeNull();
      expect(sanitizeShape(validShape({ geom: 42 }))).toBeNull();
      expect(sanitizeShape(validShape({ geom: null }))).toBeNull();
      // Note: arrays pass the `typeof === 'object'` check, so they are
      // currently accepted as opaque geom blobs. The README claims "must be
      // objects" — if you want strict object-only, add an Array.isArray()
      // check in protocol.ts and tighten this assertion.
      const arrayGeom = sanitizeShape(validShape({ geom: [1, 2, 3] }));
      expect(arrayGeom?.geom).toEqual([1, 2, 3]);
    });

    it("rejects missing or non-object options", () => {
      expect(sanitizeShape(validShape({ options: undefined }))).toBeNull();
      expect(sanitizeShape(validShape({ options: "x" }))).toBeNull();
      expect(sanitizeShape(validShape({ options: null }))).toBeNull();
      // Same quirk as geom: arrays pass through as opaque options.
      const arrayOptions = sanitizeShape(validShape({ options: [] }));
      expect(arrayOptions?.options).toEqual([]);
    });

    it("passes geom and options through as opaque blobs (server doesn't interpret them)", () => {
      // Whatever garbage the client puts in geom/options survives unchanged —
      // the server's job is just to store and relay.
      const result = sanitizeShape(
        validShape({
          geom: { deeply: { nested: ["stuff", 42, true] } },
          options: { anything: "goes", including: ["arrays"] },
        })
      );
      expect(result?.geom).toEqual({ deeply: { nested: ["stuff", 42, true] } });
      expect(result?.options).toEqual({ anything: "goes", including: ["arrays"] });
    });
  });
});

describe("sanitizePlayerMove", () => {
  function validMove(overrides: Record<string, unknown> = {}) {
    return {
      type: "player-move",
      id: "player-1",
      x: 100,
      y: 200,
      moving: true,
      facing: 1,
      ...overrides,
    };
  }

  it("rejects null, undefined, primitives, and arrays", () => {
    expect(sanitizePlayerMove(null)).toBeNull();
    expect(sanitizePlayerMove(undefined)).toBeNull();
    expect(sanitizePlayerMove("move")).toBeNull();
    expect(sanitizePlayerMove(42)).toBeNull();
    expect(sanitizePlayerMove([])).toBeNull();
  });

  describe("id validation", () => {
    it("rejects missing, empty, non-string, and oversize ids", () => {
      expect(sanitizePlayerMove(validMove({ id: undefined }))).toBeNull();
      expect(sanitizePlayerMove(validMove({ id: "" }))).toBeNull();
      expect(sanitizePlayerMove(validMove({ id: 0 }))).toBeNull();
      expect(sanitizePlayerMove(validMove({ id: "a".repeat(129) }))).toBeNull();
    });

    it("accepts a 128-char id at the boundary", () => {
      expect(sanitizePlayerMove(validMove({ id: "a".repeat(128) }))).not.toBeNull();
    });
  });

  describe("coordinate validation", () => {
    it("rejects non-finite x or y (NaN, Infinity, strings)", () => {
      expect(sanitizePlayerMove(validMove({ x: Number.NaN }))).toBeNull();
      expect(sanitizePlayerMove(validMove({ y: Number.NaN }))).toBeNull();
      expect(sanitizePlayerMove(validMove({ x: Number.POSITIVE_INFINITY }))).toBeNull();
      expect(sanitizePlayerMove(validMove({ y: Number.NEGATIVE_INFINITY }))).toBeNull();
      expect(sanitizePlayerMove(validMove({ x: "abc" }))).toBeNull();
      // "1.5" coerces to a finite number — accepted (server uses Number()).
      expect(sanitizePlayerMove(validMove({ x: "1.5" }))?.x).toBe(1.5);
    });

    it("rejects coords outside ±MAX_PLAYER_COORD", () => {
      const just_over = MAX_PLAYER_COORD + 1;
      const just_under = MAX_PLAYER_COORD - 1;
      expect(sanitizePlayerMove(validMove({ x: just_over }))).toBeNull();
      expect(sanitizePlayerMove(validMove({ x: -just_over }))).toBeNull();
      expect(sanitizePlayerMove(validMove({ y: just_over }))).toBeNull();
      expect(sanitizePlayerMove(validMove({ y: -just_over }))).toBeNull();
      // At the exact boundary (±1,000,000) it is still accepted.
      expect(sanitizePlayerMove(validMove({ x: MAX_PLAYER_COORD }))?.x).toBe(MAX_PLAYER_COORD);
      expect(sanitizePlayerMove(validMove({ x: just_under }))?.x).toBe(just_under);
    });

    it("coerces numeric x/y through Number() so the result is a number", () => {
      const result = sanitizePlayerMove(validMove({ x: "10", y: 20 }));
      expect(result?.x).toBe(10);
      expect(result?.y).toBe(20);
      expect(typeof result?.x).toBe("number");
    });
  });

  describe("facing and moving", () => {
    it("coerces moving to a boolean (any truthy -> true, falsy -> false)", () => {
      expect(sanitizePlayerMove(validMove({ moving: 1 }))?.moving).toBe(true);
      expect(sanitizePlayerMove(validMove({ moving: "yes" }))?.moving).toBe(true);
      expect(sanitizePlayerMove(validMove({ moving: 0 }))?.moving).toBe(false);
      expect(sanitizePlayerMove(validMove({ moving: null }))?.moving).toBe(false);
      expect(sanitizePlayerMove(validMove({ moving: undefined }))?.moving).toBe(false);
    });

    it("normalizes facing to exactly 1 or -1", () => {
      expect(sanitizePlayerMove(validMove({ facing: 1 }))?.facing).toBe(1);
      expect(sanitizePlayerMove(validMove({ facing: -1 }))?.facing).toBe(-1);
      // Anything other than -1 collapses to 1 (server has no "sideways" facing).
      expect(sanitizePlayerMove(validMove({ facing: 0 }))?.facing).toBe(1);
      expect(sanitizePlayerMove(validMove({ facing: 2 }))?.facing).toBe(1);
      expect(sanitizePlayerMove(validMove({ facing: "left" }))?.facing).toBe(1);
      expect(sanitizePlayerMove(validMove({ facing: undefined }))?.facing).toBe(1);
    });
  });

  it("returns a clean record for a valid move", () => {
    const result = sanitizePlayerMove(validMove());
    expect(result).toEqual({
      type: "player-move",
      id: "player-1",
      x: 100,
      y: 200,
      moving: true,
      facing: 1,
    });
  });
});

describe("sanitizePlayer", () => {
  function validPlayer(overrides: Record<string, unknown> = {}) {
    return {
      id: "player-1",
      x: 100,
      y: 200,
      moving: false,
      facing: 1,
      avatar: [],
      ...overrides,
    };
  }

  it("inherits all the move-level validations (id / coords / moving / facing)", () => {
    expect(sanitizePlayer(validPlayer({ id: "" }))).toBeNull();
    expect(sanitizePlayer(validPlayer({ x: NaN }))).toBeNull();
    expect(sanitizePlayer(validPlayer({ y: 9_999_999 }))).toBeNull();
  });

  it("rejects non-array avatars", () => {
    expect(sanitizePlayer(validPlayer({ avatar: undefined }))).toBeNull();
    expect(sanitizePlayer(validPlayer({ avatar: "nope" }))).toBeNull();
    expect(sanitizePlayer(validPlayer({ avatar: { hack: true } }))).toBeNull();
  });

  it("drops invalid entries from the avatar list and keeps the valid ones", () => {
    const result = sanitizePlayer(
      validPlayer({
        avatar: [
          validShape({ id: "good-1" }),
          validShape({ id: "" }), // bad id — dropped
          validShape({ id: "good-2", type: "ellipse" }),
          { id: "no-geom" }, // missing geom — dropped
          "not a shape", // not an object — dropped
        ],
      })
    );
    expect(result?.avatar).toHaveLength(2);
    expect(result?.avatar.map((s) => s.id)).toEqual(["good-1", "good-2"]);
  });

  it(`caps the avatar list at MAX_AVATAR_SHAPES (${MAX_AVATAR_SHAPES})`, () => {
    const tooMany = Array.from({ length: MAX_AVATAR_SHAPES + 50 }, (_, i) =>
      validShape({ id: `shape-${i}` })
    );
    const result = sanitizePlayer(validPlayer({ avatar: tooMany }));
    expect(result?.avatar).toHaveLength(MAX_AVATAR_SHAPES);
    // The first MAX_AVATAR_SHAPES entries are kept, the tail is dropped.
    expect(result?.avatar[0].id).toBe("shape-0");
    expect(result?.avatar[MAX_AVATAR_SHAPES - 1].id).toBe(
      `shape-${MAX_AVATAR_SHAPES - 1}`
    );
  });

  it("returns a fully-normalized player for a valid input", () => {
    const result = sanitizePlayer(
      validPlayer({
        id: "p1",
        x: 0,
        y: 0,
        moving: true,
        facing: -1,
        avatar: [validShape()],
      })
    );
    expect(result).toEqual({
      id: "p1",
      x: 0,
      y: 0,
      moving: true,
      facing: -1,
      avatar: [
        {
          id: "shape-1",
          type: "rectangle",
          geom: { x1: 0, y1: 0, x2: 10, y2: 10 },
          options: { stroke: "#000" },
        },
      ],
    });
  });
});
