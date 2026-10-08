'use strict';
/* =============================================================================
   UTILIDADES MATEMÁTICAS
   ============================================================================= */

/* Limita un valor al rango [minimo, maximo]. */
function limitar(valor, minimo, maximo) {
  return valor < minimo ? minimo : valor > maximo ? maximo : valor;
}

/* Interpolación lineal: con t=0 devuelve a, con t=1 devuelve b. */
function interpolar(a, b, t) {
  return a + (b - a) * t;
}

/* Distancia entre dos puntos (Pitágoras). */
function distancia(x1, y1, x2, y2) {
  return Math.hypot(x2 - x1, y2 - y1);
}

/* ---------- Números aleatorios con semilla ----------
   Math.random() da números distintos cada vez. Para generar mapas
   reproducibles usamos un generador con semilla ("mulberry32"):
   la misma semilla siempre produce la misma secuencia de números. */
function crearAleatorioConSemilla(semilla) {
  let estado = semilla | 0;
  return function siguienteAleatorio() {
    estado = (estado + 0x6D2B79F5) | 0;
    let t = Math.imul(estado ^ (estado >>> 15), 1 | estado);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296; // número entre 0 y 1
  };
}

/* ---------- Ruido (value noise) ----------
   Sirve para generar formas "naturales" (bordes de techo, rugosidad, texturas).

   1) hashEntero: a cada punto entero (x, y) le asigna un valor pseudoaleatorio
      fijo entre 0 y 1 (mezclando los bits de x, y y la semilla).
   2) ruidoSuave: para un punto con decimales, toma los 4 puntos enteros de
      alrededor y mezcla sus valores con una curva suave (smoothstep),
      así el resultado varía de forma continua, sin saltos. */
function hashEntero(x, y, semilla) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(semilla | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function ruidoSuave(x, y, semilla) {
  const xEntero = Math.floor(x), yEntero = Math.floor(y);
  const fraccionX = x - xEntero, fraccionY = y - yEntero;
  // smoothstep: 3t² - 2t³ (curva en S, evita que se noten las "esquinas" de la grilla)
  const suaveX = fraccionX * fraccionX * (3 - 2 * fraccionX);
  const suaveY = fraccionY * fraccionY * (3 - 2 * fraccionY);
  const arribaIzq = hashEntero(xEntero, yEntero, semilla);
  const arribaDer = hashEntero(xEntero + 1, yEntero, semilla);
  const abajoIzq = hashEntero(xEntero, yEntero + 1, semilla);
  const abajoDer = hashEntero(xEntero + 1, yEntero + 1, semilla);
  const filaArriba = interpolar(arribaIzq, arribaDer, suaveX);
  const filaAbajo = interpolar(abajoIzq, abajoDer, suaveX);
  return interpolar(filaArriba, filaAbajo, suaveY);
}

/* Ruido fractal: suma 3 capas de ruido, cada una con el doble de detalle
   y menos peso (60% + 30% + 10%). Da formas grandes con detalle chico encima. */
function ruidoFractal(x, y, semilla) {
  return ruidoSuave(x, y, semilla) * 0.6
       + ruidoSuave(x * 2.1, y * 2.1, semilla + 7) * 0.3
       + ruidoSuave(x * 4.3, y * 4.3, semilla + 13) * 0.1;
}

/* ---------- Colores ----------
   Los píxeles del terreno se escriben en un Uint32Array. Cada número de 32 bits
   guarda un píxel con el orden de bytes A B G R (alfa, azul, verde, rojo),
   por cómo las PC (little-endian) leen los 4 bytes RGBA de la imagen. */
function aByte(valor) {
  return valor < 0 ? 0 : valor > 255 ? 255 : valor | 0;
}

function colorPixel(rojo, verde, azul) {
  return (0xff000000 | (aByte(azul) << 16) | (aByte(verde) << 8) | aByte(rojo)) >>> 0;
}

/* Operaciones inversas: sacar cada canal de un color empaquetado. */
function rojoDe(color)  { return color & 255; }
function verdeDe(color) { return (color >> 8) & 255; }
function azulDe(color)  { return (color >> 16) & 255; }
