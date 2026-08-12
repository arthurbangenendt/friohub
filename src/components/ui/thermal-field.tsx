"use client";

import { useEffect, useRef } from "react";

/**
 * Fundo animado em WebGL puro (sem dependências): linhas de calor em looping
 * lento, na paleta da marca. Renderiza um único triângulo em tela cheia —
 * mais leve que trazer uma lib 3D inteira para desenhar um plano 2D.
 */

const VERTEX_SHADER = `
  attribute vec2 aPosition;
  void main() {
    gl_Position = vec4(aPosition, 0.0, 1.0);
  }
`;

const FRAGMENT_SHADER = `
  precision highp float;
  uniform vec2 uResolution;
  uniform float uTime;

  float random(float x) {
    return fract(sin(x) * 1e4);
  }

  void main() {
    vec2 uv = (gl_FragCoord.xy * 2.0 - uResolution.xy) / min(uResolution.x, uResolution.y);

    vec2 mosaic = vec2(4.0, 2.0);
    vec2 grid = vec2(256.0, 256.0);
    uv.x = floor(uv.x * grid.x / mosaic.x) / (grid.x / mosaic.x);
    uv.y = floor(uv.y * grid.y / mosaic.y) / (grid.y / mosaic.y);

    float t = uTime * 0.05 + random(uv.x) * 0.4;
    float lineWidth = 0.00055;

    float glow = 0.0;
    for (int i = 0; i < 5; i++) {
      glow += lineWidth * float(i * i) / abs(fract(t + float(i) * 0.012) - length(uv));
    }
    glow = clamp(glow, 0.0, 1.0);

    vec3 deep = vec3(0.031, 0.235, 0.306);
    vec3 bright = vec3(0.173, 0.651, 0.788);
    vec3 color = mix(deep, bright, glow);

    gl_FragColor = vec4(color * glow, glow * 0.42);
  }
`;

function compileShader(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  return shader;
}

export function ThermalField({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext("webgl", {
      alpha: true,
      antialias: false,
      premultipliedAlpha: false,
    });
    if (!gl) return;

    const vertexShader = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
    const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    if (!vertexShader || !fragmentShader) return;

    const program = gl.createProgram();
    if (!program) return;
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;
    gl.useProgram(program);

    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

    const aPosition = gl.getAttribLocation(program, "aPosition");
    gl.enableVertexAttribArray(aPosition);
    gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 0, 0);

    const uResolution = gl.getUniformLocation(program, "uResolution");
    const uTime = gl.getUniformLocation(program, "uTime");

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let frameId = 0;
    let time = 0;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = canvas.clientWidth * dpr;
      const height = canvas.clientHeight * dpr;
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        gl.viewport(0, 0, width, height);
      }
      gl.uniform2f(uResolution, width, height);
    };

    const draw = () => {
      resize();
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform1f(uTime, time);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    const observer = new ResizeObserver(draw);
    observer.observe(canvas);

    if (prefersReducedMotion) {
      draw();
    } else {
      const animate = () => {
        time += 1;
        draw();
        frameId = requestAnimationFrame(animate);
      };
      frameId = requestAnimationFrame(animate);
    }

    return () => {
      observer.disconnect();
      if (frameId) cancelAnimationFrame(frameId);
      gl.deleteProgram(program);
      gl.deleteShader(vertexShader);
      gl.deleteShader(fragmentShader);
      gl.deleteBuffer(positionBuffer);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={className}
      style={{ display: "block", width: "100%", height: "100%" }}
    />
  );
}
