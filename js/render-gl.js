'use strict';
/* =============================================================================
   TERRENO CON WEBGL2 (shader en la GPU)

   Hace lo mismo que pintarTerreno (render.js) pero en la placa de video:
   para cada celda visible calcula su color a partir del material, la
   temperatura, la masa de agua, el ruido de textura, el color del fondo y el
   tiempo. Como el color de cada celda NO depende del de las demás, es el tipo
   de cálculo que la GPU hace en paralelo (miles de celdas a la vez), mientras
   que en JavaScript se recorren una por una.

   Cómo funciona:
     1) Los datos de la grilla se suben como TEXTURAS (una imagen por propiedad):
          material   R8UI   (un entero por celda)
          temperatura R32F  (un float por celda)
          masaAgua   R32F
          fondo      RGBA8  (color del fondo de la caverna + ruido en el alfa)
          escala     RGBA8  1024×1: la escala de colores de la vista de temperatura
        Material, temperatura y masa cambian todo el tiempo: se suben en cada
        cuadro, pero solo el rectángulo que ve la cámara. El fondo solo cambia
        con un mapa nuevo (versionDelFondo, ver grilla.js).
     2) Se dibuja un triángulo que cubre todo el lienzo; el FRAGMENT SHADER corre
        una vez por píxel, y cada píxel es una celda (lienzo de 384×540).
        Con el "scissor" solo se calculan los píxeles del rectángulo visible.
     3) render.js estira este lienzo a la pantalla con el mismo drawImage de
        siempre, así la cámara y la alineación con los personajes no cambian.

   Si el navegador no tiene WebGL2 (o algo falla), se usa el camino de siempre
   en JavaScript (pintarTerreno + putImageData). Para compararlos, el panel de
   debug (P) tiene un interruptor que cambia de camino en vivo; abriendo la
   página con ?terreno=cpu se arranca con el camino en JavaScript.

   El agua de superficie a medio llenar se sigue dibujando con el canvas 2D
   (dibujarAguaParcial): el shader la pinta como aire, igual que pintarTerreno.
   ============================================================================= */

const lienzoGL = document.createElement('canvas');
lienzoGL.width = ANCHO_GRILLA;
lienzoGL.height = ALTO_GRILLA;

const terrenoGL = {
  disponible: false,    // ¿se pudo preparar WebGL2?
  usar: true,           // interruptor del panel de debug (false = dibujar en JavaScript)
  gl: null,
  programa: null,
  ubicaciones: {},      // dónde está cada uniform en el programa
  texturas: {},
  versionFondoSubida: -1
};

/* Filas de más que se suben por ENCIMA del rectángulo visible: el agua mira
   hasta 5 celdas hacia arriba para saber su profundidad, y el hielo 2. */
const FILAS_EXTRA_ARRIBA = 6;
const TAMANIO_ESCALA_TEMPERATURA = 1024;
const ESCALA_DESDE = -20, ESCALA_HASTA = 1000; // grados que cubre la tabla de colores

/* ---------- Shaders ---------- */

// Vértices: un solo triángulo enorme que tapa todo el lienzo (más simple que dos)
const CODIGO_VERTICES = `#version 300 es
void main() {
  vec2 posicion = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0);
  gl_Position = vec4(posicion, 0.0, 1.0);
}`;

/* Fragmentos: es la traducción de pintarTerreno (render.js) a GLSL, caso por caso.
   Los colores se calculan en la escala 0..255 y al final se recortan y truncan
   igual que aByte (utilidades.js), para que se vea idéntico al camino en JS. */
