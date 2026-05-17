/** Per-timestep world updates (victims, blockades). */

export function updateVictims(state) {
  for (const victim of state.victims) {
    if (victim.status === "trapped" || victim.status === "unknown") {
      victim.hp = Math.max(0, victim.hp - victim.damage_per_step);
      if (victim.hp === 0) victim.status = "dead";
    }
    victim.survival_pct = parseFloat(((victim.hp / victim.hp_max) * 100).toFixed(1));
  }
}

export function updateBlockades(state) {
  for (const blockade of state.map.blocked_cells) {
    if (blockade.clear_progress >= blockade.repair_cost) blockade.status = "cleared";
  }
}
