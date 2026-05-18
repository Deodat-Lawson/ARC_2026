#!/usr/bin/env python3
"""
OpenAI-compatible HTTP bridge for Gemma 4 on LiteRT (Google AI Edge / LiteRT-LM).

Exposes POST /v1/chat/completions so Next.js /api/gemma-chat proxies Gemma 4 E4B on LiteRT.
Multimodal: passes FPV frames as {"type":"image","blob":"<base64>"} per LiteRT-LM docs
(https://github.com/google-ai-edge/LiteRT-LM/blob/main/docs/api/cpp/conversation.md).

Env:
  LITERT_MODEL_PATH     — default: repo_root/models/gemma-4-E4B-it.litertlm
  LITERT_BACKEND        — cpu | gpu (LLM backend, default cpu)
  LITERT_VISION_BACKEND — cpu | gpu (vision tower, default cpu; required for image+blob)
  LITERT_MAX_TOKENS     — default 512 (raise for long completions; bounds worst-case latency)
  LITERT_SERVER_HOST    — default 127.0.0.1
  LITERT_SERVER_PORT    — default 8787
"""

from __future__ import annotations

import json
import logging
import os
import sys
import threading
import time
from pathlib import Path
from typing import Any

# Repository root (parent of scripts/)
REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from flask import Flask, Response, request

from arc_core.perception.gemma_perceiver import DEFAULT_LITERT_MODEL_PATH

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger("litert_openai_server")

app = Flask(__name__)

_inference_lock = threading.Lock()
_engine: Any = None


def _pick_backend(name: str):
    from litert_lm.interfaces import Backend

    return Backend.GPU if name.lower() == "gpu" else Backend.CPU


def get_model_path() -> str:
    return os.environ.get("LITERT_MODEL_PATH", str(DEFAULT_LITERT_MODEL_PATH))


def ensure_model_file(model_path: str) -> None:
    if os.path.isfile(model_path):
        return
    local_dir = os.path.dirname(model_path) or "."
    os.makedirs(local_dir, exist_ok=True)
    logger.info("Downloading Gemma 4 E4B LiteRT weights into %s (large download)…", local_dir)
    try:
        from huggingface_hub import hf_hub_download

        hf_hub_download(
            repo_id="litert-community/gemma-4-E4B-it-litert-lm",
            filename="gemma-4-E4B-it.litertlm",
            local_dir=local_dir,
            local_dir_use_symlinks=False,
        )
    except Exception as e:
        raise RuntimeError(f"Hugging Face download failed: {e}") from e
    if not os.path.isfile(model_path):
        raise RuntimeError(
            f"Model not found at {model_path} after download. "
            "Set LITERT_MODEL_PATH to the downloaded .litertlm file."
        )


def get_engine():
    global _engine
    if _engine is None:
        from litert_lm import Engine

        path = get_model_path()
        ensure_model_file(path)
        main_backend = _pick_backend(os.environ.get("LITERT_BACKEND", "cpu"))
        vision_backend = _pick_backend(os.environ.get("LITERT_VISION_BACKEND", "cpu"))
        max_tok = int(os.environ.get("LITERT_MAX_TOKENS", "512"))
        logger.info(
            "Loading LiteRT Engine (Gemma 4 E4B) backend=%s vision_backend=%s path=%s",
            main_backend.name,
            vision_backend.name,
            path,
        )
        _engine = Engine(
            path,
            backend=main_backend,
            vision_backend=vision_backend,
            max_num_tokens=max_tok,
        )
        logger.info("LiteRT engine ready (multimodal vision enabled).")
    return _engine


DEFAULT_SYSTEM = (
    "You are Gemma 4 on an edge rescue device (LiteRT). "
    "Answer concisely in English unless the user writes in another language."
)


def _strip_data_url_to_blob(url_or_b64: str) -> str:
    """LiteRT expects raw base64 in image.blob (see LiteRT conversation.md)."""
    s = (url_or_b64 or "").strip()
    if s.startswith("data:"):
        if "," not in s:
            return s
        return s.split(",", 1)[1].strip()
    return s


def _list_content_to_text_only(content: list) -> str:
    parts: list[str] = []
    for block in content:
        if not isinstance(block, dict):
            continue
        if block.get("type") == "text":
            parts.append(block.get("text", ""))
        elif block.get("type") == "image_url":
            parts.append("[earlier turn: image omitted from transcript]")
    return "\n".join(parts)


def _message_to_transcript_line(role: str, content) -> str:
    if isinstance(content, str):
        body = content
    elif isinstance(content, list):
        body = _list_content_to_text_only(content)
    else:
        body = str(content or "")
    return f"{role.upper()}: {body}"


