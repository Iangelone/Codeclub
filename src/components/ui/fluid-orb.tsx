'use client';

import React, { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { useOrbPalette, type OrbShape } from '../OrbPaletteProvider';

// A smooth five-lobed silhouette, normalized so every orb size uses the same shape.
const CLOUD_CLIP = `polygon(${Array.from({ length: 96 }, (_, index) => {
  const angle = index / 96 * Math.PI * 2;
  const radius = 43 + 5 * Math.cos(5 * angle + Math.PI / 2);
  return `${50 + radius * Math.cos(angle)}% ${50 + radius * Math.sin(angle)}%`;
}).join(', ')})`;

// Sample rounded corners once; percentage coordinates keep small and large orbs identical.
const TRIANGLE_CLIP = `polygon(${[
  [[46, 10], [50, 2], [54, 10]],
  [[93, 85], [98, 94], [88, 94]],
  [[12, 94], [2, 94], [7, 85]],
].flatMap(([start, control, end]) => Array.from({ length: 17 }, (_, index) => {
  const t = index / 16;
  const x = (1 - t) ** 2 * start[0] + 2 * (1 - t) * t * control[0] + t ** 2 * end[0];
  const y = (1 - t) ** 2 * start[1] + 2 * (1 - t) * t * control[1] + t ** 2 * end[1];
  return `${x}% ${y}%`;
})).join(', ')})`;

export type FluidOrbProps = React.ComponentProps<'div'> & {
  size?: number;
  color?: string;
  shape?: OrbShape | 'rect';
  animateOnHover?: boolean;
  active?: boolean;
  themeTint?: boolean;
};

// Adapted from Rare UI Fluid Orb: https://www.rareui.com/components/fluidorb
// Keep the shader self-contained; palette updates arrive through component props.
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

  vec3 color;
  float edge = 1.0;
  if (u_shape > 0.5) {
    float shade = clamp(1.0 - uv.y + (fluid - 0.5) * 0.8, 0.0, 1.0);
    color = mix(vec3(0.99, 1.0, 1.0), u_color, smoothstep(0.48, 0.82, shade));
  } else {
    vec2 pointOnSphere = (uv - 0.5) * 2.0;
    float radiusSquared = dot(pointOnSphere, pointOnSphere);
    if (radiusSquared > 1.0) discard;

    float depth = sqrt(1.0 - radiusSquared);
    vec3 normal = normalize(vec3(pointOnSphere, depth));
    vec3 lightDirection = normalize(vec3(-0.48, 0.72, 0.82));
    vec3 viewDirection = vec3(0.0, 0.0, 1.0);
    vec3 halfDirection = normalize(lightDirection + viewDirection);

    float gradient = clamp(1.0 - uv.y, 0.0, 1.0);
    float anchor = smoothstep(0.0, 0.3, uv.y);
    float shade = clamp(gradient + (fluid - 0.5) * 0.8 * anchor, 0.0, 1.0);
    vec3 white = vec3(0.99, 1.0, 1.0);
    vec3 lightBlue = mix(white, u_color, 0.5);
    color = mix(white, lightBlue, smoothstep(0.28, 0.52, shade));
    color = mix(color, u_color, smoothstep(0.58, 0.88, shade));

    float diffuse = 0.93 + 0.07 * max(dot(normal, lightDirection), 0.0);
    float specular = pow(max(dot(normal, halfDirection), 0.0), 36.0) * 0.025;
    float rim = pow(1.0 - max(dot(normal, viewDirection), 0.0), 2.0) * 0.025;
    color = color * diffuse + vec3(specular + rim);
    edge = smoothstep(0.0, 0.035, depth);
  }
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
  shape: requestedShape,
  animateOnHover = false,
  active = true,
  themeTint = true,
  className,
  style,
  ...props
}: FluidOrbProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hovered, setHovered] = useState(false);
  const [fallback, setFallback] = useState(false);
  const { palette, shape: sharedShape } = useOrbPalette();
  const shape = requestedShape ?? sharedShape;
  const reducedMotion = useReducedMotion();

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
    gl.uniform1f(uniformShape, shape === 'circle' ? 0 : 1);

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let visible = !document.hidden;
    let intersecting = true;
    const shouldAnimate = () => active && visible && intersecting && !reducedMotion && (!animateOnHover || hovered);
    const startedAt = performance.now();
    let animationFrame = 0;
    const render = (now: number) => {
      gl.uniform1f(time, shouldAnimate() ? (now - startedAt) / 1000 : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      if (shouldAnimate()) animationFrame = requestAnimationFrame(render);
    };
    const resume = () => { cancelAnimationFrame(animationFrame); render(performance.now()); };
    const onVisibility = () => { visible = !document.hidden; resume(); };
    const observer = new IntersectionObserver(([entry]) => { intersecting = entry.isIntersecting; resume(); });
    observer.observe(canvas);
    document.addEventListener('visibilitychange', onVisibility);
    render(startedAt);

    return () => {
      cancelAnimationFrame(animationFrame);
      observer.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
    };
  }, [active, animateOnHover, color, hovered, shape, size]);

  return <div
    data-slot="fluid-orb"
    data-orb-shape={shape}
    className={`relative overflow-hidden ${shape === 'circle' ? 'rounded-full' : ''} ${className || ''}`}
    style={{ width: size, height: size, clipPath: shape === 'cloud' ? CLOUD_CLIP : shape === 'triangle' ? TRIANGLE_CLIP : undefined, borderRadius: shape === 'square' ? '12%' : undefined, ...style }}
    onPointerEnter={() => { if (animateOnHover) setHovered(true); }}
    onPointerLeave={() => { if (animateOnHover) setHovered(false); }}
    {...props}
  >
    <motion.div
      className="h-full w-full"
      style={{ background: fallback ? `radial-gradient(circle at 32% 24%, #ffffff 0 24%, #a8c7ff 54%, ${color} 82%)` : 'transparent' }}
      animate={{ filter: `hue-rotate(${themeTint ? palette.hue : 0}deg)` }}
      transition={reducedMotion ? { duration: 0 } : { duration: 0.48, ease: [0.22, 1, 0.36, 1] }}
    >
      <canvas ref={canvasRef} className="block h-full w-full" aria-hidden="true" />
    </motion.div>
  </div>;
}
