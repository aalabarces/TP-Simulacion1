'use strict';
/* =============================================================================
   TECLADO (y unión con los joysticks)

   Hay un esquema de teclas por jugador, pensado para que los dos entren en el
   mismo teclado al mismo tiempo (modo Tiempo real):

                      J1 (izquierda)     J2 (derecha)
     Mover            A / D              ← / →
     Saltar           Espacio            Shift derecho
     Apuntar          W / S              ↑ / ↓
     Cargar/disparar  F (mantener)       Enter (mantener)
     Cambiar arma     Q                  . (punto)

   En los modos POR TURNOS los dos esquemas (y cualquier joystick) controlan a
   la llama del turno: el que juega usa el que le quede más cómodo.

   Ojo: muchos teclados no registran más de 3 o 4 teclas a la vez ("ghosting");
   para Tiempo real conviene usar joysticks.

   Otras teclas: Tab cambiar de llama (Worms) · P debug · N sonido ·
   8 vista de temperatura · 9 vista de grilla · 0 nuevo mapa · M menú (al terminar).
   ============================================================================= */

const ESQUEMAS_DE_TECLADO = [
  { // J1
    izquierda: ['KeyA'], derecha: ['KeyD'], saltar: ['Space'],
    apuntarArriba: ['KeyW'], apuntarAbajo: ['KeyS'], cargar: ['KeyF'], cambiarArma: ['KeyQ']
  },
  { // J2
    izquierda: ['ArrowLeft'], derecha: ['ArrowRight'], saltar: ['ShiftRight'],
    apuntarArriba: ['ArrowUp'], apuntarAbajo: ['ArrowDown'], cargar: ['Enter', 'NumpadEnter'], cambiarArma: ['Period']
  }
];
const CUALQUIER_JUGADOR = -1; // en los modos por turnos, cualquier control mueve a la llama del turno

const teclasApretadas = new Set();

/* Teclas que se ignoran hasta que se suelten. Al empezar la partida con Enter,
   esa misma tecla (que también es la de disparar de J2) sigue apretada: sin
   esto, el juego la tomaría como carga y dispararía al soltarla. */
const teclasIgnoradasHastaSoltar = new Set();

function ignorarTeclasApretadas() {
  for (const codigo of teclasApretadas) teclasIgnoradasHastaSoltar.add(codigo);
}

function teclaApretada(codigo) {
  return teclasApretadas.has(codigo) && !teclasIgnoradasHastaSoltar.has(codigo);
}

function algunaApretada(codigos) {
  return codigos.some(teclaApretada);
}

/* Controles de un jugador (0 = J1, 1 = J2, o CUALQUIER_JUGADOR), sumando su
   esquema de teclado y su joystick:
     mover:   -1 (izquierda) .. 1 (derecha)
     apuntar: -1 (bajar el ángulo) .. 1 (subirlo); con stick puede ser intermedio
     saltar, cargar: true / false */
function leerControles(jugador) {
  const esquemas = jugador === CUALQUIER_JUGADOR ? ESQUEMAS_DE_TECLADO : [ESQUEMAS_DE_TECLADO[jugador]];
  const joysticks = jugador === CUALQUIER_JUGADOR ? estadoJoysticks : estadoJoysticks.filter(j => j.numero === jugador);

  let mover = 0, apuntar = 0, saltar = false, cargar = false;
  for (const esquema of esquemas) {
    mover += (algunaApretada(esquema.derecha) ? 1 : 0) - (algunaApretada(esquema.izquierda) ? 1 : 0);
    apuntar += (algunaApretada(esquema.apuntarArriba) ? 1 : 0) - (algunaApretada(esquema.apuntarAbajo) ? 1 : 0);
    saltar = saltar || algunaApretada(esquema.saltar);
    cargar = cargar || algunaApretada(esquema.cargar);
  }
  for (const joystick of joysticks) {
    mover += joystick.mover;
    apuntar += joystick.apuntar;
    saltar = saltar || joystick.saltar;
    cargar = cargar || joystick.cargar;
  }
  return { mover: limitar(mover, -1, 1), apuntar: limitar(apuntar, -1, 1), saltar, cargar };
}

/* ¿Qué llama maneja este jugador ahora? En Tiempo real, la suya; en los modos
   por turnos, la del turno (para cualquier jugador). */
function llamaQueManeja(jugador) {
  if (MODOS_DE_JUEGO[juego.modo].tiempoReal) return llamasDelEquipo(jugador)[0];
  return llamaActual();
}

