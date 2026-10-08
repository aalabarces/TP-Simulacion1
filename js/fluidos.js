'use strict';
/* =============================================================================
   AUTÓMATA CELULAR: AGUA Y MAGMA (parte Euleriana)

   La grilla se recorre de ABAJO hacia ARRIBA: así una gota que cae deja lugar
   para la de arriba en el mismo paso. Además se alterna el sentido de cada fila
   (izquierda→derecha / derecha→izquierda) para que el agua no tenga
   preferencia por un lado.

   AGUA:
     - Si abajo hay AIRE, la gota deja la grilla y se convierte en PARTÍCULA
       (estado Lagrangiano, ver particulas-agua.js).
     - Si está apoyada, se corre de costado hasta "dispersionAgua" celdas.
       Esto nivela la superficie: los cráteres se llenan con agua plana.

   MAGMA (líquido viscoso):
     - Si toca AGUA: la evapora y se solidifica al instante (choque térmico).
     - Si abajo hay aire, cae.
     - Si no, con probabilidad "fluidezMagma" se corre una celda de costado.
   ============================================================================= */

const MAXIMO_PARTICULAS_AGUA = 6000;

function simularFluidos() {
  const pasoActual = ++numeroDePaso;
  let contadorAgua = 0;

  // La última fila (ALTO_GRILLA - 1) es el fondo: no puede caer más, se arranca en la anterior
  for (let y = ALTO_GRILLA - 2; y >= 0; y--) {
    const deIzquierdaADerecha = ((y + pasoActual) & 1) === 0; // alterna según fila y paso
    for (let k = 0; k < ANCHO_GRILLA; k++) {
      const x = deIzquierdaADerecha ? k : ANCHO_GRILLA - 1 - k;
      const indice = y * ANCHO_GRILLA + x;
      const tipo = material[indice];

      if (tipo === AGUA) {
        contadorAgua++;
        if (pasoEnQueSeMovio[indice] !== pasoActual) actualizarAgua(x, y, indice, pasoActual);
      } else if (tipo === MAGMA) {
        if (pasoEnQueSeMovio[indice] !== pasoActual) actualizarMagma(x, y, indice, pasoActual);
      }
    }
  }
  celdasDeAguaEnGrilla = contadorAgua;
}

function actualizarAgua(x, y, indice, pasoActual) {
  const indiceAbajo = indice + ANCHO_GRILLA;

  // ¿AIRE debajo? -> pasa a ser una partícula en caída libre
  if (material[indiceAbajo] === AIRE) {
    if (particulasAgua.length < MAXIMO_PARTICULAS_AGUA) {
      particulasAgua.push({
        x: x + 0.5, y: y + 0.5,                   // centro de la celda
        velocidadX: (Math.random() - 0.5) * 3,    // un poco de dispersión lateral
        velocidadY: 2,
        grados: temperatura[indice],
        jugadoresGolpeados: 0                     // máscara de bits: a quién ya mojó
      });
      material[indice] = AIRE;
      temperatura[indice] = PARAMETROS.temperaturaAmbiente;
    } else {
      // Si hay demasiadas partículas, cae dentro de la grilla (1 celda por paso)
      intercambiarCeldas(indice, indiceAbajo);
      pasoEnQueSeMovio[indiceAbajo] = pasoActual;
    }
    return;
  }

  // Apoyada: probar primero un lado al azar y después el otro
  const primerLado = Math.random() < 0.5 ? -1 : 1;
  for (const lado of [primerLado, -primerLado]) {
    let destino = -1;
    for (let distanciaCeldas = 1; distanciaCeldas <= PARAMETROS.dispersionAgua; distanciaCeldas++) {
      const xVecino = x + lado * distanciaCeldas;
      if (xVecino < 0 || xVecino >= ANCHO_GRILLA) break;
      const indiceVecino = indice + lado * distanciaCeldas;
      if (material[indiceVecino] !== AIRE) break;       // pared o más agua: no sigue
      destino = indiceVecino;
      if (material[indiceVecino + ANCHO_GRILLA] === AIRE) break; // encontró un borde: en el próximo paso cae
    }
    if (destino >= 0) {
      intercambiarCeldas(indice, destino);
      pasoEnQueSeMovio[destino] = pasoActual;
      return;
    }
  }
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
