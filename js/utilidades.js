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
  return hipotDet(x2 - x1, y2 - y1);
}

/* =============================================================================
   MATEMÁTICA DETERMINISTA (para el juego en red)
   -----------------------------------------------------------------------------
   En el juego online las dos PCs simulan lo mismo y solo se mandan los
   controles. Para que ambas den EXACTAMENTE el mismo resultado, la simulación
   no puede usar Math.sin/cos/pow/exp/log/hypot: cada navegador (V8, Firefox,
   Safari) los calcula distinto en los últimos bits. Las operaciones + - * / y
   Math.sqrt, en cambio, son exactas según IEEE 754 en todos lados.
   Estas funciones usan solo esas operaciones. Lo visual (render, efectos,
   sonido) puede seguir usando Math.* sin problema.
   ============================================================================= */
const DET_DOS_PI = 6.283185307179586;
const DET_MEDIO_PI = 1.5707963267948966;
const DET_LN2 = 0.6931471805599453;

/* Raíz de x² + y² (reemplaza a Math.hypot). */
function hipotDet(x, y) {
  return Math.sqrt(x * x + y * y);
}

/* Seno de un ángulo en radianes: reducción a [-π/2, π/2] + serie de Taylor. */
function senoDet(x) {
  x = x - DET_DOS_PI * Math.round(x / DET_DOS_PI);      // [-π, π]
  if (x > DET_MEDIO_PI) x = Math.PI - x;                // sen(π - x) = sen(x)
  else if (x < -DET_MEDIO_PI) x = -Math.PI - x;
  const x2 = x * x;
  // x - x³/3! + x⁵/5! - ... hasta x¹⁹ (error < 1e-15 en [-π/2, π/2])
  return x * (1 + x2 * (-1 / 6 + x2 * (1 / 120 + x2 * (-1 / 5040 + x2 * (1 / 362880
       + x2 * (-1 / 39916800 + x2 * (1 / 6227020800 + x2 * (-1 / 1307674368000
       + x2 * (1 / 355687428096000 + x2 * (-1 / 121645100408832000))))))))));
}

function cosenoDet(x) {
  return senoDet(x + DET_MEDIO_PI);
}

/* Logaritmo natural (x > 0): x = m·2^k con m en [0.75, 1.5), ln(m) por serie de atanh. */
function logDet(x) {
  if (!(x > 0)) return x === 0 ? -Infinity : NaN;
  if (x === Infinity) return Infinity;
  let k = 0;
  while (x >= 1.5) { x *= 0.5; k++; }                   // multiplicar por 0.5 es exacto
  while (x < 0.75) { x *= 2; k--; }
  const s = (x - 1) / (x + 1), s2 = s * s;              // ln(x) = 2·atanh(s)
  const serie = 2 * s * (1 + s2 * (1 / 3 + s2 * (1 / 5 + s2 * (1 / 7 + s2 * (1 / 9
              + s2 * (1 / 11 + s2 * (1 / 13 + s2 * (1 / 15 + s2 * (1 / 17)))))))));
  return k * DET_LN2 + serie;
}

/* e^x: x = k·ln2 + r con |r| <= ln2/2, serie de Taylor para e^r, y se escala por 2^k. */
function expDet(x) {
  if (x !== x) return NaN;
  if (x > 709) return Infinity;
  if (x < -745) return 0;
  const k = Math.round(x / DET_LN2);
  const r = x - k * DET_LN2;
  let termino = 1, suma = 1;
  for (let n = 1; n <= 16; n++) { termino = termino * r / n; suma += termino; }
  for (let i = 0; i < k; i++) suma *= 2;                // multiplicar por 2 o 0.5 es exacto
  for (let i = 0; i > k; i--) suma *= 0.5;
  return suma;
}

/* base^exponente (reemplaza a Math.pow). Igual que Math.pow, devuelve NaN si la base
   es negativa y el exponente no es entero. */
function potenciaDet(base, exponente) {
  if (exponente === 0) return 1;
  if (base === 0) return exponente > 0 ? 0 : Infinity;
  if (base < 0) {
    if (exponente !== Math.floor(exponente)) return NaN;
    const resultado = expDet(exponente * logDet(-base));
    return (exponente % 2 !== 0) ? -resultado : resultado;
  }
  return expDet(exponente * logDet(base));
}

/* ---------- Azar de la SIMULACIÓN (estado visible) ----------
   Todo lo que afecta el juego (dispersión de gotas, viento, magma...) usa
   azarSim(); lo puramente visual (humo, chispas, sonido) sigue con Math.random().
   Las dos PCs la inician con la misma semilla, así sortean lo mismo.
   El estado es un entero 32-bit para poder compararlo entre PCs (ver estadoAzarSim). */
let estadoAzarSimulacion = 1;

function iniciarAzarSim(semilla) {
  estadoAzarSimulacion = semilla | 0;
}

function azarSim() {
  estadoAzarSimulacion = (estadoAzarSimulacion + 0x6D2B79F5) | 0;
  let t = Math.imul(estadoAzarSimulacion ^ (estadoAzarSimulacion >>> 15), 1 | estadoAzarSimulacion);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function estadoAzarSim() {
  return estadoAzarSimulacion;
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
