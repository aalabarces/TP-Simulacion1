'use strict';
/* =============================================================================
   CÁMARA

   El mundo (320×540) es más grande que la pantalla. La cámara dice qué parte se ve:
     x, y        centro de la vista, en celdas
     vistaAncho  cuántas celdas entran a lo ANCHO de la pantalla (el zoom):
                 más chico = más cerca. El alto sale de la proporción de la ventana.

   Dos modos:
     AUTOMÁTICO  La cámara se mueve sola (con suavizado):
                   - por turnos: sigue a la llama del turno, al proyectil en vuelo y,
                     mientras el agua se asienta, al lugar del impacto;
                   - tiempo real: encuadra a las dos llamas (zoom dinámico);
                   - título y fin de partida: muestra la arena (las plataformas).
     LIBRE       El jugador la maneja a mano (mouse, teclado o joystick). Vuelve al
                 automático al empezar el turno, al disparar, con C o tras unos
                 segundos sin tocarla.

   El zoom que elige el jugador (rueda, teclas, joystick) queda guardado en
   "vistaPreferida" y lo usa el modo automático de los turnos.
   ============================================================================= */

const VISTA_ANCHO_MINIMA = 50;        // zoom máximo: 50 celdas a lo ancho
const VISTA_ANCHO_INICIAL = 200;      // zoom con el que arranca una partida
const VISTA_TIEMPO_REAL_MINIMA = 140; // en tiempo real nunca se acerca más que esto
const TIEMPO_LIBRE_SIN_TOCAR = 6;     // segundos hasta que la cámara libre vuelve sola
const SUAVIZADO_CAMARA = 5;           // más alto = la cámara sigue más rápido
const SUAVIZADO_CAMARA_PROYECTIL = 9;

const camara = {
  // Lo que se dibuja
  x: ANCHO_GRILLA / 2, y: ALTO_GRILLA / 2, vistaAncho: ANCHO_GRILLA,
  // A donde va (en modo libre solo lo cambia el jugador)
  objetivoX: ANCHO_GRILLA / 2, objetivoY: ALTO_GRILLA / 2, objetivoVista: ANCHO_GRILLA,
  vistaPreferida: VISTA_ANCHO_INICIAL,
  libre: false,
  tiempoSinTocar: 0,
  foco: null,                         // { x, y } del último impacto del turno
  geometria: { ancho: 1, alto: 1, franjaHud: 0, altoVista: 1, unidad: 1 }
};

/* Rectángulo de pantalla donde se ve el mundo: todo el lienzo menos la franja
   del HUD de arriba. Se recalcula en cada cuadro. */
function calcularGeometriaPantalla() {
  const ancho = lienzo.width, alto = lienzo.height;
  const unidad = calcularUnidadHud(ancho, alto);
  const franjaHud = 9.8 * unidad;
  const g = camara.geometria;
  g.ancho = ancho; g.alto = alto; g.unidad = unidad; g.franjaHud = franjaHud;
  g.altoVista = Math.max(1, alto - franjaHud);
  return g;
}

/* Zoom mínimo (vista más ancha): todo el mundo entra en pantalla. */
function vistaAnchoMaxima() {
  const g = camara.geometria;
  return Math.max(ANCHO_GRILLA, ALTO_GRILLA * g.ancho / g.altoVista);
}

function pixelesPorCelda() {
  return camara.geometria.ancho / camara.vistaAncho;
}

/* Mantiene el zoom dentro de los límites y la vista dentro del mundo. Si el
   mundo es más chico que la vista en un eje, queda centrado en ese eje. */
function limitarCamara(vistaAncho, x, y) {
  const g = camara.geometria;
  const vista = limitar(vistaAncho, VISTA_ANCHO_MINIMA, vistaAnchoMaxima());
  const mitadAncho = vista / 2;
  const mitadAlto = vista * g.altoVista / g.ancho / 2;
  return {
    vista,
    x: mitadAncho * 2 >= ANCHO_GRILLA ? ANCHO_GRILLA / 2 : limitar(x, mitadAncho, ANCHO_GRILLA - mitadAncho),
    y: mitadAlto * 2 >= ALTO_GRILLA ? ALTO_GRILLA / 2 : limitar(y, mitadAlto, ALTO_GRILLA - mitadAlto)
  };
}

/* ---------- Conversión entre pantalla y mundo ---------- */

function pantallaACelda(pixelX, pixelY) {
  const g = camara.geometria, escala = pixelesPorCelda();
  return {
    x: camara.x + (pixelX - g.ancho / 2) / escala,
    y: camara.y + (pixelY - g.franjaHud - g.altoVista / 2) / escala
  };
}

/* Celdas que se ven ahora (con un margen), recortadas al mundo. Sirve para pintar
   solo lo visible. Devuelve límites [x0, x1) × [y0, y1). */
