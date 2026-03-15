import * as THREE from 'three';

/**
 * Agent/provider icons drawn directly on canvas (no async SVG).
 * Each draw function receives a CanvasRenderingContext2D and draws
 * white on transparent at the given size, centered.
 */

const DEFAULT_ICON_COLOR = '#fef3c7';

type DrawFn = (ctx: CanvasRenderingContext2D, s: number, color?: string) => void;

// ── Icon draw functions ───────────────────────────────────

// Claude — sparkle/asterisk
const drawClaude: DrawFn = (ctx, s, color = DEFAULT_ICON_COLOR) => {
  const cx = s / 2, cy = s / 2, r = s * 0.35;
  ctx.strokeStyle = color;
  ctx.lineWidth = s * 0.04;
  ctx.lineCap = 'round';
  // 6 rays
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI * 2 * i) / 6 - Math.PI / 2;
    const len = i % 2 === 0 ? r : r * 0.6;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(angle) * len, cy + Math.sin(angle) * len);
    ctx.stroke();
  }
  // center dot
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(cx, cy, s * 0.05, 0, Math.PI * 2);
  ctx.fill();
};

// GitHub Copilot — glasses/visor
const drawCopilot: DrawFn = (ctx, s, color = DEFAULT_ICON_COLOR) => {
  const cx = s / 2, cy = s / 2;
  ctx.strokeStyle = color;
  ctx.lineWidth = s * 0.035;
  ctx.lineCap = 'round';
  // visor shape
  ctx.beginPath();
  ctx.ellipse(cx - s * 0.13, cy, s * 0.14, s * 0.1, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(cx + s * 0.13, cy, s * 0.14, s * 0.1, 0, 0, Math.PI * 2);
  ctx.stroke();
  // bridge
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.02, cy);
  ctx.lineTo(cx + s * 0.02, cy);
  ctx.stroke();
  // pupils
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(cx - s * 0.13, cy, s * 0.04, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx + s * 0.13, cy, s * 0.04, 0, Math.PI * 2);
  ctx.fill();
};

// Cursor — cursor arrow
const drawCursor: DrawFn = (ctx, s, color = DEFAULT_ICON_COLOR) => {
  const cx = s / 2, cy = s / 2;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.15, cy - s * 0.25);
  ctx.lineTo(cx + s * 0.2, cy + s * 0.05);
  ctx.lineTo(cx + s * 0.02, cy + s * 0.05);
  ctx.lineTo(cx + s * 0.1, cy + s * 0.25);
  ctx.lineTo(cx, cy + s * 0.2);
  ctx.lineTo(cx - s * 0.06, cy + s * 0.05);
  ctx.lineTo(cx - s * 0.15, cy + s * 0.12);
  ctx.closePath();
  ctx.fill();
};

// Aider — terminal >_
const drawAider: DrawFn = (ctx, s, color = DEFAULT_ICON_COLOR) => {
  ctx.strokeStyle = color;
  ctx.lineWidth = s * 0.04;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const cx = s / 2, cy = s / 2;
  // >
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.15, cy - s * 0.12);
  ctx.lineTo(cx + s * 0.02, cy);
  ctx.lineTo(cx - s * 0.15, cy + s * 0.12);
  ctx.stroke();
  // _
  ctx.beginPath();
  ctx.moveTo(cx + s * 0.06, cy + s * 0.12);
  ctx.lineTo(cx + s * 0.2, cy + s * 0.12);
  ctx.stroke();
};

// OpenAI — hexagon with inner lines
const drawOpenAI: DrawFn = (ctx, s, color = DEFAULT_ICON_COLOR) => {
  const cx = s / 2, cy = s / 2, r = s * 0.3;
  ctx.strokeStyle = color;
  ctx.lineWidth = s * 0.03;
  ctx.lineJoin = 'round';
  // hexagon
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI * 2 * i) / 6 - Math.PI / 2;
    const x = cx + Math.cos(angle) * r;
    const y = cy + Math.sin(angle) * r;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.stroke();
  // inner spokes
  for (let i = 0; i < 3; i++) {
    const a1 = (Math.PI * 2 * i) / 6 - Math.PI / 2;
    const a2 = a1 + Math.PI;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a1) * r * 0.5, cy + Math.sin(a1) * r * 0.5);
    ctx.lineTo(cx + Math.cos(a2) * r * 0.5, cy + Math.sin(a2) * r * 0.5);
    ctx.stroke();
  }
};

