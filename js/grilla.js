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

/* Calor latente: cuánto frío "extra" acumuló cada celda de agua que ya está en
   el punto de congelamiento. Se congela recién cuando llega a
   PARAMETROS.calorLatente (ver temperatura.js). Vale 0 donde no hay agua. */
const frioAcumulado = new Float32Array(TOTAL_CELDAS);

/* Celdas que NADA puede romper (1 = indestructible): la piedra de los bordes del
   mapa (franja de arriba del techo, paredes laterales y lecho del lago). La
   piedra de las islas no tiene esta marca: la bola de fuego la rompe. */
const celdaIndestructible = new Uint8Array(TOTAL_CELDAS);

/* Celdas tapadas por una llama (1 = ocupada). El magma no fluye ahí
   y el agua no se congela ahí, así nadie queda encerrado en un bloque. */
const ocupadaPorLlama = new Uint8Array(TOTAL_CELDAS);

/* Datos solo visuales, calculados al generar el mapa. */
const texturaRuido = new Uint8Array(TOTAL_CELDAS);    // variación de brillo por celda
const fondoRojo = new Uint8Array(TOTAL_CELDAS);       // color del fondo de la caverna
const fondoVerde = new Uint8Array(TOTAL_CELDAS);
const fondoAzul = new Uint8Array(TOTAL_CELDAS);

/* Datos del mapa actual. */
const mapa = {
  semilla: 0,
  filaSuperiorLago: ALTO_GRILLA - 16, // desde esta fila hacia abajo está el lago termal
  puntosDeAparicion: []               // [{ par, lado, x }]: uno por plataforma (ver generador-mapa.js)
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

/* ---------- Bloques despiertos (optimización del agua) ----------
   La grilla se divide en bloques de 16×16 celdas. El autómata del agua
   (fluidos.js) solo calcula los bloques DESPIERTOS; el agua de un bloque
   dormido está quieta y calcularla daría "no mover nada", así que se saltea.
   Es lo que plantea el GDD: el agua en reposo no consume recursos.

   - Un bloque se DUERME solo: si en un paso no tuvo ningún movimiento de agua
     ni magma, en el paso siguiente no se calcula.
   - Un bloque se DESPIERTA cuando algo puede mover su agua: llamar a
     despertarCelda() en TODO lugar que cambie el material o el agua de una celda
     (explosiones, derretir/congelar/evaporar, gotas que aterrizan, flujos...).

   Se usan dos arreglos: los bloques a calcular en ESTE paso y los que quedaron
   con actividad para el PRÓXIMO. Al terminar el paso de fluidos, el próximo pasa
   a ser el actual. */
const TAMANIO_BLOQUE = 16;
const BLOQUES_X = Math.ceil(ANCHO_GRILLA / TAMANIO_BLOQUE); // 20
const BLOQUES_Y = Math.ceil(ALTO_GRILLA / TAMANIO_BLOQUE);  // 12 (la última fila de bloques mide 4 celdas)
const bloqueDespierto = new Uint8Array(BLOQUES_X * BLOQUES_Y);
const bloqueDespiertoProximo = new Uint8Array(BLOQUES_X * BLOQUES_Y);
let bloquesCalculados = 0; // estadística: bloques despiertos en el último paso

/* Despierta los bloques que tocan la celda y sus 8 vecinas: si la celda está en
   el borde de un bloque, su agua puede pasar al bloque de al lado. */
function despertarCelda(indice) {
  const x = indice % ANCHO_GRILLA;
  const y = (indice - x) / ANCHO_GRILLA;
  despertarZona(x - 1, y - 1, x + 1, y + 1);
}

/* Despierta todos los bloques que tocan el rectángulo (x1, y1)-(x2, y2), en celdas. */
function despertarZona(x1, y1, x2, y2) {
  const primerBloqueX = Math.max(0, Math.floor(x1 / TAMANIO_BLOQUE));
  const ultimoBloqueX = Math.min(BLOQUES_X - 1, Math.floor(x2 / TAMANIO_BLOQUE));
  const primerBloqueY = Math.max(0, Math.floor(y1 / TAMANIO_BLOQUE));
  const ultimoBloqueY = Math.min(BLOQUES_Y - 1, Math.floor(y2 / TAMANIO_BLOQUE));
  for (let by = primerBloqueY; by <= ultimoBloqueY; by++) {
    for (let bx = primerBloqueX; bx <= ultimoBloqueX; bx++) {
      const bloque = by * BLOQUES_X + bx;
      bloqueDespierto[bloque] = 1;         // si todavía no se calculó en este paso, se calcula
      bloqueDespiertoProximo[bloque] = 1;  // y sigue despierto en el próximo
    }
  }
}

function despertarTodo() {
  bloqueDespierto.fill(1);
  bloqueDespiertoProximo.fill(1);
}

/* Las llamas chocan con todo menos con el aire y el agua
   (el agua los moja, no los frena). */
function esSolidoParaLlama(tipoMaterial) {
  return tipoMaterial === HIELO || tipoMaterial === PIEDRA
      || tipoMaterial === MAGMA_SOLIDO || tipoMaterial === MAGMA;
}
