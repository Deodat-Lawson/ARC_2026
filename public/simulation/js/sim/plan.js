/** Mission planning: victim ranking and commander briefing structure. */

import {
  clamp,
  distance,
  manhattan,
  roundScore,
} from "./math.js";
import { currentScenePreset } from "../config/presets.js";

function isUnavailableAgent(agent) {
  return agent?.status === "sacrificed" || agent?.status === "packed" || agent?.battery <= 0;
}

export function lifeSignalConfidence(victim) {
  return victim.thermal_signal;
}

export function estimatedSurvivalSteps(victim) {
  return victim.damage_per_step <= 0 ? Infinity : victim.hp / victim.damage_per_step;
}

export function urgency(victim, maxSurvivalSteps) {
  return clamp(1 - estimatedSurvivalSteps(victim) / maxSurvivalSteps, 0, 1);
}

export function locationRisk(state, location, agentType) {
  return state.map.risk_zones.reduce((risk, zone) => {
    if (distance(location, zone.center) > zone.radius) return risk;
    if (agentType !== "drone" && zone.type === "fire") return risk + zone.risk;
    return risk + zone.risk * 0.65;
  }, 0);
}

export function isBlockedNear(state, location) {
  return state.map.blocked_cells.some(
    (blockade) => blockade.status === "blocked" && manhattan(blockade.location, location) <= 3,
  );
}

/**
 * Relay anchor along base→offline victim vector (daisy-chain).
 * @param {number} idx
 * @param {Array} offlineVicCandidates ranked candidates with comm !== "available"
 */
export function computeRelayAnchor(state, idx, offlineVicCandidates) {
  const base = state.map.base;
  const [cols, rows] = state.map.size;
  const vCand = offlineVicCandidates[idx % Math.max(1, offlineVicCandidates.length)];
  const vObj = vCand && state.victims.find((v) => v.id === vCand.id);
  if (!vObj) {
    return [
      Math.round(cols * (0.40 + idx * 0.12)),
      Math.round(rows * (0.35 + idx * 0.10)),
    ];
  }
  const t = Math.min(0.55 + idx * 0.18, 0.80);
  return [
    Math.round(base[0] + (vObj.location[0] - base[0]) * t),
    Math.round(base[1] + (vObj.location[1] - base[1]) * t),
  ];
}

export function communicationStatus(state, location) {
  const baseDistance = distance(location, state.map.base);
  const inDeadZone = state.map.communication_dead_zones.some(
    (zone) => distance(location, zone.center) <= zone.radius,
  );
  if (baseDistance <= state.communication.base_range && !inDeadZone) return "available";
  if (baseDistance <= state.communication.base_range || inDeadZone) return "weak";
  return "offline";
}

export function mortalityFactorSummary(victim) {
  const p = victim?.survival_profile || {};
  const age = p.age_group || "adult";
  const injury = p.injury_zone || "unknown injury";
  const env = `${p.temperature_c ?? "?"}C/${p.humidity_pct ?? "?"}% RH/${p.rainfall_mm_h ?? "?"}mm rain`;
  const enclosure = p.enclosure || "unknown enclosure";
  const group = `${p.group_size || 1} trapped`;
  return `${age}, ${injury}, ${env}, ${enclosure}, ${group}`;
}

export function mortalityRiskLabel(victim) {
  const d = victim?.damage_per_step || 0;
  if (d >= 110) return "critical";
  if (d >= 75) return "high";
  if (d >= 45) return "elevated";
  return "guarded";
}

export function makeBrief(candidates, needsRelay, blockade) {
  if (!candidates.length) {
    return "All known victim sites are resolved. Maintain perimeter scanning and prepare extraction reports.";
  }
  const top = candidates[0];
  const relayText = needsRelay
    ? " Because communication is weak, the fleet should establish relay coverage before close approach."
    : "";
  const blockadeText = blockade
    ? ` UGV-2 should continue clearing ${blockade.id} to open the ground corridor.`
    : " Ground corridors are currently open enough for the next move.";
  return `${top.id} is the current priority because it combines a short survival window, ${top.mortality_risk_label} mortality risk, strong life-signal confidence, and acceptable access cost. Drone-1 should confirm the site from above while UGV-1 verifies the safest reachable target.${relayText}${blockadeText}`;
}

