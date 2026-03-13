import React, { useRef, useCallback, useEffect, useState } from 'react';
import ForceGraph3D from 'react-force-graph-3d';
import * as THREE from 'three';
import type { GraphData, GraphNode } from '../hooks/useGraphData';
import { getIconSprite, getPufferIconSprite } from '../lib/agentIcons';

interface NetworkGraph3DProps {
  graphData: GraphData;
  onNodeClick?: (node: GraphNode) => void;
}

// ── Shared glow texture (warm amber soft circle) ────────
const GLOW_TEX = (() => {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(251,191,36,0.95)');
  g.addColorStop(0.15, 'rgba(251,146,60,0.5)');
  g.addColorStop(0.4, 'rgba(245,158,11,0.12)');
  g.addColorStop(0.7, 'rgba(245,158,11,0.03)');
  g.addColorStop(1, 'rgba(245,158,11,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
})();

// ── Small dot texture for neural mesh particles ─────────
const DOT_TEX = (() => {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(254,243,199,1.0)');
  g.addColorStop(0.2, 'rgba(251,191,36,0.7)');
  g.addColorStop(0.5, 'rgba(251,146,60,0.15)');
  g.addColorStop(1, 'rgba(245,158,11,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
})();

// ── Bokeh texture for out-of-focus background dots ──────
const BOKEH_TEX = (() => {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(59,130,180,0.5)');
  g.addColorStop(0.3, 'rgba(30,64,120,0.2)');
  g.addColorStop(0.6, 'rgba(20,40,80,0.05)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
})();

// ── Nebula textures ─────────────────────────────────────
function makeNebulaTexture(r: number, g: number, b: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const ctx = c.getContext('2d')!;
  const grad = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, `rgba(${r},${g},${b},0.35)`);
  grad.addColorStop(0.3, `rgba(${r},${g},${b},0.12)`);
  grad.addColorStop(0.6, `rgba(${r},${g},${b},0.04)`);
  grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(c);
}

const NEBULA_TEX_BLUE = makeNebulaTexture(6, 80, 160);
const NEBULA_TEX_AMBER = makeNebulaTexture(251, 146, 60);
const NEBULA_TEX_WARM = makeNebulaTexture(200, 120, 30);

// ── Dense neural mesh — decorative particle cloud + lines ─
function createNeuralMesh(): THREE.Group {
  const group = new THREE.Group();
  const MESH_COUNT = 400;
  const SPREAD = 55;
  const positions: THREE.Vector3[] = [];

  // Spread out more, weighted toward center but gentler
  for (let i = 0; i < MESH_COUNT; i++) {
    const r = (Math.random() ** 0.5) * SPREAD;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    positions.push(new THREE.Vector3(
      r * Math.sin(phi) * Math.cos(theta),
      r * Math.sin(phi) * Math.sin(theta) * 0.5,
      r * Math.cos(phi)
    ));
  }

  const posArray = new Float32Array(MESH_COUNT * 3);
  for (let i = 0; i < MESH_COUNT; i++) {
    posArray[i * 3] = positions[i].x;
    posArray[i * 3 + 1] = positions[i].y;
    posArray[i * 3 + 2] = positions[i].z;
  }
  const dotGeo = new THREE.BufferGeometry();
  dotGeo.setAttribute('position', new THREE.Float32BufferAttribute(posArray, 3));

  // Small subtle warm dots
  const dotMat = new THREE.PointsMaterial({
    size: 0.8, map: DOT_TEX, transparent: true, opacity: 0.45,
    sizeAttenuation: true, depthWrite: false,
    blending: THREE.AdditiveBlending, color: 0xfbbf24,
  });
  group.add(new THREE.Points(dotGeo, dotMat));

  // Very soft glow halos — subtle
  const dotMat2 = new THREE.PointsMaterial({
    size: 2.5, map: DOT_TEX, transparent: true, opacity: 0.08,
    sizeAttenuation: true, depthWrite: false,
    blending: THREE.AdditiveBlending, color: 0xf59e0b,
  });
  group.add(new THREE.Points(dotGeo.clone(), dotMat2));

  // Delicate connection lines — fewer, thinner
  const MAX_DIST = 16;
  const lineVerts: number[] = [];
  for (let i = 0; i < MESH_COUNT; i++) {
    let connections = 0;
    for (let j = i + 1; j < MESH_COUNT && connections < 2; j++) {
      const d = positions[i].distanceTo(positions[j]);
      if (d < MAX_DIST && Math.random() < 0.25) {
        lineVerts.push(
          positions[i].x, positions[i].y, positions[i].z,
          positions[j].x, positions[j].y, positions[j].z
        );
        connections++;
      }
    }
  }

  if (lineVerts.length > 0) {
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(lineVerts, 3));
    const lineMat = new THREE.LineBasicMaterial({
      color: 0xfbbf24, transparent: true, opacity: 0.04,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    group.add(new THREE.LineSegments(lineGeo, lineMat));
  }

  return group;
}

// ── Background starfield + bokeh ────────────────────────
function createStarfield(): THREE.Group {
  const group = new THREE.Group();

  const makeLayer = (count: number, rMin: number, rMax: number, size: number, opacity: number, tex: THREE.Texture, color = 0xffffff) => {
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const rad = rMin + Math.random() * (rMax - rMin);
      positions[i * 3]     = rad * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = rad * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = rad * Math.cos(phi);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      size, map: tex, transparent: true, opacity,
      sizeAttenuation: true, depthWrite: false,
      blending: THREE.AdditiveBlending, color,
    });
    return new THREE.Points(geo, mat);
  };

  // Dim distant white stars
  group.add(makeLayer(1200, 120, 350, 1.2, 0.3, DOT_TEX));
  // Blue bokeh background dots — key reference effect (closer + bigger)
  group.add(makeLayer(800, 50, 180, 5.0, 0.45, BOKEH_TEX, 0x4488cc));
  // Large soft blue bokeh (depth of field)
  group.add(makeLayer(300, 40, 150, 10.0, 0.25, BOKEH_TEX, 0x336699));
  // Very large background bokeh blobs
  group.add(makeLayer(100, 60, 200, 18.0, 0.12, BOKEH_TEX, 0x223355));
  // Warm amber scatter in mid-ground
  group.add(makeLayer(500, 45, 160, 2.5, 0.55, DOT_TEX, 0xfbbf24));

  return group;
}

// ── Nebula sprites ──────────────────────────────────────
function createNebulae(): THREE.Group {
  const group = new THREE.Group();
  const configs: { tex: THREE.Texture; pos: [number, number, number]; scale: number; opacity: number }[] = [
    { tex: NEBULA_TEX_AMBER, pos: [-60, 15, -50], scale: 160, opacity: 0.1 },
    { tex: NEBULA_TEX_BLUE,  pos: [ 80, -20,  50], scale: 140, opacity: 0.08 },
    { tex: NEBULA_TEX_AMBER, pos: [ 30,  30,  60], scale: 130, opacity: 0.09 },
    { tex: NEBULA_TEX_BLUE,  pos: [-50, -25, -80], scale: 120, opacity: 0.07 },
    { tex: NEBULA_TEX_WARM,  pos: [ 10, -10,  90], scale: 150, opacity: 0.08 },
    // Central warm ambient glow
    { tex: NEBULA_TEX_AMBER, pos: [0, 0, 0], scale: 80, opacity: 0.12 },
  ];
  for (const { tex, pos, scale, opacity } of configs) {
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: tex, transparent: true, opacity,
        blending: THREE.AdditiveBlending, depthWrite: false,
      })
    );
    sprite.position.set(...pos);
    sprite.scale.set(scale, scale, 1);
    group.add(sprite);
  }
  return group;
}

