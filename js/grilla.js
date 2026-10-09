'use strict';
/* =============================================================================
   GRILLA (estado Euleriano)
   El mundo es una grilla fija de celdas. Para que sea rápido, cada propiedad
   se guarda en un arreglo tipado de una dimensión (Typed Array).

   Una celda (x, y) está en la posición:   indice = y * ANCHO_GRILLA + x
   Por eso:
     - la celda de la DERECHA es  indice + 1
     - la celda de la IZQUIERDA es indice - 1
     - la celda de ABAJO es       indice + ANCHO_GRILLA
     - la celda de ARRIBA es      indice - ANCHO_GRILLA
   ============================================================================= */

const material = new Uint8Array(TOTAL_CELDAS);        // qué hay en cada celda (AIRE, HIELO, ...)
const temperatura = new Float32Array(TOTAL_CELDAS);   // grados de cada celda
const temperaturaNueva = new Float32Array(TOTAL_CELDAS); // copia de trabajo para la difusión

/* Cuánta agua tiene cada celda de AGUA (1 = llena). Vale 0 donde no hay agua.
   Ver fluidos.js. */
const masaAgua = new Float32Array(TOTAL_CELDAS);
const masaAguaNueva = new Float32Array(TOTAL_CELDAS);    // copia de trabajo del flujo

/* Para no mover la misma gota dos veces en un mismo paso, se anota el
   número de paso en que se movió cada celda. */
const pasoEnQueSeMovio = new Uint32Array(TOTAL_CELDAS);

/* Celdas tapadas por un jugador (1 = ocupada). El magma no fluye ahí
   y el agua no se congela ahí, así nadie queda encerrado en un bloque. */
const ocupadaPorJugador = new Uint8Array(TOTAL_CELDAS);

/* Datos solo visuales, calculados al generar el mapa. */
const texturaRuido = new Uint8Array(TOTAL_CELDAS);    // variación de brillo por celda
const fondoRojo = new Uint8Array(TOTAL_CELDAS);       // color del fondo de la caverna
const fondoVerde = new Uint8Array(TOTAL_CELDAS);
const fondoAzul = new Uint8Array(TOTAL_CELDAS);

/* Datos del mapa actual. */
const mapa = {
  semilla: 0,
  filaSuperiorLago: ALTO_GRILLA - 16, // desde esta fila hacia abajo está el lago termal
  posicionInicialX: 40                // x del J1 (el J2 aparece en espejo)
};

let numeroDePaso = 0;            // cuántos pasos de fluidos se simularon
let celdasDeAguaEnGrilla = 0;    // estadística para el panel de debug
let celdasDeAguaActivas = 0;     // flujos de agua en el último paso (0 = agua estable)
let masaTotalDeAgua = 0;         // suma de masaAgua (se conserva salvo evaporación y descartes)

function indiceDeCelda(x, y) {
  return y * ANCHO_GRILLA + x;
}

function estaDentroDeLaGrilla(x, y) {
  return x >= 0 && x < ANCHO_GRILLA && y >= 0 && y < ALTO_GRILLA;
}

/* Intercambia material y temperatura de dos celdas.
   Así "se mueve" un fluido: la gota pasa a la otra celda y el aire ocupa su lugar. */
function intercambiarCeldas(indiceA, indiceB) {
  const materialA = material[indiceA];
  material[indiceA] = material[indiceB];
  material[indiceB] = materialA;
  const temperaturaA = temperatura[indiceA];
  temperatura[indiceA] = temperatura[indiceB];
  temperatura[indiceB] = temperaturaA;
}

/* Los jugadores chocan con todo menos con el aire y el agua
   (el agua los moja, no los frena). */
function esSolidoParaJugador(tipoMaterial) {
  return tipoMaterial === HIELO || tipoMaterial === PIEDRA
      || tipoMaterial === MAGMA_SOLIDO || tipoMaterial === MAGMA;
}
