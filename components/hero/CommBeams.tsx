"use client";

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import {
  BufferAttribute,
  BufferGeometry,
  LineBasicMaterial,
  Mesh,
  Vector3,
} from "three";
import {
  applyWaypointLerp,
  COMM_COLORS,
  COMM_EVENTS,
  commLinkEndpoints,
  DRONE_WAYPOINTS,
  getLoopTime,
  LOOP_SECONDS,
} from "./missionTimeline";

/**
 * Inter-drone mesh visualization.
 *
 *   • 3 persistent thin lines between the 3 drones (idle mesh topology)
 *     — opacity floor at ~0.12, surges to ~0.9 when a comm event runs
 *     along that link
 *   • Per-event packet sphere that travels from sender to receiver during
 *     the event window, colored by message kind
 *
 * Geometry is rebuilt each frame via direct BufferGeometry mutation
 * (bypassing drei Line's prop-based re-build).
 */
export function CommBeams() {
  // Position scratch
  const lead = useRef(new Vector3());
  const perception = useRef(new Vector3());
  const relay = useRef(new Vector3());

  // 3 idle lines (line-pair: each is two endpoints in a Float32Array(6))
  const lpLine = useLink();
  const lrLine = useLink();
  const prLine = useLink();

  // Packet refs — one mesh per COMM_EVENT
  const packetRefs = useRef(
    COMM_EVENTS.map(() => ({ current: null as Mesh | null })),
  );

  useFrame(() => {
    const t = getLoopTime();
    applyWaypointLerp(lead.current, DRONE_WAYPOINTS.lead, t);
    applyWaypointLerp(perception.current, DRONE_WAYPOINTS.perception, t);
    applyWaypointLerp(relay.current, DRONE_WAYPOINTS.relay, t);

    // Compute per-link activity: 1 if a comm event is running along it
    let actLP = 0;
    let actLR = 0;
    let actPR = 0;
    COMM_EVENTS.forEach((ev) => {
      let e = t - ev.t;
      if (e < 0) e += LOOP_SECONDS;
      if (e >= 0 && e < ev.duration) {
        const intensity = Math.sin((e / ev.duration) * Math.PI); // 0→1→0 over event
        if (ev.link === "lead-perception") actLP = Math.max(actLP, intensity);
        else if (ev.link === "lead-relay") actLR = Math.max(actLR, intensity);
        else if (ev.link === "perception-relay") actPR = Math.max(actPR, intensity);
        // relay-command isn't a peer link; we render it as a vertical beam below
      }
    });

    updateLink(lpLine, lead.current, perception.current, actLP);
    updateLink(lrLine, lead.current, relay.current, actLR);
    updateLink(prLine, perception.current, relay.current, actPR);

    // Update each packet
    COMM_EVENTS.forEach((ev, i) => {
      const mesh = packetRefs.current[i].current;
      if (!mesh) return;
      let e = t - ev.t;
      if (e < 0) e += LOOP_SECONDS;
      const active = e >= 0 && e < ev.duration;
      if (!active) {
        mesh.visible = false;
        return;
      }
      const [aArr, bArr] = commLinkEndpoints(
        ev.link,
        [lead.current.x, lead.current.y, lead.current.z],
        [perception.current.x, perception.current.y, perception.current.z],
        [relay.current.x, relay.current.y, relay.current.z],
      );
      const progress = e / ev.duration;
      mesh.position.set(
        aArr[0] + (bArr[0] - aArr[0]) * progress,
        aArr[1] + (bArr[1] - aArr[1]) * progress,
        aArr[2] + (bArr[2] - aArr[2]) * progress,
      );
      mesh.visible = true;
    });
  });

  return (
    <group>
      <line>
        <primitive object={lpLine.geometry} attach="geometry" />
        <primitive object={lpLine.material} attach="material" />
      </line>
      <line>
        <primitive object={lrLine.geometry} attach="geometry" />
        <primitive object={lrLine.material} attach="material" />
      </line>
      <line>
        <primitive object={prLine.geometry} attach="geometry" />
        <primitive object={prLine.material} attach="material" />
      </line>

      {COMM_EVENTS.map((ev, i) => (
        <mesh
          key={`pkt${i}`}
          ref={(el) => {
            packetRefs.current[i].current = el;
          }}
          visible={false}
        >
          <sphereGeometry args={[0.16, 12, 12]} />
          <meshStandardMaterial
            color={COMM_COLORS[ev.kind]}
            emissive={COMM_COLORS[ev.kind]}
            emissiveIntensity={5}
            toneMapped={false}
          />
        </mesh>
      ))}

      {/* Relay → Command vertical beam (rendered as a vertical line beyond the
          relay drone, shooting up off-screen during the relay-command event) */}
      <RelayToCommandBeam relay={relay} />
    </group>
  );
}

// ---- Helpers ----

function useLink() {
  return useMemo(() => {
    const positions = new Float32Array(6);
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(positions, 3));
    const material = new LineBasicMaterial({
      color: 0x5dffb4,
      transparent: true,
      opacity: 0.12,
      depthWrite: false,
    });
    return { geometry, material, positions };
  }, []);
}

function updateLink(
  link: { geometry: BufferGeometry; material: LineBasicMaterial; positions: Float32Array },
  a: Vector3,
  b: Vector3,
  activity: number,
) {
  const p = link.positions;
  p[0] = a.x;
  p[1] = a.y;
  p[2] = a.z;
  p[3] = b.x;
  p[4] = b.y;
  p[5] = b.z;
  (link.geometry.attributes.position as BufferAttribute).needsUpdate = true;
  link.material.opacity = 0.12 + activity * 0.78;
}

// ---- Relay → Command vertical beam ----

function RelayToCommandBeam({ relay }: { relay: React.MutableRefObject<Vector3> }) {
  const link = useLink();

  // Override the idle color to a slightly different command tone (orange)
  useMemo(() => {
    link.material.color.set("#ff7a40");
  }, [link]);

  const packetRef = useRef<Mesh>(null);

  useFrame(() => {
    const t = getLoopTime();
    let activity = 0;
    let progress = 0;
    let active = false;
    COMM_EVENTS.forEach((ev) => {
      if (ev.link !== "relay-command") return;
      let e = t - ev.t;
      if (e < 0) e += LOOP_SECONDS;
      if (e >= 0 && e < ev.duration) {
        activity = Math.sin((e / ev.duration) * Math.PI);
        progress = e / ev.duration;
        active = true;
      }
    });

    const r = relay.current;
    const top = new Vector3(r.x, r.y + 26, r.z);
    updateLink(link, r, top, activity);

    if (packetRef.current) {
      if (!active) {
        packetRef.current.visible = false;
      } else {
        packetRef.current.visible = true;
        packetRef.current.position.set(
          r.x,
          r.y + (top.y - r.y) * progress,
          r.z,
        );
      }
    }
  });

  return (
    <group>
      <line>
        <primitive object={link.geometry} attach="geometry" />
        <primitive object={link.material} attach="material" />
      </line>
      <mesh ref={packetRef} visible={false}>
        <sphereGeometry args={[0.22, 12, 12]} />
        <meshStandardMaterial
          color="#ff7a40"
          emissive="#ff7a40"
          emissiveIntensity={6}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}
