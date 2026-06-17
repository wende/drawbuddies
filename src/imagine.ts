/**
 * "Imagine" feature: LLM -> SVG generation.
 *
 * Stateless POST /imagine endpoint that proxies a prompt to the configured LLM
 * (Z.ai or Minimax) and returns a generated SVG. Keeps the API key server-side
 * and never touches the Durable Object.
 */

import type { Env } from './protocol';

// Both providers speak the OpenAI-style chat-completions shape (messages, model,
// temperature, max_tokens; reply in choices[0].message.content), so the request
// and parsing are shared — only the URL, key, model and a couple of tweaks differ.
const MINIMAX_URL = 'https://api.minimax.io/v1/text/chatcompletion_v2';
const DEFAULT_MINIMAX_MODEL = 'MiniMax-M3';

// Z.ai (Zhipu GLM) Coding Plan, OpenAI-compatible endpoint.
const ZAI_URL = 'https://api.z.ai/api/coding/paas/v4/chat/completions';
const DEFAULT_ZAI_MODEL = 'glm-4.7';

const IMAGINE_TIMEOUT_MS = 45_000;
const MAX_PROMPT_LENGTH = 500;
const MAX_SVG_BYTES = 100_000;
const IMAGINE_MAX_TOKENS = 16_000;

// Steer the model toward a single, self-contained SVG built from the simple
// primitives the client's SVG->rough.js converter understands.
const IMAGINE_SYSTEM_PROMPT = `You are an SVG illustrator for a hand-drawn collaborative whiteboard.
Respond with a SINGLE self-contained <svg> element and nothing else — no prose, no markdown, no code fences.
Rules:
- Use only these elements: path, line, rect, circle, ellipse, polyline, polygon.
- Use a viewBox of "0 0 512 512". Do not set width/height attributes.
- Draw with stroked outlines. Use fill sparingly and only when it meaningfully represents the subject (e.g. a red apple, a blue sky). Most shapes should have no fill or fill="none".
- Set stroke and fill colors directly as attributes (e.g. stroke="#333" fill="#e74c3c"). Default to stroke="#333" when color is not meaningful.
- Draw the object itself only — no background, no shadow, no border frame, no decorative surround.
- Do NOT use the transform attribute. Bake every position and rotation directly into the coordinates.
- Do NOT use: <text>, <image>, <use>, <defs>, gradients, filters, masks, clip-paths, CSS <style>, or inline style attributes.
- Keep paths simple (M/L/C/Q/Z commands). Aim for a clean line drawing, not a photo.`;

// Lightweight per-IP throttle. Module-scope state lives per isolate, so this is a
// best-effort guard against runaway cost, not a global rate limiter.
const IMAGINE_WINDOW_MS = 60_000;
const IMAGINE_MAX_PER_WINDOW = 10;
const imagineHits = new Map<string, number[]>();

