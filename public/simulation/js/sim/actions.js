/** Agent motion and mission_plan execution (grid step). */

import { pointNearBuilding } from "./collision.js";
import { nearCell, roundCoord } from "./math.js";
import { currentScenePreset } from "../config/presets.js";

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

export function avoidBuildingStep(from, proposed, target, speed, state, getBuildingRects) {
  if (!state?.map) return proposed;
  const rects = getBuildingRects(state);
  if (!pointNearBuilding(proposed[0], proposed[1], rects, 0.36)) return proposed;
  const [x, y] = from;
  const candidates = [
    [x + speed, y],
    [x - speed, y],
    [x, y + speed],
    [x, y - speed],
    [x + speed * 0.7, y + speed * 0.7],
    [x + speed * 0.7, y - speed * 0.7],
    [x - speed * 0.7, y + speed * 0.7],
    [x - speed * 0.7, y - speed * 0.7],
  ]
    .map(([cx, cy]) => [roundCoord(cx), roundCoord(cy)])
    .filter(([cx, cy]) => {
      const [cols, rows] = state.map.size;
      return (
        cx >= 0 &&
        cy >= 0 &&
        cx <= cols - 1 &&
        cy <= rows - 1 &&
        !pointNearBuilding(cx, cy, rects, 0.36)
      );
    });
  if (!candidates.length) return from;
  candidates.sort((a, b) => {
    const da = Math.hypot(a[0] - target[0], a[1] - target[1]);
    const db = Math.hypot(b[0] - target[0], b[1] - target[1]);
    return da - db;
  });
  return candidates[0];
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
  agent.location = next;
}

/**
 * @param {object} state
 * @param {object[]} actions
 * @param {object} deps
 * @param {(agent: object, targetCell: number[], targetKey: string) => void} deps.moveAgentOnRoad
 * @param {(agent: object) => boolean} deps.agentUsesRoadRouting
 * @param {(state: object) => Array} deps.getBuildingRects  buildingAvoidanceRects from 3D scenario geometry
 */
export function executeActions(state, actions, deps) {
  const { moveAgentOnRoad, agentUsesRoadRouting, getBuildingRects } = deps;
  for (const action of actions) {
    const agent = state.agents.find((item) => item.id === action.agent);
    if (!agent) continue;

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
      if (agentUsesRoadRouting(agent)) {
        moveAgentOnRoad(agent, victim.location, rk);
      } else {
        moveAgentToward(agent, victim.location, state, getBuildingRects);
      }
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
      if (agentUsesRoadRouting(agent)) {
        moveAgentOnRoad(agent, relayPos, rk);
      } else {
        moveAgentToward(agent, relayPos, state, getBuildingRects);
      }
    } else if (action.target?.startsWith("K")) {
      const blockade = state.map.blocked_cells.find((item) => item.id === action.target);
      if (!blockade) continue;
      const rk = `${action.agent}|${action.task}|${action.target}`;
      if (agentUsesRoadRouting(agent)) {
        moveAgentOnRoad(agent, blockade.location, rk);
      } else {
        moveAgentToward(agent, blockade.location, state, getBuildingRects);
      }
    }

    agent.battery = Math.max(0, agent.battery - (agent.type === "drone" ? 0.1 : 0.05));
  }
}
