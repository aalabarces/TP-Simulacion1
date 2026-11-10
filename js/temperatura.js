'use strict';
/* =============================================================================
   SIMULACIÓN TÉRMICA
   Cada paso hace tres cosas sobre toda la grilla:

   1) DIFUSIÓN: el calor pasa de las celdas calientes a sus vecinas frías.
      Para cada par de celdas vecinas (A, B):
          flujo = conductividad * difusion * dt * (T_B - T_A)
      A gana "flujo" grados y B pierde lo mismo, así el calor total se conserva.
      La conductividad del par es la MENOR de las dos (el material más aislante
      manda: por eso el aire separa bien el magma del hielo).

   2) ENFRIAMIENTO GLOBAL (ley de Newton): cada celda se acerca a la
      temperatura ambiente una fracción por segundo:
          T = T + (T_ambiente - T) * enfriamiento * dt

   3) CAMBIOS DE ESTADO según la temperatura resultante:
        HIELO  > 0°           -> AGUA  (se derrite)
        AGUA   >= 100°        -> AIRE  (se evapora, larga vapor)
        AGUA   < -3°          -> HIELO, pero recién después de perder el CALOR LATENTE
                                 (nunca en el lago ni dentro de una llama)
        MAGMA  < 600°         -> MAGMA_SOLIDO

   OPTIMIZACIÓN: la difusión solo recorre los BLOQUES DESPIERTOS (ver grilla.js),
   igual que el autómata del agua. Un bloque sin gradiente térmico activo se
   duerme y se saltea; cuando algo externo cambia la temperatura de una celda
   (explosión, magma, lengua de fuego) se llama a despertarCelda() para que la
   difusión la procese en los pasos siguientes.
   ============================================================================= */

const TEMPERATURA_EVAPORACION = 100;
const TEMPERATURA_MINIMA_LAGO = 3; // el lago es termal: nunca baja de 3°, no se congela

/* Flujo térmico mínimo que mantiene un bloque despierto. Por debajo de este
   umbral la diferencia de temperatura es imperceptible y el bloque puede dormirse.
   Con conductividad máxima (magma = 1), factor = 0.25/60 ≈ 0.004 y ΔT = 0.25:
   flujo ≈ 1 × 0.004 × 0.25 = 0.001, así que el umbral está justo en el límite. */
const FLUJO_TERMICO_MINIMO = 0.001;

function simularTemperatura(dt) {
  difundirCalor(dt);
  enfriarYCambiarEstados(dt);
}

function difundirCalor(dt) {
  const factor = PARAMETROS.difusionTermica * dt;

  // Se calcula sobre una copia para que el orden del recorrido no afecte el resultado.
  // Solo se copian las celdas de los bloques despiertos (más 1 celda de borde),
  // que es hasta donde puede llegar el flujo de calor.
  for (let b = 0; b < bloqueDespierto.length; b++) {
    if (!bloqueDespierto[b]) continue;
    const { x1, x2, y1, y2 } = limitesDeBloque(b, 1);
    for (let y = y1; y < y2; y++) {
      const fila = y * ANCHO_GRILLA;
      for (let x = x1; x < x2; x++) temperaturaNueva[fila + x] = temperatura[fila + x];
    }
  }

  // Cada par de celdas vecinas se procesa UNA sola vez: solo el par (celda, derecha)
  // y el par (celda, abajo). Si el flujo es significativo, el bloque sigue despierto.
  for (let b = 0; b < bloqueDespierto.length; b++) {
    if (!bloqueDespierto[b]) continue;
    const { x1, x2, y1, y2 } = limitesDeBloque(b, 0);
    for (let y = y1; y < y2; y++) {
      for (let x = x1; x < x2; x++) {
        const indice = y * ANCHO_GRILLA + x;
        const conductividadPropia = CONDUCTIVIDAD[material[indice]];
        const temperaturaPropia = temperatura[indice];

        if (x < ANCHO_GRILLA - 1) {
          const vecino = indice + 1;
          const conductividadPar = Math.min(conductividadPropia, CONDUCTIVIDAD[material[vecino]]);
          const flujo = conductividadPar * factor * (temperatura[vecino] - temperaturaPropia);
          if (flujo !== 0) {
            temperaturaNueva[indice] += flujo;
            temperaturaNueva[vecino] -= flujo;
            if (Math.abs(flujo) > FLUJO_TERMICO_MINIMO) {
              bloqueDespiertoProximo[b] = 1;
              // Si el vecino está en el bloque contiguo, despertarlo también
              const bVecino = b % BLOQUES_X < BLOQUES_X - 1 ? b + 1 : -1;
              if (bVecino >= 0) bloqueDespiertoProximo[bVecino] = 1;
            }
          }
        }
        if (y < ALTO_GRILLA - 1) {
          const vecino = indice + ANCHO_GRILLA;
          const conductividadPar = Math.min(conductividadPropia, CONDUCTIVIDAD[material[vecino]]);
          const flujo = conductividadPar * factor * (temperatura[vecino] - temperaturaPropia);
          if (flujo !== 0) {
            temperaturaNueva[indice] += flujo;
            temperaturaNueva[vecino] -= flujo;
            if (Math.abs(flujo) > FLUJO_TERMICO_MINIMO) {
              bloqueDespiertoProximo[b] = 1;
              // Si el vecino está en el bloque de abajo, despertarlo también
              const bAbajo = b + BLOQUES_X < bloqueDespierto.length ? b + BLOQUES_X : -1;
              if (bAbajo >= 0) bloqueDespiertoProximo[bAbajo] = 1;
            }
          }
        }
      }
    }
  }
}

