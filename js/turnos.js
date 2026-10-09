'use strict';
/* =============================================================================
   FLUJO DE LA PARTIDA

   Pantallas:  'titulo' (con selector de modo) -> 'jugando' -> 'fin'

   Modos (ver MODOS_DE_JUEGO en configuracion.js):
     Clásico 1 vs 1   por turnos, una llama por jugador.
     Worms            por turnos, 3 llamas por jugador. Cada turno juega la
                      SIGUIENTE llama viva del equipo (rotan solas) y con Tab
                      (o Y en el joystick) se puede cambiar mientras se apunta.
     Tiempo real      sin turnos: los dos jugadores se mueven y disparan a la vez.
                      Después de cada disparo hay un tiempo de recarga y el
                      viento cambia cada PARAMETROS.cambioDeViento segundos.
   En todos, pierde quien se queda sin llamas encendidas.

   MODOS POR TURNOS
     Los turnos son de EQUIPO (J1, J2, J1...). Dentro del turno se mueve una sola
     llama: juego.llamaActual (índice en el arreglo "llamas"). Fases:
       'apuntar'   duracionTurno segundos para moverse, apuntar y cargar el disparo.
       'vuelo'     El proyectil está en el aire (la llama se puede seguir moviendo).
       'escape'    Después del impacto: tiempoEscape segundos para alejarse.
       'asentando' Se espera a que el agua deje de caer (o un máximo de 7 s)
                   y recién ahí pasa el turno al otro equipo.

   TIEMPO REAL
     Fase única 'libre'. Cuando a un equipo no le quedan llamas, se espera un
     momento (para ver cómo se apaga) y termina la partida.
   ============================================================================= */

const juego = {
  pantalla: 'titulo',
  modo: 'worms',         // clave de MODOS_DE_JUEGO
  fase: 'apuntar',
  equipoActual: 0,       // por turnos: 0 = J1, 1 = J2
  llamaActual: 0,        // por turnos: índice en "llamas" de la llama que se mueve este turno
  ultimaLlamaDeCadaEquipo: [-1, -1], // para rotar: la próxima vez juega la siguiente
  tiempoTurnoRestante: PARAMETROS.duracionTurno,
  tiempoEnFase: 0,       // en 'escape' cuenta hacia atrás, en 'asentando' hacia adelante
  tiempoHastaCambioDeViento: 0, // tiempo real
  tiempoParaTerminar: -1,       // tiempo real: cuenta regresiva al quedar un solo equipo
  cartel: null,          // mensaje grande en el centro: { texto, color, edad }
  temblor: 0,            // segundos de sacudida de cámara
  textoGanador: ''
};

let viento = 0;          // entre -vientoMaximo (izquierda) y +vientoMaximo (derecha)

const DURACION_CARTEL = 2;
const PARTICULAS_PARA_CONSIDERAR_QUIETO = 8;
const TIEMPO_MINIMO_ASENTANDO = 1;
const TIEMPO_MAXIMO_ASENTANDO = 7;
const VELOCIDAD_GIRO_APUNTADO = 60; // grados por segundo con el control al máximo
const TIEMPO_CARGA_COMPLETA = 1.3;  // segundos manteniendo el disparo para llegar al 100%
const ESPERA_AL_TERMINAR = 2;       // tiempo real: segundos entre la última llama apagada y el final

function llamasPorEquipo() {
  return MODOS_DE_JUEGO[juego.modo].llamasPorJugador;
}

function esTiempoReal() {
  return MODOS_DE_JUEGO[juego.modo].tiempoReal;
}

function mostrarCartel(texto, color) {
  juego.cartel = { texto, color: color || '#fff', edad: 0 };
}

/* Sortea un viento nuevo, redondeado a pasos de 0.05 para que se lea bien.
   Si cambia de sentido (de izquierda a derecha o al revés) suena una ráfaga. */
function sortearViento() {
  const anterior = viento;
  const valor = (Math.random() * 2 - 1) * PARAMETROS.vientoMaximo;
  viento = Math.round(valor * 20) / 20;
  const cambioDeSentido = Math.sign(viento) !== 0 && Math.sign(viento) !== Math.sign(anterior);
  if (cambioDeSentido) sonarCambioDeViento(viento);
}

/* Siguiente llama VIVA del equipo después de "despuesDe" (índice en "llamas"),
   dando la vuelta al final de la lista. Con despuesDe = -1 devuelve la primera. */
function siguienteLlamaViva(equipo, despuesDe) {
  const delEquipo = llamasDelEquipo(equipo);
  const posicion = delEquipo.findIndex(llama => llama.numero === despuesDe);
  for (let paso = 1; paso <= delEquipo.length; paso++) {
    const candidata = delEquipo[(posicion + paso) % delEquipo.length];
    if (candidata.vivo) return candidata.numero;
  }
  return -1; // no le quedan llamas
}

/* ---------- Inicio de partida y de turno ---------- */