function rectanguloVisible(margen) {
  const g = camara.geometria, escala = pixelesPorCelda();
  const mitadAncho = g.ancho / 2 / escala, mitadAlto = g.altoVista / 2 / escala;
  return {
    x0: Math.max(0, Math.floor(camara.x - mitadAncho) - margen),
    x1: Math.min(ANCHO_GRILLA, Math.ceil(camara.x + mitadAncho) + margen),
    y0: Math.max(0, Math.floor(camara.y - mitadAlto) - margen),
    y1: Math.min(ALTO_GRILLA, Math.ceil(camara.y + mitadAlto) + margen)
  };
}

/* ---------- Control manual ---------- */

function tomarControlDeLaCamara() {
  if (!camara.libre) {
    camara.libre = true;
    camara.objetivoX = camara.x; camara.objetivoY = camara.y; camara.objetivoVista = camara.vistaAncho;
  }
  camara.tiempoSinTocar = 0;
}

/* Desplaza la cámara (en celdas). */
function moverCamara(desplazamientoX, desplazamientoY) {
  tomarControlDeLaCamara();
  const l = limitarCamara(camara.objetivoVista, camara.objetivoX + desplazamientoX, camara.objetivoY + desplazamientoY);
  camara.objetivoX = l.x; camara.objetivoY = l.y;
}

/* Zoom multiplicando la vista: factor < 1 = acercar. Si se pasa un punto de la
   pantalla (el mouse), ese punto del mundo se queda quieto bajo el cursor. */
function zoomCamara(factor, pixelX, pixelY) {
  tomarControlDeLaCamara();
  const g = camara.geometria;
  const vistaVieja = camara.objetivoVista;
  const l0 = limitarCamara(vistaVieja * factor, camara.objetivoX, camara.objetivoY);
  let x = l0.x, y = l0.y;
  if (pixelX !== undefined) {
    // Celda bajo el cursor antes del zoom y su posición en pantalla después
    const escalaVieja = g.ancho / vistaVieja, escalaNueva = g.ancho / l0.vista;
    const celdaX = camara.objetivoX + (pixelX - g.ancho / 2) / escalaVieja;
    const celdaY = camara.objetivoY + (pixelY - g.franjaHud - g.altoVista / 2) / escalaVieja;
    x = celdaX - (pixelX - g.ancho / 2) / escalaNueva;
    y = celdaY - (pixelY - g.franjaHud - g.altoVista / 2) / escalaNueva;
  }
  const l = limitarCamara(l0.vista, x, y);
  camara.objetivoVista = l.vista; camara.objetivoX = l.x; camara.objetivoY = l.y;
  camara.vistaPreferida = l.vista;
}

/* Vuelve al modo automático (C, empezar turno, disparar). */
function recentrarCamara() {
  camara.libre = false;
  camara.tiempoSinTocar = 0;
}

/* Salta directo al objetivo, sin recorrido (al empezar la partida o armar un mundo). */
function colocarCamaraYa() {
  recentrarCamara();
  camara.foco = null;
  calcularGeometriaPantalla();
  const o = objetivoAutomatico();
  const l = limitarCamara(o.vista, o.x, o.y);
  camara.x = camara.objetivoX = l.x;
  camara.y = camara.objetivoY = l.y;
  camara.vistaAncho = camara.objetivoVista = l.vista;
}

/* ---------- Modo automático ---------- */

function objetivoAutomatico() {
  const g = camara.geometria;
  // Título y fin: la arena (donde están las plataformas), a lo ancho del mundo
  const centroDelMundo = { x: ANCHO_GRILLA / 2, y: mapa.filaArena || ALTO_GRILLA / 2, vista: ANCHO_GRILLA };
  if (juego.pantalla !== 'jugando') return centroDelMundo;

  if (esTiempoReal()) {
    const vivas = llamas.filter(llama => llama.vivo);
    if (vivas.length === 0) return centroDelMundo;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const llama of vivas) {
      minX = Math.min(minX, llama.centroX); maxX = Math.max(maxX, llama.centroX);
      minY = Math.min(minY, llama.centroY); maxY = Math.max(maxY, llama.centroY);
    }
    const proporcion = g.ancho / g.altoVista;
    const necesaria = Math.max(maxX - minX + 90, (maxY - minY + 55) * proporcion, VISTA_TIEMPO_REAL_MINIMA);
    return { x: (minX + maxX) / 2, y: (minY + maxY) / 2, vista: Math.max(necesaria, camara.vistaPreferida) };
  }

  // Por turnos
  let foco = null;
  if (juego.fase === 'vuelo' && proyectiles.length > 0) foco = proyectiles[0];
  else if (juego.fase === 'asentando' && camara.foco) foco = camara.foco;
  else {
    const llama = llamaActual();
    if (llama) foco = { x: llama.centroX, y: llama.centroY };
  }
  if (!foco) return centroDelMundo;
  return { x: foco.x, y: foco.y, vista: camara.vistaPreferida };
}

