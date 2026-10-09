'use strict';
/* =============================================================================
   JOYSTICKS (Gamepad API)

   El navegador reconoce joysticks USB/Bluetooth (Xbox, PlayStation y la
   mayoría de los genéricos). Por privacidad, recién los "ve" cuando se aprieta
   algún botón con la página abierta.

   Se usa el MAPEO ESTÁNDAR del navegador (los índices son los de un joystick
   de Xbox; en PlayStation: A = ✕, B = ○, X = □, Y = △):

     Stick izquierdo / cruz ← →   mover
     A                            saltar
     Stick derecho / cruz ↑ ↓     apuntar (el stick permite ajuste fino)
     Gatillo derecho (RT)         mantener para cargar, soltar para disparar
     LB / RB                      cambiar de arma
     Y                            cambiar de llama (Worms)
     Start                        empezar / revancha
     Back (Select)                volver al menú (al terminar la partida)

   Asignación: el primer joystick conectado es de J1 y el segundo de J2.
   En los modos por turnos cualquier joystick controla a la llama del turno
   (alcanza con uno solo); en Tiempo real cada uno controla a su jugador.
   ============================================================================= */

const BOTON = {
  A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9,
  ARRIBA: 12, ABAJO: 13, IZQUIERDA: 14, DERECHA: 15
};
const ZONA_MUERTA = 0.25;      // los sticks nunca vuelven exacto a 0: menos que esto se ignora
const UMBRAL_GATILLO = 0.3;    // el gatillo es analógico (0 a 1): desde acá cuenta como apretado

/* Estado leído en este cuadro, uno por joystick conectado (en orden de conexión). */
let estadoJoysticks = [];
let botonesDelCuadroAnterior = []; // para detectar el momento en que se APRIETA un botón

/* Elimina el temblor de los sticks y reescala: con la zona muerta 0.25,
   un valor de 0.25 pasa a 0 y uno de 1 sigue siendo 1. */
function aplicarZonaMuerta(valor) {
  if (Math.abs(valor) < ZONA_MUERTA) return 0;
  return Math.sign(valor) * (Math.abs(valor) - ZONA_MUERTA) / (1 - ZONA_MUERTA);
}

/* Botones que se ignoran hasta soltarlos, por joystick (ver ignorarBotonesApretados). */
let botonesIgnoradosHastaSoltar = [];

function botonApretadoFisico(joystick, indice) {
  const boton = joystick.buttons[indice];
  return !!boton && (boton.pressed || boton.value > UMBRAL_GATILLO);
}

function botonApretado(joystick, indice) {
  const ignorados = botonesIgnoradosHastaSoltar[joystick.index];
  return botonApretadoFisico(joystick, indice) && !(ignorados && ignorados.has(indice));
}

/* Al empezar la partida con A o Start, ese botón sigue apretado: se ignora
   hasta soltarlo (si no, A haría saltar a la llama apenas arranca). */
function ignorarBotonesApretados() {
  if (!navigator.getGamepads) return;
  for (const joystick of Array.from(navigator.getGamepads())) {
    if (!joystick) continue;
    const apretados = new Set();
    joystick.buttons.forEach((_, i) => { if (botonApretadoFisico(joystick, i)) apretados.add(i); });
    botonesIgnoradosHastaSoltar[joystick.index] = apretados;
  }
}

/* Saca de la lista de ignorados los botones que ya se soltaron. */
function liberarBotonesSoltados(joystick) {
  const ignorados = botonesIgnoradosHastaSoltar[joystick.index];
  if (!ignorados) return;
  for (const i of [...ignorados]) if (!botonApretadoFisico(joystick, i)) ignorados.delete(i);
}

/* Se llama una vez por cuadro (principal.js): lee todos los joysticks y
   dispara las acciones de "un solo toque" (cambiar arma, empezar, etc.). */
function actualizarJoysticks() {
  if (!navigator.getGamepads) return;
  const conectados = Array.from(navigator.getGamepads()).filter(j => j && j.connected);

  estadoJoysticks = conectados.map((joystick, numero) => {
    liberarBotonesSoltados(joystick);
    const cruz = (botonApretado(joystick, BOTON.DERECHA) ? 1 : 0) - (botonApretado(joystick, BOTON.IZQUIERDA) ? 1 : 0);
    const cruzVertical = (botonApretado(joystick, BOTON.ARRIBA) ? 1 : 0) - (botonApretado(joystick, BOTON.ABAJO) ? 1 : 0);
    const estado = {
      numero,
      mover: cruz || aplicarZonaMuerta(joystick.axes[0] || 0),
      // En los sticks el eje Y crece hacia ABAJO: se invierte para que "arriba" sea positivo
      apuntar: cruzVertical || -aplicarZonaMuerta(joystick.axes[3] || 0),
      saltar: botonApretado(joystick, BOTON.A),
      cargar: botonApretado(joystick, BOTON.RT)
    };

    // Acciones de un solo toque: solo en el cuadro en que el botón pasa de suelto a apretado
    const antes = botonesDelCuadroAnterior[numero] || [];
    const ahora = joystick.buttons.map((_, i) => botonApretado(joystick, i));
    const recienApretado = i => ahora[i] && !antes[i];
    const jugador = numero; // 1.º joystick = J1, 2.º = J2
    if (recienApretado(BOTON.LB) || recienApretado(BOTON.RB)) ejecutarAccion('cambiarArma', jugador);
    if (recienApretado(BOTON.Y)) ejecutarAccion('cambiarLlama', jugador);
    if (recienApretado(BOTON.START)) ejecutarAccion('aceptar', jugador);
    if (recienApretado(BOTON.BACK)) ejecutarAccion('menu', jugador);
    // En las pantallas de título y fin: navegar con la cruz y aceptar con A
    if (juego.pantalla !== 'jugando') {
      if (recienApretado(BOTON.IZQUIERDA)) ejecutarAccion('modoAnterior', jugador);
      if (recienApretado(BOTON.DERECHA)) ejecutarAccion('modoSiguiente', jugador);
      if (recienApretado(BOTON.A)) ejecutarAccion('aceptar', jugador);
    }
    botonesDelCuadroAnterior[numero] = ahora;
    return estado;
  });
}

window.addEventListener('gamepadconnected', evento => {
  mostrarCartel(`🎮 Joystick conectado (${evento.gamepad.index + 1})`, '#cfe0f5');
});
window.addEventListener('gamepaddisconnected', () => {
  mostrarCartel('🎮 Joystick desconectado', '#ffd38a');
});
