# Orbe fluido WebGL

El orbe es un shader WebGL sin dependencias externas. El componente compartido está en `src/components/ui/fluid-orb.tsx`; dibuja sobre un canvas y acepta tamaño, color, forma, animación al pasar el cursor y estado activo.

## Cómo se construye

1. Un vertex shader dibuja un rectángulo que cubre el canvas.
2. El fragment shader genera ruido procedural con `hash`, `noise` y tres octavas de `fbm`. Dos campos de ruido deforman un tercero (`warp`), mientras `u_time` desplaza lentamente el patrón.
3. El color base conserva el patrón: blanco arriba, azul abajo y transición suave e irregular. `gradient`, `anchor` y `shade` determinan esa frontera. Estos cálculos son la identidad visual del orbe; si se busca más volumen, no reemplazarlos por una división plana del círculo.
4. Para la esfera, las coordenadas UV se convierten en un disco. Los píxeles fuera del radio se descartan; dentro, `sqrt(1.0 - radiusSquared)` reconstruye la profundidad y con ella la normal de la superficie.
5. Una luz difusa tenue, un reflejo especular muy bajo y un borde suave dan volumen sin endurecer la frontera de ruido. Mantener estos valores bajos: la iluminación fuerte blanquea el patrón y hace que parezca otra esfera.

La forma `rect` conserva el degradado rectangular y no aplica la máscara ni el sombreado esférico.

## Ajustes visuales

- **Más o menos nubes:** ajustar el factor `(fluid - 0.5) * 0.8` en `shade`. Un valor mayor hace más irregular la frontera; uno menor la aplana.
- **Velocidad del movimiento:** ajustar `u_time * 0.22` y el desplazamiento `drift`.
- **Volumen:** ajustar primero `diffuse`; mantener `specular` y `rim` sutiles para no tapar el patrón.
- **Color:** pasar `color` como hex al componente. El shader lo convierte a RGB con `hexToRgb`.
- **Rendimiento y movimiento:** el canvas limita el DPR a 2, dibuja con `requestAnimationFrame` y pausa cuando la pestaña está oculta, el canvas sale del viewport, `active` es falso o el usuario prefiere movimiento reducido. `animateOnHover` limita la animación al hover.
- **Compatibilidad:** si WebGL o la compilación del shader falla, se muestra un degradado CSS de respaldo.

No dupliques el shader para cada superficie. `ChatInterface`, `FloatingChat` y `WorkspaceLayout` usan `FluidOrb`; los cambios en el componente compartido mantienen el mismo aspecto en el input, el widget y las vistas relacionadas.

## Vista previa

Con `npm run next:dev`, abrir `http://127.0.0.1:3000/orb-preview` para inspeccionar el orbe aislado sobre el fondo oscuro.