def _messages_to_litert_turn(messages: list) -> tuple[str, str | dict]:
    """Return (system_message, user_turn) where user_turn is str or OpenAI-style multimodal dict."""
    if not messages:
        return DEFAULT_SYSTEM, ""

    system = DEFAULT_SYSTEM
    start_idx = 0
    if messages[0].get("role") == "system":
        c0 = messages[0].get("content")
        if isinstance(c0, str):
            system = c0.strip() or system
        elif isinstance(c0, list):
            system = _list_content_to_text_only(c0).strip() or system
        start_idx = 1

    rest = messages[start_idx:]
    if not rest:
        return system, ""

    last = rest[-1]
    prior = rest[:-1]
    history_lines = [_message_to_transcript_line(m.get("role", ""), m.get("content")) for m in prior]
    history_block = "\n".join(history_lines)
    if history_block:
        history_block = "Conversation so far:\n" + history_block + "\n\n"

    if last.get("role") != "user":
        # Rare (e.g. trailing tool message); flatten as text-only user proxy
        body = _message_to_transcript_line(last.get("role", "user"), last.get("content"))
        return system, (history_block + body).strip()

    content = last.get("content")
    text_segments: list[str] = []
    image_blob: str | None = None

    if isinstance(content, list):
        for block in content:
            if not isinstance(block, dict):
                continue
            if block.get("type") == "text":
                text_segments.append(block.get("text", ""))
            elif block.get("type") == "image_url":
                image_url = block.get("image_url")
                u = image_url.get("url", "") if isinstance(image_url, dict) else str(image_url or "")
                blob = _strip_data_url_to_blob(u)
                if blob:
                    image_blob = blob
    else:
        text_segments.append(str(content or ""))

    final_text = history_block + "\n".join(text_segments).strip()
    vision_hint = (
        "Analyze this FPV / aerial frame for disaster response: roads, debris, "
        "smoke, structure damage, and safe approach corridors."
    )
    if image_blob:
        text_for_model = final_text if final_text else vision_hint
        return system, {
            "role": "user",
            "content": [
                {"type": "text", "text": text_for_model},
                {"type": "image", "blob": image_blob},
            ],
        }

    return system, final_text


def _extract_text_from_litert_response(response) -> str:
    if not isinstance(response, dict):
        return str(response).strip() if response is not None else ""
    content = response.get("content", [])
    if isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, dict) and item.get("type") == "text":
                parts.append(item.get("text", ""))
        return "\n".join(parts).strip()
    if isinstance(content, str):
        return content.strip()
    return ""


def _fake_openai_stream(text: str) -> str:
    out = []
    step = 8
    for i in range(0, len(text), step):
        chunk = text[i : i + step]
        payload = json.dumps({"choices": [{"delta": {"content": chunk}}]}, ensure_ascii=False)
        out.append(f"data: {payload}\n\n")
    out.append("data: [DONE]\n\n")
    return "".join(out)


@app.get("/health")
def health():
    try:
        eng = get_engine()
        return {
            "ok": True,
            "backend": "litert",
            "multimodal": True,
            "model_path": get_model_path(),
            "vision_backend": os.environ.get("LITERT_VISION_BACKEND", "cpu"),
            "llm_backend": os.environ.get("LITERT_BACKEND", "cpu"),
            "engine_loaded": eng is not None,
        }
    except Exception as e:
        logger.warning("Health check failed: %s", e)
        return {"ok": False, "backend": "litert", "error": str(e)}, 503


@app.post("/v1/chat/completions")
def chat_completions():
    try:
        body = request.get_json(force=True, silent=False) or {}
    except Exception:
        return {"error": "Invalid JSON"}, 400

    messages = body.get("messages")
    if not isinstance(messages, list) or not messages:
        return {"error": "messages required"}, 400

    stream = bool(body.get("stream", False))
    system, user_turn = _messages_to_litert_turn(messages)

    if isinstance(user_turn, str):
        if not user_turn.strip():
            return {"error": "empty prompt"}, 400
        send_payload: str | dict = user_turn
    else:
        send_payload = user_turn
        if not send_payload.get("content"):
            return {"error": "empty multimodal prompt"}, 400

    try:
        eng = get_engine()
    except Exception as e:
        logger.exception("LiteRT init error")
        return {"error": str(e), "fallback": True}, 503

    t0 = time.perf_counter()
    with _inference_lock:
        try:
            with eng.create_conversation(
                system_message=system,
                automatic_tool_calling=False,
            ) as conv:
                response = conv.send_message(send_payload)
        except Exception as e:
            logger.exception("LiteRT inference failed")
            return {"error": str(e), "fallback": True}, 502

    latency_ms = round((time.perf_counter() - t0) * 1000)
    text = _extract_text_from_litert_response(response)
    if not text:
        return {"error": "Empty model output", "fallback": True}, 502

    if stream:
        return Response(
            _fake_openai_stream(text),
            mimetype="text/event-stream; charset=utf-8",
            headers={
                "Cache-Control": "no-cache, no-transform",
                "Connection": "keep-alive",
                "X-Arc-Latency-Ms": str(latency_ms),
                "X-Arc-Model": "gemma-4-E4B-it-litertlm",
            },
        )

    return {
        "id": "litert-chatcmpl",
        "object": "chat.completion",
        "choices": [{"message": {"role": "assistant", "content": text}}],
        "model": "gemma-4-E4B-it-litertlm",
        "usage": {"total_tokens": None},
        "meta": {"backend": "litert", "latency_ms": latency_ms, "model": "gemma-4-E4B-it-litertlm"},
    }


def main():
    host = os.environ.get("LITERT_SERVER_HOST", "127.0.0.1")
    port = int(os.environ.get("LITERT_SERVER_PORT", "8787"))
    logger.info(
        "LiteRT OpenAI bridge — http://%s:%s/v1/chat/completions  (GET /health)  vision=on",
        host,
        port,
    )
    app.run(host=host, port=port, threaded=False, debug=False)


if __name__ == "__main__":
    main()
