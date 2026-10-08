'use strict';
/* =============================================================================
   FLUJO DE LA PARTIDA

   Pantallas:  'titulo' -> 'jugando' -> 'fin'

   Fases de cada turno (mientras se está jugando):
     'apuntar'   El jugador activo tiene duracionTurno segundos para moverse,
                 apuntar y cargar el disparo.
     'vuelo'     El proyectil está en el aire (nadie se puede mover).
     'escape'    Después del impacto: tiempoEscape segundos para alejarse.
     'asentando' Se espera a que el agua deje de caer (o un máximo de 7 s)
                 y recién ahí pasa el turno al otro jugador.
   ============================================================================= */

const juego = {
  pantalla: 'titulo',
  fase: 'apuntar',
  jugadorActual: 0,
  tiempoTurnoRestante: PARAMETROS.duracionTurno,
  tiempoEnFase: 0,       // en 'escape' cuenta hacia atrás, en 'asentando' hacia adelante
  cargando: false,       // ¿se está manteniendo la barra espaciadora?
  potencia: 0,           // 0 a 1
  cartel: null,          // mensaje grande en el centro: { texto, color, edad }
  temblor: 0,            // segundos de sacudida de cámara
  textoGanador: ''
};

let viento = 0;          // entre -vientoMaximo (izquierda) y +vientoMaximo (derecha)

const DURACION_CARTEL = 2;
const PARTICULAS_PARA_CONSIDERAR_QUIETO = 8;
const TIEMPO_MINIMO_ASENTANDO = 1;
const TIEMPO_MAXIMO_ASENTANDO = 7;
const VELOCIDAD_GIRO_APUNTADO = 60; // grados por segundo con ↑/↓
const TIEMPO_CARGA_COMPLETA = 1.3;  // segundos manteniendo Espacio para llegar al 100%

function mostrarCartel(texto, color) {
  juego.cartel = { texto, color: color || '#fff', edad: 0 };
}

/* Sortea un viento nuevo, redondeado a pasos de 0.05 para que se lea bien. */
function sortearViento() {
  const valor = (Math.random() * 2 - 1) * PARAMETROS.vientoMaximo;
  viento = Math.round(valor * 20) / 20;
}

function empezarTurno(numeroJugador) {
  juego.jugadorActual = numeroJugador;
  juego.fase = 'apuntar';
  juego.tiempoTurnoRestante = PARAMETROS.duracionTurno;
  juego.cargando = false;
  juego.potencia = 0;
  sortearViento();
  mostrarCartel(`Turno de ${PALETAS_JUGADORES[numeroJugador].nombre}`, PALETAS_JUGADORES[numeroJugador].hud);
}

function pasarAFaseAsentando() {
  juego.fase = 'asentando';
  juego.tiempoEnFase = 0;
  juego.cargando = false;
  juego.potencia = 0;
}

/* Se llama cuando el proyectil explotó o salió del mapa. */
function alTerminarElDisparo() {
  if (juego.pantalla === 'jugando' && juego.fase === 'vuelo') {
    juego.fase = 'escape';
    juego.tiempoEnFase = PARAMETROS.tiempoEscape;
  }
}

function terminarTurno() {
  const vivos = jugadores.filter(j => j.vivo);
  if (vivos.length < 2) {
    juego.pantalla = 'fin';
    juego.textoGanador = vivos.length === 1
      ? `¡Gana ${vivos[0].paleta.nombre}!`
      : '¡Empate! Se apagaron los dos';
    return;
  }
  empezarTurno(1 - juego.jugadorActual); // 0 -> 1, 1 -> 0
}

/* Crea mapa y jugadores nuevos (sin empezar la partida: sirve de fondo del título). */
function prepararMundo(semilla) {
  generarMapa(semilla === undefined ? Math.floor(Math.random() * 1e9) : semilla);
  particulasAgua = [];
  efectos = [];
  proyectil = null;

  const { ancho, alto } = FISICA_JUGADOR;
  const xJugador1 = mapa.posicionInicialX - ancho / 2;
  // Espejo de un rectángulo: su borde derecho pasa a ser el izquierdo
  const xJugador2 = ANCHO_GRILLA - (xJugador1 + ancho);
  jugadores = [
    new Jugador(0, xJugador1, buscarAlturaDeAparicion(xJugador1, ancho, alto)),
    new Jugador(1, xJugador2, buscarAlturaDeAparicion(xJugador2, ancho, alto))
  ];
}

function empezarPartida() {
  prepararMundo();
  juego.pantalla = 'jugando';
  empezarTurno(0);
}

/* Lógica de turnos que corre en cada paso de simulación. */
function actualizarTurno(dt) {
  if (juego.cartel) {
    juego.cartel.edad += dt;
    if (juego.cartel.edad > DURACION_CARTEL) juego.cartel = null;
  }
  juego.temblor = Math.max(0, juego.temblor - dt);
  if (juego.pantalla !== 'jugando') return;

  const jugador = jugadores[juego.jugadorActual];

  if (juego.fase === 'apuntar') {
    juego.tiempoTurnoRestante -= dt;
    if (jugador.vivo) actualizarApuntado(jugador, dt);
    if (juego.fase === 'apuntar' && juego.tiempoTurnoRestante <= 0) {
      mostrarCartel('¡Se acabó el tiempo!', '#ffd38a');
      pasarAFaseAsentando();
    }
  } else if (juego.fase === 'escape') {
    juego.tiempoEnFase -= dt;
    if (juego.tiempoEnFase <= 0) pasarAFaseAsentando();
  } else if (juego.fase === 'asentando') {
    juego.tiempoEnFase += dt;
    const aguaQuieta = particulasAgua.length < PARTICULAS_PARA_CONSIDERAR_QUIETO && !proyectil;
    if ((juego.tiempoEnFase > TIEMPO_MINIMO_ASENTANDO && aguaQuieta) || juego.tiempoEnFase > TIEMPO_MAXIMO_ASENTANDO) {
      terminarTurno();
    }
  }
}

/* Ángulo con ↑/↓ y carga de potencia con Espacio.
   Se dispara al soltar Espacio o al llegar al 100% de carga. */
function actualizarApuntado(jugador, dt) {
  if (teclaApretada('ArrowUp')) jugador.angulo = Math.min(90, jugador.angulo + VELOCIDAD_GIRO_APUNTADO * dt);
  if (teclaApretada('ArrowDown')) jugador.angulo = Math.max(-40, jugador.angulo - VELOCIDAD_GIRO_APUNTADO * dt);

  if (teclaApretada('Space')) {
    juego.cargando = true;
    juego.potencia = Math.min(1, juego.potencia + dt / TIEMPO_CARGA_COMPLETA);
    if (juego.potencia >= 1) disparar();
  } else if (juego.cargando) {
    disparar();
  }
}