function empezarPartida() {
  prepararMundo();
  juego.pantalla = 'jugando';
  if (esTiempoReal()) {
    juego.fase = 'libre';
    juego.tiempoParaTerminar = -1;
    juego.tiempoHastaCambioDeViento = PARAMETROS.cambioDeViento;
    sortearViento();
    sonarTurno(0);
    mostrarCartel('¡A apagarse!', '#ffd38a');
  } else {
    empezarTurno(0);
  }
}

function empezarTurno(equipo) {
  juego.equipoActual = equipo;
  // Rotación: juega la siguiente llama viva después de la que jugó la última vez
  juego.llamaActual = siguienteLlamaViva(equipo, juego.ultimaLlamaDeCadaEquipo[equipo]);
  juego.ultimaLlamaDeCadaEquipo[equipo] = juego.llamaActual;
  juego.fase = 'apuntar';
  juego.tiempoTurnoRestante = PARAMETROS.duracionTurno;
  sortearViento();
  sonarTurno(equipo);
  mostrarCartel(`Turno de ${PALETAS_JUGADORES[equipo].nombre}`, PALETAS_JUGADORES[equipo].hud);
}

/* Tab / Y: pasar a la siguiente llama viva del equipo. Solo por turnos, mientras
   se apunta y antes de cargar el disparo (no se cambia a mitad de un tiro). */
function cambiarDeLlama() {
  if (esTiempoReal() || juego.pantalla !== 'jugando' || juego.fase !== 'apuntar') return;
  const actual = llamaActual();
  if (actual && actual.cargando) return;
  const siguiente = siguienteLlamaViva(juego.equipoActual, juego.llamaActual);
  if (siguiente < 0 || siguiente === juego.llamaActual) return;
  juego.llamaActual = siguiente;
  juego.ultimaLlamaDeCadaEquipo[juego.equipoActual] = siguiente;
  sonarCambioDeLlama();
}

function pasarAFaseAsentando() {
  juego.fase = 'asentando';
  juego.tiempoEnFase = 0;
  const llama = llamaActual();
  if (llama) { llama.cargando = false; llama.potencia = 0; }
}

/* Se llama cuando un proyectil explotó o salió del mapa. */
function alTerminarElDisparo() {
  if (juego.pantalla === 'jugando' && juego.fase === 'vuelo') {
    juego.fase = 'escape';
    juego.tiempoEnFase = PARAMETROS.tiempoEscape;
  }
}

/* ---------- Fin de partida ---------- */

/* Equipos que todavía tienen al menos una llama encendida. */
function equiposEnJuego() {
  const enJuego = [];
  for (let equipo = 0; equipo < CANTIDAD_JUGADORES; equipo++) {
    if (llamasVivasDelEquipo(equipo).length > 0) enJuego.push(equipo);
  }
  return enJuego;
}

/* Si quedó un solo equipo (o ninguno) termina la partida. Devuelve true si terminó. */
function terminarPartidaSiCorresponde() {
  const enJuego = equiposEnJuego();
  if (enJuego.length >= 2) return false;
  juego.pantalla = 'fin';
  juego.textoGanador = enJuego.length === 1
    ? `¡Gana ${PALETAS_JUGADORES[enJuego[0]].nombre}!`
    : '¡Empate! Se apagaron todas las llamas';
  sonarVictoria();
  return true;
}

function terminarTurno() {
  if (terminarPartidaSiCorresponde()) return;
  empezarTurno(1 - juego.equipoActual); // 0 -> 1, 1 -> 0
}

/* ---------- Armado del mundo y menú ---------- */

/* Crea mapa y llamas nuevas según el modo (sin empezar la partida: también
   sirve de fondo para la pantalla de título). */
function prepararMundo(semilla) {
  const semillaFinal = semilla === undefined ? Math.floor(Math.random() * 1e9) : semilla;
  generarMapa(semillaFinal, CANTIDAD_JUGADORES * llamasPorEquipo());
  prepararCascadas();
  prepararViento();
  particulasAgua = [];
  efectos = [];
  proyectiles = [];

  // Una llama centrada sobre cada plataforma. En cada par espejado, una es de J1
  // y la otra de J2; "invertidos[par]" dice si J1 va a la derecha en ese par.
  const invertidos = sortearLadosDeCadaPar(mapa.puntosDeAparicion.length / 2);
  const { ancho, alto } = FISICA_LLAMA;
  llamas = mapa.puntosDeAparicion.map((punto, numero) => {
    const equipo = invertidos[punto.par] ? 1 - punto.lado : punto.lado;
    const x = punto.x - ancho / 2;
    return new Llama(numero, equipo, x, buscarAlturaDeAparicion(x, ancho, alto));
  });
  juego.ultimaLlamaDeCadaEquipo = [-1, -1];
  juego.llamaActual = siguienteLlamaViva(0, -1);
}

