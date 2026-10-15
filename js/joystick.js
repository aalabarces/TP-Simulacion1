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
     Stick derecho o izquierdo ↑ ↓, cruz ↑ ↓   apuntar (el stick permite ajuste fino)
     Gatillo derecho (RT) o B     mantener para cargar, soltar para disparar
     LB / RB                      arma anterior / siguiente
     LT (mantener)                cámara: stick derecho mueve, cruz ↑ ↓ zoom
     Y                            cambiar de llama (Worms)
     Start (≡)                    en el menú, empezar; jugando o al terminar, volver al menú
     Back (⧉)                     volver al menú

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

/* ---------- Mapeo de los ejes ----------
   Con el mapeo ESTÁNDAR (joystick.mapping === 'standard') los ejes son siempre
   0/1 stick izquierdo X/Y y 2/3 stick derecho X/Y, y los gatillos son botones (6/7).
   Pero el navegador no siempre reconoce el joystick: con mapeo NO estándar el
   orden de los ejes cambia según el modelo y los gatillos suelen venir como EJES
   que en reposo valen -1 y apretados +1. Si se leyera uno de esos como stick, la
   mira subiría sola (−1 en reposo) y bajaría al apretar el gatillo.
   Por eso, la primera vez que se ve un joystick no estándar se mira cada eje en
   reposo: los que están cerca de 0 son sticks (en orden: izq X, izq Y, der X,
   der Y) y los que están cerca de -1 son gatillos (en orden: LT, RT). */
const mapeosDeEjes = new Map(); // índice del joystick -> { sticks: [...], gatillos: [...] }

function mapeoDeEjes(joystick) {
  if (joystick.mapping === 'standard') return { sticks: [0, 1, 2, 3], gatillos: [] };
  let mapeo = mapeosDeEjes.get(joystick.index);
  if (!mapeo) {
    mapeo = { sticks: [], gatillos: [] };
    joystick.axes.forEach((valor, eje) => (valor < -0.5 ? mapeo.gatillos : mapeo.sticks).push(eje));
    mapeosDeEjes.set(joystick.index, mapeo);
  }
  return mapeo;
}

function leerEje(joystick, eje) {
  return eje === undefined ? 0 : (joystick.axes[eje] || 0);
}

/* Un gatillo que viene como eje va de -1 (suelto) a +1 (apretado). */
function gatilloComoEjeApretado(joystick, eje) {
  return eje !== undefined && (leerEje(joystick, eje) + 1) / 2 > UMBRAL_GATILLO;
}

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

/* Joysticks ya vistos (por índice). El navegador recién muestra un joystick cuando
   se aprieta un botón: ese primer botón solo sirve para "despertarlo" y se ignora
   hasta soltarlo. Si no, apretar A o Start para que el juego lo reconozca
   empezaría la partida. */
const joysticksVistos = new Set();

/* Se llama una vez por cuadro (principal.js): lee todos los joysticks y
   dispara las acciones de "un solo toque" (cambiar arma, empezar, etc.). */
