'use strict';
/* =============================================================================
   CASCADAS LATERALES (muerte súbita)

   Durante la partida, de cada pared lateral sale una cascada de agua que nunca
   se corta. El agua cae al lago y lo va llenando: con el tiempo el nivel sube
   hasta las plataformas y obliga a terminar la partida.

   - La cascada es un chorro de muchas gotas chicas (masa < 1 celda), así se ve
     continuo. El caudal (celdas de agua por segundo, por lado) es ajustable.
   - Las gotas de cascada NO las afecta el viento: si no, un viento fuerte las
     tiraría sobre las plataformas.
   - A medida que el lago sube, se mueve su límite superior (mapa.filaSuperiorLago):
     el agua de abajo de esa fila es termal y no se congela (ver temperatura.js).

   Ritmo (medido en la simulación): con 15 celdas/s por lado el lago sube unas
   4 filas por minuto (el lago mide ~300 celdas de ancho y parte del agua queda
   en el camino). Con el valor por defecto (25) sube ~7 filas por minuto y llega
   a las plataformas (unas 60 filas más arriba) en 8-9 minutos.
   ============================================================================= */

const GOTAS_CASCADA_POR_SEGUNDO = 120;   // por lado (solo visual: el caudal real lo fija la masa)
const TEMPERATURA_AGUA_CASCADA = 6;      // agua termal, tarda en congelarse
const INTERVALO_MEDICION_LAGO = 0.5;     // segundos entre mediciones del nivel del lago

const cascada = {
  y: 0,                  // fila donde nace el chorro
  columnaInicial: 0,     // cara de la pared izquierda al generar el mapa (para medir el lago)
  xIzquierda: 0,         // columna de la boca izquierda (se recalcula cada paso)
  xDerecha: 0,           // columna de la boca derecha (se recalcula cada paso)
  gotasPendientes: 0,    // fracción de gota acumulada entre pasos
  tiempoSinMedir: 0
};

/* Se llama después de generar cada mapa: el chorro nace 2 filas debajo del
   borde inferior del techo (medido lejos de la pared). */
function prepararCascadas() {
  let fila = 0;
  while (fila < ALTO_GRILLA - 1 && material[indiceDeCelda(MARGEN_PARED + 2, fila)] !== AIRE) fila++;
  cascada.y = fila + 2;
  ubicarBocasDeCascada();
  cascada.columnaInicial = cascada.xIzquierda;
  cascada.gotasPendientes = 0;
  cascada.tiempoSinMedir = 0;
}

/* La boca de cada cascada está en la CARA de la pared: la primera celda de aire
   en la fila del chorro, buscando desde el borde de la pantalla hacia adentro.
   Se recalcula en cada paso: si se rompe el hielo de la pared, la boca se corre
   hacia el borde y queda pegada al hielo o la piedra que quede. Cada lado se
   busca por separado (romper la pared izquierda no mueve la cascada derecha).
   El agua también cuenta como "pared": si la cascada llena un hueco de la pared,
   el chorro sale por encima de esa agua. */
function ubicarBocasDeCascada() {
  const filaChorro = cascada.y * ANCHO_GRILLA;
  let izquierda = 0;
  while (izquierda < MITAD_ANCHO && material[filaChorro + izquierda] !== AIRE) izquierda++;
  let derecha = ANCHO_GRILLA - 1;
  while (derecha >= MITAD_ANCHO && material[filaChorro + derecha] !== AIRE) derecha--;
  cascada.xIzquierda = izquierda;
  cascada.xDerecha = derecha;
}

function simularCascadas(dt) {
  if (juego.pantalla !== 'jugando' || PARAMETROS.caudalCascada <= 0) return;

  // Cuántas gotas salen en este paso (puede ser fraccionario: se acumula)
  cascada.gotasPendientes += GOTAS_CASCADA_POR_SEGUNDO * dt;
  // Masa de cada gota: así, sumando todas las gotas de un segundo, cae exactamente "caudal" de agua
  const masaPorGota = PARAMETROS.caudalCascada / GOTAS_CASCADA_POR_SEGUNDO;
  ubicarBocasDeCascada();

  while (cascada.gotasPendientes >= 1 && particulasAgua.length < MAXIMO_PARTICULAS_AGUA - 2) {
    cascada.gotasPendientes -= 1;
    // Un poco de dispersión: el chorro sale con 1-2 celdas de ancho y un leve empuje hacia el centro
    const corrimiento = Math.random() * 1.5;
    const empuje = 2 + Math.random() * 4;
    crearGotaDeCascada(cascada.xIzquierda + 0.5 + corrimiento, empuje, masaPorGota);  // sale hacia la derecha
    crearGotaDeCascada(cascada.xDerecha + 0.5 - corrimiento, -empuje, masaPorGota);   // sale hacia la izquierda
  }

  cascada.tiempoSinMedir += dt;
  if (cascada.tiempoSinMedir >= INTERVALO_MEDICION_LAGO) {
    cascada.tiempoSinMedir = 0;
    actualizarNivelDelLago();
  }
}

