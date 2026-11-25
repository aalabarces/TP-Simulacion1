'use strict';
/* =============================================================================
   COMANDOS POR PASO

   La simulación NO lee el teclado ni los joysticks: lee los "comandos" que hay en
   comandosDelPaso, uno por equipo, y solo cambian al empezar cada paso. Quién los
   llena es lo único que cambia entre jugar local y online:
     - Local:  entrada.js los llena cada paso con el teclado/joystick/táctil
               (muestrearControlesLocales).
     - Online: cada PC manda los comandos de SU equipo y los dos lados aplican los
               mismos comandos en el mismo paso (ver la sincronización de red).

   Un comando es un objeto chico y siempre igual:
     mover:    -1 (izquierda) .. 1 (derecha)
     apuntar:  -1 (bajar el ángulo) .. 1 (subirlo)
     saltar, cargar: true / false   (cargar = mantener el disparo apretado)
     acciones: máscara de bits con las acciones de un solo toque de ESTE paso
               (ACCION_*): cambiar de llama y de arma (anterior / siguiente).
     elegirArma: número de arma que se eligió tocando su ícono, o -1 si ninguna.

   Esta parte es simulación pura: no depende del teclado, del dibujo ni del audio
   (salvo un sonido), así que también corre en los tests de determinismo.
   ============================================================================= */

const ACCION_CAMBIAR_LLAMA = 1;
const ACCION_ARMA_ANTERIOR = 2;
const ACCION_ARMA_SIGUIENTE = 4;

function comandoVacio() {
  return { mover: 0, apuntar: 0, saltar: false, cargar: false, acciones: 0, elegirArma: -1 };
}

/* El comando vigente de cada equipo (0 = J1, 1 = J2). */
const comandosDelPaso = [comandoVacio(), comandoVacio()];

function comandoDelEquipo(equipo) {
  return comandosDelPaso[equipo];
}

/* Copia el comando al buffer del equipo (se copian los campos, no se guarda el objeto,
   para que quien lo armó pueda reutilizarlo). */
function asignarComando(equipo, comando) {
  const destino = comandosDelPaso[equipo];
  destino.mover = comando.mover;
  destino.apuntar = comando.apuntar;
  destino.saltar = comando.saltar;
  destino.cargar = comando.cargar;
  destino.acciones = comando.acciones | 0;
  destino.elegirArma = comando.elegirArma === undefined ? -1 : comando.elegirArma;
}

function limpiarComandos() {
  for (const comando of comandosDelPaso) Object.assign(comando, comandoVacio());
}

/* ---------- Acciones de un solo toque ---------- */

/* Se puede cambiar de arma mientras se apunta y sin estar cargando un disparo. */
function puedeCambiarDeArma(llama) {
  if (!llama || !llama.vivo || juego.pantalla !== 'jugando' || llama.cargando || llama.rociando) return false;
  return MODOS_DE_JUEGO[juego.modo].tiempoReal || juego.fase === 'apuntar';
}

/* Recorre las armas en círculo: después de la última viene la primera (y al revés). */
function cambiarDeArma(llama, paso) {
  if (!puedeCambiarDeArma(llama)) return;
  llama.arma = (llama.arma + paso + CANTIDAD_ARMAS) % CANTIDAD_ARMAS;
  sonarCambioDeLlama();
}

/* Al empezar cada paso: ejecuta las acciones de un solo toque que trae cada comando.
   Tiempo real: afectan a la llama de ese equipo. Por turnos: solo cuentan las del
   equipo que tiene el turno, sobre la llama del turno. */
function aplicarAccionesDelPaso() {
  if (juego.pantalla !== 'jugando') return;
  const tiempoReal = esTiempoReal();
  for (let equipo = 0; equipo < comandosDelPaso.length; equipo++) {
    const { acciones, elegirArma } = comandosDelPaso[equipo];
    if (!acciones && elegirArma < 0) continue;
    if (!tiempoReal && equipo !== juego.equipoActual) continue;
    if (acciones & ACCION_CAMBIAR_LLAMA) cambiarDeLlama(); // solo hace algo por turnos
    const llama = tiempoReal ? llamasDelEquipo(equipo)[0] : llamaActual();
    if (acciones & ACCION_ARMA_ANTERIOR) cambiarDeArma(llama, -1);
    if (acciones & ACCION_ARMA_SIGUIENTE) cambiarDeArma(llama, 1);
    // Ícono tocado: se valida el número porque online viene de la red
    if (elegirArma >= 0 && elegirArma < CANTIDAD_ARMAS && llama && llama.arma !== elegirArma && puedeCambiarDeArma(llama)) {
      llama.arma = elegirArma;
      sonarCambioDeLlama();
    }
  }
}
