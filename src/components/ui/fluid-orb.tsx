'use client';

import React, { useEffect, useRef, useState } from 'react';

export type FluidOrbProps = React.ComponentProps<'div'> & {
  size?: number;
  color?: string;
  shape?: 'circle' | 'rect';
  animateOnHover?: boolean;
};

// Adaptado de Rare UI Fluid Orb: https://www.rareui.com/components/fluidorb
const VERTEX_SHADER = `
attribute vec2 a_pos;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform vec2 u_resolution;
uniform float u_time;
uniform vec3 u_color;
uniform float u_shape;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.6;
  for (int i = 0; i < 3; i++) {
    value += amplitude * noise(p);
    p *= 2.0;
    amplitude *= 0.5;
  }
  return value;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution.xy;
  float time = u_time * 0.22;
  vec2 drift = vec2(
    sin(time) + 0.6 * sin(time * 1.7 + 1.3),
    cos(time * 0.8) + 0.6 * cos(time * 1.3 + 2.1)
  );
  vec2 point = vec2(uv.x * 1.8, uv.y) + drift * 0.7;
  vec2 warp = vec2(fbm(point + drift), fbm(point + vec2(3.2, 1.5) - drift));
  float fluid = fbm(point + 1.2 * warp);
  float gradient = clamp(1.0 - uv.y, 0.0, 1.0);
  float anchor = smoothstep(0.0, 0.3, uv.y);
  float shade = clamp(gradient + (fluid - 0.5) * 0.8 * anchor, 0.0, 1.0);

  vec3 white = vec3(0.99, 1.0, 1.0);
  vec3 light = mix(white, u_color, 0.5);
  vec3 color = white;
  color = mix(color, light, smoothstep(0.28, 0.52, shade));
  color = mix(color, u_color, smoothstep(0.58, 0.88, shade));

  float edge = u_shape > 0.5
    ? 1.0
    : smoothstep(0.5, 0.49, distance(uv, vec2(0.5)));
  gl_FragColor = vec4(color * edge, edge);
}
`;

function hexToRgb(hex: string): [number, number, number] {
  let value = hex.replace('#', '').trim();
  if (value.length === 3) value = value.split('').map((channel) => channel + channel).join('');
  const parsed = Number.parseInt(value, 16);
  if (value.length !== 6 || Number.isNaN(parsed)) return [0.176, 0.373, 0.839];
  return [(parsed >> 16 & 255) / 255, (parsed >> 8 & 255) / 255, (parsed & 255) / 255];
}

function compileShader(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

export default function FluidOrb({
  size = 240,
  color = '#2D5FD6',
  shape = 'circle',
  animateOnHover = false,
  className,
  style,
  ...props
}: FluidOrbProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hovered, setHovered] = useState(false);
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const gl = canvas.getContext('webgl', { antialias: true, alpha: true });
    if (!gl) {
      setFallback(true);
      return undefined;
    }

    const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
    const fragment = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    const program = gl.createProgram();
    if (!vertex || !fragment || !program) {
      setFallback(true);
      if (vertex) gl.deleteShader(vertex);
      if (fragment) gl.deleteShader(fragment);
      if (program) gl.deleteProgram(program);
      return undefined;
    }

    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      setFallback(true);
      gl.deleteProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
      return undefined;
    }
    setFallback(false);
    gl.useProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'a_pos');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

    const resolution = gl.getUniformLocation(program, 'u_resolution');
    const time = gl.getUniformLocation(program, 'u_time');
    const uniformColor = gl.getUniformLocation(program, 'u_color');
    const uniformShape = gl.getUniformLocation(program, 'u_shape');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pixels = Math.max(1, Math.round(size * dpr));
    canvas.width = pixels;
    canvas.height = pixels;
    gl.viewport(0, 0, pixels, pixels);
    gl.uniform2f(resolution, pixels, pixels);
    gl.uniform3f(uniformColor, ...hexToRgb(color));
    gl.uniform1f(uniformShape, shape === 'rect' ? 1 : 0);

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const shouldAnimate = !reducedMotion && (!animateOnHover || hovered);
    const startedAt = performance.now();
    let animationFrame = 0;
    const render = (now: number) => {
      gl.uniform1f(time, shouldAnimate ? (now - startedAt) / 1000 : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      if (shouldAnimate) animationFrame = requestAnimationFrame(render);
    };
    render(startedAt);

    return () => {
      cancelAnimationFrame(animationFrame);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
    };
  }, [animateOnHover, color, hovered, shape, size]);

  return <div
    data-slot="fluid-orb"
    className={`relative overflow-hidden ${shape === 'circle' ? 'rounded-full' : ''} ${className || ''}`}
    style={{ width: size, height: size, backgroundColor: fallback ? color : 'transparent', ...style }}
    onPointerEnter={() => { if (animateOnHover) setHovered(true); }}
    onPointerLeave={() => { if (animateOnHover) setHovered(false); }}
    {...props}
  >
    <canvas ref={canvasRef} className="block h-full w-full" aria-hidden="true" />
  </div>;
}
