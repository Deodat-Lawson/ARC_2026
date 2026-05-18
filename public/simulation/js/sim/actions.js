/** Agent motion and mission_plan execution (grid step). */

import { nearCell, roundCoord } from "./math.js";
import { currentScenePreset } from "../config/presets.js";
import { avoidBuildingStep, markDroneOverflight } from "./motion-avoid.js";
import { moveWildfireRoutedToward } from "./path-planners.js";

export function isGroundAgentType(type) {
  const t = String(type || "").toLowerCase();
  return t === "ground_rescue" || t === "ground_clear" || t === "ground_armored" || t === "ugv";
}

/** In wildfire, air assets also dodge burn footprint rects on the tac grid (see wildfireBurnAvoidanceRects). */
function avoidsBurnAndBuildingRects(agent) {
  if (isGroundAgentType(agent.type)) return true;
  if (currentScenePreset === "wildfire") {
    const t = String(agent.type || "").toLowerCase();
    if (t === "drone" || t === "balloon") return true;
  }
  return false;
}

export function moveAgentToward(agent, target, state, getBuildingRects) {
  if (!target) return;
  const [x, y] = agent.location;
  const dx = target[0] - x;
  const dy = target[1] - y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 0.05) return;
  const speed = agent.speed || 1;
  const scale = Math.min(speed, dist) / dist;
  let next = [roundCoord(x + dx * scale), roundCoord(y + dy * scale)];
  if (avoidsBurnAndBuildingRects(agent)) {
    next = avoidBuildingStep(agent.location, next, target, speed, state, getBuildingRects);
  }
  markDroneOverflight(agent, agent.location, next, state, getBuildingRects);
  agent.location = next;
}

function syncPackedBalloons(state) {
  for (const balloon of state.agents.filter((a) => a.type === "balloon" && a.status === "packed")) {
    const carrier = state.agents.find((a) => a.id === balloon.carrier_id);
    if (carrier) balloon.location = [...carrier.location];
  }
}

/**
 * @param {object} state
 * @param {object[]} actions
 * @param {object} deps
 * @param {(agent: object, targetCell: number[], targetKey: string) => void} deps.moveAgentOnRoad
 * @param {(agent: object) => boolean} deps.agentUsesRoadRouting
 * @param {(agent: object) => boolean} [deps.agentUsesIndustrialGrid]
 * @param {(agent: object, targetCell: number[], targetKey: string) => void} [deps.moveAgentOnIndustrialGrid]
 * @param {(state: object) => Array} deps.getBuildingRects  buildingAvoidanceRects from 3D scenario geometry
 */
export function executeActions(state, actions, deps) {
  const {
    moveAgentOnRoad,
    agentUsesRoadRouting,
    agentUsesIndustrialGrid = () => false,
    moveAgentOnIndustrialGrid,
    getBuildingRects,
  } = deps;

  function dispatchMove(agent, targetCell, targetKey) {
    if (currentScenePreset === "wildfire") {
      moveWildfireRoutedToward(agent, targetCell, state, getBuildingRects, targetKey);
      return;
    }
    if (currentScenePreset === "industrial" && agentUsesIndustrialGrid(agent)) {
      if (moveAgentOnIndustrialGrid) moveAgentOnIndustrialGrid(agent, targetCell, targetKey);
      else moveAgentToward(agent, targetCell, state, getBuildingRects);
      return;
    }
    if (agentUsesRoadRouting(agent)) {
      moveAgentOnRoad(agent, targetCell, targetKey);
      return;
    }
    moveAgentToward(agent, targetCell, state, getBuildingRects);
  }

  syncPackedBalloons(state);

  for (const action of actions) {
    const agent = state.agents.find((item) => item.id === action.agent);
    if (!agent || agent.status === "sacrificed" || agent.status === "packed") continue;

    if (action.task === "clear_blockade") {
      const blockade = state.map.blocked_cells.find((item) => item.id === action.target);
      if (blockade && blockade.status === "blocked") {
        blockade.clear_progress = Math.min(
          blockade.repair_cost,
          blockade.clear_progress + (agent.clear_rate || 0),
        );
        if (blockade.clear_progress >= blockade.repair_cost) blockade.status = "cleared";
      }
    }

    if (action.target?.startsWith("V")) {
      const victim = state.victims.find((item) => item.id === action.target);
      if (!victim) continue;
      const rk = `${action.agent}|${action.task}|${action.target}`;
      dispatchMove(agent, victim.location, rk);
      if (
        agent.type === "drone" &&
        victim.status === "unknown" &&
        nearCell(agent.location, victim.location, 3)
      ) {
        victim.status = "trapped";
      }
      const isGroundRescuer =
        agent.type === "ground_rescue" ||
        agent.type === "ground_armored" ||
        agent.type === "ground_clear";
      if (
        isGroundRescuer &&
        (victim.status === "trapped" || victim.status === "unknown") &&
        nearCell(agent.location, victim.location, 1.5)
      ) {
        victim.status = "rescued";
        state.rescued += 1;
        agent._rescueTarget = null;
      }
    } else if (action.target?.startsWith("Relay-")) {
      const relayPos = action._relayPos ?? [
        Math.round(state.map.size[0] * 0.47),
        Math.round(state.map.size[1] * 0.37),
      ];
      const rk = `${action.agent}|${action.task}|${action.target}`;
      dispatchMove(agent, relayPos, rk);
    } else if (action.task === "deploy_balloon") {
      const balloon = state.agents.find((item) => item.id === action.target);
      if (!balloon || balloon.status !== "packed") continue;
      const relayPos = action._relayPos ?? [
        Math.round(state.map.size[0] * 0.47),
        Math.round(state.map.size[1] * 0.37),
      ];
      const rk = `${action.agent}|${action.task}|${action.target}`;
      dispatchMove(agent, relayPos, rk);
      balloon.location = [...agent.location];
      if (nearCell(agent.location, relayPos, 1.5)) {
        balloon.status = "deployed";
        balloon.deployed = true;
        balloon.carrier_id = null;
        balloon.location = [...relayPos];
      }
    } else if (action.task === "sacrificial_relay" || action.target?.startsWith("Sacrifice-")) {
      const relayPos = action._relayPos ?? [
        Math.round(state.map.size[0] * 0.47),
        Math.round(state.map.size[1] * 0.37),
      ];
      const rk = `${action.agent}|${action.task}|${action.target}`;
      dispatchMove(agent, relayPos, rk);
      if (nearCell(agent.location, relayPos, 1.5)) {
        agent.status = "sacrificed";
        agent.role = "sacrificed_relay";
        agent.battery = 0;
      }
    } else if (action.target?.startsWith("K")) {
      const blockade = state.map.blocked_cells.find((item) => item.id === action.target);
      if (!blockade) continue;
      const rk = `${action.agent}|${action.task}|${action.target}`;
      dispatchMove(agent, blockade.location, rk);
    }

    if (agent.status !== "sacrificed") {
      agent.battery = Math.max(0, agent.battery - (agent.type === "drone" ? 0.1 : 0.05));
    }
  }

  syncPackedBalloons(state);
}
