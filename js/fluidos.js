'use strict';
/* =============================================================================
   AUTÓMATA CELULAR: AGUA Y MAGMA (parte Euleriana)

   AGUA CON CANTIDAD POR CELDA
     Cada celda con material AGUA guarda cuánta agua tiene en "masaAgua"
     (1 = celda llena). Esa cantidad fluye, no las celdas enteras:
       1. ABAJO: pasa a la celda de abajo hasta llenarla.
       2. COSTADOS: se iguala con las vecinas (fluye de la más llena a la menos
          llena). Así una superficie con montes se aplana de a poco y queda
          pareja, sin escalones ni picos.
       3. ARRIBA: si una celda queda con más de 1 (agua apilada), el exceso sube.
     Los flujos menores a FLUJO_MINIMO se descartan: el agua llega a quedar
     QUIETA (celdasDeAguaActivas = 0) en lugar de moverse para siempre.

     Si abajo hay AIRE, la masa de la celda pasa a una PARTÍCULA en caída libre
     (estado Lagrangiano, ver particulas-agua.js) que al aterrizar suma su masa
     a la celda donde cae.

     Se calcula con doble búfer (se lee de masaAgua y se escribe en
     masaAguaNueva), así el resultado no depende del orden en que se recorre.

     Convención: masaAgua vale 0 donde no hay AGUA. Si otra parte del juego crea
     una celda de AGUA sin asignar masa (derretir hielo, generar el mapa), la
     masa 0 se interpreta como "celda llena".

   MAGMA (líquido viscoso):
     - Si toca AGUA: la evapora y se solidifica al instante (choque térmico).
     - Si abajo hay aire, cae.
     - Si no, con probabilidad "fluidezMagma" se corre una celda de costado.

   OPTIMIZACIÓN: solo se calculan los BLOQUES DESPIERTOS (ver grilla.js). Toda
   celda que tiene un flujo, se convierte en gota o tiene magma despierta su
   zona; un bloque sin actividad en un paso se duerme en el siguiente.
   ============================================================================= */

const MAXIMO_PARTICULAS_AGUA = 6000;

const MASA_MAXIMA = 1;           // masa de una celda llena
const COMPRESION_MAXIMA = 0.02;  // cuánto más que 1 puede tener una celda con agua encima
const MASA_MINIMA = 0.02;        // menos que esto: la celda se vacía (se descarta)
const FLUJO_MINIMO = 0.004;      // flujos menores se ignoran: así el agua se detiene

const PASOS_ENTRE_CONTEOS = 30; // las estadísticas del agua total se recalculan cada medio segundo

function simularFluidos() {
  const pasoActual = ++numeroDePaso;
  celdasDeAguaActivas = 0;

  // Mientras una gota recién convertida en partícula sigue en su celda de origen,
  // esa celda queda reservada: aunque la grilla la vea vacía, si el agua de al lado
  // se corriera ahí la gota chocaría al instante contra ella y no llegaría nunca
  // al hueco que tiene debajo (se repetiría para siempre).
  // Además, mientras dure la reserva la zona queda DESPIERTA: el agua de al lado no
  // puede correrse a esa celda, y si su bloque se durmiera por "no tener movimiento"
  // nadie lo despertaría cuando la gota se va (el agua quedaría trabada con aire al costado).
  for (const gota of particulasAgua) {
    const indiceActual = Math.floor(gota.y) * ANCHO_GRILLA + Math.floor(gota.x);
    if (indiceActual === gota.celdaOrigen) {
      pasoEnQueSeMovio[indiceActual] = pasoActual;
      despertarCelda(indiceActual);
    }
  }

  // Recorrido de ABAJO hacia ARRIBA (solo bloques despiertos): ordena la masa,
  // convierte en partículas el agua sin apoyo y mueve el magma.
  for (let y = ALTO_GRILLA - 1; y >= 0; y--) {
    const deIzquierdaADerecha = ((y + pasoActual) & 1) === 0; // alterna según fila y paso
    const primerBloqueDeLaFila = Math.floor(y / TAMANIO_BLOQUE) * BLOQUES_X;
    for (let k = 0; k < BLOQUES_X; k++) {
      const bx = deIzquierdaADerecha ? k : BLOQUES_X - 1 - k;
      if (!bloqueDespierto[primerBloqueDeLaFila + bx]) continue; // agua quieta: se saltea
      const xInicio = bx * TAMANIO_BLOQUE;
      const xFin = Math.min(ANCHO_GRILLA, xInicio + TAMANIO_BLOQUE);
      for (let j = 0; j < xFin - xInicio; j++) {
        const x = deIzquierdaADerecha ? xInicio + j : xFin - 1 - j;
        actualizarCeldaDeFluido(x, y, y * ANCHO_GRILLA + x, pasoActual);
      }
    }
  }

  // La masa fluye varias veces por paso: más repeticiones = el agua se nivela más rápido
  for (let n = 0; n < PARAMETROS.subpasosAgua; n++) nivelarAgua(pasoActual);

  // Los bloques con actividad en este paso son los que se calculan en el próximo;
  // el resto se duerme.
  bloquesCalculados = 0;
  for (let b = 0; b < bloqueDespierto.length; b++) bloquesCalculados += bloqueDespierto[b];
  bloqueDespierto.set(bloqueDespiertoProximo);
  bloqueDespiertoProximo.fill(0);

  if (pasoActual % PASOS_ENTRE_CONTEOS === 0) contarAguaTotal();
}