// Anthropic — bold "A"
const drawAnthropic: DrawFn = (ctx, s, color = DEFAULT_ICON_COLOR) => {
  ctx.fillStyle = color;
  ctx.font = `bold ${s * 0.45}px "Inter", "Helvetica", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('A', s / 2, s / 2 + s * 0.02);
};

// Ollama — circle with "O" and ears
const drawOllama: DrawFn = (ctx, s, color = DEFAULT_ICON_COLOR) => {
  const cx = s / 2, cy = s / 2;
  ctx.strokeStyle = color;
  ctx.lineWidth = s * 0.035;
  // head circle
  ctx.beginPath();
  ctx.arc(cx, cy + s * 0.03, s * 0.2, 0, Math.PI * 2);
  ctx.stroke();
  // ears
  ctx.beginPath();
  ctx.ellipse(cx - s * 0.18, cy - s * 0.13, s * 0.06, s * 0.09, -0.3, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(cx + s * 0.18, cy - s * 0.13, s * 0.06, s * 0.09, 0.3, 0, Math.PI * 2);
  ctx.stroke();
  // eyes
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(cx - s * 0.07, cy, s * 0.025, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx + s * 0.07, cy, s * 0.025, 0, Math.PI * 2);
  ctx.fill();
};

// DeepSeek — magnifying glass
const drawDeepSeek: DrawFn = (ctx, s, color = DEFAULT_ICON_COLOR) => {
  const cx = s / 2 - s * 0.04, cy = s / 2 - s * 0.04;
  ctx.strokeStyle = color;
  ctx.lineWidth = s * 0.035;
  ctx.beginPath();
  ctx.arc(cx, cy, s * 0.18, 0, Math.PI * 2);
  ctx.stroke();
  // handle
  ctx.lineCap = 'round';
  ctx.lineWidth = s * 0.05;
  ctx.beginPath();
  ctx.moveTo(cx + s * 0.13, cy + s * 0.13);
  ctx.lineTo(cx + s * 0.25, cy + s * 0.25);
  ctx.stroke();
};

// Puffer — shield with check
const drawPuffer: DrawFn = (ctx, s, color = DEFAULT_ICON_COLOR) => {
  const cx = s / 2, cy = s / 2;
  ctx.strokeStyle = color;
  ctx.lineWidth = s * 0.03;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  // shield path
  const sh = s * 0.32, sw = s * 0.25;
  ctx.beginPath();
  ctx.moveTo(cx, cy - sh);
  ctx.lineTo(cx + sw, cy - sh * 0.55);
  ctx.lineTo(cx + sw, cy + sh * 0.2);
  ctx.quadraticCurveTo(cx, cy + sh, cx, cy + sh);
  ctx.quadraticCurveTo(cx, cy + sh, cx - sw, cy + sh * 0.2);
  ctx.lineTo(cx - sw, cy - sh * 0.55);
  ctx.closePath();
  ctx.stroke();
  // check
  ctx.lineWidth = s * 0.04;
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.08, cy + s * 0.02);
  ctx.lineTo(cx - s * 0.02, cy + s * 0.1);
  ctx.lineTo(cx + s * 0.1, cy - s * 0.06);
  ctx.stroke();
};

// Sub-agent — nested circles (agent spawning agent)
const drawSubagent: DrawFn = (ctx, s, color = DEFAULT_ICON_COLOR) => {
  const cx = s / 2, cy = s / 2;
  ctx.strokeStyle = color;
  ctx.lineWidth = s * 0.03;
  // Outer circle
  ctx.beginPath();
  ctx.arc(cx, cy, s * 0.28, 0, Math.PI * 2);
  ctx.stroke();
  // Inner circle
  ctx.beginPath();
  ctx.arc(cx, cy, s * 0.15, 0, Math.PI * 2);
  ctx.stroke();
  // Arrow from inner to outer (spawn)
  ctx.lineWidth = s * 0.035;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx + s * 0.15, cy);
  ctx.lineTo(cx + s * 0.28, cy);
  ctx.stroke();
  // Arrowhead
  ctx.beginPath();
  ctx.moveTo(cx + s * 0.24, cy - s * 0.04);
  ctx.lineTo(cx + s * 0.28, cy);
  ctx.lineTo(cx + s * 0.24, cy + s * 0.04);
  ctx.stroke();
};

// MCP — plug/connector icon
const drawMCP: DrawFn = (ctx, s, color = DEFAULT_ICON_COLOR) => {
  const cx = s / 2, cy = s / 2;
  ctx.strokeStyle = color;
  ctx.lineWidth = s * 0.035;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // Plug body (rectangle)
  const w = s * 0.22, h = s * 0.3;
  ctx.strokeRect(cx - w / 2, cy - h / 2, w, h);
  // Prongs (two lines going up from top)
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.06, cy - h / 2);
  ctx.lineTo(cx - s * 0.06, cy - h / 2 - s * 0.12);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx + s * 0.06, cy - h / 2);
  ctx.lineTo(cx + s * 0.06, cy - h / 2 - s * 0.12);
  ctx.stroke();
  // Cable (line going down from bottom)
  ctx.beginPath();
  ctx.moveTo(cx, cy + h / 2);
  ctx.lineTo(cx, cy + h / 2 + s * 0.12);
  ctx.stroke();
};

// Generic — crosshair
const drawGeneric: DrawFn = (ctx, s, color = DEFAULT_ICON_COLOR) => {
  const cx = s / 2, cy = s / 2;
  ctx.strokeStyle = color;
  ctx.lineWidth = s * 0.025;
  ctx.lineCap = 'round';
  // circle
  ctx.beginPath();
  ctx.arc(cx, cy, s * 0.18, 0, Math.PI * 2);
  ctx.stroke();
  // crosshair lines
  const inner = s * 0.1, outer = s * 0.28;
  ctx.beginPath();
  ctx.moveTo(cx, cy - outer); ctx.lineTo(cx, cy - inner); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx, cy + inner); ctx.lineTo(cx, cy + outer); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - outer, cy); ctx.lineTo(cx - inner, cy); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx + inner, cy); ctx.lineTo(cx + outer, cy); ctx.stroke();
};

// ── Matching ──────────────────────────────────────────────

interface IconEntry { draw: DrawFn; keywords: string[] }

const ICON_DB: IconEntry[] = [
  { draw: drawClaude, keywords: ['claude', 'claude-code'] },
  { draw: drawCopilot, keywords: ['copilot', 'github-copilot'] },
  { draw: drawCursor, keywords: ['cursor'] },
  { draw: drawAider, keywords: ['aider'] },
  { draw: drawOpenAI, keywords: ['openai', 'gpt', 'chatgpt'] },
  { draw: drawAnthropic, keywords: ['anthropic'] },
  { draw: drawOllama, keywords: ['ollama', 'llama'] },
  { draw: drawDeepSeek, keywords: ['deepseek'] },
  { draw: drawSubagent, keywords: ['subagent', 'claude-code-agent'] },
  { draw: drawMCP, keywords: ['mcp'] },
];

function findDraw(name: string): DrawFn {
  const lower = name.toLowerCase();
  for (const entry of ICON_DB) {
    if (entry.keywords.some((kw) => lower.includes(kw))) return entry.draw;
  }
  return drawGeneric;
}

// ── Texture cache (sync canvas) ───────────────────────────

const texCache = new Map<string, THREE.CanvasTexture>();

function makeIconTexture(name: string, drawFn: DrawFn, color?: string): THREE.CanvasTexture {
  const key = `${name}__${color ?? 'default'}`;
  if (texCache.has(key)) return texCache.get(key)!;

  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  drawFn(ctx, size, color);

  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  texCache.set(key, tex);
  return tex;
}

// ── Public API ────────────────────────────────────────────

export function getIconSprite(name: string, scale: number, color?: string): THREE.Sprite {
  const drawFn = findDraw(name);
  const tex = makeIconTexture(name, drawFn, color);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: tex, transparent: true, opacity: 0.92,
      depthWrite: false, depthTest: false,
      blending: THREE.AdditiveBlending,
    })
  );
  sprite.scale.set(scale, scale, 1);
  return sprite;
}

export function getPufferIconSprite(scale: number, color?: string): THREE.Sprite {
  const tex = makeIconTexture('__puffer__', drawPuffer, color);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: tex, transparent: true, opacity: 0.85,
      depthWrite: false, depthTest: false,
      blending: THREE.AdditiveBlending,
    })
  );
  sprite.scale.set(scale, scale, 1);
  return sprite;
}
