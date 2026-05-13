"use client";

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import {
  BufferAttribute,
  BufferGeometry,
  LineBasicMaterial,
  Mesh,
} from "three";
import {
  COMM_COLORS,
  COMM_EVENTS,
  commLinkEndpoints,
  getLoopTime,
  LOOP_SECONDS,
  CommLink,
} from "./missionTimeline";
import { ASSET_POSITIONS } from "./missionStore";

/**
 * Inter-asset mesh visualization (drones + dogs). Reads asset positions
 * from the shared store (written by DroneSwarm / DogTeam).
 *
 * Three layers:
 *   1. Persistent faint mesh lines between all peer pairs that participate
 *      in the mesh (drone↔drone, dog↔dog, dog↔drone)
 *   2. Per-event packet sphere that travels from sender to receiver
 *   3. Vertical "uplink" beam from relay to command (off-screen up)
 *
 * Mutates BufferGeometry attributes directly per frame.
 */

// The set of peer links to render as always-on faint mesh edges
const PEER_LINKS: CommLink[] = [
  "lead-perception",
  "lead-relay",
  "perception-relay",
  "lead-dog1",
  "perception-dog2",
  "dog1-dog2",
  "dog1-relay",
  "dog2-relay",
];

export function CommBeams() {
  // Persistent mesh line for each peer pair
  const linkRefs = useRef(PEER_LINKS.map(() => makeLine("#5dffb4")));

  // Packet refs — one mesh per COMM_EVENT
  const packetRefs = useRef(
    COMM_EVENTS.map(() => ({ current: null as Mesh | null })),
  );

  useFrame(() => {
    const t = getLoopTime();

    // Per-link activity (max of overlapping events on that link)
    const activity: Record<CommLink, number> = {
      "lead-perception": 0,
      "lead-relay": 0,
      "perception-relay": 0,
      "relay-command": 0,
      "lead-dog1": 0,
      "perception-dog2": 0,
      "dog1-dog2": 0,
      "dog1-relay": 0,
      "dog2-relay": 0,
    };
    COMM_EVENTS.forEach((ev) => {
      let e = t - ev.t;
      if (e < 0) e += LOOP_SECONDS;
      if (e >= 0 && e < ev.duration) {
        const intensity = Math.sin((e / ev.duration) * Math.PI);
        activity[ev.link] = Math.max(activity[ev.link], intensity);
      }
    });

    // Update each persistent peer link
    PEER_LINKS.forEach((link, i) => {
      const lineState = linkRefs.current[i];
      const [a, b] = endpointsFor(link);
      updateLine(lineState, a, b, activity[link]);
    });

    // Update each comm event packet
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
      const [aArr, bArr] = endpointsFor(ev.link);
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
      {PEER_LINKS.map((link, i) => (
        <line key={link}>
          <primitive object={linkRefs.current[i].geometry} attach="geometry" />
          <primitive object={linkRefs.current[i].material} attach="material" />
        </line>
      ))}

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

      {/* Vertical uplink to command */}
      <RelayToCommandBeam />
    </group>
  );
}

// ---- helpers ----

function endpointsFor(link: CommLink): [[number, number, number], [number, number, number]] {
  const lp = ASSET_POSITIONS.lead;
  const pp = ASSET_POSITIONS.perception;
  const rp = ASSET_POSITIONS.relay;
  const d1 = ASSET_POSITIONS.dog1;
  const d2 = ASSET_POSITIONS.dog2;
  return commLinkEndpoints(
    link,
    [lp.x, lp.y, lp.z],
    [pp.x, pp.y, pp.z],
    [rp.x, rp.y, rp.z],
    [d1.x, d1.y, d1.z],
    [d2.x, d2.y, d2.z],
  );
}

function makeLine(color: string) {
  const positions = new Float32Array(6);
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  const material = new LineBasicMaterial({
    color,
    transparent: true,
    opacity: 0.12,
    depthWrite: false,
  });
  return { geometry, material, positions };
}

function updateLine(
  link: { geometry: BufferGeometry; material: LineBasicMaterial; positions: Float32Array },
  a: [number, number, number],
  b: [number, number, number],
  activity: number,
) {
  const p = link.positions;
  p[0] = a[0];
  p[1] = a[1];
  p[2] = a[2];
  p[3] = b[0];
  p[4] = b[1];
  p[5] = b[2];
  (link.geometry.attributes.position as BufferAttribute).needsUpdate = true;
  link.material.opacity = 0.12 + activity * 0.78;
  link.geometry.boundingSphere = null;
  link.geometry.boundingBox = null;
}

// ---- Relay → Command vertical beam ----

function RelayToCommandBeam() {
  const link = useMemo(() => makeLine("#ff7a40"), []);
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

    const r = ASSET_POSITIONS.relay;
    const topY = r.y + 26;
    updateLine(link, [r.x, r.y, r.z], [r.x, topY, r.z], activity);

    if (packetRef.current) {
      if (!active) {
        packetRef.current.visible = false;
      } else {
        packetRef.current.visible = true;
        packetRef.current.position.set(
          r.x,
          r.y + (topY - r.y) * progress,
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