/* Acciones de un solo toque, vengan del teclado o de un joystick. */
function ejecutarAccion(accion, jugador) {
  switch (accion) {
    case 'aceptar':
      if (juego.pantalla !== 'jugando') {
        empezarPartida(); // en "fin" es la revancha con el mismo modo
        ignorarTeclasApretadas();   // el Enter que empezó la partida no cuenta como disparo
        ignorarBotonesApretados();  // ni el A / Start del joystick como salto
      }
      break;
    case 'menu':
      if (juego.pantalla === 'fin') juego.pantalla = 'titulo';
      break;
    case 'modoAnterior':
      if (juego.pantalla === 'titulo') elegirModo(-1);
      break;
    case 'modoSiguiente':
      if (juego.pantalla === 'titulo') elegirModo(1);
      break;
    case 'cambiarLlama':
      cambiarDeLlama();
      break;
    case 'cambiarArma': {
      const llama = llamaQueManeja(jugador);
      if (puedeCambiarDeArma(llama)) { llama.arma = 1 - llama.arma; sonarCambioDeLlama(); }
      break;
    }
  }
}

/* Se puede cambiar de arma mientras se apunta y sin estar cargando un disparo. */
function puedeCambiarDeArma(llama) {
  if (!llama || !llama.vivo || juego.pantalla !== 'jugando' || llama.cargando) return false;
  return MODOS_DE_JUEGO[juego.modo].tiempoReal || juego.fase === 'apuntar';
}

/* Jugador al que pertenece una tecla (por su esquema), o CUALQUIER_JUGADOR. */
function jugadorDeLaTecla(codigo) {
  const indice = ESQUEMAS_DE_TECLADO.findIndex(esquema => Object.values(esquema).some(teclas => teclas.includes(codigo)));
  return indice >= 0 ? indice : CUALQUIER_JUGADOR;
}

window.addEventListener('keydown', evento => {
  // Si había un slider del panel de debug enfocado, se le quita el foco
  // para que las flechas muevan al jugador y no al slider.
  const elementoEnfocado = document.activeElement;
  if (elementoEnfocado && elementoEnfocado.tagName === 'INPUT') elementoEnfocado.blur();

  // El navegador solo deja arrancar el audio después de una acción del usuario
  iniciarAudio();

  teclasApretadas.add(evento.code);
  // Evitar que Espacio y las flechas hagan scroll en la página, y que Tab cambie el foco
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(evento.code)) evento.preventDefault();

  // Las acciones de un solo toque no se repiten al mantener la tecla
  if (evento.repeat) return;
  const jugador = jugadorDeLaTecla(evento.code);

  switch (evento.code) {
    case 'Enter': case 'NumpadEnter': ejecutarAccion('aceptar', jugador); break;
    case 'KeyM': ejecutarAccion('menu', jugador); break;
    case 'Tab': ejecutarAccion('cambiarLlama', jugador); break;
    case 'KeyQ': case 'Period': ejecutarAccion('cambiarArma', jugador); break;
    case 'KeyP': alternarPanelDebug(); break;
    case 'KeyN': alternarSilencio(); break;
    case 'Digit8': cambiarVista('temperatura', !vista.temperatura); break;
    case 'Digit9': cambiarVista('grilla', !vista.grilla); break;
    case 'Digit0': if (juego.pantalla === 'jugando') empezarPartida(); else prepararMundo(); break;
  }

  // Menú: elegir el modo con las flechas, A/D o el número de la tarjeta
  if (juego.pantalla === 'titulo') {
    if (evento.code === 'ArrowLeft' || evento.code === 'KeyA') ejecutarAccion('modoAnterior', jugador);
    if (evento.code === 'ArrowRight' || evento.code === 'KeyD') ejecutarAccion('modoSiguiente', jugador);
    const numero = ['Digit1', 'Digit2', 'Digit3'].indexOf(evento.code);
    if (numero >= 0 && numero < ORDEN_DE_MODOS.length) elegirModoPorNumero(numero);
  }
});

window.addEventListener('keyup', evento => {
  teclasApretadas.delete(evento.code);
  teclasIgnoradasHastaSoltar.delete(evento.code);
});

// Si la ventana pierde el foco, se "sueltan" todas las teclas
window.addEventListener('blur', () => {
  teclasApretadas.clear();
  teclasIgnoradasHastaSoltar.clear();
});
