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
   ============================================================================= */

const TEMPERATURA_EVAPORACION = 100;
const TEMPERATURA_MINIMA_LAGO = 3; // el lago es termal: nunca baja de 3°, no se congela

function simularTemperatura(dt) {
  difundirCalor(dt);
  enfriarYCambiarEstados(dt);
}

function difundirCalor(dt) {
  const factor = PARAMETROS.difusionTermica * dt;
  // Se calcula sobre una copia para que el orden del recorrido no afecte el resultado
  temperaturaNueva.set(temperatura);

  for (let y = 0; y < ALTO_GRILLA; y++) {
    for (let x = 0; x < ANCHO_GRILLA; x++) {
      const indice = y * ANCHO_GRILLA + x;
      const conductividadPropia = CONDUCTIVIDAD[material[indice]];
      const temperaturaPropia = temperatura[indice];

      // Cada par se procesa UNA sola vez: solo con el vecino de la derecha y el de abajo.
      if (x < ANCHO_GRILLA - 1) {
        const vecino = indice + 1;
        const conductividadPar = Math.min(conductividadPropia, CONDUCTIVIDAD[material[vecino]]);
        const flujo = conductividadPar * factor * (temperatura[vecino] - temperaturaPropia);
        temperaturaNueva[indice] += flujo;
        temperaturaNueva[vecino] -= flujo;
      }
      if (y < ALTO_GRILLA - 1) {
        const vecino = indice + ANCHO_GRILLA;
        const conductividadPar = Math.min(conductividadPropia, CONDUCTIVIDAD[material[vecino]]);
        const flujo = conductividadPar * factor * (temperatura[vecino] - temperaturaPropia);
        temperaturaNueva[indice] += flujo;
        temperaturaNueva[vecino] -= flujo;
      }
    }
  }
}

function enfriarYCambiarEstados(dt) {
  const ambiente = PARAMETROS.temperaturaAmbiente;
  const escala = PARAMETROS.escalaEnfriamiento * dt;
  const primerIndiceDelLago = mapa.filaSuperiorLago * ANCHO_GRILLA;

  for (let indice = 0; indice < TOTAL_CELDAS; indice++) {
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

function congelarCelda(indice) {
  // Una celda con poca agua (película fina) se seca en vez de crear hielo nuevo
  material[indice] = masaAgua[indice] >= 0.5 || masaAgua[indice] === 0 ? HIELO : AIRE;
  masaAgua[indice] = 0;
  frioAcumulado[indice] = 0;
  temperatura[indice] = PARAMETROS.temperaturaCongelamiento;
  despertarCelda(indice);  // si se secó (quedó aire), el agua de alrededor puede correrse
}
