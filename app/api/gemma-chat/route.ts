import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** When set (e.g. http://127.0.0.1:8787/v1), all chat traffic uses LiteRT Gemma 4 E4B (scripts/litert_openai_server.py). */
const LITERT_OPENAI_BASE_URL = process.env.LITERT_OPENAI_BASE_URL?.replace(/\/$/, "");

const LMSTUDIO_BASE_URL =
  process.env.LMSTUDIO_BASE_URL?.replace(/\/$/, "") || "http://localhost:1234/v1";

function upstreamChatBaseUrl(): string {
  return LITERT_OPENAI_BASE_URL || LMSTUDIO_BASE_URL;
}

function litertHealthUrl(): string | null {
  if (!LITERT_OPENAI_BASE_URL) return null;
  const root = LITERT_OPENAI_BASE_URL.replace(/\/v1\/?$/i, "");
  return `${root}/health`;
}

const AGENT_PROMPTS: Record<string, string> = {
  Drone_Alpha:
    "You are Drone_Alpha, a frontline reconnaissance UAV. Report aerial visual intelligence: road damage, obstacles, access corridors. Be objective and concise, under 60 words. English only.",
  Track_Beta:
    "You are Track_Beta, a heavy tracked ground vehicle. Assess surface stability, aftershock risk, and passability using visual intel from the drone. Be concise, under 60 words. English only.",
  Relay_Gamma:
    "You are Relay_Gamma, a high-altitude relay UAV and fleet coordinator. Synthesize visual and ground assessments into a concrete coordinated movement plan. Be concise, under 60 words. English only.",
  Orchestrator:
    "You are Gemma 4 mesh orchestrator for urban disaster rescue. Think step by step: ingest grid state, rank victims, check comms and battery, then emit task policy. Show brief reasoning before the decision. Under 120 words. English only.",
};

type HistoryMessage = { role: "user" | "assistant"; content: string };

type ChatMessage =
  | { role: "system" | "user" | "assistant"; content: string }
  | {
      role: "user";
      content: Array<
        | { type: "text"; text: string }
        | { type: "image_url"; image_url: { url: string } }
      >;
    };

function buildMessages(
  agent: string,
  message: string,
  history: HistoryMessage[],
  imageBase64?: string
): ChatMessage[] {
  const system = AGENT_PROMPTS[agent] ?? AGENT_PROMPTS.Orchestrator;
  const messages: ChatMessage[] = [{ role: "system", content: system }];

  for (const h of history) {
    if (h.role === "user" || h.role === "assistant") {
      messages.push({ role: h.role, content: h.content });
    }
  }

  if (imageBase64) {
    const url = imageBase64.startsWith("data:")
      ? imageBase64
      : `data:image/jpeg;base64,${imageBase64}`;
    messages.push({
      role: "user",
      content: [
        { type: "text", text: message },
        { type: "image_url", image_url: { url } },
      ],
    });
  } else {
    messages.push({ role: "user", content: message });
  }

  return messages;
}

async function upstreamChat(
  messages: ChatMessage[],
  stream: boolean
): Promise<Response> {
  const base = upstreamChatBaseUrl();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);

  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer lm-studio",
      },
      body: JSON.stringify({
        model: LITERT_OPENAI_BASE_URL ? "gemma-4-E4B-it-litertlm" : "local-model",
        messages,
        temperature: 0.4,
        stream,
      }),
      signal: controller.signal,
    });
    return res;
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET(): Promise<NextResponse> {
  const health = litertHealthUrl();
  if (health) {
    try {
      const r = await fetch(health, { cache: "no-store" });
      const body = (await r.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        backend?: string;
        model_path?: string;
      };
      if (r.ok && body.ok === true) {
        return NextResponse.json({
          ok: true,
          backend: "litert",
          model_path: body.model_path,
        });
      }
      return NextResponse.json(
        { ok: false, backend: "litert", error: body.error || r.statusText },
        { status: 503 }
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Health check failed";
      return NextResponse.json({ ok: false, backend: "litert", error: msg }, { status: 503 });
    }
  }

  const base = LMSTUDIO_BASE_URL;
  try {
    const r = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer lm-studio",
      },
      body: JSON.stringify({
        model: "local-model",
        messages: [{ role: "user", content: "Reply with exactly: OK" }],
        temperature: 0,
        max_tokens: 8,
        stream: false,
      }),
    });
    if (!r.ok) {
      return NextResponse.json(
        { ok: false, backend: "lm-studio", error: `HTTP ${r.status}` },
        { status: 503 }
      );
    }
    const data = (await r.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const text = data.choices?.[0]?.message?.content ?? "";
    const ok = /ok/i.test(text);
    return NextResponse.json({ ok, backend: "lm-studio" }, { status: ok ? 200 : 503 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "LM Studio unreachable";
    return NextResponse.json({ ok: false, backend: "lm-studio", error: msg }, { status: 503 });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: {
    agent?: string;
    message?: string;
    history?: HistoryMessage[];
    image_base64?: string;
    stream?: boolean;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ fallback: true, error: "Invalid JSON body" }, { status: 400 });
  }

  const agent = body.agent ?? "Orchestrator";
  const message = body.message?.trim();
  if (!message) {
    return NextResponse.json({ fallback: true, error: "message is required" }, { status: 400 });
  }

  if (!AGENT_PROMPTS[agent]) {
    return NextResponse.json({ fallback: true, error: `Unknown agent: ${agent}` }, { status: 400 });
  }

  const history = Array.isArray(body.history) ? body.history : [];
  const stream = Boolean(body.stream);
  const messages = buildMessages(agent, message, history, body.image_base64);

  try {
    const upstream = await upstreamChat(messages, stream);

    if (!upstream.ok) {
      const errText = await upstream.text().catch(() => "");
      const label = LITERT_OPENAI_BASE_URL ? "LiteRT bridge" : "LM Studio";
      return NextResponse.json(
        {
          fallback: true,
          error: `${label} error ${upstream.status}`,
          detail: errText.slice(0, 200),
        },
        { status: 502 }
      );
    }

    if (stream) {
      const headers = new Headers({
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      });
      return new NextResponse(upstream.body, { status: 200, headers });
    }

    const data = (await upstream.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content?.trim() ?? "";
    if (!content) {
      return NextResponse.json({ fallback: true, error: "Empty model response" }, { status: 502 });
    }

    return NextResponse.json({ content, agent, fallback: false });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Proxy error";
    return NextResponse.json({ fallback: true, error: msg }, { status: 502 });
  }
}
