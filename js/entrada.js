'use strict';
/* =============================================================================
   TECLADO
   Los dos jugadores usan las mismas teclas (juegan por turnos).
   ============================================================================= */

const teclasApretadas = new Set();

function teclaApretada(codigo) {
  return teclasApretadas.has(codigo);
}

/* Controles de movimiento del jugador activo. */
function leerControles() {
  return {
    izquierda: teclaApretada('KeyA') || teclaApretada('ArrowLeft'),
    derecha: teclaApretada('KeyD') || teclaApretada('ArrowRight'),
    saltar: teclaApretada('KeyW')
  };
}

window.addEventListener('keydown', evento => {
  // Si había un slider del panel de debug enfocado, se le quita el foco
  // para que las flechas muevan al jugador y no al slider.
  const elementoEnfocado = document.activeElement;
  if (elementoEnfocado && elementoEnfocado.tagName === 'INPUT') elementoEnfocado.blur();

  teclasApretadas.add(evento.code);
  // Evitar que Espacio y las flechas hagan scroll en la página
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(evento.code)) evento.preventDefault();

  // Las acciones de un solo toque no se repiten al mantener la tecla
  if (evento.repeat) return;

  switch (evento.code) {
    case 'Enter': if (juego.pantalla !== 'jugando') empezarPartida(); break;
    case 'KeyP': alternarPanelDebug(); break;
    case 'KeyT': cambiarVista('temperatura', !vista.temperatura); break;
    case 'KeyG': cambiarVista('grilla', !vista.grilla); break;
    case 'KeyR': if (juego.pantalla === 'jugando') empezarPartida(); else prepararMundo(); break;
  }

  // Cambio de arma: solo mientras se apunta y sin estar cargando
  if (juego.pantalla === 'jugando' && juego.fase === 'apuntar' && !juego.cargando) {
    const jugador = jugadores[juego.jugadorActual];
    if (evento.code === 'KeyQ' || evento.code === 'KeyE') jugador.arma = 1 - jugador.arma;
    if (evento.code === 'Digit1') jugador.arma = ARMA_BOLA_DE_FUEGO;
    if (evento.code === 'Digit2') jugador.arma = ARMA_MAGMA;
  }
});

window.addEventListener('keyup', evento => teclasApretadas.delete(evento.code));

// Si la ventana pierde el foco, se "sueltan" todas las teclas
window.addEventListener('blur', () => teclasApretadas.clear());
