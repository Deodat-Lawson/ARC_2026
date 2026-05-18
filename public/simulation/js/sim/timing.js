/** Base simulation pacing. At cell_size_m=10 and agent.speed=3, this gives a
 *  ~12.5 m/s (45 km/h) drone — realistic urban survey pace. */
export const MS_PER_TICK = 2400;

/** Slower auto-step in live Gemma mode so rounds can finish before the next tick. */
export const GEMMA_MS_PER_TICK = 12000;

/** Min wall time between new fleet dialogue cards while auto-run is on. */
export const COT_FEED_AUTO_MIN_MS = 4400;

/** Legacy fallback if `fleet-dialogue-cot.json` omits `feedMaxBlocks`. */
export const COT_FEED_MAX_BLOCKS = 28;