const CODIGO_FRAGMENTOS = `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;

uniform usampler2D uMaterial;
uniform sampler2D uTemperatura;
uniform sampler2D uMasa;
uniform sampler2D uFondo;        // rgb = fondo de la caverna, a = ruido de textura
uniform sampler2D uEscala;       // escala de colores de la vista de temperatura
uniform float uTiempo;
uniform int uVista;              // 0 normal, 1 temperatura, 2 grilla
uniform float uTemperaturaCuracion;
uniform float uMasaCeldaLlena;
uniform vec3 uColoresGrilla[6];

out vec4 colorFinal;

const int AIRE = 0, HIELO = 1, PIEDRA = 2, AGUA = 3, MAGMA = 4, MAGMA_SOLIDO = 5;
const int ANCHO = ${ANCHO_GRILLA}, ALTO = ${ALTO_GRILLA};

int materialEn(int x, int y) { return int(texelFetch(uMaterial, ivec2(x, y), 0).r); }

void main() {
  // La fila 0 de la grilla está ARRIBA, pero en WebGL el píxel (0, 0) está abajo
  int x = int(gl_FragCoord.x);
  int y = ALTO - 1 - int(gl_FragCoord.y);
  ivec2 celda = ivec2(x, y);
  int tipo = materialEn(x, y);
  float grados = texelFetch(uTemperatura, celda, 0).r;

  if (uVista == 2) { colorFinal = vec4(uColoresGrilla[tipo], 1.0); return; }

  if (uVista == 1) {
    // Posición en la tabla de colores; se mezclan las dos entradas vecinas
    // (interpolación lineal, como colorDeTemperatura) para no ver escalones
    float lugar = clamp((grados - float(${ESCALA_DESDE})) / float(${ESCALA_HASTA - ESCALA_DESDE}), 0.0, 1.0) * float(${TAMANIO_ESCALA_TEMPERATURA - 1});
    int entrada = min(int(lugar), ${TAMANIO_ESCALA_TEMPERATURA - 2});
    vec3 color = floor(mix(texelFetch(uEscala, ivec2(entrada, 0), 0).rgb, texelFetch(uEscala, ivec2(entrada + 1, 0), 0).rgb,
                           lugar - float(entrada)) * 255.0 + 0.5);
    if (tipo == AIRE) color = floor(color * 0.35); // el aire se oscurece para que se vean las formas
    colorFinal = vec4(color / 255.0, 1.0);
    return;
  }

  vec4 datosFondo = texelFetch(uFondo, celda, 0);
  vec3 fondo = floor(datosFondo.rgb * 255.0 + 0.5);
  float ruido = floor(datosFondo.a * 255.0 + 0.5) / 255.0 - 0.5;   // -0.5 .. 0.5
  int materialArriba = y > 0 ? materialEn(x, y - 1) : PIEDRA;
  vec3 color;

  if (tipo == AIRE) {
    color = fondo;
    // El aire muy caliente (recién explotado) brilla anaranjado
    if (grados > 30.0) {
      float brillo = min(1.0, (grados - 30.0) / 150.0);
      color.r += 110.0 * brillo; color.g += 40.0 * brillo;
    }
  } else if (tipo == HIELO) {
    if (materialArriba == AIRE) {
      color = vec3(222.0, 244.0, 255.0); // borde superior: escarcha clara
    } else {
      float profundo = (y > 1 && materialEn(x, y - 2) == HIELO) ? 0.92 : 1.0;
      color = vec3(160.0 + ruido * 34.0, 208.0 + ruido * 26.0, 238.0 + ruido * 14.0) * profundo;
    }
    // Hielo a punto de derretirse: se pone más cálido
    if (grados > -2.0) {
      float tibieza = min(1.0, (grados + 2.0) / 2.0);
      color.r += 18.0 * tibieza; color.g += 6.0 * tibieza;
    }
  } else if (tipo == PIEDRA) {
    float gris = 70.0 + ruido * 34.0;
    color = vec3(gris, gris + 5.0, gris + 16.0);
  } else if (tipo == AGUA) {
    // Cuántas celdas de agua hay arriba (hasta 5): más profunda = más oscura
    int profundidad = 0;
    for (int k = 1; k <= 5; k++) {
      if (y - k < 0 || materialEn(x, y - k) != AGUA) break;
      profundidad++;
    }
    if (profundidad == 0 && materialArriba == AIRE) {
      // Superficie: clara y con un brillo ondulante
      float onda = sin(uTiempo * 3.0 + float(x) * 0.45) * 12.0;
      color = vec3(120.0 + onda, 195.0 + onda, 250.0);
      float masa = texelFetch(uMasa, celda, 0).r;
      if (masa == 0.0) masa = 1.0; // masa 0 = recién creada = llena
      // Celda parcial: queda como aire; render.js la dibuja encima con su altura
      if (masa < uMasaCeldaLlena) color = fondo;
    } else {
      // Agua semitransparente: 25% fondo + 75% azul
      float oscuridad = float(profundidad) / 5.0;
      color = fondo * 0.25 + vec3(40.0 - 15.0 * oscuridad, 115.0 - 40.0 * oscuridad + ruido * 10.0, 215.0 - 40.0 * oscuridad) * 0.75;
    }
  } else if (tipo == MAGMA) {
    // Más caliente = más amarillo. El seno hace que "burbujee".
    float calor = clamp((grados - 600.0) / 400.0, 0.0, 1.0);
    float burbujeo = sin(uTiempo * 6.0 + float(x) * 0.7 + float(y) * 0.5) * 20.0;
    color = vec3(255.0, 80.0 + calor * 140.0 + ruido * 40.0 + burbujeo, 20.0 + calor * 60.0);
  } else {
    // MAGMA_SOLIDO: roca marrón que brilla rojo mientras sigue caliente (y cura)
    float incandescencia = clamp((grados - uTemperaturaCuracion) / 450.0, 0.0, 1.0) * 0.85;
    color = vec3(88.0 + ruido * 30.0, 56.0 + ruido * 20.0, 40.0 + ruido * 14.0);
    color += (vec3(235.0, 95.0, 25.0) - color) * incandescencia;
  }

  // Igual que aByte: recortar a 0..255 y truncar
  colorFinal = vec4(floor(clamp(color, 0.0, 255.0)) / 255.0, 1.0);
}`;

