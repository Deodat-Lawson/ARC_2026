/** Base simulation pacing. At cell_size_m=10 and agent.speed=3, this gives a
 *  ~6.25 m/s (22 km/h) drone — slowed 50% from the original 2400ms pace for
 *  closer visual inspection of the post-quake city. */
export const MS_PER_TICK = 4800;

/** Slower auto-step in live Gemma mode so rounds can finish before the next tick. */
export const GEMMA_MS_PER_TICK = 12000;

/** Min wall time between new fleet dialogue cards while auto-run is on. */
export const COT_FEED_AUTO_MIN_MS = 4400;

/** Legacy fallback if `fleet-dialogue-cot.json` omits `feedMaxBlocks`. */
export const COT_FEED_MAX_BLOCKS = 28;
