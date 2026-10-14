'use strict';
/* =============================================================================
   CONTROLES TÁCTILES (celular / tablet)

   Solo se activan en pantallas táctiles (o abriendo la página con ?tactil=1,
   para probar en la PC). En ese caso:
     - Se muestran botones sobre el juego (ver index.html y estilos.css):
         abajo a la izquierda: ◀ ▶ mover, ⤒ saltar
         abajo a la derecha:   ▲ ▼ ángulo, 🔥 disparar (mantener), ⇄ llama (Worms)
     - Las armas se eligen tocando su ícono en el selector de abajo.
     - La cámara: arrastrar con un dedo la mueve, pellizcar con dos hace zoom.
     - En el menú se tocan las tarjetas de modo y el botón Empezar.
     - Solo están los modos por turnos (Tiempo real necesita dos jugadores a la
       vez y no entran en una pantalla de celular).
     - Con el celular vertical se pide girarlo: el juego es horizontal.

   Los botones funcionan como TECLAS VIRTUALES: se guardan en "botonesTactiles"
   y leerControles (entrada.js) los suma a los del teclado y el joystick.
   ============================================================================= */

const esDispositivoTactil = new URLSearchParams(location.search).has('tactil')
  || window.matchMedia('(pointer: coarse)').matches;

/* Estado de los botones que se mantienen apretados. */
const botonesTactiles = { izquierda: false, derecha: false, saltar: false, arriba: false, abajo: false, cargar: false };

/* Rectángulos del lienzo que se pueden tocar (los registra hud.js al dibujar):
   { x, y, ancho, alto, accion } en píxeles del lienzo. Se rehacen en cada cuadro. */
let zonasTocables = [];

function registrarZonaTocable(x, y, ancho, alto, accion) {
  if (esDispositivoTactil) zonasTocables.push({ x, y, ancho, alto, accion });
}

/* Modos que se ofrecen en el menú: en el celular, solo los por turnos. */
function modosDisponibles() {
  return esDispositivoTactil ? ORDEN_DE_MODOS.filter(clave => !MODOS_DE_JUEGO[clave].tiempoReal) : ORDEN_DE_MODOS;
}

/* ---------- Botones de juego ---------- */

function prepararControlesTactiles() {
  if (!esDispositivoTactil) return;
  document.body.classList.add('tactil');
  if (MODOS_DE_JUEGO[juego.modo].tiempoReal) juego.modo = modosDisponibles()[0];

  // Botones que se mantienen: apretado mientras el dedo está encima
  document.querySelectorAll('[data-mantener]').forEach(boton => {
    const nombre = boton.dataset.mantener;
    const soltar = () => { botonesTactiles[nombre] = false; boton.classList.remove('apretado'); };
    boton.addEventListener('pointerdown', evento => {
      evento.preventDefault();
      iniciarAudio();
      boton.setPointerCapture(evento.pointerId);
      botonesTactiles[nombre] = true;
      boton.classList.add('apretado');
    });
    boton.addEventListener('pointerup', soltar);
    boton.addEventListener('pointercancel', soltar);
    boton.addEventListener('lostpointercapture', soltar);
  });

  // Botones de un solo toque
  document.querySelectorAll('[data-accion]').forEach(boton => {
    boton.addEventListener('pointerdown', evento => {
      evento.preventDefault();
      iniciarAudio();
      ejecutarAccion(boton.dataset.accion, CUALQUIER_JUGADOR);
    });
  });

  document.getElementById('boton-pantalla-completa').addEventListener('pointerdown', evento => {
    evento.preventDefault();
    alternarPantallaCompleta();
  });

  prepararToquesEnElLienzo();
}

/* Pantalla completa y, si el navegador lo permite, orientación horizontal fija. */
function alternarPantallaCompleta() {
  if (document.fullscreenElement) { document.exitFullscreen(); return; }
  const raiz = document.documentElement;
  if (!raiz.requestFullscreen) return; // algunos navegadores (iPhone) no lo permiten
  raiz.requestFullscreen().then(() => {
    if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {});
  }).catch(() => {});
}

/* El <body> lleva la pantalla, el modo y la fase como atributos: estilos.css
   los usa para mostrar u ocultar botones (ej.: el de cambiar llama solo en Worms). */
function actualizarControlesTactiles() {
  if (!esDispositivoTactil) return;
  const cuerpo = document.body.dataset;
  if (cuerpo.pantalla !== juego.pantalla) cuerpo.pantalla = juego.pantalla;
  const variasLlamas = juego.pantalla === 'jugando' && llamasPorEquipo() > 1 ? 'si' : 'no';
  if (cuerpo.variasLlamas !== variasLlamas) cuerpo.variasLlamas = variasLlamas;
  // Al terminar la partida se sueltan todos (el dedo puede haber quedado sobre un botón)
  if (juego.pantalla !== 'jugando') for (const nombre in botonesTactiles) botonesTactiles[nombre] = false;
  zonasTocables = []; // hud.js las vuelve a registrar al dibujar este cuadro
}

/* ---------- Toques sobre el lienzo: zonas tocables y cámara ---------- */

const dedosEnElLienzo = new Map(); // pointerId -> { x, y } en píxeles del lienzo

function puntoEnLienzo(evento) {
  const caja = lienzo.getBoundingClientRect();
  return {
    x: (evento.clientX - caja.left) * lienzo.width / caja.width,
    y: (evento.clientY - caja.top) * lienzo.height / caja.height
  };
}

function distanciaEntreDedos() {
  const [a, b] = [...dedosEnElLienzo.values()];
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function prepararToquesEnElLienzo() {
  lienzo.style.touchAction = 'none'; // que el navegador no haga scroll ni zoom de la página

  lienzo.addEventListener('pointerdown', evento => {
    evento.preventDefault();
    iniciarAudio();
    const punto = puntoEnLienzo(evento);
    // Primero, ¿tocó algo del HUD (una tarjeta de modo, un arma)?
    const zona = zonasTocables.find(z => punto.x >= z.x && punto.x <= z.x + z.ancho && punto.y >= z.y && punto.y <= z.y + z.alto);
    if (zona) { zona.accion(); return; }
    // Si no, el dedo maneja la cámara
    lienzo.setPointerCapture(evento.pointerId);
    dedosEnElLienzo.set(evento.pointerId, punto);
  });

  lienzo.addEventListener('pointermove', evento => {
    if (!dedosEnElLienzo.has(evento.pointerId) || juego.pantalla !== 'jugando') return;
    const anterior = dedosEnElLienzo.get(evento.pointerId);
    const punto = puntoEnLienzo(evento);

    if (dedosEnElLienzo.size === 1) {
      // Un dedo: arrastrar el mundo (la cámara va al revés que el dedo)
      const escala = pixelesPorCelda();
      moverCamara(-(punto.x - anterior.x) / escala, -(punto.y - anterior.y) / escala);
      dedosEnElLienzo.set(evento.pointerId, punto);
    } else if (dedosEnElLienzo.size === 2) {
      // Dos dedos: pellizco. Si los dedos se separan, la vista se achica (acercar)
      const distanciaAntes = distanciaEntreDedos();
      dedosEnElLienzo.set(evento.pointerId, punto);
      const distanciaAhora = distanciaEntreDedos();
      if (distanciaAntes > 0 && distanciaAhora > 0) zoomCamara(distanciaAntes / distanciaAhora);
    }
  });

  const soltarDedo = evento => dedosEnElLienzo.delete(evento.pointerId);
  lienzo.addEventListener('pointerup', soltarDedo);
  lienzo.addEventListener('pointercancel', soltarDedo);
}