/* ---------- Preparación ---------- */

function compilarShader(gl, tipo, codigo) {
  const shader = gl.createShader(tipo);
  gl.shaderSource(shader, codigo);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error('Error compilando shader: ' + gl.getShaderInfoLog(shader));
  }
  return shader;
}

/* Crea una textura vacía del tamaño de la grilla, sin filtrado (cada texel es
   una celda: no se mezclan vecinas). */
function crearTextura(gl, formatoInterno, formato, tipoDato, ancho, alto) {
  const textura = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, textura);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texStorage2D(gl.TEXTURE_2D, 1, formatoInterno, ancho, alto);
  return { textura, formato, tipoDato };
}

/* La escala de colores de la vista de temperatura se arma desde
   colorDeTemperatura (render.js): así hay una sola definición de los colores. */
function datosDeLaEscalaDeTemperatura() {
  const datos = new Uint8Array(TAMANIO_ESCALA_TEMPERATURA * 4);
  for (let i = 0; i < TAMANIO_ESCALA_TEMPERATURA; i++) {
    const grados = ESCALA_DESDE + (ESCALA_HASTA - ESCALA_DESDE) * i / (TAMANIO_ESCALA_TEMPERATURA - 1);
    const color = colorDeTemperatura(grados);
    datos.set([rojoDe(color), verdeDe(color), azulDe(color), 255], i * 4);
  }
  return datos;
}

function prepararTerrenoGL() {
  // Con ?terreno=cpu se arranca dibujando en JS (igual se prepara WebGL, para poder cambiar en vivo)
  if (new URLSearchParams(location.search).get('terreno') === 'cpu') terrenoGL.usar = false;
  try {
    const gl = lienzoGL.getContext('webgl2', { alpha: false, antialias: false, depth: false, preserveDrawingBuffer: true });
    if (!gl) return;
    terrenoGL.gl = gl;

    const programa = gl.createProgram();
    gl.attachShader(programa, compilarShader(gl, gl.VERTEX_SHADER, CODIGO_VERTICES));
    gl.attachShader(programa, compilarShader(gl, gl.FRAGMENT_SHADER, CODIGO_FRAGMENTOS));
    gl.linkProgram(programa);
    if (!gl.getProgramParameter(programa, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(programa));
    terrenoGL.programa = programa;
    gl.useProgram(programa);
    for (const nombre of ['uMaterial', 'uTemperatura', 'uMasa', 'uFondo', 'uEscala', 'uTiempo', 'uVista',
                          'uTemperaturaCuracion', 'uMasaCeldaLlena', 'uColoresGrilla']) {
      terrenoGL.ubicaciones[nombre] = gl.getUniformLocation(programa, nombre);
    }

    // Una unidad de textura por dato (0..4)
    const t = terrenoGL.texturas;
    t.material = crearTextura(gl, gl.R8UI, gl.RED_INTEGER, gl.UNSIGNED_BYTE, ANCHO_GRILLA, ALTO_GRILLA);
    t.temperatura = crearTextura(gl, gl.R32F, gl.RED, gl.FLOAT, ANCHO_GRILLA, ALTO_GRILLA);
    t.masa = crearTextura(gl, gl.R32F, gl.RED, gl.FLOAT, ANCHO_GRILLA, ALTO_GRILLA);
    t.fondo = crearTextura(gl, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, ANCHO_GRILLA, ALTO_GRILLA);
    t.escala = crearTextura(gl, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, TAMANIO_ESCALA_TEMPERATURA, 1);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, TAMANIO_ESCALA_TEMPERATURA, 1, gl.RGBA, gl.UNSIGNED_BYTE, datosDeLaEscalaDeTemperatura());
    [t.material, t.temperatura, t.masa, t.fondo, t.escala].forEach((datos, unidad) => {
      gl.activeTexture(gl.TEXTURE0 + unidad);
      gl.bindTexture(gl.TEXTURE_2D, datos.textura);
    });
    const u = terrenoGL.ubicaciones;
    gl.uniform1i(u.uMaterial, 0);
    gl.uniform1i(u.uTemperatura, 1);
    gl.uniform1i(u.uMasa, 2);
    gl.uniform1i(u.uFondo, 3);
    gl.uniform1i(u.uEscala, 4);
    gl.uniform1f(u.uMasaCeldaLlena, MASA_PARA_CELDA_LLENA);
    const colores = [];
    for (const c of COLORES_VISTA_GRILLA) colores.push(rojoDe(c) / 255, verdeDe(c) / 255, azulDe(c) / 255);
    gl.uniform3fv(u.uColoresGrilla, colores);
    // bindTexture actúa sobre la unidad ACTIVA: las subidas de cada cuadro se hacen
    // en una unidad libre (5) para no desenganchar las texturas de las unidades 0..4
    gl.activeTexture(gl.TEXTURE0 + 5);

    // Las filas de los arreglos de la grilla están pegadas (sin relleno entre filas)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, ANCHO_GRILLA);
    gl.enable(gl.SCISSOR_TEST);
    gl.viewport(0, 0, ANCHO_GRILLA, ALTO_GRILLA);

    lienzoGL.addEventListener('webglcontextlost', () => { terrenoGL.disponible = false; });
    terrenoGL.disponible = true;
  } catch (error) {
    console.warn('Terreno con WebGL2 no disponible, se usa el dibujo en JavaScript.', error);
    terrenoGL.disponible = false;
  }
}

