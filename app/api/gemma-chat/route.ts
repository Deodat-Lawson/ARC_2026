import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** LiteRT-only path: scripts/litert_openai_server.py (Gemma 4 E4B). */
const LITERT_OPENAI_BASE_URL = process.env.LITERT_OPENAI_BASE_URL?.replace(/\/$/, "");

const GEMMA4_EDGE_MODEL = "gemma-4-E4B-it-litertlm";

function litertConfigured(): boolean {
  return Boolean(LITERT_OPENAI_BASE_URL);
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
  if (!LITERT_OPENAI_BASE_URL) {
    throw new Error("LITERT_OPENAI_BASE_URL is not configured");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);

  try {
    const res = await fetch(`${LITERT_OPENAI_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer litert",
      },
      body: JSON.stringify({
        model: GEMMA4_EDGE_MODEL,
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
  if (!litertConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        backend: "litert",
        error: "Set LITERT_OPENAI_BASE_URL=http://127.0.0.1:8787/v1 and run scripts/litert_openai_server.py",
      },
      { status: 503 }
    );
  }

  const health = litertHealthUrl();
  if (!health) {
    return NextResponse.json({ ok: false, backend: "litert", error: "Invalid LITERT_OPENAI_BASE_URL" }, { status: 503 });
  }

  try {
    const r = await fetch(health, { cache: "no-store" });
    const body = (await r.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      model_path?: string;
    };
    if (r.ok && body.ok === true) {
      return NextResponse.json({
        ok: true,
        backend: "litert",
        model: GEMMA4_EDGE_MODEL,
        model_path: body.model_path,
      });
    }
    return NextResponse.json(
      { ok: false, backend: "litert", error: body.error || r.statusText },
      { status: 503 }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "LiteRT health check failed";
    return NextResponse.json({ ok: false, backend: "litert", error: msg }, { status: 503 });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!litertConfigured()) {
    return NextResponse.json(
      {
        fallback: true,
        error: "LITERT_OPENAI_BASE_URL not configured",
        meta: { backend: "none", mode: "unconfigured" },
      },
      { status: 503 }
    );
  }

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
  const t0 = performance.now();

  try {
    const upstream = await upstreamChat(messages, stream);

    if (!upstream.ok) {
      const errText = await upstream.text().catch(() => "");
      const latency_ms = Math.round(performance.now() - t0);
      return NextResponse.json(
        {
          fallback: true,
          error: `LiteRT bridge error ${upstream.status}`,
          detail: errText.slice(0, 200),
          meta: { backend: "litert", latency_ms, model: GEMMA4_EDGE_MODEL },
        },
        { status: 502 }
      );
    }

    if (stream) {
      const latency_ms = Math.round(performance.now() - t0);
      const headers = new Headers({
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Arc-Backend": "litert",
        "X-Arc-Latency-Ms": String(latency_ms),
        "X-Arc-Model": GEMMA4_EDGE_MODEL,
      });
      return new NextResponse(upstream.body, { status: 200, headers });
    }

    const data = (await upstream.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
      meta?: { latency_ms?: number };
    };
    const content = data.choices?.[0]?.message?.content?.trim() ?? "";
    const upstreamLatency = data.meta?.latency_ms;
    const latency_ms = Math.round(
      typeof upstreamLatency === "number" ? upstreamLatency : performance.now() - t0
    );
    const usage = data.usage;
    const tokens =
      usage?.total_tokens ??
      (usage?.prompt_tokens != null && usage?.completion_tokens != null
        ? usage.prompt_tokens + usage.completion_tokens
        : undefined);

    if (!content) {
      return NextResponse.json(
        {
          fallback: true,
          error: "Empty model response",
          meta: { backend: "litert", latency_ms, model: GEMMA4_EDGE_MODEL, tokens: tokens ?? null },
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      content,
      agent,
      fallback: false,
      meta: {
        backend: "litert",
        mode: "litert",
        latency_ms,
        model: GEMMA4_EDGE_MODEL,
        tokens: tokens ?? null,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Proxy error";
    const latency_ms = Math.round(performance.now() - t0);
    return NextResponse.json(
      {
        fallback: true,
        error: msg,
        meta: { backend: "litert", latency_ms, model: GEMMA4_EDGE_MODEL },
      },
      { status: 502 }
    );
  }
}
