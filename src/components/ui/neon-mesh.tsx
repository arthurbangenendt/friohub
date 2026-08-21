"use client";

import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";

/**
 * Hero interativo: malha 3D com física Verlet (tecido) que reage ao mouse,
 * desenhada em canvas 2D puro. Paleta fixa e escura — mesmo gradiente e
 * mesmo acento ciano que `.parc-hero`/`.auth-aside` já usam em `globals.css`,
 * porque essas seções não respondem ao tema claro/escuro do resto do site.
 */

interface Point3D {
  x: number;
  y: number;
  z: number;
  oldX: number;
  oldY: number;
  oldZ: number;
  pinned: boolean;
  baseX: number;
  baseY: number;
  baseZ: number;
  projX: number;
  projY: number;
  projScale: number;
}

interface Constraint3D {
  p1: Point3D;
  p2: Point3D;
  length: number;
}

const BG_STOPS: [string, string, string] = ["#0e1b26", "#123243", "#0d2130"];
const ACCENT = "#7fe0f2";
const MESH_BASE_RGB = "127, 224, 242";

export interface NeonMeshProps {
  title?: string;
  subtitle?: string;
  description?: string;
  height?: string;
  className?: string;
  children?: ReactNode;
}

export function NeonMesh({
  title,
  subtitle,
  description,
  height: heroHeight = "min(680px, 92vh)",
  className,
  children,
}: NeonMeshProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;

    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let animationFrameId = 0;
    let width = 0;
    let height = 0;
    let bgGradient: CanvasGradient | string = BG_STOPS[2];

    const mouse = {
      x: -1000,
      y: -1000,
      targetAngleX: 0.2,
      targetAngleY: -0.3,
      angleX: 0.2,
      angleY: -0.3,
      radius: 180,
    };

    let points: Point3D[] = [];
    let constraints: Constraint3D[] = [];

    const buildBgGradient = () => {
      const g = ctx.createLinearGradient(0, 0, width * 0.35, height);
      g.addColorStop(0, BG_STOPS[0]);
      g.addColorStop(0.6, BG_STOPS[1]);
      g.addColorStop(1, BG_STOPS[2]);
      return g;
    };

    const initMesh = () => {
      points = [];
      constraints = [];

      const spacing = 42;
      const cols = Math.ceil((width * 1.1) / spacing) + 1;
      const rows = Math.ceil((height * 1.1) / spacing) + 1;

      const grid: Point3D[][] = [];
      const startX = -(cols * spacing) / 2;
      const startY = -(rows * spacing) / 2;

      for (let j = 0; j < rows; j++) {
        grid[j] = [];
        for (let i = 0; i < cols; i++) {
          const bx = startX + i * spacing;
          const by = startY + j * spacing;
          const bz = 0;
          const isEdge = i === 0 || i === cols - 1 || j === 0 || j === rows - 1;

          const p: Point3D = {
            x: bx, y: by, z: bz, oldX: bx, oldY: by, oldZ: bz,
            pinned: isEdge, baseX: bx, baseY: by, baseZ: bz,
            projX: 0, projY: 0, projScale: 1,
          };

          points.push(p);
          grid[j][i] = p;
        }
      }

      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          if (i < cols - 1) constraints.push({ p1: grid[j][i], p2: grid[j][i + 1], length: spacing });
          if (j < rows - 1) constraints.push({ p1: grid[j][i], p2: grid[j + 1][i], length: spacing });
        }
      }
    };

    const handleResize = () => {
      const rect = container.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width;
      height = rect.height;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
      bgGradient = buildBgGradient();
      initMesh();
    };

    const handleMouseMove = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      const rawX = e.clientX - rect.left;
      const rawY = e.clientY - rect.top;

      mouse.x = rawX;
      mouse.y = rawY;

      const normX = (rawX / width - 0.5) * 2;
      const normY = (rawY / height - 0.5) * 2;
      mouse.targetAngleY = normX * 0.45;
      mouse.targetAngleX = -normY * 0.35 + 0.2;
    };

    const handleMouseLeave = () => {
      mouse.x = -1000;
      mouse.y = -1000;
      mouse.targetAngleX = 0.2;
      mouse.targetAngleY = 0;
    };

    handleResize();
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);
    container.addEventListener("mousemove", handleMouseMove);
    container.addEventListener("mouseleave", handleMouseLeave);

    let time = 0;

    const render = () => {
      time += 0.025;

      mouse.angleX += (mouse.targetAngleX - mouse.angleX) * 0.05;
      mouse.angleY += (mouse.targetAngleY - mouse.angleY) * 0.05;

      const cosX = Math.cos(mouse.angleX);
      const sinX = Math.sin(mouse.angleX);
      const cosY = Math.cos(mouse.angleY);
      const sinY = Math.sin(mouse.angleY);

      ctx.fillStyle = bgGradient;
      ctx.fillRect(0, 0, width, height);

      for (let i = 0; i < points.length; i++) {
        const p = points[i];
        if (p.pinned) continue;

        const vx = (p.x - p.oldX) * 0.93;
        const vy = (p.y - p.oldY) * 0.93;
        const vz = (p.z - p.oldZ) * 0.93;

        p.oldX = p.x; p.oldY = p.y; p.oldZ = p.z;
        p.x += vx; p.y += vy; p.z += vz;

        const ambientZ = Math.sin(p.baseX * 0.015 + p.baseY * 0.015 + time) * 18;

        p.x += (p.baseX - p.x) * 0.04;
        p.y += (p.baseY - p.y) * 0.04;
        p.z += (p.baseZ + ambientZ - p.z) * 0.04;
      }

      const perspective = 600;
      const centerX = width / 2;
      const centerY = height / 2;

      for (let i = 0; i < points.length; i++) {
        const p = points[i];

        const rx1 = p.x * cosY + p.z * sinY;
        const ry1 = p.y;
        const rz1 = -p.x * sinY + p.z * cosY;

        const rx2 = rx1;
        const ry2 = ry1 * cosX - rz1 * sinX;
        const rz2 = ry1 * sinX + rz1 * cosX + 400;

        const scale = perspective / Math.max(1, rz2);
        p.projScale = scale;
        p.projX = centerX + rx2 * scale;
        p.projY = centerY + ry2 * scale;

        if (!p.pinned) {
          const dx = p.projX - mouse.x;
          const dy = p.projY - mouse.y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < mouse.radius && dist > 0) {
            const force = (1 - dist / mouse.radius) * 22;
            const angle = Math.atan2(dy, dx);
            p.x += (Math.cos(angle) * force) / p.projScale;
            p.y += (Math.sin(angle) * force) / p.projScale;
            p.z -= (force * 1.5) / p.projScale;
          }
        }
      }

      for (let iter = 0; iter < 4; iter++) {
        for (let i = 0; i < constraints.length; i++) {
          const c = constraints[i];
          const dx = c.p2.x - c.p1.x;
          const dy = c.p2.y - c.p1.y;
          const dz = c.p2.z - c.p1.z;
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
          const delta = (dist - c.length) / (dist || 1);

          if (!c.p1.pinned) {
            c.p1.x += dx * 0.5 * delta;
            c.p1.y += dy * 0.5 * delta;
            c.p1.z += dz * 0.5 * delta;
          }
          if (!c.p2.pinned) {
            c.p2.x -= dx * 0.5 * delta;
            c.p2.y -= dy * 0.5 * delta;
            c.p2.z -= dz * 0.5 * delta;
          }
        }
      }

      for (let i = 0; i < constraints.length; i++) {
        const c = constraints[i];
        const midX = (c.p1.projX + c.p2.projX) / 2;
        const midY = (c.p1.projY + c.p2.projY) / 2;

        const dx = mouse.x - midX;
        const dy = mouse.y - midY;
        const dist = Math.sqrt(dx * dx + dy * dy);

        const isHot = dist < mouse.radius;
        const avgScale = (c.p1.projScale + c.p2.projScale) / 2;

        ctx.strokeStyle = isHot
          ? ACCENT
          : `rgba(${MESH_BASE_RGB}, ${Math.min(1, Math.max(0.1, 0.28 * avgScale))})`;
        ctx.lineWidth = isHot ? 2 * avgScale : 0.8 * avgScale;

        ctx.beginPath();
        ctx.moveTo(c.p1.projX, c.p1.projY);
        ctx.lineTo(c.p2.projX, c.p2.projY);
        ctx.stroke();
      }

      for (let i = 0; i < points.length; i++) {
        const p = points[i];
        const dx = mouse.x - p.projX;
        const dy = mouse.y - p.projY;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < 100) {
          ctx.fillStyle = ACCENT;
          ctx.beginPath();
          ctx.arc(p.projX, p.projY, 2.5 * p.projScale, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    };

    if (prefersReducedMotion) {
      render();
    } else {
      const animate = () => {
        render();
        animationFrameId = requestAnimationFrame(animate);
      };
      animationFrameId = requestAnimationFrame(animate);
    }

    return () => {
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
      resizeObserver.disconnect();
      container.removeEventListener("mousemove", handleMouseMove);
      container.removeEventListener("mouseleave", handleMouseLeave);
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ position: "relative", width: "100%", height: heroHeight, overflow: "hidden", userSelect: "none", background: BG_STOPS[2] }}
    >
      <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, display: "block", cursor: "crosshair" }} />

      <div style={overlay}>
        {subtitle && <span style={eyebrowStyle}>{subtitle}</span>}
        {title && <h1 style={titleStyle}>{title}</h1>}
        {description && <p style={descStyle}>{description}</p>}
        {children && <div style={ctaWrap}>{children}</div>}
      </div>
    </div>
  );
}

export default NeonMesh;

const overlay: CSSProperties = {
  position: "relative", zIndex: 10, display: "flex", flexDirection: "column",
  alignItems: "center", justifyContent: "center", height: "100%",
  textAlign: "center", padding: "0 24px", pointerEvents: "none",
  textShadow: "0 2px 24px rgba(0,0,0,.35)",
};
const eyebrowStyle: CSSProperties = {
  fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
  fontSize: 11.5, letterSpacing: "0.16em", textTransform: "uppercase", color: ACCENT, marginBottom: 12,
};
const titleStyle: CSSProperties = {
  fontSize: "clamp(2.1rem, 5vw, 3.4rem)", fontWeight: 800, letterSpacing: "-0.03em",
  lineHeight: 1.06, margin: 0, maxWidth: 720, color: "#eaf6fa",
};
const descStyle: CSSProperties = {
  fontSize: "1.15rem", lineHeight: 1.6, color: "rgba(234,246,250,.78)", maxWidth: 560, margin: "18px 0 0",
};
const ctaWrap: CSSProperties = {
  marginTop: 28, pointerEvents: "auto", display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "center",
};