/* Con varias llamas por jugador, las de un mismo jugador aparecen mezcladas en
   los dos lados. Se sortea por PAR de plataformas espejadas, así la partida
   sigue siendo justa: cada llama de J1 tiene una de J2 en la posición espejo.
   Si el sorteo dejara todas las de un jugador del mismo lado (todos los pares
   iguales), se vuelve a sortear. Con un solo par (Clásico) J1 va a la izquierda. */
function sortearLadosDeCadaPar(cantidadDePares) {
  if (cantidadDePares < 2) return [false];
  let invertidos;
  do {
    invertidos = Array.from({ length: cantidadDePares }, () => Math.random() < 0.5);
  } while (invertidos.every(valor => valor === invertidos[0]));
  return invertidos;
}

/* Pantalla de título: elegir modo con ←/→, la cruz del joystick o 1/2/3.
   El mapa de fondo se regenera para mostrar las plataformas de ese modo. */
function elegirModo(desplazamiento) {
  const posicion = ORDEN_DE_MODOS.indexOf(juego.modo);
  elegirModoPorNumero((posicion + desplazamiento + ORDEN_DE_MODOS.length) % ORDEN_DE_MODOS.length);
}

function elegirModoPorNumero(numero) {
  if (ORDEN_DE_MODOS[numero] === juego.modo) return;
  juego.modo = ORDEN_DE_MODOS[numero];
  prepararMundo();
}

/* ---------- Lógica que corre en cada paso de simulación ---------- */

function actualizarTurno(dt) {
  if (juego.cartel) {
    juego.cartel.edad += dt;
    if (juego.cartel.edad > DURACION_CARTEL) juego.cartel = null;
  }
  juego.temblor = Math.max(0, juego.temblor - dt);
  if (juego.pantalla !== 'jugando') return;

  if (esTiempoReal()) actualizarTiempoReal(dt);
  else actualizarPorTurnos(dt);
}

function actualizarPorTurnos(dt) {
  const llama = llamaActual();
  if (juego.fase === 'apuntar') {
    juego.tiempoTurnoRestante -= dt;
    if (llama && llama.vivo) actualizarApuntado(llama, dt, leerControles(CUALQUIER_JUGADOR));
    if (juego.fase === 'apuntar' && juego.tiempoTurnoRestante <= 0) {
      mostrarCartel('¡Se acabó el tiempo!', '#ffd38a');
      pasarAFaseAsentando();
    }
  } else if (juego.fase === 'escape') {
    juego.tiempoEnFase -= dt;
    if (juego.tiempoEnFase <= 0) pasarAFaseAsentando();
  } else if (juego.fase === 'asentando') {
    juego.tiempoEnFase += dt;
    // Las gotas de las cascadas no cuentan: caen siempre y el turno nunca terminaría
    const aguaQuieta = contarGotasDelDisparo() < PARTICULAS_PARA_CONSIDERAR_QUIETO && proyectiles.length === 0;
    if ((juego.tiempoEnFase > TIEMPO_MINIMO_ASENTANDO && aguaQuieta) || juego.tiempoEnFase > TIEMPO_MAXIMO_ASENTANDO) {
      terminarTurno();
    }
  }
}

function actualizarTiempoReal(dt) {
  // Cada llama apunta y dispara con los controles de su jugador
  for (const llama of llamas) {
    if (llama.vivo) actualizarApuntado(llama, dt, leerControles(llama.equipo));
  }

  // El viento cambia cada tanto
  juego.tiempoHastaCambioDeViento -= dt;
  if (juego.tiempoHastaCambioDeViento <= 0) {
    juego.tiempoHastaCambioDeViento = PARAMETROS.cambioDeViento;
    sortearViento();
    mostrarCartel('El viento cambió', '#bfe3ff');
  }

  // Si quedó un solo equipo, se espera un momento antes de terminar
  if (juego.tiempoParaTerminar < 0 && equiposEnJuego().length < 2) juego.tiempoParaTerminar = ESPERA_AL_TERMINAR;
  if (juego.tiempoParaTerminar >= 0) {
    juego.tiempoParaTerminar -= dt;
    if (juego.tiempoParaTerminar <= 0) terminarPartidaSiCorresponde();
  }
}

/* Ángulo y carga del disparo de una llama.
   - El ángulo cambia a VELOCIDAD_GIRO_APUNTADO grados/s multiplicado por
     controles.apuntar (con el stick, inclinarlo poco = ajuste fino).
   - Mantener "cargar" sube la potencia; se dispara al soltar o al llegar al 100%.
   - En tiempo real, durante la recarga no se puede cargar. */
function actualizarApuntado(llama, dt, controles) {
  llama.recarga = Math.max(0, llama.recarga - dt);
  llama.angulo = limitar(llama.angulo + VELOCIDAD_GIRO_APUNTADO * controles.apuntar * dt, -40, 90);

  if (controles.cargar && llama.recarga <= 0) {
    llama.cargando = true;
    llama.potencia = Math.min(1, llama.potencia + dt / TIEMPO_CARGA_COMPLETA);
    if (llama.potencia >= 1) disparar(llama);
  } else if (llama.cargando) {
    disparar(llama);
  }
}