export function chooseBestAgent(state, victim) {
  const score = (agent) => {
    const raw = locationRisk(state, victim.location, agent.type);
    const immune = agent.risk_immune || agent.type === "ground_armored";
    return immune ? raw * 0.3 : raw;
  };
  let options = state.agents
    .filter((agent) => !isUnavailableAgent(agent) && agent.role !== "relay" && agent.role !== "clear_blockade")
    .map((agent) => ({
      agent,
      pathRisk: score(agent),
      blocked: agent.type !== "drone" && agent.type !== "balloon" && isBlockedNear(state, victim.location),
    }));
  if (!options.length && state.agents.length) {
    options = state.agents
      .filter((agent) => !isUnavailableAgent(agent))
      .map((agent) => ({
        agent,
        pathRisk: score(agent),
        blocked: agent.type !== "drone" && agent.type !== "balloon" && isBlockedNear(state, victim.location),
      }));
  }
  if (!options.length) {
    return { agent: { id: "—", battery: 0, type: "drone" }, pathRisk: 1, blocked: false };
  }
  return options.sort((a, b) => a.pathRisk - b.pathRisk)[0];
}

export function rankVictims(state) {
  const activeVictims = state.victims.filter((victim) => victim.status !== "dead" && victim.status !== "rescued");
  const confirmedVictims = activeVictims.filter((victim) => victim.status === "trapped");
  const survivalBaseline = confirmedVictims.length ? confirmedVictims : activeVictims;
  const maxSurvival = Math.max(...survivalBaseline.map(estimatedSurvivalSteps), 1);

  return activeVictims
    .map((victim) => {
      const bestAgent = chooseBestAgent(state, victim);
      const distBase = manhattan(state.map.base, victim.location);
      const normalizedDistance = Math.min(1, distBase / 40);
      const accessDifficulty = bestAgent.pathRisk + (bestAgent.blocked ? 0.35 : 0);
      const energyFeasible = bestAgent.agent.battery - distBase * 0.8 >= 5 ? 1 : 0;
      const score =
        0.35 * urgency(victim, maxSurvival) +
        0.25 * lifeSignalConfidence(victim) +
        0.15 * (1 - clamp(accessDifficulty, 0, 1)) +
        0.15 * (1 - normalizedDistance) +
        0.1 * energyFeasible;

      return {
        id: victim.id,
        score: roundScore(score),
        hp: Math.round(victim.hp),
        hp_max: victim.hp_max,
        survival_pct: victim.survival_pct,
        survival_steps: roundScore(estimatedSurvivalSteps(victim)),
        life_signal_confidence: roundScore(lifeSignalConfidence(victim)),
        mortality_factors: mortalityFactorSummary(victim),
        mortality_risk_label: mortalityRiskLabel(victim),
        best_agent: bestAgent.agent.id,
        communication_status: communicationStatus(state, victim.location),
        status: victim.status,
      };
    })
    .sort((a, b) => b.score - a.score);
}