function actualizarJoysticks() {
  if (!navigator.getGamepads) return;
  const conectados = Array.from(navigator.getGamepads()).filter(j => j && j.connected);

  estadoJoysticks = conectados.map((joystick, numero) => {
    if (!joysticksVistos.has(joystick.index)) {
      joysticksVistos.add(joystick.index);
      const apretados = new Set();
      joystick.buttons.forEach((_, i) => { if (botonApretadoFisico(joystick, i)) apretados.add(i); });
      botonesIgnoradosHastaSoltar[joystick.index] = apretados;
    }
    liberarBotonesSoltados(joystick);
    const mapeo = mapeoDeEjes(joystick);
    const cruz = (botonApretado(joystick, BOTON.DERECHA) ? 1 : 0) - (botonApretado(joystick, BOTON.IZQUIERDA) ? 1 : 0);
    const cruzVertical = (botonApretado(joystick, BOTON.ARRIBA) ? 1 : 0) - (botonApretado(joystick, BOTON.ABAJO) ? 1 : 0);
    // Gatillos: como botón (mapeo estándar) o como eje (no estándar)
    const gatilloIzquierdo = botonApretado(joystick, BOTON.LT) || gatilloComoEjeApretado(joystick, mapeo.gatillos[0]);
    const gatilloDerecho = botonApretado(joystick, BOTON.RT) || gatilloComoEjeApretado(joystick, mapeo.gatillos[1]);
    // Con el gatillo izquierdo apretado, el stick derecho y la cruz ↑ ↓ manejan la cámara
    // (ver camara.js) en vez de apuntar
    const camaraManual = gatilloIzquierdo;
    const stickDerechoX = aplicarZonaMuerta(leerEje(joystick, mapeo.sticks[2]));
    const stickDerechoY = aplicarZonaMuerta(leerEje(joystick, mapeo.sticks[3]));
    const stickIzquierdoY = aplicarZonaMuerta(leerEje(joystick, mapeo.sticks[1]));
    const estado = {
      numero,
      mover: cruz || aplicarZonaMuerta(leerEje(joystick, mapeo.sticks[0])),
      // Apuntar: cruz ↑ ↓, stick derecho o stick izquierdo arriba/abajo (en ese orden de prioridad).
      // En los sticks el eje Y crece hacia ABAJO: se invierte para que "arriba" sea positivo
      apuntar: camaraManual ? 0 : (cruzVertical || -stickDerechoY || -stickIzquierdoY),
      saltar: botonApretado(joystick, BOTON.A),
      cargar: gatilloDerecho || botonApretado(joystick, BOTON.B), // RT o B
      camara: camaraManual,
      camaraX: camaraManual ? stickDerechoX : 0,
      camaraY: camaraManual ? stickDerechoY : 0,
      camaraZoom: camaraManual ? cruzVertical : 0
    };

    // Acciones de un solo toque: solo en el cuadro en que el botón pasa de suelto a apretado
    const antes = botonesDelCuadroAnterior[numero] || [];
    const ahora = joystick.buttons.map((_, i) => botonApretado(joystick, i));
    const recienApretado = i => ahora[i] && !antes[i];
    const jugador = numero; // 1.º joystick = J1, 2.º = J2
    if (recienApretado(BOTON.LB)) ejecutarAccion('armaAnterior', jugador);
    if (recienApretado(BOTON.RB)) ejecutarAccion('armaSiguiente', jugador);
    if (recienApretado(BOTON.Y)) ejecutarAccion('cambiarLlama', jugador);
    // Start (≡): en el menú empieza; jugando o al terminar, vuelve al menú principal
    if (recienApretado(BOTON.START)) ejecutarAccion(juego.pantalla === 'titulo' ? 'aceptar' : 'menu', jugador);
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
  mapeosDeEjes.delete(evento.gamepad.index); // se vuelve a detectar con el joystick en reposo
  mostrarCartel(`🎮 Joystick conectado (${evento.gamepad.index + 1})`, '#cfe0f5');
});
window.addEventListener('gamepaddisconnected', evento => {
  mapeosDeEjes.delete(evento.gamepad.index);
  joysticksVistos.delete(evento.gamepad.index); // al reconectarlo, el primer botón vuelve a solo despertarlo
  mostrarCartel('🎮 Joystick desconectado', '#ffd38a');
});

/* Texto para el panel de debug: mapeo detectado y valor de cada eje. */
function describirJoysticks() {
  if (!navigator.getGamepads) return 'sin soporte';
  const conectados = Array.from(navigator.getGamepads()).filter(j => j && j.connected);
  if (conectados.length === 0) return 'ninguno';
  return conectados.map(j => {
    const mapeo = mapeoDeEjes(j);
    const ejes = j.axes.map(v => v.toFixed(2)).join(' ');
    return `${j.index + 1}: ${j.mapping || 'no estándar'} · sticks [${mapeo.sticks}] gatillos [${mapeo.gatillos}]\n            ejes ${ejes}`;
  }).join('\n            ');
}
