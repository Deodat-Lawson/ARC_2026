#!/usr/bin/env bash
# Benchmark /api/gemma-chat latency. Run with the LiteRT bridge and Next.js dev
# server both up:
#   python scripts/litert_openai_server.py
#   pnpm dev
#   bash scripts/bench_gemma.sh
#
# Reports per-call latency (X-Arc-Latency-Ms) for each agent and prints
# min / median / max across the runs. Pure curl + awk; no extra deps.

set -u

BASE_URL="${BENCH_BASE_URL:-http://127.0.0.1:3000}"
ENDPOINT="${BASE_URL%/}/api/gemma-chat"
RUNS="${BENCH_RUNS:-3}"

agents=(Orchestrator Drone_Alpha Track_Beta Relay_Gamma)
prompts=(
  "Heartbeat T+007. Three trapped victims; one drone at 60% battery. Emit task policy."
  "FPV frame ingested. Collapsed two-story residential, debris partially blocks the south approach. Assess."
  "Drone reports clear corridor north, debris south. Surface is fractured slab. Assess UGV passability."
  "Drone: north corridor clear. Beta: slab unstable, lateral approach safer. Issue movement orders."
)

# 384x384 white JPEG as a base64 placeholder for the drone vision call.
TINY_IMG_B64="$(printf '%s' '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwA/8AH/2Q==')"

run_one() {
  local agent="$1"
  local prompt="$2"
  local image_b64="$3"

  local body
  if [ -n "$image_b64" ]; then
    body=$(printf '{"agent":"%s","message":"%s","history":[],"image_base64":"%s"}' \
      "$agent" "$prompt" "$image_b64")
  else
    body=$(printf '{"agent":"%s","message":"%s","history":[]}' "$agent" "$prompt")
  fi

  curl -sS -D - -o /tmp/bench_gemma_body.$$ \
    -H 'Content-Type: application/json' \
    -X POST "$ENDPOINT" \
    --data "$body" \
  | awk 'BEGIN{IGNORECASE=1} /^x-arc-latency-ms:/ {gsub(/[^0-9]/, "", $2); print $2}'
  rm -f /tmp/bench_gemma_body.$$
}

stats() {
  awk '
    { n++; a[n] = $1; sum += $1; if (n == 1 || $1 < min) min = $1; if ($1 > max) max = $1 }
    END {
      if (n == 0) { print "  (no samples)"; exit }
      asort(a)
      mid = int((n+1)/2)
      med = (n % 2 == 1) ? a[mid] : (a[mid] + a[mid+1]) / 2
      printf "  n=%d  min=%dms  median=%dms  max=%dms  mean=%dms\n", n, min, med, max, sum/n
    }
  '
}

echo "Benchmark: $ENDPOINT   runs=$RUNS"
echo

all_samples=""

for i in "${!agents[@]}"; do
  agent="${agents[$i]}"
  prompt="${prompts[$i]}"
  img=""
  if [ "$agent" = "Drone_Alpha" ]; then img="$TINY_IMG_B64"; fi

  echo "── $agent ──"
  samples=""
  for ((r=1; r<=RUNS; r++)); do
    ms=$(run_one "$agent" "$prompt" "$img" || true)
    ms="${ms:-?}"
    printf "  run %d: %s ms\n" "$r" "$ms"
    if [[ "$ms" =~ ^[0-9]+$ ]]; then
      samples+="$ms"$'\n'
      all_samples+="$ms"$'\n'
    fi
  done
  printf '%s' "$samples" | stats
  echo
done

echo "── overall ──"
printf '%s' "$all_samples" | stats