/* ---------- Dibujo de cada cuadro ---------- */

/* Sube el rectángulo [x0, x1) × [y0, y1) de un arreglo de la grilla a su textura.
   UNPACK_SKIP_* indican desde dónde leer dentro del arreglo completo. */
function subirRectangulo(datos, arreglo, x0, y0, x1, y1) {
  const gl = terrenoGL.gl;
  gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, x0);
  gl.pixelStorei(gl.UNPACK_SKIP_ROWS, y0);
  gl.bindTexture(gl.TEXTURE_2D, datos.textura);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, x0, y0, x1 - x0, y1 - y0, datos.formato, datos.tipoDato, arreglo);
}

/* El fondo y el ruido solo cambian con un mapa nuevo: se arman en una sola
   imagen RGBA y se suben enteros. */
const datosFondo = new Uint8Array(TOTAL_CELDAS * 4);
function subirFondoSiCambio() {
  if (terrenoGL.versionFondoSubida === versionDelFondo) return;
  for (let i = 0, j = 0; i < TOTAL_CELDAS; i++, j += 4) {
    datosFondo[j] = fondoRojo[i];
    datosFondo[j + 1] = fondoVerde[i];
    datosFondo[j + 2] = fondoAzul[i];
    datosFondo[j + 3] = texturaRuido[i];
  }
  subirRectangulo(terrenoGL.texturas.fondo, datosFondo, 0, 0, ANCHO_GRILLA, ALTO_GRILLA);
  terrenoGL.versionFondoSubida = versionDelFondo;
}

/* Pinta las celdas visibles con el shader. Devuelve false si no hay WebGL2
   (entonces render.js usa pintarTerreno). */
function pintarTerrenoGL(x0, y0, x1, y1) {
  if (!terrenoGL.disponible || !terrenoGL.usar) return false;
  const gl = terrenoGL.gl, t = terrenoGL.texturas, u = terrenoGL.ubicaciones;

  subirFondoSiCambio();
  const yDesde = Math.max(0, y0 - FILAS_EXTRA_ARRIBA);
  subirRectangulo(t.material, material, x0, yDesde, x1, y1);
  subirRectangulo(t.temperatura, temperatura, x0, yDesde, x1, y1);
  subirRectangulo(t.masa, masaAgua, x0, yDesde, x1, y1);

  gl.uniform1f(u.uTiempo, tiempoTotal);
  gl.uniform1i(u.uVista, vista.grilla ? 2 : vista.temperatura ? 1 : 0);
  gl.uniform1f(u.uTemperaturaCuracion, PARAMETROS.temperaturaCuracion);

  // Solo los píxeles visibles (el scissor cuenta las filas desde ABAJO)
  gl.scissor(x0, ALTO_GRILLA - y1, x1 - x0, y1 - y0);
  gl.drawArrays(gl.TRIANGLES, 0, 3);

  if (!vista.grilla && !vista.temperatura) recolectarAguaParcial(x0, y0, x1, y1);
  else celdasDeAguaParcial.length = 0;
  return true;
}

/* Las celdas de superficie con menos de una celda de agua las dibuja render.js
   encima (dibujarAguaParcial). En el camino en JS se juntan mientras se pinta;
   acá hay que buscarlas aparte (solo se mira el material, es un recorrido barato). */
function recolectarAguaParcial(x0, y0, x1, y1) {
  celdasDeAguaParcial.length = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0, i = y * ANCHO_GRILLA + x0; x < x1; x++, i++) {
      if (material[i] !== AGUA) continue;
      const arriba = y > 0 ? material[i - ANCHO_GRILLA] : PIEDRA;
      if (arriba !== AIRE) continue;
      const masa = masaAgua[i] || 1; // masa 0 = recién creada = llena
      if (masa < MASA_PARA_CELDA_LLENA) celdasDeAguaParcial.push(i, masa, Math.sin(tiempoTotal * 3 + x * 0.45) * 12);
    }
  }
}

prepararTerrenoGL();