function imagineRateLimited(ip: string): boolean {
  const now = Date.now();
  if (imagineHits.size > 1000) {
    for (const [key, times] of imagineHits.entries()) {
      const active = times.filter((t) => now - t < IMAGINE_WINDOW_MS);
      if (active.length === 0) {
        imagineHits.delete(key);
      } else if (active.length !== times.length) {
        imagineHits.set(key, active);
      }
    }
  }
  const recent = (imagineHits.get(ip) || []).filter((t) => now - t < IMAGINE_WINDOW_MS);
  if (recent.length === 0) {
    imagineHits.delete(ip);
  }
  if (recent.length >= IMAGINE_MAX_PER_WINDOW) {
    imagineHits.set(ip, recent);
    return true;
  }
  recent.push(now);
  imagineHits.set(ip, recent);
  return false;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Pull a single <svg>...</svg> out of the model's reply, tolerating code fences
// or stray prose. If the model returned bare SVG elements without a wrapper,
// wraps them in a 512×512 viewBox. Returns null if no SVG is present or it is too large.
function extractSvg(content: string): string | null {
  const svgMatch = content.match(/<svg[\s\S]*?<\/svg>/i);
  if (svgMatch) {
    const svg = svgMatch[0];
    return new TextEncoder().encode(svg).length > MAX_SVG_BYTES ? null : svg;
  }

  // Fallback: model omitted the <svg> wrapper and returned bare elements.
  const elemMatch = content.match(/(<(?:path|rect|circle|ellipse|line|polyline|polygon)\b[\s\S]*)/i);
  if (elemMatch) {
    const wrapped = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${elemMatch[1]}</svg>`;
    return new TextEncoder().encode(wrapped).length > MAX_SVG_BYTES ? null : wrapped;
  }

  return null;
}

interface LlmProvider {
  name: string;
  url: string;
  apiKey: string;
  model: string;
  // GLM ships with "thinking" on by default, which is slow; turn it off so the
  // model emits the SVG directly. Ignored by providers that don't use the flag.
  disableThinking?: boolean;
}

// Pick the LLM provider. An explicit IMAGINE_PROVIDER wins; otherwise auto-detect
// from whichever API key is set (Z.ai preferred). Returns null if none configured.
function resolveProvider(env: Env): LlmProvider | null {
  const zai: LlmProvider | null = env.ZAI_API_KEY
    ? {
        name: 'zai',
        url: ZAI_URL,
        apiKey: env.ZAI_API_KEY,
        model: env.ZAI_MODEL || DEFAULT_ZAI_MODEL,
        disableThinking: true,
      }
    : null;
  const minimax: LlmProvider | null = env.MINIMAX_API_KEY
    ? {
        name: 'minimax',
        url: MINIMAX_URL,
        apiKey: env.MINIMAX_API_KEY,
        model: env.MINIMAX_MODEL || DEFAULT_MINIMAX_MODEL,
      }
    : null;

  switch ((env.IMAGINE_PROVIDER || '').toLowerCase()) {
    case 'zai':
      return zai;
    case 'minimax':
      return minimax;
    default:
      return zai || minimax;
  }
}

/**
 * Handle POST /imagine — proxy a prompt to the configured LLM (Z.ai or Minimax)
 * and return the generated SVG. Stateless: does not touch the Durable Object.
 * Keeps the API key server-side.
 */
export async function handleImagine(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }
  const provider = resolveProvider(env);
  if (!provider) {
    console.error('[imagine] No provider configured — set ZAI_API_KEY or MINIMAX_API_KEY');
    return jsonResponse({ error: 'Imagine is not configured' }, 503);
  }

  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  if (imagineRateLimited(ip)) {
    return jsonResponse({ error: 'Too many requests, slow down' }, 429);
  }

  let prompt: unknown;
  try {
    ({ prompt } = (await request.json()) as { prompt?: unknown });
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }
  if (typeof prompt !== 'string' || prompt.trim().length === 0) {
    return jsonResponse({ error: 'A non-empty prompt is required' }, 400);
  }
  if (prompt.length > MAX_PROMPT_LENGTH) {
    return jsonResponse({ error: 'Prompt is too long' }, 400);
  }

  console.log(`[imagine] provider=${provider.name} model=${provider.model} promptLen=${prompt.length}`);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), IMAGINE_TIMEOUT_MS);

  // Reasoning-capable models (M3, GLM) spend tokens thinking before the SVG, so
  // keep max_tokens generous or the answer gets truncated mid-tag.
  const body: Record<string, unknown> = {
    model: provider.model,
    temperature: 0.7,
    max_tokens: IMAGINE_MAX_TOKENS,
    messages: [
      { role: 'system', content: IMAGINE_SYSTEM_PROMPT },
      { role: 'user', content: prompt },
    ],
  };
  if (provider.disableThinking) {
    body.thinking = { type: 'disabled' };
  }

  const fetchStart = Date.now();
  try {
    console.log(`[imagine] fetching ${provider.url}`);
    const upstream = await fetch(provider.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${provider.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    console.log(`[imagine] upstream responded: status=${upstream.status} elapsed=${Date.now() - fetchStart}ms`);

    if (!upstream.ok) {
      const errText = await upstream.text().catch(() => '(unreadable)');
      console.error(`[imagine] upstream error ${upstream.status}: ${errText.slice(0, 300)}`);
      return jsonResponse({ error: 'Upstream model error' }, 502);
    }

    const result = (await upstream.json()) as {
      choices?: { message?: { content?: string; reasoning_content?: string } }[];
    };
    const message = result.choices?.[0]?.message;
    // Final answer lives in content; reasoning models occasionally leave the
    // SVG in reasoning_content, so fall back to it before giving up.
    const content = message?.content || message?.reasoning_content;
    if (typeof content !== 'string') {
      console.error('[imagine] empty model response; choices:', JSON.stringify(result.choices?.slice(0, 1)));
      return jsonResponse({ error: 'Empty model response' }, 502);
    }
    console.log(`[imagine] content received: ${content.length} chars`);

    const svg = extractSvg(content);
    if (!svg) {
      console.error(`[imagine] no usable SVG in response (first 200 chars): ${content.slice(0, 200)}`);
      return jsonResponse({ error: 'Model did not return a usable SVG' }, 502);
    }
    console.log(`[imagine] SVG extracted: ${svg.length} bytes, total elapsed=${Date.now() - fetchStart}ms`);

    return jsonResponse({ svg });
  } catch (err) {
    const elapsed = Date.now() - fetchStart;
    if (err instanceof Error && err.name === 'AbortError') {
      console.error(`[imagine] timed out after ${elapsed}ms (limit=${IMAGINE_TIMEOUT_MS}ms)`);
      return jsonResponse({ error: 'Model request timed out' }, 504);
    }
    console.error(`[imagine] fetch failed after ${elapsed}ms:`, err);
    return jsonResponse({ error: 'Failed to reach the model' }, 502);
  } finally {
    clearTimeout(timeout);
  }
}
