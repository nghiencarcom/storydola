"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import * as THREE from "three";
import type {
  CreateVideoHighlightColor,
  CreateVideoPalette,
  CreateVideoSceneKind,
  CreateVideoStatItem,
  CreateVideoVector,
} from "../lib/motion-video";

export type MotionThreeStageProps = {
  width: number;
  height: number;
  timeSec: number;
  sceneProgress: number; // 0..1 within current scene
  palette: CreateVideoPalette;
  sceneKind: CreateVideoSceneKind;
  dominantVector: CreateVideoVector;
  stats?: readonly CreateVideoStatItem[];
};

const PALETTE_CONFIG: Record<
  CreateVideoPalette,
  { bgA: string; bgB: string; glowA: string; glowB: string; meshA: number; meshB: number; grid: number }
> = {
  "midnight-cyan": {
    bgA: "#040814",
    bgB: "#0b1933",
    glowA: "rgba(56, 189, 248, 0.36)",
    glowB: "rgba(99, 102, 241, 0.34)",
    meshA: 0x38bdf8,
    meshB: 0x818cf8,
    grid: 0x1e3a5f,
  },
  "aurora-violet": {
    bgA: "#090518",
    bgB: "#1a103d",
    glowA: "rgba(167, 139, 250, 0.38)",
    glowB: "rgba(244, 114, 182, 0.30)",
    meshA: 0xa78bfa,
    meshB: 0xf472b6,
    grid: 0x312063,
  },
  "emerald-tech": {
    bgA: "#03110d",
    bgB: "#082822",
    glowA: "rgba(52, 211, 153, 0.35)",
    glowB: "rgba(56, 189, 248, 0.28)",
    meshA: 0x34d399,
    meshB: 0x38bdf8,
    grid: 0x114237,
  },
  "crimson-energy": {
    bgA: "#14050b",
    bgB: "#2b0c19",
    glowA: "rgba(251, 113, 133, 0.38)",
    glowB: "rgba(251, 191, 36, 0.30)",
    meshA: 0xfb7185,
    meshB: 0xfbbf24,
    grid: 0x4c1729,
  },
  "amber-editorial": {
    bgA: "#120d05",
    bgB: "#261b0a",
    glowA: "rgba(251, 191, 36, 0.34)",
    glowB: "rgba(56, 189, 248, 0.24)",
    meshA: 0xfbbf24,
    meshB: 0x38bdf8,
    grid: 0x423012,
  },
  "slate-minimal": {
    bgA: "#070a12",
    bgB: "#131b2e",
    glowA: "rgba(148, 163, 184, 0.26)",
    glowB: "rgba(99, 102, 241, 0.22)",
    meshA: 0x94a3b8,
    meshB: 0x6366f1,
    grid: 0x243049,
  },
};

function statColorHex(color?: CreateVideoHighlightColor): number {
  if (color === "emerald") return 0x34d399;
  if (color === "rose") return 0xfb7185;
  if (color === "cyan") return 0x38bdf8;
  if (color === "violet") return 0xa78bfa;
  return 0xfbbf24;
}

type ThreeBundle = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  keyLight: THREE.DirectionalLight;
  rimLight: THREE.DirectionalLight;
  gridHelper: THREE.GridHelper;
  heroPrism: THREE.Mesh<THREE.IcosahedronGeometry, THREE.MeshStandardMaterial>;
  accentTorus: THREE.Mesh<THREE.TorusGeometry, THREE.MeshStandardMaterial>;
  particles: Array<{
    mesh: THREE.Mesh<THREE.OctahedronGeometry, THREE.MeshStandardMaterial>;
    baseX: number;
    baseY: number;
    baseZ: number;
    speed: number;
  }>;
  barsGroup: THREE.Group;
  barMeshes: Array<THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>>;
  lastPalette: CreateVideoPalette;
};

