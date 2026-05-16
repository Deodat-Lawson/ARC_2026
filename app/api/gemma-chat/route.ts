import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const LMSTUDIO_BASE_URL =
  process.env.LMSTUDIO_BASE_URL?.replace(/\/$/, "") || "http://localhost:1234/v1";

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
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);

  try {
    const res = await fetch(`${LMSTUDIO_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer lm-studio",
      },
      body: JSON.stringify({
        model: "local-model",
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
      return NextResponse.json(
        {
          fallback: true,
          error: `LM Studio error ${upstream.status}`,
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