function actualizarCeldaDeFluido(x, y, indice, pasoActual) {
  const tipo = material[indice];
  if (tipo === AGUA) {
    if (masaAgua[indice] <= 0) masaAgua[indice] = MASA_MAXIMA; // creada sin masa: llena
    if (y < ALTO_GRILLA - 1 && material[indice + ANCHO_GRILLA] === AIRE) {
      convertirEnParticula(x, y, indice, pasoActual);
    }
  } else {
    masaAgua[indice] = 0; // donde no hay agua no hay masa (otra parte pudo borrarla)
    if (tipo === MAGMA && y < ALTO_GRILLA - 1 && pasoEnQueSeMovio[indice] !== pasoActual) {
      actualizarMagma(x, y, indice, pasoActual);
    }
  }
}

/* Estadísticas del panel de debug. Como los bloques dormidos no se recorren,
   el total se cuenta aparte recorriendo toda la grilla (solo cada medio segundo). */
function contarAguaTotal() {
  let celdas = 0, masa = 0;
  for (let i = 0; i < TOTAL_CELDAS; i++) {
    if (material[i] === AGUA) { celdas++; masa += masaAgua[i] || MASA_MAXIMA; }
  }
  celdasDeAguaEnGrilla = celdas;
  masaTotalDeAgua = masa;
}

/* La celda de agua no tiene apoyo: toda su masa pasa a una gota en caída libre. */
function convertirEnParticula(x, y, indice, pasoActual) {
  const masa = masaAgua[indice];
  celdasDeAguaActivas++;
  despertarCelda(indice); // el agua de alrededor puede correrse al hueco que queda
  if (particulasAgua.length < MAXIMO_PARTICULAS_AGUA) {
    if (masa >= MASA_MINIMA) {
      particulasAgua.push({
        x: x + 0.5, y: y + 0.5,                   // centro de la celda
        velocidadX: (Math.random() - 0.5) * 3,    // un poco de dispersión lateral
        velocidadY: 2,
        masa,
        celdaOrigen: indice,                      // ver la reserva al inicio de simularFluidos
        grados: temperatura[indice],
        llamasGolpeadas: 0                        // máscara de bits: a qué llamas ya mojó
      });
    }
    material[indice] = AIRE;
    masaAgua[indice] = 0;
    temperatura[indice] = PARAMETROS.temperaturaAmbiente;
    pasoEnQueSeMovio[indice] = pasoActual;        // celda recién vaciada: nadie más fluye ahí en este paso
  } else {
    // Si hay demasiadas partículas, cae dentro de la grilla (1 celda por paso)
    const indiceAbajo = indice + ANCHO_GRILLA;
    material[indiceAbajo] = AGUA;
    masaAgua[indiceAbajo] = masa;
    temperatura[indiceAbajo] = temperatura[indice];
    material[indice] = AIRE;
    masaAgua[indice] = 0;
    pasoEnQueSeMovio[indiceAbajo] = pasoActual;
    despertarCelda(indiceAbajo);
  }
}

/* Cuánto debería tener la celda de ABAJO cuando entre las dos suman "total".
   Hasta 1 se llena la de abajo; con más, la de abajo admite un poco más que 1
   (compresión) y el resto queda arriba. */
function masaEstableAbajo(total) {
  if (total <= MASA_MAXIMA) return MASA_MAXIMA;
  if (total < 2 * MASA_MAXIMA + COMPRESION_MAXIMA) {
    return (MASA_MAXIMA * MASA_MAXIMA + total * COMPRESION_MAXIMA) / (MASA_MAXIMA + COMPRESION_MAXIMA);
  }
  return (total + COMPRESION_MAXIMA) / 2;
}

/* ¿Puede entrar agua a esta celda? Sí si ya es agua, o si es aire que no está
   reservada por una gota que acaba de salir de ahí. */
function aceptaAgua(indice, pasoActual) {
  const tipo = material[indice];
  return tipo === AGUA || (tipo === AIRE && pasoEnQueSeMovio[indice] !== pasoActual);
}

