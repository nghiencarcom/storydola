"use client";

import { ThreeCanvas } from "@remotion/three";
import { useMemo } from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";

const PARTICLES = Array.from({ length: 18 }, (_, i) => ({
  id: i,
  x: ((i * 37) % 100) / 14 - 3.5,
  y: ((i * 53) % 100) / 16 - 3.1,
  z: -1.5 - ((i * 29) % 40) / 10,
  speed: 0.45 + (i % 5) * 0.16,
  scale: 0.045 + (i % 4) * 0.02,
  color: ["#38bdf8", "#34d399", "#fbbf24", "#818cf8"][i % 4],
}));

export function AutoEditThreeBackdrop({ width, height }: { width: number; height: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;

  const canUseWebGl = useMemo(() => {
    if (typeof document === "undefined") return false;
    try {
      const canvas = document.createElement("canvas");
      return Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl"));
    } catch {
      return false;
    }
  }, []);

  // Aurora Mesh Gradient base + Three.js 3D floating geometric crystals & bokeh particles
  const shiftA = Math.sin(t * 0.7) * 18;
  const shiftB = Math.cos(t * 0.55) * 22;

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        background: `
          radial-gradient(circle at ${28 + shiftA}% ${22 + shiftB * 0.5}%, rgba(56, 189, 248, 0.38), transparent 52%),
          radial-gradient(circle at ${74 - shiftB}% ${76 - shiftA * 0.6}%, rgba(99, 102, 241, 0.42), transparent 55%),
          radial-gradient(circle at ${52 + shiftB * 0.4}% ${48 + shiftA * 0.4}%, rgba(52, 211, 153, 0.24), transparent 48%),
          linear-gradient(145deg, #050814 0%, #0b132b 52%, #090d1a 100%)
        `,
      }}
    >
      {canUseWebGl && (
        <ThreeCanvas
          width={width}
          height={height}
          style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
          camera={{ fov: 45, position: [0, 0, 5] }}
        >
          <ambientLight intensity={0.75} />
          <directionalLight position={[3, 4, 5]} intensity={1.3} color="#e0f2fe" />
          <directionalLight position={[-3, -2, 3]} intensity={0.8} color="#fbbf24" />

          {/* Left floating 3D wireframe icosahedron */}
          <mesh position={[-2.6, 1.55 + Math.sin(t * 1.1) * 0.18, -1.2]} rotation={[t * 0.45, t * 0.65, 0]}>
            <icosahedronGeometry args={[0.52, 0]} />
            <meshStandardMaterial color="#38bdf8" wireframe transparent opacity={0.42} />
          </mesh>

          {/* Right floating 3D torus accent */}
          <mesh position={[2.55, -1.45 + Math.cos(t * 0.95) * 0.2, -1.4]} rotation={[t * 0.55, -t * 0.4, 0.4]}>
            <torusGeometry args={[0.46, 0.11, 12, 32]} />
            <meshStandardMaterial color="#fbbf24" wireframe transparent opacity={0.36} />
          </mesh>

          {/* Deterministic 3D depth particle field */}
          {PARTICLES.map((p) => {
            const y = p.y + Math.sin(t * p.speed + p.id) * 0.28;
            const x = p.x + Math.cos(t * p.speed * 0.8 + p.id) * 0.18;
            return (
              <mesh key={p.id} position={[x, y, p.z]} rotation={[t * 0.6, t * 0.4, 0]}>
                <octahedronGeometry args={[p.scale, 0]} />
                <meshStandardMaterial color={p.color} emissive={p.color} emissiveIntensity={0.6} transparent opacity={0.65} />
              </mesh>
            );
          })}
        </ThreeCanvas>
      )}
    </div>
  );
}
