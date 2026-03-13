import React, { useRef, useCallback, useEffect, useState } from 'react';
import ForceGraph3D from 'react-force-graph-3d';
import * as THREE from 'three';
import type { GraphData, GraphNode } from '../hooks/useGraphData';
import { getIconSprite, getPufferIconSprite } from '../lib/agentIcons';

interface NetworkGraph3DProps {
  graphData: GraphData;
  onNodeClick?: (node: GraphNode) => void;
}

// Soft circular glow texture
const GLOW_TEX = (() => {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.35)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.06)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
})();

const ORBIT_RADIUS = 40; // how close orbs stay to center

const NetworkGraph3D: React.FC<NetworkGraph3DProps> = ({ graphData, onNodeClick }) => {
  const fgRef = useRef<any>(null);
  const [dims, setDims] = useState({ w: window.innerWidth, h: window.innerHeight });

  // Configure d3 forces to keep nodes tight around center
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;

    try {
      // Weaken charge so nodes don't repel far
      fg.d3Force('charge')?.strength(-15);
      // Short link distance — orbiting close
      fg.d3Force('link')?.distance(ORBIT_RADIUS);
      // Strong center pull
      fg.d3Force('center')?.strength(1.5);
    } catch {
      // force api might not be available on first render
    }
  }, [graphData]);

  // Slow auto-orbit camera
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;

    fg.cameraPosition({ x: 60, y: 35, z: 60 });

    let angle = 0;
    const radius = 85;
    let raf: number;

    const orbit = () => {
      angle += 0.0007;
      fg.cameraPosition({
        x: radius * Math.cos(angle),
        y: 28 + Math.sin(angle * 0.4) * 12,
        z: radius * Math.sin(angle),
      });
      raf = requestAnimationFrame(orbit);
    };

    const t = setTimeout(() => { raf = requestAnimationFrame(orbit); }, 1500);
    return () => { clearTimeout(t); cancelAnimationFrame(raf); };
  }, []);

  useEffect(() => {
    const h = () => setDims({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', h);
    return () => window.removeEventListener('resize', h);
  }, []);

  // ── Custom Three.js objects ──────────────────────────────
  const nodeThreeObject = useCallback((node: GraphNode) => {
    const group = new THREE.Group();

    if (node.type === 'puffer') {
      // ─── Central orb ───
      const sphere = new THREE.Mesh(
        new THREE.SphereGeometry(5, 48, 48),
        new THREE.MeshPhysicalMaterial({
          color: 0xffffff,
          emissive: 0xffffff,
          emissiveIntensity: 0.18,
          transparent: true,
          opacity: 0.88,
          roughness: 0.08,
          metalness: 0.15,
          clearcoat: 1.0,
          clearcoatRoughness: 0.03,
        })
      );
      group.add(sphere);

      // Inner core
      group.add(new THREE.Mesh(
        new THREE.SphereGeometry(3, 24, 24),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.12 })
      ));

      // Ring
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(7.5, 0.1, 16, 100),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.15 })
      );
      ring.rotation.x = Math.PI / 2;
      group.add(ring);

      const ring2 = new THREE.Mesh(
        new THREE.TorusGeometry(7.5, 0.08, 16, 100),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.08 })
      );
      ring2.rotation.x = Math.PI / 2.8;
      ring2.rotation.z = Math.PI / 5;
      group.add(ring2);

      // Glow
      const glow = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: GLOW_TEX, color: 0xffffff,
          transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending,
        })
      );
      glow.scale.set(25, 25, 1);
      group.add(glow);

      // Shield icon
      const icon = getPufferIconSprite(6);
      group.add(icon);

      // Label
      const label = makeLabel('YOUR COMPUTER', '#ffffff', 12);
      label.position.set(0, 9, 0);
      group.add(label);

    } else {
      // ─── Agent / Provider orbs ───
      const r = node.type === 'agent' ? 2.2 : 1.8;

      const sphere = new THREE.Mesh(
        new THREE.SphereGeometry(r, 24, 24),
        new THREE.MeshPhysicalMaterial({
          color: new THREE.Color(node.color),
          emissive: new THREE.Color(node.color),
          emissiveIntensity: 0.1,
          transparent: true,
          opacity: 0.75,
          roughness: 0.12,
          metalness: 0.08,
          clearcoat: 0.7,
        })
      );
      group.add(sphere);

      // Glow
      const glow = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: GLOW_TEX, color: new THREE.Color(node.color),
          transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending,
        })
      );
      glow.scale.set(r * 5, r * 5, 1);
      group.add(glow);

      // Icon on top of orb
      const icon = getIconSprite(node.name, r * 2);
      group.add(icon);

      // Label above
      const label = makeLabel(node.name.toUpperCase(), '#d1d5db', 8);
      label.position.set(0, r + 3, 0);
      group.add(label);

      // Type tag
      const tag = makeLabel(node.type.toUpperCase(), '#6b7280', 5);
      tag.position.set(0, r + 1.2, 0);
      group.add(tag);
    }

    return group;
  }, []);

  const handleClick = useCallback((node: any) => {
    onNodeClick?.(node as GraphNode);
    const fg = fgRef.current;
    if (fg) {
      const d = node.type === 'puffer' ? 50 : 35;
      fg.cameraPosition(
        { x: node.x + d, y: node.y + d * 0.35, z: node.z + d },
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
        backgroundColor="#06080d"
        nodeId="id"
        nodeVal="val"
        nodeThreeObject={nodeThreeObject}
        nodeThreeObjectExtend={false}
        onNodeClick={handleClick}
        linkColor="color"
        linkWidth={0.6}
        linkOpacity={0.35}
        linkCurvature="curvature"
        linkDirectionalParticles="particleCount"
        linkDirectionalParticleSpeed="particleSpeed"
        linkDirectionalParticleWidth={1.8}
        linkDirectionalParticleColor="particleColor"
        linkDirectionalArrowLength={2.5}
        linkDirectionalArrowRelPos={1}
        linkDirectionalArrowColor="particleColor"
        d3AlphaDecay={0.06}
        d3VelocityDecay={0.6}
        d3AlphaMin={0.01}
        warmupTicks={120}
        cooldownTicks={80}
        showNavInfo={false}
        enableNodeDrag={true}
      />
    </div>
  );
};

// ── Minimal monochrome text sprite ─────────────────────────
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
  sprite.scale.set(18, 2, 1);
  return sprite;
}

export default NetworkGraph3D;