export function generatePlan(state) {
  const candidates = rankVictims(state);
  const allBlockades = state.map.blocked_cells.filter((b) => b.status === "blocked");

  const offlineVics = candidates.filter((c) => c.communication_status !== "available");
  const needsRelay = offlineVics.length > 0 && (offlineVics[0]?.score ?? 0) > 0.3;

  const missionPlan = [];
  const assignedVictimIds = new Set();
  const reservedAgentIds = new Set();
  const activeAgents = state.agents.filter((a) => !isUnavailableAgent(a));
  const packedBalloons = state.agents.filter((a) => a.type === "balloon" && a.status === "packed" && a.carrier_id);
  const activeRelays = activeAgents.filter((a) => a.role === "relay" && (a.type !== "balloon" || a.deployed !== false));
  const sacrificeDrone =
    currentScenePreset === "industrial" &&
    candidates[0] &&
    ((candidates[0].communication_status !== "available" && activeRelays.length === 0) || allBlockades.length > 0)
      ? activeAgents.find((a) => a.type === "drone")
      : null;

  const scouts = activeAgents.filter((a) => a.role === "scout" && a.id !== sacrificeDrone?.id);
  const relays = activeRelays.filter((a) => a.id !== sacrificeDrone?.id);
  const rescues = activeAgents.filter((a) => a.role === "rescue" || a.type === "ground_rescue");
  const clearers = activeAgents.filter((a) => a.role === "clear_blockade" || a.type === "ground_clear");

  if (needsRelay) {
    packedBalloons.forEach((balloon, i) => {
      const carrier = activeAgents.find((a) => a.id === balloon.carrier_id);
      if (!carrier) return;
      const anchor = computeRelayAnchor(state, i, offlineVics);
      missionPlan.push({
        agent: carrier.id,
        task: "deploy_balloon",
        target: balloon.id,
        _relayPos: anchor,
        safety_note: `${balloon.id} is packed on ${carrier.id}; deploy it as a long-duration relay before close approach.`,
      });
      reservedAgentIds.add(carrier.id);
    });
  }

  if (sacrificeDrone) {
    const anchor = computeRelayAnchor(state, 0, offlineVics.length ? offlineVics : candidates);
    missionPlan.push({
      agent: sacrificeDrone.id,
      task: "sacrificial_relay",
      target: `Sacrifice-${candidates[0].id}`,
      _relayPos: anchor,
      safety_note: "Decision hub authorized drone sacrifice: drain the UAV as a one-way relay to improve industrial rescue coverage.",
    });
    reservedAgentIds.add(sacrificeDrone.id);
  }

  scouts.forEach((scout, i) => {
    if (reservedAgentIds.has(scout.id)) return;
    const target = candidates[i] || candidates[candidates.length - 1];
    if (!target) return;
    missionPlan.push({
      agent: scout.id,
      task: "aerial_confirmation",
      target: target.id,
      safety_note: "Keep flight path above blocked roads and avoid prolonged hover over collapse-risk cells.",
    });
  });

  relays.forEach((relay, i) => {
    if (reservedAgentIds.has(relay.id)) return;
    if (!needsRelay) {
      const target = candidates[scouts.length + i] || candidates[candidates.length - 1];
      if (target) {
        missionPlan.push({
          agent: relay.id,
          task: "aerial_confirmation",
          target: target.id,
          safety_note: "No relay needed — acting as supplementary scout.",
        });
      }
      return;
    }
    const anchor = computeRelayAnchor(state, i, offlineVics);
    missionPlan.push({
      agent: relay.id,
      task: "deploy_relay",
      target: `Relay-R${i + 1}`,
      _relayPos: anchor,
      safety_note: "Hold relay coverage between base and the weak communication zone.",
    });
  });

  rescues.forEach((rescue) => {
    if (reservedAgentIds.has(rescue.id)) return;
    const committed = rescue._rescueTarget;
    const committedStill =
      committed &&
      !assignedVictimIds.has(committed) &&
      candidates.find((c) => c.id === committed && c.survival_steps > 0);
    const emergency = candidates.find(
      (c) => c.survival_steps < 3 && !assignedVictimIds.has(c.id) && c.id !== committed,
    );
    const nextBest = candidates.find((c) => !assignedVictimIds.has(c.id));

    const target = emergency || committedStill || nextBest;
    if (!target) return;

    assignedVictimIds.add(target.id);
    rescue._rescueTarget = target.id;
    missionPlan.push({
      agent: rescue.id,
      task: "ground_rescue",
      target: target.id,
      safety_note: "Use the safer corridor and do not enter blocked or extreme collapse-risk cells.",
    });
  });

  clearers.forEach((clearer, i) => {
    if (reservedAgentIds.has(clearer.id)) return;
    const blockade = allBlockades[i];
    if (blockade) {
      missionPlan.push({
        agent: clearer.id,
        task: "clear_blockade",
        target: blockade.id,
        safety_note: "Clear one blockade at a time; parallel clearing is not counted as extra benefit.",
      });
      return;
    }
    const committed = clearer._rescueTarget;
    const committedStill =
      committed &&
      !assignedVictimIds.has(committed) &&
      candidates.find((c) => c.id === committed && c.survival_steps > 0);
    const nextBest = candidates.find((c) => !assignedVictimIds.has(c.id));
    const target = committedStill || nextBest;
    if (!target) return;

    assignedVictimIds.add(target.id);
    clearer._rescueTarget = target.id;
    missionPlan.push({
      agent: clearer.id,
      task: "ground_rescue",
      target: target.id,
      safety_note: "No blockades remaining — assisting rescue operations.",
    });
  });

  const top = candidates[0] ?? null;
  const balloonDeploys = missionPlan.filter((a) => a.task === "deploy_balloon").length;
  const sacrifice = missionPlan.find((a) => a.task === "sacrificial_relay");
  return {
    commander_briefing: makeBrief(candidates, needsRelay && relays.length > 0, allBlockades[0] ?? null),
    priority_order: candidates.map((c) => c.id),
    mission_plan: missionPlan,
    human_confirmation_required: [
      top ? `Approve ground approach to ${top.id}.` : "No active victims.",
      needsRelay
        ? `Confirm relay deployment to cover ${offlineVics.length} offline victim(s).`
        : "Relay not required for current targets.",
      balloonDeploys ? `Confirm UGV balloon deployment for ${balloonDeploys} packed platform(s).` : "",
      sacrifice ? `Authorize sacrifice of ${sacrifice.agent} for industrial relay coverage.` : "",
    ],
  };
}