/* Un paso de flujo de masa. Cada celda reparte su masa entre abajo, los costados
   y arriba (en ese orden). Se lee de masaAgua y se acumula en masaAguaNueva.
   Un flujo hacia una celda de AIRE solo cuenta si es al menos MASA_MINIMA
   (si no, la celda nacería ya vacía y se perdería esa agua). */
/* Límites (en celdas) de un bloque, agrandados "margen" celdas para cada lado. */
function limitesDeBloque(bloque, margen) {
  const bx = bloque % BLOQUES_X, by = (bloque - bx) / BLOQUES_X;
  return {
    x1: Math.max(0, bx * TAMANIO_BLOQUE - margen),
    x2: Math.min(ANCHO_GRILLA, (bx + 1) * TAMANIO_BLOQUE + margen), // x2 e y2 no incluidos
    y1: Math.max(0, by * TAMANIO_BLOQUE - margen),
    y2: Math.min(ALTO_GRILLA, (by + 1) * TAMANIO_BLOQUE + margen)
  };
}

function nivelarAgua(pasoActual) {
  // Bloques a calcular en este subpaso (se toma la lista al empezar)
  const bloques = [];
  for (let b = 0; b < bloqueDespierto.length; b++) if (bloqueDespierto[b]) bloques.push(b);
  if (bloques.length === 0) return;

  // Copia de trabajo: solo los bloques despiertos más 1 celda de borde, que es
  // hasta donde puede llegar un flujo (las vecinas de sus celdas).
  for (const bloque of bloques) {
    const { x1, x2, y1, y2 } = limitesDeBloque(bloque, 1);
    for (let y = y1; y < y2; y++) {
      const fila = y * ANCHO_GRILLA;
      for (let x = x1; x < x2; x++) masaAguaNueva[fila + x] = masaAgua[fila + x];
    }
  }

  let flujosAplicados = 0;
  const celdasVaciandose = []; // celdas que quedaron con muy poca agua (ver más abajo)

  for (const bloque of bloques) {
    const { x1, x2, y1, y2 } = limitesDeBloque(bloque, 0);
    for (let y = y1; y < y2; y++) for (let x = x1; x < x2; x++) {
      const indice = y * ANCHO_GRILLA + x;
      if (material[indice] !== AGUA) continue;
      const flujosAntes = flujosAplicados;
      let restante = masaAgua[indice];
      const masaAlEmpezar = restante;

      // 1) Abajo: se llena la celda de abajo
      if (y < ALTO_GRILLA - 1) {
        const abajo = indice + ANCHO_GRILLA;
        if (aceptaAgua(abajo, pasoActual)) {
          const masaAbajo = masaAgua[abajo];
          let flujo = masaEstableAbajo(restante + masaAbajo) - masaAbajo;
          if (flujo > restante) flujo = restante;
          if (flujo > FLUJO_MINIMO && (material[abajo] === AGUA || flujo >= MASA_MINIMA)) {
            masaAguaNueva[indice] -= flujo; masaAguaNueva[abajo] += flujo; restante -= flujo; flujosAplicados++;
            if (material[abajo] === AIRE) temperatura[abajo] = temperatura[indice];
          }
        }
      }

      // 2) Costados: fluye de la celda más llena a la menos llena
      for (let lado = -1; lado <= 1; lado += 2) {
        if (restante <= 0) break;
        const xVecino = x + lado;
        if (xVecino < 0 || xVecino >= ANCHO_GRILLA) continue;
        const vecino = indice + lado;
        if (!aceptaAgua(vecino, pasoActual)) continue;
        let flujo = (restante - masaAgua[vecino]) / 4; // con 1/4 por lado la igualación es estable (no se pasa de largo)
        if (flujo > restante) flujo = restante;
        if (flujo > FLUJO_MINIMO && (material[vecino] === AGUA || flujo >= MASA_MINIMA)) {
          masaAguaNueva[indice] -= flujo; masaAguaNueva[vecino] += flujo; restante -= flujo; flujosAplicados++;
          if (material[vecino] === AIRE) temperatura[vecino] = temperatura[indice];
        }
      }

      // 3) Arriba: si quedó con más de 1, el exceso sube
      if (restante > MASA_MAXIMA && y > 0) {
        const arriba = indice - ANCHO_GRILLA;
        if (aceptaAgua(arriba, pasoActual)) {
          let flujo = restante - masaEstableAbajo(restante + masaAgua[arriba]);
          if (flujo > FLUJO_MINIMO) flujo *= 0.5;
          if (flujo > restante) flujo = restante;
          if (flujo > FLUJO_MINIMO && (material[arriba] === AGUA || flujo >= MASA_MINIMA)) {
            masaAguaNueva[indice] -= flujo; masaAguaNueva[arriba] += flujo; flujosAplicados++;
            if (material[arriba] === AIRE) temperatura[arriba] = temperatura[indice];
          }
        }
      }

      if (masaAguaNueva[indice] < MASA_MINIMA && masaAguaNueva[indice] < masaAlEmpezar) celdasVaciandose.push(indice);
      // Si esta celda movió agua, su zona sigue despierta (incluye el bloque vecino si está en el borde)
      if (flujosAplicados !== flujosAntes) despertarCelda(indice);
    }
  }

  // Una celda que se vació casi del todo no se borra con su resto adentro (se
  // perdería agua): lo que le queda pasa a una vecina que tenga agua.
  for (const indice of celdasVaciandose) {
    const resto = masaAguaNueva[indice];
    if (resto < MASA_MINIMA && resto > 0) {
      const x = indice % ANCHO_GRILLA;
      const candidatas = [indice + ANCHO_GRILLA, x > 0 ? indice - 1 : -1, x < ANCHO_GRILLA - 1 ? indice + 1 : -1, indice - ANCHO_GRILLA];
      for (const vecina of candidatas) {
        if (vecina >= 0 && vecina < TOTAL_CELDAS && material[vecina] === AGUA && masaAguaNueva[vecina] >= MASA_MINIMA) {
          masaAguaNueva[vecina] += resto;
          masaAguaNueva[indice] = 0;
          break;
        }
      }
    }
  }

  // Aplicar (en la misma zona que se copió): una celda con masa pasa a ser AGUA;
  // con muy poca, se vacía. Si dos zonas se superponen, aplicar dos veces da lo mismo.
  for (const bloque of bloques) {
    const { x1, x2, y1, y2 } = limitesDeBloque(bloque, 1);
    for (let y = y1; y < y2; y++) {
      for (let x = x1; x < x2; x++) {
        const indice = y * ANCHO_GRILLA + x;
        const masa = masaAguaNueva[indice];
        const tipo = material[indice];
        if (tipo === AGUA) {
          if (masa < MASA_MINIMA) { material[indice] = AIRE; masaAgua[indice] = 0; }
          else masaAgua[indice] = masa;
        } else if (tipo === AIRE && masa >= MASA_MINIMA) {
          material[indice] = AGUA;
          masaAgua[indice] = masa;
        }
      }
    }
  }
  celdasDeAguaActivas += flujosAplicados;
}