export function MotionVideoThreeStage({
  width,
  height,
  timeSec,
  sceneProgress,
  palette,
  sceneKind,
  dominantVector,
  stats,
}: MotionThreeStageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bundleRef = useRef<ThreeBundle | null>(null);
  const cfg = PALETTE_CONFIG[palette] || PALETTE_CONFIG["midnight-cyan"];

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        alpha: true,
        antialias: true,
        preserveDrawingBuffer: true,
        powerPreference: "high-performance",
      });
    } catch {
      return;
    }

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(44, width / Math.max(1, height), 0.1, 60);

    const ambient = new THREE.AmbientLight(0xffffff, 0.85);
    scene.add(ambient);

    const keyLight = new THREE.DirectionalLight(0xe0f2fe, 1.55);
    keyLight.position.set(4, 6, 5);
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0xfbbf24, 0.95);
    rimLight.position.set(-4, -2, 4);
    scene.add(rimLight);

    const gridHelper = new THREE.GridHelper(22, 22, cfg.meshA, cfg.grid);
    gridHelper.position.set(0, -2.55, -2.5);
    scene.add(gridHelper);

    const heroPrism = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.72, 0),
      new THREE.MeshStandardMaterial({
        color: cfg.meshA,
        wireframe: true,
        transparent: true,
        opacity: 0.34,
      }),
    );
    scene.add(heroPrism);

    const accentTorus = new THREE.Mesh(
      new THREE.TorusGeometry(0.62, 0.12, 14, 36),
      new THREE.MeshStandardMaterial({
        color: cfg.meshB,
        wireframe: true,
        transparent: true,
        opacity: 0.3,
      }),
    );
    scene.add(accentTorus);

    const particles: ThreeBundle["particles"] = [];
    for (let i = 0; i < 22; i++) {
      const scale = 0.04 + (i % 4) * 0.022;
      const mesh = new THREE.Mesh(
        new THREE.OctahedronGeometry(scale, 0),
        new THREE.MeshStandardMaterial({
          color: i % 2 === 0 ? cfg.meshA : cfg.meshB,
          emissive: i % 2 === 0 ? cfg.meshA : cfg.meshB,
          emissiveIntensity: 0.55,
          transparent: true,
          opacity: 0.58,
        }),
      );
      const baseX = ((i * 41) % 100) / 11 - 4.5;
      const baseY = ((i * 59) % 100) / 13 - 3.8;
      const baseZ = -1.2 - ((i * 31) % 50) / 10;
      scene.add(mesh);
      particles.push({ mesh, baseX, baseY, baseZ, speed: 0.35 + (i % 5) * 0.14 });
    }

    const barsGroup = new THREE.Group();
    const barMeshes: Array<THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>> = [];
    for (let i = 0; i < 4; i++) {
      const bar = new THREE.Mesh(
        new THREE.BoxGeometry(0.68, 1, 0.68),
        new THREE.MeshStandardMaterial({
          color: cfg.meshA,
          roughness: 0.25,
          metalness: 0.55,
          transparent: true,
          opacity: 0.48,
        }),
      );
      barsGroup.add(bar);
      barMeshes.push(bar);
    }
    scene.add(barsGroup);

    bundleRef.current = {
      renderer,
      scene,
      camera,
      keyLight,
      rimLight,
      gridHelper,
      heroPrism,
      accentTorus,
      particles,
      barsGroup,
      barMeshes,
      lastPalette: palette,
    };

    return () => {
      const current = bundleRef.current;
      bundleRef.current = null;
      if (current) {
        current.heroPrism.geometry.dispose();
        current.heroPrism.material.dispose();
        current.accentTorus.geometry.dispose();
        current.accentTorus.material.dispose();
        current.gridHelper.geometry.dispose();
        if (Array.isArray(current.gridHelper.material)) {
          current.gridHelper.material.forEach((m) => m.dispose());
        } else {
          current.gridHelper.material.dispose();
        }
        current.particles.forEach((p) => {
          p.mesh.geometry.dispose();
          p.mesh.material.dispose();
        });
        current.barMeshes.forEach((bm) => {
          bm.geometry.dispose();
          bm.material.dispose();
        });
      }
      renderer.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useLayoutEffect(() => {
    const b = bundleRef.current;
    if (!b) return;

    b.renderer.setSize(width, height, false);
    b.camera.aspect = width / Math.max(1, height);
    b.camera.updateProjectionMatrix();

    const camDriftX = dominantVector === "left" ? (0.5 - sceneProgress) * 0.75 : (sceneProgress - 0.5) * 0.35;
    const camDriftY = dominantVector === "up" ? (sceneProgress - 0.5) * 0.55 : 0.15;
    const camZ = dominantVector === "z-push"
      ? 5.4 - sceneProgress * 0.85
      : dominantVector === "z-pull"
        ? 4.6 + sceneProgress * 0.75
        : 5.1;
    b.camera.position.set(camDriftX, camDriftY, camZ);
    b.camera.lookAt(0, 0, -1.2);

    b.heroPrism.material.color.setHex(cfg.meshA);
    b.accentTorus.material.color.setHex(cfg.meshB);
    b.rimLight.color.setHex(cfg.meshB);

    if (b.lastPalette !== palette) {
      b.scene.remove(b.gridHelper);
      b.gridHelper.geometry.dispose();
      if (Array.isArray(b.gridHelper.material)) {
        b.gridHelper.material.forEach((m) => m.dispose());
      } else {
        b.gridHelper.material.dispose();
      }
      const nextGrid = new THREE.GridHelper(22, 22, cfg.meshA, cfg.grid);
      nextGrid.position.set(0, -2.55, -2.5);
      b.scene.add(nextGrid);
      b.gridHelper = nextGrid;
      b.lastPalette = palette;
    }

    const isPortrait = height > width;
    const spreadX = isPortrait ? 1.85 : 3.15;

    b.heroPrism.position.set(-spreadX, 1.65 - sceneProgress * 0.35, -1.5);
    b.heroPrism.rotation.set(timeSec * 0.42, timeSec * 0.62, 0.18);

    b.accentTorus.position.set(spreadX, -1.55 + sceneProgress * 0.35, -1.7);
    b.accentTorus.rotation.set(timeSec * 0.5, -timeSec * 0.38, 0.4);

    b.gridHelper.visible = sceneKind === "stat_counter_3d" || sceneKind === "browser_3d_showcase";
    b.gridHelper.position.z = -2.5 + ((timeSec * 0.85) % 1);

    for (let i = 0; i < b.particles.length; i++) {
      const p = b.particles[i];
      const travelZ = ((p.baseZ + timeSec * p.speed * 1.4) % 5.5) - 4.2;
      p.mesh.position.set(
        p.baseX * (isPortrait ? 0.68 : 1),
        p.baseY,
        travelZ,
      );
      p.mesh.rotation.set(timeSec * 0.65 + i, timeSec * 0.45, 0);
      p.mesh.material.color.setHex(i % 2 === 0 ? cfg.meshA : cfg.meshB);
      p.mesh.material.emissive.setHex(i % 2 === 0 ? cfg.meshA : cfg.meshB);
    }

    if (sceneKind === "stat_counter_3d" && stats && stats.length > 0) {
      b.barsGroup.visible = true;
      const count = Math.min(4, stats.length);
      const maxVal = Math.max(1, ...stats.slice(0, count).map((s) => Math.abs(s.value)));
      const riseProgress = Math.min(1, Math.max(0.05, sceneProgress / 0.52));
      const easedRise = 1 - Math.pow(1 - riseProgress, 3);
      const spacing = isPortrait ? 0.95 : 1.35;

      for (let i = 0; i < b.barMeshes.length; i++) {
        const mesh = b.barMeshes[i];
        if (i >= count) {
          mesh.visible = false;
          continue;
        }
        mesh.visible = true;
        const item = stats[i];
        const normH = 0.55 + (Math.abs(item.value) / maxVal) * 2.15;
        const h = Math.max(0.12, normH * easedRise);
        const x = (i - (count - 1) / 2) * spacing;
        mesh.scale.set(1, h, 1);
        mesh.position.set(x, -2.35 + h / 2, -1.6);
        mesh.rotation.set(0, -0.28 + sceneProgress * 0.36, 0);
        mesh.material.color.setHex(statColorHex(item.color));
      }
    } else {
      b.barsGroup.visible = false;
    }

    b.renderer.render(b.scene, b.camera);
  }, [width, height, timeSec, sceneProgress, palette, sceneKind, dominantVector, stats, cfg.meshA, cfg.meshB, cfg.grid]);

  const shiftX = Math.round((sceneProgress - 0.5) * 26);
  const shiftY = Math.round((0.5 - sceneProgress) * 20);

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        background: `
          radial-gradient(circle at ${26 + shiftX}% ${24 + shiftY}%, ${cfg.glowA}, transparent 54%),
          radial-gradient(circle at ${76 - shiftX}% ${74 - shiftY}%, ${cfg.glowB}, transparent 56%),
          linear-gradient(145deg, ${cfg.bgA} 0%, ${cfg.bgB} 56%, ${cfg.bgA} 100%)
        `,
      }}
    >
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        style={{ width: "100%", height: "100%", display: "block", pointerEvents: "none" }}
      />
    </div>
  );
}
