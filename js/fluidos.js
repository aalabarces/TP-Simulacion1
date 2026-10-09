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
   ============================================================================= */

const MAXIMO_PARTICULAS_AGUA = 6000;

const MASA_MAXIMA = 1;           // masa de una celda llena
const COMPRESION_MAXIMA = 0.02;  // cuánto más que 1 puede tener una celda con agua encima
const MASA_MINIMA = 0.02;        // menos que esto: la celda se vacía (se descarta)
const FLUJO_MINIMO = 0.004;      // flujos menores se ignoran: así el agua se detiene

function simularFluidos() {
  const pasoActual = ++numeroDePaso;
  let contadorAgua = 0;
  let masaTotal = 0;
  celdasDeAguaActivas = 0;

  // Mientras una gota recién convertida en partícula sigue en su celda de origen,
  // esa celda queda reservada: aunque la grilla la vea vacía, si el agua de al lado
  // se corriera ahí la gota chocaría al instante contra ella y no llegaría nunca
  // al hueco que tiene debajo (se repetiría para siempre).
  for (const gota of particulasAgua) {
    const indiceActual = Math.floor(gota.y) * ANCHO_GRILLA + Math.floor(gota.x);
    if (indiceActual === gota.celdaOrigen) pasoEnQueSeMovio[indiceActual] = pasoActual;
  }

  // Recorrido de ABAJO hacia ARRIBA: ordena la masa, convierte en partículas el
  // agua sin apoyo y mueve el magma.
  for (let y = ALTO_GRILLA - 1; y >= 0; y--) {
    const deIzquierdaADerecha = ((y + pasoActual) & 1) === 0; // alterna según fila y paso
    for (let k = 0; k < ANCHO_GRILLA; k++) {
      const x = deIzquierdaADerecha ? k : ANCHO_GRILLA - 1 - k;
      const indice = y * ANCHO_GRILLA + x;
      const tipo = material[indice];

      if (tipo === AGUA) {
        if (masaAgua[indice] <= 0) masaAgua[indice] = MASA_MAXIMA; // creada sin masa: llena
        if (y < ALTO_GRILLA - 1 && material[indice + ANCHO_GRILLA] === AIRE) {
          convertirEnParticula(x, y, indice, pasoActual);
        } else {
          contadorAgua++;
          masaTotal += masaAgua[indice];
        }
      } else {
        masaAgua[indice] = 0; // donde no hay agua no hay masa (otra parte pudo borrarla)
        if (tipo === MAGMA && y < ALTO_GRILLA - 1 && pasoEnQueSeMovio[indice] !== pasoActual) {
          actualizarMagma(x, y, indice, pasoActual);
        }
      }
    }
  }

  // La masa fluye varias veces por paso: más repeticiones = el agua se nivela más rápido
  for (let n = 0; n < PARAMETROS.subpasosAgua; n++) nivelarAgua(pasoActual);

  celdasDeAguaEnGrilla = contadorAgua;
  masaTotalDeAgua = masaTotal;
}

/* La celda de agua no tiene apoyo: toda su masa pasa a una gota en caída libre. */
function convertirEnParticula(x, y, indice, pasoActual) {
  const masa = masaAgua[indice];
  celdasDeAguaActivas++;
  if (particulasAgua.length < MAXIMO_PARTICULAS_AGUA) {
    if (masa >= MASA_MINIMA) {
      particulasAgua.push({
        x: x + 0.5, y: y + 0.5,                   // centro de la celda
        velocidadX: (Math.random() - 0.5) * 3,    // un poco de dispersión lateral
        velocidadY: 2,
        masa,
        celdaOrigen: indice,                      // ver la reserva al inicio de simularFluidos
        grados: temperatura[indice],
        jugadoresGolpeados: 0                     // máscara de bits: a quién ya mojó
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
function nivelarAgua(pasoActual) {
  masaAguaNueva.set(masaAgua);
  let flujosAplicados = 0;
  const celdasVaciandose = []; // celdas que quedaron con muy poca agua (ver más abajo)

  for (let y = 0; y < ALTO_GRILLA; y++) {
    for (let x = 0; x < ANCHO_GRILLA; x++) {
      const indice = y * ANCHO_GRILLA + x;
      if (material[indice] !== AGUA) continue;
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

  // Aplicar: una celda con masa pasa a ser AGUA; con muy poca, se vacía
  for (let indice = 0; indice < TOTAL_CELDAS; indice++) {
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
  celdasDeAguaActivas += flujosAplicados;
}

function actualizarMagma(x, y, indice, pasoActual) {
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
  if (material[indiceAbajo] === AIRE && !ocupadaPorJugador[indiceAbajo]) {
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
      if (material[indiceVecino] === AIRE && !ocupadaPorJugador[indiceVecino]) {
        intercambiarCeldas(indice, indiceVecino);
        pasoEnQueSeMovio[indiceVecino] = pasoActual;
      }
    }
  }
}