function actualizarMagma(x, y, indice, pasoActual) {
  // Mientras haya magma líquido, su zona queda despierta (puede moverse o tocar agua en cualquier paso)
  despertarCelda(indice);

  // 1) Choque térmico: cada vecino de AGUA se evapora
  const vecinos = [
    x > 0 ? indice - 1 : -1,                  // izquierda
    x < ANCHO_GRILLA - 1 ? indice + 1 : -1,   // derecha
    y > 0 ? indice - ANCHO_GRILLA : -1,       // arriba
    indice + ANCHO_GRILLA                     // abajo
  ];
  let tocoAgua = false;
  for (const vecino of vecinos) {
    if (vecino >= 0 && material[vecino] === AGUA) {
      material[vecino] = AIRE;
      masaAgua[vecino] = 0;
      temperatura[vecino] = 80;
      crearVapor(vecino % ANCHO_GRILLA + 0.5, Math.floor(vecino / ANCHO_GRILLA) + 0.5, 2);
      tocoAgua = true;
    }
  }
  if (tocoAgua) {
    material[indice] = MAGMA_SOLIDO;
    temperatura[indice] *= 0.7; // perdió calor evaporando el agua
    return;
  }

  // 2) Caer si hay aire abajo (y no hay un jugador ahí)
  const indiceAbajo = indice + ANCHO_GRILLA;
  if (material[indiceAbajo] === AIRE && !ocupadaPorLlama[indiceAbajo]) {
    intercambiarCeldas(indice, indiceAbajo);
    pasoEnQueSeMovio[indiceAbajo] = pasoActual;
    return;
  }

  // 3) Escurrirse de costado de vez en cuando (es espeso)
  if (Math.random() < PARAMETROS.fluidezMagma) {
    const lado = Math.random() < 0.5 ? -1 : 1;
    const xVecino = x + lado;
    if (xVecino >= 0 && xVecino < ANCHO_GRILLA) {
      const indiceVecino = indice + lado;
      if (material[indiceVecino] === AIRE && !ocupadaPorLlama[indiceVecino]) {
        intercambiarCeldas(indice, indiceVecino);
        pasoEnQueSeMovio[indiceVecino] = pasoActual;
      }
    }
  }
}