function enfriarYCambiarEstados(dt) {
  const ambiente = PARAMETROS.temperaturaAmbiente;
  const escala = PARAMETROS.escalaEnfriamiento * dt;
  const primerIndiceDelLago = mapa.filaSuperiorLago * ANCHO_GRILLA;

  for (let b = 0; b < bloqueDespierto.length; b++) {
    if (!bloqueDespierto[b]) continue;
    const { x1, x2, y1, y2 } = limitesDeBloque(b, 0);
    for (let y = y1; y < y2; y++) {
      for (let x = x1; x < x2; x++) {
        const indice = y * ANCHO_GRILLA + x;
        const tipo = material[indice];
        let grados = temperaturaNueva[indice];

        // Newton: acercarse al ambiente (se limita a 1 para no "pasarse" del ambiente)
        const fraccion = Math.min(1, ENFRIAMIENTO[tipo] * escala);
        grados += (ambiente - grados) * fraccion;
        temperatura[indice] = grados;

        if (tipo === HIELO) {
          if (grados > PARAMETROS.temperaturaFusion) {
            material[indice] = AGUA;
            masaAgua[indice] = MASA_MAXIMA; // el hielo derretido da una celda llena
            temperatura[indice] = 1; // agua recién derretida, apenas sobre 0°
            despertarCelda(indice);  // agua nueva: el autómata tiene que moverla
          }
        } else if (tipo === AGUA) {
          if (grados >= TEMPERATURA_EVAPORACION) {
            material[indice] = AIRE;
            masaAgua[indice] = 0;
            temperatura[indice] = 60;
            despertarCelda(indice);  // quedó un hueco: el agua de alrededor puede correrse
            if (Math.random() < 0.5) crearVapor(indice % ANCHO_GRILLA + 0.5, Math.floor(indice / ANCHO_GRILLA) + 0.5, 1);
          } else if (indice >= primerIndiceDelLago) {
            if (grados < TEMPERATURA_MINIMA_LAGO) temperatura[indice] = TEMPERATURA_MINIMA_LAGO;
          } else if (grados < PARAMETROS.temperaturaCongelamiento && !ocupadaPorLlama[indice]) {
            // CALOR LATENTE: el agua no se congela apenas llega al punto de congelamiento.
            // Se queda en esa temperatura y todo el frío que reciba de más se va
            // acumulando; recién cuando acumuló "calorLatente" grados se vuelve hielo.
            // (Es lo que pasa en la realidad: congelar agua que ya está a 0° requiere
            // sacarle mucho calor más, por eso un lago tarda tanto en congelarse.)
            const congelamiento = PARAMETROS.temperaturaCongelamiento;
            frioAcumulado[indice] += congelamiento - grados;
            temperatura[indice] = congelamiento;
            if (frioAcumulado[indice] >= PARAMETROS.calorLatente) congelarCelda(indice);
          }
        } else if (tipo === MAGMA) {
          if (grados < PARAMETROS.temperaturaSolidificacion) material[indice] = MAGMA_SOLIDO;
        }
        // Donde ya no hay agua no queda frío acumulado (si vuelve a haber agua, arranca de cero)
        if (material[indice] !== AGUA && frioAcumulado[indice] !== 0) frioAcumulado[indice] = 0;
      }
    }
  }
}

function congelarCelda(indice) {
  // Una celda con poca agua (película fina) se seca en vez de crear hielo nuevo
  material[indice] = masaAgua[indice] >= 0.5 || masaAgua[indice] === 0 ? HIELO : AIRE;
  masaAgua[indice] = 0;
  frioAcumulado[indice] = 0;
  temperatura[indice] = PARAMETROS.temperaturaCongelamiento;
  despertarCelda(indice);  // si se secó (quedó aire), el agua de alrededor puede correrse
}
