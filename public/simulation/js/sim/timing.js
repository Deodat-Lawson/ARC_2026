/** Base simulation pacing (2D + planner ticks). */
export const MS_PER_TICK = 900;

/** Slower auto-step in live Gemma mode so rounds can finish before the next tick. */
export const GEMMA_MS_PER_TICK = 12000;

/** Min wall time between new fleet dialogue cards while auto-run is on. */
export const COT_FEED_AUTO_MIN_MS = 4400;

/** Legacy fallback if `fleet-dialogue-cot.json` omits `feedMaxBlocks`. */
export const COT_FEED_MAX_BLOCKS = 28;
