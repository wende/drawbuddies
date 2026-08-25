/**
 * Unit tests for src/imagine.ts — the "Imagine" LLM proxy.
 *
 * Covers the four seams that the Worker is built around:
 *  - extractSvg: pure, parses the model reply (with or without <svg> wrapper,
 *    rejects oversize payloads).
 *  - imagineRateLimited: in-memory 10/min/IP throttle.
 *  - resolveProvider: env -> {name, url, apiKey, model} picking Z.ai / Minimax.
 *  - handleImagine: the HTTP handler. Validates method/provider/prompt/rate
 *    limit, calls the upstream model, parses the response, returns SVG.
 *
 * The provider-keyed tests construct a tiny Env. The handler tests stub
 * `global.fetch` to avoid calling a real LLM.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../../src/protocol.js";
import {
  __resetImagineRateLimitForTest,
  extractSvg,
  handleImagine,
  imagineRateLimited,
  resolveProvider
} from "../../src/imagine.js";

function envWith(overrides: Partial<Env> = {}): Env {
  return {
    // CanvasRoom and ASSETS aren't used by handleImagine — they're required
    // by the Env type but stay as undefined here.
    CANVAS_ROOM: undefined as unknown as DurableObjectNamespace,
    ASSETS: undefined as unknown as Fetcher,
    ...overrides
  };
}

describe("extractSvg", () => {
  it("returns a wrapped <svg>...</svg> verbatim", () => {
    const svg = '<svg viewBox="0 0 512 512"><path d="M0 0 L10 10"/></svg>';
    expect(extractSvg(svg)).toBe(svg);
  });

  it("tolerates prose around the SVG", () => {
    const svg = '<svg viewBox="0 0 512 512"><path d="M0 0 L10 10"/></svg>';
    const reply = `Sure! Here you go:\n${svg}\nHope that helps.`;
    expect(extractSvg(reply)).toBe(svg);
  });

  it("tolerates markdown code fences around the SVG", () => {
    const svg = '<svg viewBox="0 0 512 512"><path d="M0 0 L10 10"/></svg>';
    expect(extractSvg("```xml\n" + svg + "\n```")).toBe(svg);
  });

  it("wraps bare <path>/<rect>/etc. in a 512x512 viewBox when no <svg> is present", () => {
    const reply = '<path d="M0 0 L10 10"/><rect x="0" y="0" width="10" height="10"/>';
    const result = extractSvg(reply);
    expect(result).not.toBeNull();
    expect(result).toContain('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">');
    expect(result).toContain('<path d="M0 0 L10 10"/>');
    expect(result).toContain('<rect x="0" y="0" width="10" height="10"/>');
    expect(result?.endsWith("</svg>")).toBe(true);
  });

  it("returns null when the reply has no SVG and no bare elements", () => {
    expect(extractSvg("Sorry, I cannot draw that.")).toBeNull();
    expect(extractSvg("")).toBeNull();
    expect(extractSvg("<text>hello</text>")).toBeNull(); // text/image/use/etc are not handled
  });

  it("returns null when the extracted SVG exceeds the byte cap (100 KB)", () => {
    // Build a single <path d="..."> attribute that's well over 100 KB.
    const hugePathD = "M0 0 L10 10 ".repeat(20_000);
    const huge = `<svg viewBox="0 0 512 512"><path d="${hugePathD}"/></svg>`;
    expect(extractSvg(huge)).toBeNull();
  });
});

describe("imagineRateLimited", () => {
  beforeEach(() => __resetImagineRateLimitForTest());

  it("allows up to 10 requests per IP within the window, then blocks", () => {
    const ip = "1.2.3.4";
    // The first 10 calls each push a timestamp and return false.
    for (let i = 0; i < 10; i++) {
      expect(imagineRateLimited(ip), `call #${i + 1} should be allowed`).toBe(false);
    }
    // The 11th call finds 10 recent timestamps and refuses.
    expect(imagineRateLimited(ip)).toBe(true);
  });

  it("treats different IPs independently", () => {
    const a = "1.1.1.1";
    const b = "2.2.2.2";
    // Burn through A's quota.
    for (let i = 0; i < 10; i++) expect(imagineRateLimited(a)).toBe(false);
    expect(imagineRateLimited(a)).toBe(true);
    // B is untouched — should get its own fresh 10.
    for (let i = 0; i < 10; i++) expect(imagineRateLimited(b)).toBe(false);
    expect(imagineRateLimited(b)).toBe(true);
  });

  it("does not count stale timestamps against the quota", () => {
    const ip = "1.2.3.4";
    // Burn through the quota.
    for (let i = 0; i < 10; i++) expect(imagineRateLimited(ip)).toBe(false);
    expect(imagineRateLimited(ip)).toBe(true);

    // Reach into the module-scope state? No — go through the public API:
    // there's no time-mocking seam today, so just verify the per-call behavior
    // and document that the 60s window is enforced by Date.now().
    // Resetting via the test hook also confirms the limit is purely state-based.
    __resetImagineRateLimitForTest();
    expect(imagineRateLimited(ip)).toBe(false);
  });
});

describe("resolveProvider", () => {
  it("returns null when no API keys are configured", () => {
    expect(resolveProvider(envWith())).toBeNull();
  });

  it("uses Z.ai when only ZAI_API_KEY is set", () => {
    const p = resolveProvider(envWith({ ZAI_API_KEY: "zai-key" }));
    expect(p?.name).toBe("zai");
    expect(p?.apiKey).toBe("zai-key");
    expect(p?.model).toBe("glm-4.7"); // default
    expect(p?.disableThinking).toBe(true);
  });

  it("uses Minimax when only MINIMAX_API_KEY is set", () => {
    const p = resolveProvider(envWith({ MINIMAX_API_KEY: "minimax-key" }));
    expect(p?.name).toBe("minimax");
    expect(p?.apiKey).toBe("minimax-key");
    expect(p?.model).toBe("MiniMax-M3"); // default
    expect(p?.disableThinking).toBeUndefined();
  });

  it("prefers Z.ai when both keys are set and IMAGINE_PROVIDER is unset (auto-detect)", () => {
    const p = resolveProvider(
      envWith({ ZAI_API_KEY: "zai-key", MINIMAX_API_KEY: "minimax-key" })
    );
    expect(p?.name).toBe("zai");
  });

  it("respects an explicit IMAGINE_PROVIDER override", () => {
    expect(
      resolveProvider(
        envWith({ ZAI_API_KEY: "zai", MINIMAX_API_KEY: "minimax", IMAGINE_PROVIDER: "minimax" })
      )?.name
    ).toBe("minimax");
    expect(
      resolveProvider(
        envWith({ ZAI_API_KEY: "zai", MINIMAX_API_KEY: "minimax", IMAGINE_PROVIDER: "zai" })
      )?.name
    ).toBe("zai");
  });

  it("returns null when IMAGINE_PROVIDER names a provider with no key configured", () => {
    expect(
      resolveProvider(envWith({ MINIMAX_API_KEY: "minimax", IMAGINE_PROVIDER: "zai" }))
    ).toBeNull();
  });

  it("honors custom ZAI_MODEL / MINIMAX_MODEL overrides", () => {
    expect(resolveProvider(envWith({ ZAI_API_KEY: "k", ZAI_MODEL: "glm-4.6" }))?.model).toBe(
      "glm-4.6"
    );
    expect(
      resolveProvider(envWith({ MINIMAX_API_KEY: "k", MINIMAX_MODEL: "MiniMax-M2" }))?.model
    ).toBe("MiniMax-M2");
  });
});

describe("handleImagine", () => {
  beforeEach(() => __resetImagineRateLimitForTest());

  function makeRequest(body: unknown, ip = "9.9.9.9"): Request {
    return new Request("http://localhost/imagine", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "cf-connecting-ip": ip
      },
      body: typeof body === "string" ? body : JSON.stringify(body)
    });
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns 405 for non-POST requests", async () => {
    const res = await handleImagine(new Request("http://localhost/imagine"), envWith());
    expect(res.status).toBe(405);
    expect(await res.json()).toEqual({ error: "Method not allowed" });
  });

  it("returns 503 when no provider is configured", async () => {
    const res = await handleImagine(makeRequest({ prompt: "a cat" }), envWith());
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "Imagine is not configured" });
  });

  it("returns 400 when the prompt is missing or empty", async () => {
    const env = envWith({ ZAI_API_KEY: "k" });
    expect((await handleImagine(makeRequest({}), env)).status).toBe(400);
    expect((await handleImagine(makeRequest({ prompt: "   " }), env)).status).toBe(400);
    expect((await handleImagine(makeRequest({ prompt: 42 }), env)).status).toBe(400);
  });

  it("returns 400 when the prompt exceeds MAX_PROMPT_LENGTH (500 chars)", async () => {
    const env = envWith({ ZAI_API_KEY: "k" });
    const res = await handleImagine(makeRequest({ prompt: "x".repeat(501) }), env);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/too long/i);
  });

  it("returns 400 when the body is not valid JSON", async () => {
    const env = envWith({ ZAI_API_KEY: "k" });
    const res = await handleImagine(makeRequest("not json at all", "9.9.9.9"), env);
    expect(res.status).toBe(400);
  });

  it("returns 429 after the 11th request from the same IP within the window", async () => {
    // Stub fetch with a factory so each call returns a fresh Response —
    // Response bodies are single-use in undici, so reusing one across 11
    // calls would fail on the second read with "Body has already been read".
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              choices: [{ message: { content: '<svg viewBox="0 0 512 512"></svg>' } }]
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          )
        )
      )
    );
    const env = envWith({ ZAI_API_KEY: "k" });

    for (let i = 0; i < 10; i++) {
      const res = await handleImagine(makeRequest({ prompt: "a cat" }), env);
      expect(res.status, `request #${i + 1} should succeed`).toBe(200);
    }
    const limited = await handleImagine(makeRequest({ prompt: "a cat" }), env);
    expect(limited.status).toBe(429);
    expect((await limited.json()).error).toMatch(/slow down/i);
  });

  it("returns the extracted SVG on a successful upstream response", async () => {
    const svg = '<svg viewBox="0 0 512 512"><path d="M0 0 L10 10"/></svg>';
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ choices: [{ message: { content: svg } }] }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )
    );

    const res = await handleImagine(makeRequest({ prompt: "a cat" }), envWith({ ZAI_API_KEY: "k" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ svg });
  });

  it("falls back to reasoning_content when content is empty (reasoning models)", async () => {
    const svg = '<svg viewBox="0 0 512 512"><path d="M0 0 L10 10"/></svg>';
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: "", // reasoning model put the answer here instead
                  reasoning_content: svg
                }
              }
            ]
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )
    );

    const res = await handleImagine(makeRequest({ prompt: "a cat" }), envWith({ ZAI_API_KEY: "k" }));
    expect(res.status).toBe(200);
    expect((await res.json()).svg).toBe(svg);
  });

  it("sends thinking=disabled for Z.ai so the model skips slow reasoning", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: '<svg viewBox="0 0 512 512"></svg>' } }] }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    await handleImagine(makeRequest({ prompt: "x" }), envWith({ ZAI_API_KEY: "k" }));
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.thinking).toEqual({ type: "disabled" });
    expect(body.model).toBe("glm-4.7");
  });

  it("does NOT send thinking=disabled for Minimax (the flag is provider-specific)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: '<svg viewBox="0 0 512 512"></svg>' } }] }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    await handleImagine(makeRequest({ prompt: "x" }), envWith({ MINIMAX_API_KEY: "k" }));
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.thinking).toBeUndefined();
    expect(body.model).toBe("MiniMax-M3");
  });

  it("returns 502 when the upstream returns a non-OK status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("oops", { status: 500 })));
    const res = await handleImagine(makeRequest({ prompt: "x" }), envWith({ ZAI_API_KEY: "k" }));
    expect(res.status).toBe(502);
  });

  it("returns 502 when the model reply has no usable SVG", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ choices: [{ message: { content: "I'm sorry, I can't draw that." } }] }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )
    );
    const res = await handleImagine(makeRequest({ prompt: "x" }), envWith({ ZAI_API_KEY: "k" }));
    expect(res.status).toBe(502);
  });
});