const ORBIT_RADIUS = 22;

const NetworkGraph3D: React.FC<NetworkGraph3DProps> = ({ graphData, onNodeClick }) => {
  const fgRef = useRef<any>(null);
  const sceneExtrasRef = useRef<THREE.Group[]>([]);
  const meshRef = useRef<THREE.Group | null>(null);
  const [dims, setDims] = useState({ w: window.innerWidth, h: window.innerHeight });

  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    try {
      fg.d3Force('charge')?.strength(-5);
      fg.d3Force('link')?.distance(ORBIT_RADIUS);
      fg.d3Force('center')?.strength(2.0);
    } catch { /* force api not ready */ }
  }, [graphData]);

  // Inject scene extras: starfield, nebulae, neural mesh
  useEffect(() => {
    const t = setTimeout(() => {
      const fg = fgRef.current;
      if (!fg) return;
      try {
        const scene = fg.scene();

        const stars = createStarfield();
        const nebulae = createNebulae();
        const neuralMesh = createNeuralMesh();

        scene.add(stars);
        scene.add(nebulae);
        scene.add(neuralMesh);

        sceneExtrasRef.current = [stars, nebulae];
        meshRef.current = neuralMesh;

        // Very subtle fog — just enough for depth fade
        scene.fog = new THREE.FogExp2(0x030508, 0.0008);
      } catch { /* scene not ready */ }
    }, 800);

    return () => {
      clearTimeout(t);
      const fg = fgRef.current;
      if (!fg) return;
      try {
        const scene = fg.scene();
        for (const grp of sceneExtrasRef.current) {
          scene.remove(grp);
          grp.traverse((obj: any) => {
            obj.geometry?.dispose();
            obj.material?.dispose();
          });
        }
        if (meshRef.current) {
          scene.remove(meshRef.current);
          meshRef.current.traverse((obj: any) => {
            obj.geometry?.dispose();
            obj.material?.dispose();
          });
          meshRef.current = null;
        }
        sceneExtrasRef.current = [];
        scene.fog = null;
      } catch { /* ignore */ }
    };
  }, []);

  // Auto-orbit camera
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;

    fg.cameraPosition({ x: 40, y: 20, z: 40 });

    try {
      const controls = fg.controls();
      if (controls) {
        controls.minDistance = 20;
        controls.maxDistance = 300;
      }
    } catch { /* controls not ready */ }

    let angle = 0;
    const radius = 50;
    let raf: number;
    let orbiting = true;
    let idleTimer: ReturnType<typeof setTimeout> | null = null;

    const orbit = () => {
      if (orbiting) {
        angle += 0.0006;
        fg.cameraPosition({
          x: radius * Math.cos(angle),
          y: 12 + Math.sin(angle * 0.3) * 6,
          z: radius * Math.sin(angle),
        });
      }

      // Slow parallax on starfield
      const [stars, nebulae] = sceneExtrasRef.current;
      if (stars) {
        stars.rotation.y = angle * 0.12;
        if (stars.children[1]) stars.children[1].rotation.y = -angle * 0.06;
      }

      // Nebula pulse
      if (nebulae) {
        nebulae.children.forEach((sprite, i) => {
          const mat = (sprite as THREE.Sprite).material;
          const base = [0.1, 0.08, 0.09, 0.07, 0.08, 0.12][i] ?? 0.08;
          mat.opacity = base + Math.sin(angle * 0.4 + i * 1.3) * 0.02;
        });
      }

      // Slowly rotate neural mesh for organic feel
      if (meshRef.current) {
        meshRef.current.rotation.y = angle * 0.08;
        meshRef.current.rotation.x = Math.sin(angle * 0.2) * 0.03;
      }

      raf = requestAnimationFrame(orbit);
    };

    const pauseOrbit = () => {
      orbiting = false;
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        try {
          const pos = fg.cameraPosition();
          angle = Math.atan2(pos.z, pos.x);
        } catch { /* ignore */ }
        orbiting = true;
      }, 10000);
    };

    const el = fg.renderer()?.domElement as HTMLElement | undefined;
    if (el) {
      el.addEventListener('mousedown', pauseOrbit);
      el.addEventListener('wheel', pauseOrbit);
      el.addEventListener('touchstart', pauseOrbit);
    }

    const t = setTimeout(() => { raf = requestAnimationFrame(orbit); }, 1500);

    return () => {
      clearTimeout(t);
      cancelAnimationFrame(raf);
      if (idleTimer) clearTimeout(idleTimer);
      if (el) {
        el.removeEventListener('mousedown', pauseOrbit);
        el.removeEventListener('wheel', pauseOrbit);
        el.removeEventListener('touchstart', pauseOrbit);
      }
    };
  }, []);

  useEffect(() => {
    const h = () => setDims({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', h);
    return () => window.removeEventListener('resize', h);
  }, []);

  // ── Node rendering — small glowing points ────────────────
  const nodeThreeObject = useCallback((node: GraphNode) => {
    const group = new THREE.Group();

    if (node.type === 'puffer') {
      const R = 1.8;

      // Bright core
      group.add(new THREE.Mesh(
        new THREE.SphereGeometry(R * 0.35, 16, 16),
        new THREE.MeshBasicMaterial({ color: 0xfef3c7, transparent: true, opacity: 0.95 })
      ));

      // Warm shell
      group.add(new THREE.Mesh(
        new THREE.SphereGeometry(R * 0.7, 20, 20),
        new THREE.MeshBasicMaterial({
          color: 0xfbbf24, transparent: true, opacity: 0.5,
          blending: THREE.AdditiveBlending,
        })
      ));

      // Big warm glow
      const glow = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: GLOW_TEX, color: 0xf59e0b,
          transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending,
        })
      );
      glow.scale.set(R * 10, R * 10, 1);
      group.add(glow);

      const icon = getPufferIconSprite(R * 1.2);
      group.add(icon);

      const label = makeLabel('YOUR COMPUTER', '#fcd34d', 8);
      label.position.set(0, R + 2.5, 0);
      group.add(label);

    } else {
      // ─── Small glowing neural point ───
      const r = node.type === 'agent' ? 0.8
        : node.type === 'subagent' ? 0.6
        : node.type === 'mcp' ? 0.55
        : 0.7;

      const nodeCol = new THREE.Color(node.color);
      const brightCol = nodeCol.clone().lerp(new THREE.Color(0xfef3c7), 0.7);

      // Tiny bright core
      group.add(new THREE.Mesh(
        new THREE.SphereGeometry(r * 0.4, 12, 12),
        new THREE.MeshBasicMaterial({ color: brightCol, transparent: true, opacity: 0.95 })
      ));

      // Soft additive shell
      group.add(new THREE.Mesh(
        new THREE.SphereGeometry(r, 14, 14),
        new THREE.MeshBasicMaterial({
          color: nodeCol, transparent: true, opacity: 0.45,
          blending: THREE.AdditiveBlending,
        })
      ));

      // Warm glow halo
      const glow = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: GLOW_TEX, color: nodeCol,
          transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending,
        })
      );
      glow.scale.set(r * 8, r * 8, 1);
      group.add(glow);

      const icon = getIconSprite(node.name, r * 2);
      group.add(icon);

      const label = makeLabel(node.name.toUpperCase(), '#fcd34d', 6);
      label.position.set(0, r + 1.8, 0);
      group.add(label);

      const tag = makeLabel(node.type.toUpperCase(), '#d97706', 3.5);
      tag.position.set(0, r + 0.6, 0);
      group.add(tag);
    }

    return group;
  }, []);

  const handleClick = useCallback((node: any) => {
    onNodeClick?.(node as GraphNode);
    const fg = fgRef.current;
    if (fg) {
      const d = node.type === 'puffer' ? 35 : 25;
      fg.cameraPosition(
        { x: node.x + d, y: node.y + d * 0.3, z: node.z + d },
        node, 1200
      );
    }
  }, [onNodeClick]);

  return (
    <div className="absolute inset-0">
      <ForceGraph3D
        ref={fgRef}
        width={dims.w}
        height={dims.h}
        graphData={graphData}
        backgroundColor="#030508"
        nodeId="id"
        nodeVal="val"
        nodeThreeObject={nodeThreeObject}
        nodeThreeObjectExtend={false}
        onNodeClick={handleClick}
        linkColor="color"
        linkWidth={0.15}
        linkOpacity={0.5}
        linkCurvature="curvature"
        linkDirectionalParticles="particleCount"
        linkDirectionalParticleSpeed="particleSpeed"
        linkDirectionalParticleWidth={0.6}
        linkDirectionalParticleColor="particleColor"
        linkDirectionalArrowLength={0}
        linkDirectionalArrowRelPos={1}
        linkDirectionalArrowColor="particleColor"
        d3AlphaDecay={0.05}
        d3VelocityDecay={0.5}
        d3AlphaMin={0.005}
        warmupTicks={200}
        cooldownTicks={0}
        showNavInfo={false}
        enableNodeDrag={true}
      />
      <div className="vignette-overlay" />
    </div>
  );
};

// ── Minimal label sprite ───────────────────────────────────
function makeLabel(text: string, color: string, size: number): THREE.Sprite {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  canvas.width = 512;
  canvas.height = 56;

  ctx.font = `500 ${size * 3}px "Inter", "SF Pro Display", -apple-system, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.85;
  ctx.fillText(text, 256, 28);

  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;

  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false })
  );
  sprite.scale.set(14, 1.5, 1);
  return sprite;
}

export default NetworkGraph3D;
