/**
 * Unit tests for public/app/room-url.js — the DOM-free room-code parser shared
 * by the browser app and the lobby UI. Pure string logic, so it runs in node.
 *
 * Run with: npm run test:unit
 */
import { describe, expect, it } from "vitest";
import { normalizeRoomCode, parseRoomCode } from "../../public/app/room-url.js";

describe("parseRoomCode", () => {
  it("reads a code from a /r/CODE path", () => {
    expect(parseRoomCode("/r/ABC234", "")).toBe("ABC234");
  });

  it("uppercases a lowercase path code", () => {
    expect(parseRoomCode("/r/abc234", "")).toBe("ABC234");
  });

  it("tolerates a trailing slash", () => {
    expect(parseRoomCode("/r/ABC234/", "")).toBe("ABC234");
  });

  it("falls back to main for a malformed path code", () => {
    expect(parseRoomCode("/r/xx", "")).toBe("main");
    expect(parseRoomCode("/r/ABC2I4", "")).toBe("main"); // ambiguous char
  });

  it("reads a code from ?room= when there is no /r/ path", () => {
    expect(parseRoomCode("/", "?room=ABC234")).toBe("ABC234");
  });

  it("passes through legacy named rooms in ?room=", () => {
    expect(parseRoomCode("/", "?room=main")).toBe("main");
  });

  it("defaults to main on the bare lobby URL", () => {
    expect(parseRoomCode("/", "")).toBe("main");
  });
});

describe("normalizeRoomCode", () => {
  it("trims, uppercases, and validates", () => {
    expect(normalizeRoomCode("  abc234 ")).toBe("ABC234");
  });

  it("returns null for invalid input", () => {
    expect(normalizeRoomCode("nope")).toBeNull();
    expect(normalizeRoomCode("")).toBeNull();
    expect(normalizeRoomCode(undefined)).toBeNull();
  });
});
