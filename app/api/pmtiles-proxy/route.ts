import { NextRequest, NextResponse } from "next/server";

/** Same archive as the static demo player; upstream often returns 200+full body for Range (invalid for PMTiles). */
const UPSTREAM_PMTILES =
  "https://pmtiles.io/protomaps(vector)ODbL_firenze.pmtiles";

export const dynamic = "force-dynamic";

let cachedBuffer: ArrayBuffer | null = null;
let cachePromise: Promise<ArrayBuffer> | null = null;
let cachedEtag: string | null = null;

async function getArchiveBuffer(): Promise<ArrayBuffer> {
  if (cachedBuffer) return cachedBuffer;
  if (cachePromise) return cachePromise;

  cachePromise = (async () => {
    const res = await fetch(UPSTREAM_PMTILES, { cache: "no-store" });
    if (!res.ok) {
      throw new Error(`Upstream PMTiles fetch failed: ${res.status}`);
    }
    cachedEtag = res.headers.get("etag");
    cachedBuffer = await res.arrayBuffer();
    return cachedBuffer;
  })();

  try {
    return await cachePromise;
  } finally {
    cachePromise = null;
  }
}

/**
 * Serves byte ranges from the Firenze PMTiles archive with proper 206 responses
 * so the browser PMTiles client (which rejects 200+wrong length for ranged reads) works.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const range = request.headers.get("range");

  try {
    const full = await getArchiveBuffer();
    const total = full.byteLength;

    if (!range) {
      const headers = new Headers({
        "Content-Type": "application/octet-stream",
        "Content-Length": String(total),
        AcceptRanges: "bytes",
      });
      if (cachedEtag) headers.set("etag", cachedEtag);
      return new NextResponse(full, {
        status: 200,
        headers,
      });
    }

    const m = /^bytes=(\d+)-(\d+)$/.exec(range);
    if (!m) {
      return NextResponse.json({ error: "Invalid Range" }, { status: 400 });
    }

    const start = Number(m[1]);
    const end = Math.min(Number(m[2]), total - 1);
    if (start > end || start < 0) {
      return new NextResponse(null, {
        status: 416,
        headers: {
          "Content-Range": `bytes */${total}`,
        },
      });
    }

    const slice = full.slice(start, end + 1);
    const headers = new Headers({
      "Content-Type": "application/octet-stream",
      "Content-Length": String(slice.byteLength),
      "Content-Range": `bytes ${start}-${end}/${total}`,
      AcceptRanges: "bytes",
    });
    if (cachedEtag) headers.set("etag", cachedEtag);

    return new NextResponse(slice, { status: 206, headers });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Proxy error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
