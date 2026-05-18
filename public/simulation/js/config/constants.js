/** Victim HP/damage — aligned with demo_player (timeline.json) scale.
 *  hp_max: 5 000–10 000 per victim; damage_per_step: 40–100 per tick.
 *  survival_pct = hp / hp_max × 100 (individual, not cross-victim). */
export const VICTIM_HP_MIN = 5000;
export const VICTIM_HP_RANGE = 5000; // hp_max ∈ [HP_MIN, HP_MIN + HP_RANGE)
export const VICTIM_DMG_MIN = 40;
export const VICTIM_DMG_RANGE = 61; // damage ∈ [DMG_MIN, DMG_MIN + DMG_RANGE)

export function roundScore(value) {
  return Math.round(value * 100) / 100;
}