function crearGotaDeCascada(x, velocidadX, masa) {
  particulasAgua.push({
    x, y: cascada.y + 0.5,
    velocidadX, velocidadY: 0,
    masa,
    celdaOrigen: -1,          // no nació de una celda de la grilla
    grados: TEMPERATURA_AGUA_CASCADA,
    llamasGolpeadas: 0,
    deCascada: true           // sin viento y no cuenta para "asentando" (ver turnos.js)
  });
}

/* Mide la superficie del lago en las columnas donde cae la cascada: desde el
   fondo hacia arriba se saltea la piedra del lecho y se recorre el agua; la
   última fila con agua es la superficie. Se usa la más alta de las columnas
   medidas. El límite del lago solo sube (el agua de la cascada no se va). */
function actualizarNivelDelLago() {
  let superficieMasAlta = mapa.filaSuperiorLago;
  for (let columna = cascada.columnaInicial + 2; columna <= cascada.columnaInicial + 12 && columna < MITAD_ANCHO; columna++) {
    let fila = ALTO_GRILLA - 1;
    while (fila > 0 && material[indiceDeCelda(columna, fila)] === PIEDRA) fila--;
    if (material[indiceDeCelda(columna, fila)] !== AGUA) continue;
    while (fila > 0 && material[indiceDeCelda(columna, fila - 1)] === AGUA) fila--;
    superficieMasAlta = Math.min(superficieMasAlta, fila);
  }
  mapa.filaSuperiorLago = superficieMasAlta;
}

/* Reparto en el lago (vasos comunicantes)
   El autómata celular mueve el agua de a una celda por paso, así que el agua que
   la cascada tira junto a la pared tardaría minutos en llegar al centro de un lago
   de 300 celdas: se formaría una loma contra las paredes. En un lago real la
   presión del agua empareja el nivel casi al instante. Para imitarlo, cada gota
   que cae al lago (de la cascada o de cualquier otro lado) suma su masa a la
   superficie de una columna AL AZAR del lago: en promedio sube parejo en todo
   su ancho.
   Se aplica a TODAS las gotas, no solo a las de la cascada: si el chorro cae
   sobre un saliente de la pared, esa agua se escurre como gotas "comunes", y si
   esas no se repartieran se formaría igual la loma contra la pared.
   Devuelve false si no pudo (la gota se deposita normalmente donde cayó). */
const COLUMNAS_A_PROBAR = 4;

function repartirEnElLago(gota) {
  // Solo si la gota cayó SOBRE AGUA cerca de la superficie del lago (no sobre un
  // saliente de la pared, una piedra o un pozo del puente)
  const x = Math.floor(gota.x), y = Math.floor(gota.y);
  if (y < mapa.filaSuperiorLago - 2 || y + 1 >= ALTO_GRILLA) return false;
  if (material[indiceDeCelda(x, y + 1)] !== AGUA) return false;

  for (let intento = 0; intento < COLUMNAS_A_PROBAR; intento++) {
    const columna = Math.floor(cascada.columnaInicial + 1 + Math.random() * (ANCHO_GRILLA - 2 * cascada.columnaInicial - 2));
    // Desde el fondo: saltear la piedra del lecho y subir por el agua hasta la superficie
    let fila = ALTO_GRILLA - 1;
    while (fila > 0 && material[indiceDeCelda(columna, fila)] === PIEDRA) fila--;
    if (material[indiceDeCelda(columna, fila)] !== AGUA) continue; // columna sin lago (pared, etc.)
    while (fila > 0 && material[indiceDeCelda(columna, fila - 1)] === AGUA) fila--;

    const indice = indiceDeCelda(columna, fila);
    // masa 0 en una celda de AGUA significa "llena" (convención de fluidos.js)
    masaAgua[indice] = (masaAgua[indice] || MASA_MAXIMA) + gota.masa;
    despertarCelda(indice);
    return true; // si se pasa de 1, el flujo de fluidos.js sube el excedente a la celda de arriba
  }
  return false;
}

/* Gotas que no son de la cascada (las del disparo de este turno). */
function contarGotasDelDisparo() {
  let cantidad = 0;
  for (const gota of particulasAgua) if (!gota.deCascada) cantidad++;
  return cantidad;
}
