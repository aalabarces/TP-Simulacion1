'use strict';
/* =============================================================================
   BUCLE PRINCIPAL

   La simulación avanza con PASO FIJO (1/60 s), independiente de los FPS:
   se acumula el tiempo real transcurrido y se ejecutan tantos pasos como
   entren. Si la PC se atrasa, se hacen como máximo 3 pasos por cuadro para
   no entrar en una espiral de lentitud.
   ============================================================================= */

/* Un paso de simulación: el orden importa. */
function simularPaso(dt) {
  marcarCeldasOcupadas();       // dónde están los jugadores (para magma y congelamiento)
  simularTemperatura(dt);       // difusión de calor + cambios de estado
  simularFluidos();             // autómata celular del agua y el magma (Euleriano)
  simularParticulasAgua(dt);    // gotas en caída libre (Lagrangiano)
  simularProyectil(dt);

  for (const jugador of jugadores) {
    // Solo el jugador del turno recibe controles, y no mientras carga el disparo
    let controles = null;
    const esSuTurno = juego.pantalla === 'jugando' && jugador.numero === juego.jugadorActual && jugador.vivo;
    if (esSuTurno && ((juego.fase === 'apuntar' && !juego.cargando) || juego.fase === 'escape')) {
      controles = leerControles();
    }
    actualizarJugador(jugador, dt, controles);
    aplicarAuraDeCalor(jugador, dt);
  }

  simularEfectos(dt);
  actualizarTurno(dt);
}

const MAXIMO_PASOS_POR_CUADRO = 3;
let instanteAnterior = performance.now();
let tiempoAcumulado = 0;
const estadisticas = { fps: 60, msSimulacion: 0, msDibujo: 0 };
let tiempoDesdeUltimasEstadisticas = 0;

/* Promedio móvil: cada medición nueva pesa un 5%, así el número no salta tanto. */
function suavizar(promedio, valorNuevo) {
  return promedio + (valorNuevo - promedio) * 0.05;
}

function cuadro(instante) {
  // Segundos desde el cuadro anterior (máximo 0.1 s, por si la pestaña estuvo en pausa)
  const transcurrido = Math.min((instante - instanteAnterior) / 1000, 0.1);
  instanteAnterior = instante;
  tiempoAcumulado += transcurrido;
  tiempoTotal += transcurrido;

  const inicioSimulacion = performance.now();
  let pasosHechos = 0;
  while (tiempoAcumulado >= PASO_SIMULACION && pasosHechos < MAXIMO_PASOS_POR_CUADRO) {
    simularPaso(PASO_SIMULACION);
    tiempoAcumulado -= PASO_SIMULACION;
    pasosHechos++;
  }
  if (pasosHechos === MAXIMO_PASOS_POR_CUADRO) tiempoAcumulado = 0; // descartar el atraso
  const finSimulacion = performance.now();

  dibujarCuadro();
  const finDibujo = performance.now();

  // Estadísticas para el panel de debug (se refrescan 4 veces por segundo)
  estadisticas.fps = suavizar(estadisticas.fps, transcurrido > 0 ? 1 / transcurrido : 60);
  estadisticas.msSimulacion = suavizar(estadisticas.msSimulacion, (finSimulacion - inicioSimulacion) / Math.max(1, pasosHechos));
  estadisticas.msDibujo = suavizar(estadisticas.msDibujo, finDibujo - finSimulacion);
  tiempoDesdeUltimasEstadisticas += transcurrido;
  if (tiempoDesdeUltimasEstadisticas > 0.25 && panelDebugVisible()) {
    tiempoDesdeUltimasEstadisticas = 0;
    actualizarEstadisticas(estadisticas);
  }

  requestAnimationFrame(cuadro);
}

// Arranque: se genera un mundo de fondo para la pantalla de título
prepararMundo();
requestAnimationFrame(cuadro);
