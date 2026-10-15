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

   Ritmo (medido): el lago arranca en la fila ~524 y la llama más baja está en la
   ~300, unas 220 filas más arriba. Con 90 celdas/s por lado no llegaba ni en 10
   minutos; con 300 llega en ~3.5 min. Por turnos se usa 150 y en tiempo real
   300 (ver caudalCascada más abajo).
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

/* Caudal según el modo: por turnos sube más despacio que en tiempo real. */
function caudalCascada() {
  return esTiempoReal() ? PARAMETROS.caudalCascadaTiempoReal : PARAMETROS.caudalCascadaPorTurnos;
}

function simularCascadas(dt) {
  if (juego.pantalla !== 'jugando' || caudalCascada() <= 0) return;

  // Cuántas gotas salen en este paso (puede ser fraccionario: se acumula)
  cascada.gotasPendientes += GOTAS_CASCADA_POR_SEGUNDO * dt;
  // Masa de cada gota: así, sumando todas las gotas de un segundo, cae exactamente "caudal" de agua
  const masaPorGota = caudalCascada() / GOTAS_CASCADA_POR_SEGUNDO;
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
    deCascada: true           // sin viento y no cuenta para "asentando" (ver turnos.js)
  });
}

/* Superficie LIBRE del lago en una columna: desde el fondo se sube por el agua y
   lo que quedó sumergido (piedras, salientes de hielo de la pared, roca) hasta el
   primer aire. Si justo debajo de ese aire hay agua, esa es la superficie. Si hay
   algo sólido (la columna pasa por una isla que asoma del agua), devuelve -1: el
   agua de abajo está atrapada bajo la isla y no puede subir, así que agregarle
   agua solo la empujaría hacia los costados y armaría un lomo. */
function superficieDelLago(columna) {
  let fila = ALTO_GRILLA - 1;
  while (fila > 0 && material[indiceDeCelda(columna, fila)] !== AIRE) fila--;
  if (fila >= ALTO_GRILLA - 1) return -1;
  return material[indiceDeCelda(columna, fila + 1)] === AGUA ? fila + 1 : -1;
}

/* ¿Esta celda de agua es parte del lago? Lo es si desde ella hacia abajo NO hay
   aire hasta el fondo (solo agua y cosas sumergidas: piedra, hielo de la pared,
   roca). Si aparece aire, es un charco o un pozo de un puente, que están más arriba.
   El hielo tiene que contar: las paredes tienen salientes de hielo, y si las gotas
   que caen junto a la pared no se repartieran, se formaría una loma contra ella. */
function esAguaDelLago(columna, fila) {
  for (let y = fila; y < ALTO_GRILLA; y++) {
    if (material[indiceDeCelda(columna, y)] === AIRE) return false;
  }
  return true;
}

/* Mide la superficie del lago cerca de las DOS paredes (donde caen las cascadas)
   y usa la más alta. El límite del lago solo sube (el agua de la cascada no se va). */
function actualizarNivelDelLago() {
  let superficieMasAlta = mapa.filaSuperiorLago;
  for (let desplazamiento = 2; desplazamiento <= 12; desplazamiento++) {
    for (const columna of [cascada.columnaInicial + desplazamiento, ANCHO_GRILLA - 1 - cascada.columnaInicial - desplazamiento]) {
      const fila = superficieDelLago(columna);
      if (fila >= 0) superficieMasAlta = Math.min(superficieMasAlta, fila);
    }
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
   Para saber si la gota cayó al lago se mira SU columna (esAguaDelLago), no un
   nivel medido en otro lado: si se comparara con el nivel de un solo costado,
   cuando el otro costado quedara un poco más alto sus gotas dejarían de
   repartirse y ese lado subiría cada vez más.
   Devuelve false si no pudo (la gota se deposita normalmente donde cayó). */
const COLUMNAS_A_PROBAR = 8; // algunas columnas no sirven (pasan por una isla): se prueba otra

function repartirEnElLago(gota) {
  // Solo si la gota cayó SOBRE el agua del lago (no sobre un saliente de la pared,
  // una piedra o un pozo del puente)
  const x = limitar(Math.floor(gota.x), 0, ANCHO_GRILLA - 1), y = Math.floor(gota.y);
  if (y + 1 >= ALTO_GRILLA || material[indiceDeCelda(x, y + 1)] !== AGUA) return false;
  if (!esAguaDelLago(x, y + 1)) return false;

  // Se prueban varias columnas al azar y el agua va a la MÁS BAJA (mayor fila,
  // porque Y crece hacia abajo): así llena los huecos y cualquier desnivel que se
  // forme se corrige solo, como en un lago de verdad.
  let mejorIndice = -1, mejorFila = -1;
  for (let intento = 0; intento < COLUMNAS_A_PROBAR; intento++) {
    const columna = Math.floor(cascada.columnaInicial + 1 + Math.random() * (ANCHO_GRILLA - 2 * cascada.columnaInicial - 2));
    const fila = superficieDelLago(columna);
    if (fila > mejorFila) { mejorFila = fila; mejorIndice = indiceDeCelda(columna, fila); }
  }
  if (mejorIndice < 0) return false; // ninguna columna con lago (pared, islas...)

  // masa 0 en una celda de AGUA significa "llena" (convención de fluidos.js)
  masaAgua[mejorIndice] = (masaAgua[mejorIndice] || MASA_MAXIMA) + gota.masa;
  despertarCelda(mejorIndice);
  return true; // si se pasa de 1, el flujo de fluidos.js sube el excedente a la celda de arriba
}

/* Gotas que no son de la cascada (las del disparo de este turno). */
function contarGotasDelDisparo() {
  let cantidad = 0;
  for (const gota of particulasAgua) if (!gota.deCascada) cantidad++;
  return cantidad;
}