/* Se llama una vez por cuadro, antes de dibujar. */
function actualizarCamara(dt) {
  if (lienzo.width < 2 || lienzo.height < 2) return; // ventana sin tamaño: no hay nada que encuadrar
  calcularGeometriaPantalla();

  if (camara.libre) {
    camara.tiempoSinTocar += dt;
    if (camara.tiempoSinTocar > TIEMPO_LIBRE_SIN_TOCAR) recentrarCamara();
  }
  if (!camara.libre) {
    const o = objetivoAutomatico();
    const l = limitarCamara(o.vista, o.x, o.y);
    camara.objetivoX = l.x; camara.objetivoY = l.y; camara.objetivoVista = l.vista;
  }

  // Suavizado exponencial: independiente de los FPS
  const rapidez = juego.fase === 'vuelo' && !camara.libre ? SUAVIZADO_CAMARA_PROYECTIL : SUAVIZADO_CAMARA;
  const k = 1 - Math.exp(-rapidez * dt);
  camara.x += (camara.objetivoX - camara.x) * k;
  camara.y += (camara.objetivoY - camara.y) * k;
  // El zoom se interpola en escala logarítmica: acercar y alejar se siente igual de rápido
  camara.vistaAncho *= Math.pow(camara.objetivoVista / camara.vistaAncho, k);
  // La ventana pudo cambiar de tamaño: se vuelve a limitar lo que se dibuja
  const l = limitarCamara(camara.vistaAncho, camara.x, camara.y);
  camara.vistaAncho = l.vista; camara.x = l.x; camara.y = l.y;
}

/* ---------- Mouse ---------- */

let arrastrandoCamara = false;

function posicionEnLienzo(evento) {
  const caja = lienzo.getBoundingClientRect();
  return {
    x: (evento.clientX - caja.left) * lienzo.width / caja.width,
    y: (evento.clientY - caja.top) * lienzo.height / caja.height
  };
}

lienzo.addEventListener('wheel', evento => {
  evento.preventDefault();
  const punto = posicionEnLienzo(evento);
  // Cada "clic" de rueda cambia el zoom un 15%
  zoomCamara(Math.pow(1.15, Math.sign(evento.deltaY)), punto.x, punto.y);
}, { passive: false });

lienzo.addEventListener('mousedown', evento => {
  if (evento.button !== 0 && evento.button !== 1 && evento.button !== 2) return;
  arrastrandoCamara = true;
  evento.preventDefault();
});
lienzo.addEventListener('contextmenu', evento => evento.preventDefault());
window.addEventListener('mouseup', () => { arrastrandoCamara = false; });
window.addEventListener('mousemove', evento => {
  if (!arrastrandoCamara) return;
  // movementX está en píxeles CSS: se pasa a píxeles del lienzo y de ahí a celdas
  const caja = lienzo.getBoundingClientRect();
  const aPixelesLienzo = lienzo.width / caja.width;
  const escala = pixelesPorCelda();
  moverCamara(-evento.movementX * aPixelesLienzo / escala, -evento.movementY * aPixelesLienzo / escala);
});

/* ---------- Teclado (I J K L mueven, - = zoom, C recentra) ---------- */

const VELOCIDAD_CAMARA_TECLADO = 0.7;   // la vista (en celdas de ancho) por segundo
const VELOCIDAD_ZOOM_TECLADO = 1.8;     // veces por segundo

/* Se llama una vez por cuadro con el tiempo transcurrido. */
function leerCamaraManual(dt) {
  const vista = camara.libre ? camara.objetivoVista : camara.vistaAncho;
  const paso = VELOCIDAD_CAMARA_TECLADO * vista * dt;
  const dx = (teclaApretada('KeyL') ? 1 : 0) - (teclaApretada('KeyJ') ? 1 : 0);
  const dy = (teclaApretada('KeyK') ? 1 : 0) - (teclaApretada('KeyI') ? 1 : 0);
  if (dx || dy) moverCamara(dx * paso, dy * paso);

  const zoom = (teclaApretada('Equal') || teclaApretada('NumpadAdd') ? 1 : 0)
             - (teclaApretada('Minus') || teclaApretada('NumpadSubtract') ? 1 : 0);
  if (zoom) zoomCamara(Math.pow(VELOCIDAD_ZOOM_TECLADO, -zoom * dt * 2));

  // Joystick: con LT apretado el stick derecho mueve la cámara y la cruz ↑ ↓ hace zoom
  for (const joystick of estadoJoysticks) {
    if (!joystick.camara) continue;
    if (joystick.camaraX || joystick.camaraY) moverCamara(joystick.camaraX * paso * 1.5, joystick.camaraY * paso * 1.5);
    if (joystick.camaraZoom) zoomCamara(Math.pow(VELOCIDAD_ZOOM_TECLADO, -joystick.camaraZoom * dt * 2));
  }
}
