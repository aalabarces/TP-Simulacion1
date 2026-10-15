'use strict';
/* =============================================================================
   GENERADOR PROCEDURAL DEL MAPA (mundo vertical)

   El mundo es alto y angosto. Solo las PLATAFORMAS DE ARRANQUE y los puentes que
   las unen son simétricos (se genera la mitad izquierda y se copia en espejo):
   todos arrancan a la misma altura y nadie parte con ventaja. El resto es libre
   y distinto a cada lado.

   Las plataformas de arranque están a ALTURAS DISTINTAS y casi no se conectan:
   para llegar de una a otra hay que caerse, tirarse con la lengua de fuego o
   romper y reconstruir terreno. Los puentes son raros y solo unen islas a
   alturas parecidas.

   Partes del mapa (de arriba hacia abajo):
     1. Techo de hielo con estalactitas, reservas de agua colgantes y burbujas
        de agua encerradas dentro del hielo.
     2. Paredes laterales de hielo (por ellas caen las cascadas).
     3. ZONA ALTA: cuencos en U con agua (distintas cantidades) flotando a
        distintas alturas. Romper la pared de un cuenco suelta su agua hacia
        abajo; rellenarla con magma la desvía.
     4. ARENA: una plataforma por llama, la mitad de cada lado, a distintas
        alturas y con algún puente (y pozos) suelto. Encima de cada una, un
        TECHO DE ROCA más chico que protege a la llama del agua que cae (se
        puede romper con la bola de fuego).
     5. ZONA BAJA: más cuencos con agua y piedras chicas flotando, que con
        suerte frenan una caída.
     6. Lago de agua "termal" en el fondo (caer ahí es ahogarse); sube con las
        cascadas.
   ============================================================================= */

const MITAD_ANCHO = ANCHO_GRILLA / 2;

/* Cuántas filas se baja el techo (y con él las reservas de agua). */
const DESCENSO_TECHO = 10;

/* Altura (fila) de la superficie de las plataformas de arranque. Cada par de plataformas
   espejadas tiene su propia altura, así que hay islas altas y bajas. */
const FILA_ARENA = 280;
const DESNIVEL_MINIMO_VECINAS = 16; // filas de diferencia mínima entre plataformas vecinas
const VARIACION_ARENA = 38; // cada plataforma (par de plataformas espejadas) queda entre FILA_ARENA ± esto
/* Filas que se dejan libres de estructuras sueltas sobre y bajo la arena: encima de
   una llama hay lugar para saltar, apuntar y colgarse; debajo, para los puentes. */
const ESPACIO_SOBRE_ARENA = 33;
const ESPACIO_BAJO_ARENA = 46;
/* Las estructuras sueltas no se acercan a las paredes: por esa franja caen las cascadas. */
const MARGEN_ESTRUCTURAS = 34;
const FILA_MINIMA_ESTRUCTURAS = 62;
const SEPARACION_ENTRE_ESTRUCTURAS = 7; // celdas de aire que rodean a cada estructura suelta

/* ---------- Pintado ---------- */

/* Pinta la celda (x, y) de la mitad izquierda y su espejo en la mitad derecha.
   El espejo de la columna x es la columna (ANCHO_GRILLA - 1 - x). */
function pintarSimetrico(x, y, tipoMaterial, grados) {
  if (x < 0 || x >= MITAD_ANCHO || y < 0 || y >= ALTO_GRILLA) return;
  const indiceIzquierdo = indiceDeCelda(x, y);
  const indiceEspejo = indiceDeCelda(ANCHO_GRILLA - 1 - x, y);
  material[indiceIzquierdo] = tipoMaterial;
  material[indiceEspejo] = tipoMaterial;
  temperatura[indiceIzquierdo] = grados;
  temperatura[indiceEspejo] = grados;
  celdaIndestructible[indiceIzquierdo] = 0;
  celdaIndestructible[indiceEspejo] = 0;
}

/* Rellena con hielo solo las celdas que todavía son aire (no pisa el agua de las reservas). */
function pintarHieloSiEsAire(x, y) {
  if (material[indiceDeCelda(x, y)] === AIRE) pintarSimetrico(x, y, HIELO, PARAMETROS.temperaturaAmbiente);
}

/* Lo mismo, pero una sola celda (sin espejo): para todo lo que no es simétrico. */
function pintar(x, y, tipoMaterial, grados) {
  if (x < 0 || x >= ANCHO_GRILLA || y < 0 || y >= ALTO_GRILLA) return;
  const indice = indiceDeCelda(x, y);
  material[indice] = tipoMaterial;
  temperatura[indice] = grados;
  celdaIndestructible[indice] = 0;
}

/* Piedra del BORDE del mapa (techo, paredes, lecho del lago): queda marcada como
   indestructible. La piedra de las islas se pinta con pintar y sí se puede romper. */
function pintarBorde(x, y) {
  if (x < 0 || x >= ANCHO_GRILLA || y < 0 || y >= ALTO_GRILLA) return;
  pintar(x, y, PIEDRA, PARAMETROS.temperaturaAmbiente);
  celdaIndestructible[indiceDeCelda(x, y)] = 1;
}

function pintarHieloLibreSiEsAire(x, y) {
  if (x >= 0 && x < ANCHO_GRILLA && y >= 0 && y < ALTO_GRILLA && material[indiceDeCelda(x, y)] === AIRE) {
    pintar(x, y, HIELO, PARAMETROS.temperaturaAmbiente);
  }
}

/* cantidadPlataformas: una por personaje en juego (se reparten mitad por lado). */
function generarMapa(semilla, cantidadPlataformas) {
  const aleatorio = crearAleatorioConSemilla(semilla);
  const aleatorioEntre = (minimo, maximo) => minimo + (maximo - minimo) * aleatorio();
  const enteroEntre = (minimo, maximo) => Math.floor(aleatorioEntre(minimo, maximo + 1));

  mapa.semilla = semilla;
  mapa.filaSuperiorLago = ALTO_GRILLA - 16;
  material.fill(AIRE);
  celdaIndestructible.fill(0);
  frioAcumulado.fill(0);
  masaAgua.fill(0); // el agua que se pinte después queda con masa 0 = celda llena
  temperatura.fill(PARAMETROS.temperaturaAmbiente);

  generarTechoYLago(semilla);
  generarParedes(semilla);
  generarReservasDeAgua(aleatorioEntre, enteroEntre);
  generarEstalactitas(aleatorioEntre, enteroEntre);
  generarBurbujasEnElTecho(aleatorioEntre, enteroEntre);
  const plataformas = generarPlataformas(semilla, cantidadPlataformas, aleatorioEntre, enteroEntre);
  generarPuentes(plataformas, aleatorioEntre, enteroEntre, aleatorio);

  // Un punto de aparición por plataforma, en PARES espejados: el par n tiene una
  // plataforma a la izquierda (lado 0) y su espejo a la derecha (lado 1,
  // x' = ANCHO_GRILLA - x). Qué jugador va en cada una lo decide turnos.js.
  // "filaBusqueda" es desde dónde buscar el suelo: unas filas sobre la plataforma
  // (así no se confunde con una estructura que haya más arriba).
  mapa.puntosDeAparicion = [
    ...plataformas.map((p, par) => ({ par, lado: 0, x: p.centroX, filaBusqueda: p.filaSuperior - 12 })),
    ...plataformas.map((p, par) => ({ par, lado: 1, x: ANCHO_GRILLA - p.centroX, filaBusqueda: p.filaSuperior - 12 }))
  ];
  mapa.filaArenaMinima = Math.min(...plataformas.map(p => p.filaSuperior));
  mapa.filaArenaMaxima = Math.max(...plataformas.map(p => p.filaSuperior));
  mapa.filaArena = Math.round((mapa.filaArenaMinima + mapa.filaArenaMaxima) / 2);

  generarTechosDeRoca(plataformas, enteroEntre);
  generarEstructurasSueltas(aleatorioEntre, enteroEntre, aleatorio);
  generarPiedrasDeSalvacion(aleatorioEntre, enteroEntre);

  generarFondoYTextura(semilla);
  despertarTodo(); // mapa nuevo: todo el agua se calcula al menos una vez hasta quedar quieta
}

/* ---------- 1. Techo y lago ---------- */
function generarTechoYLago(semilla) {
  const ambiente = PARAMETROS.temperaturaAmbiente;
  for (let x = 0; x < ANCHO_GRILLA; x++) {
    // Grosor del techo: entre 8 y 19 celdas (más DESCENSO_TECHO), variando suavemente con el ruido
    const grosorTecho = Math.round(8 + DESCENSO_TECHO + ruidoFractal(x * 0.045, 0.5, semilla) * 11);
    for (let y = 0; y < grosorTecho; y++) {
      // Las 2 primeras filas son piedra indestructible: el techo nunca se puede atravesar
      if (y < 2) pintarBorde(x, y);
      else pintar(x, y, HIELO, ambiente);
    }
    // Lecho del lago: piedra indestructible e irregular en las últimas 3 a 7 filas
    const filaLecho = ALTO_GRILLA - 3 - Math.round(ruidoFractal(x * 0.09, 3.7, semilla + 3) * 4);
    for (let y = mapa.filaSuperiorLago; y < ALTO_GRILLA; y++) {
      if (y >= filaLecho) pintarBorde(x, y);
      else pintar(x, y, AGUA, 4); // el lago empieza a 4° (es termal)
    }
  }
}

/* ---------- 2. Paredes laterales (cada lado con su propio relieve) ----------
   Arriba (donde nacen las cascadas) las paredes miden GROSOR_MAXIMO_PARED y más
   abajo nunca sobresalen más que eso: el agua que cae pegada a la pared no se
   engancha en ninguna saliente en sus 500 filas de caída. */
const GROSOR_MAXIMO_PARED = 9;
const FILAS_DE_PARED_PAREJA = 50;

function generarParedes(semilla) {
  const ambiente = PARAMETROS.temperaturaAmbiente;
  for (let y = 0; y < ALTO_GRILLA; y++) {
    let grosorIzquierda = Math.round(3 + ruidoFractal(0.5, y * 0.06, semilla + 11) * (GROSOR_MAXIMO_PARED - 3)); // 3 a 9 celdas
    let grosorDerecha = Math.round(3 + ruidoFractal(0.5, y * 0.06, semilla + 12) * (GROSOR_MAXIMO_PARED - 3));
    if (y < FILAS_DE_PARED_PAREJA) grosorIzquierda = grosorDerecha = GROSOR_MAXIMO_PARED;
    for (let x = 0; x < Math.max(grosorIzquierda, grosorDerecha); x++) {
      // Las 2 primeras columnas son piedra indestructible (el borde del mundo)
      if (x < grosorIzquierda) {
        if (x < 2) pintarBorde(x, y); else pintar(x, y, HIELO, ambiente);
      }
      if (x < grosorDerecha) {
        if (x < 2) pintarBorde(ANCHO_GRILLA - 1 - x, y); else pintar(ANCHO_GRILLA - 1 - x, y, HIELO, ambiente);
      }
    }
  }
}

/* ---------- 3. Reservas de agua en el techo ----------
   Cada reserva es una elipse de agua envuelta en una "cáscara" de hielo
   que cuelga del techo. Romper la cáscara con fuego libera el agua. */
function generarReservasDeAgua(aleatorioEntre, enteroEntre) {
  const reservas = [];
  const cantidad = enteroEntre(10, 13);
  let intentos = 0;
  while (reservas.length < cantidad && intentos++ < 400) {
    const radioX = enteroEntre(6, 11);
    const centroX = aleatorioEntre(16 + radioX, ANCHO_GRILLA - 16 - radioX);
    const noSeSuperpone = reservas.every(r => Math.abs(r.centroX - centroX) > r.radioX + radioX + 6);
    if (noSeSuperpone) reservas.push({ centroX, radioX, radioY: enteroEntre(4, 6) });
  }

  for (const reserva of reservas) {
    const centroY = 3 + DESCENSO_TECHO + reserva.radioY;
    const gradosReserva = aleatorioEntre(TEMPERATURA_MINIMA_BURBUJA, TEMPERATURA_MAXIMA_BURBUJA);
    const margen = 5; // "hombros" de hielo a cada lado de la reserva
    for (let x = Math.floor(reserva.centroX - reserva.radioX - margen); x <= Math.ceil(reserva.centroX + reserva.radioX + margen); x++) {
      if (x < 0 || x >= ANCHO_GRILLA) continue;
      // u = posición horizontal normalizada: -1 en el borde izquierdo de la elipse, 0 en el centro, +1 en el derecho
      const u = (x - reserva.centroX) / reserva.radioX;
      const distanciaAlCentro = Math.abs(u);

      if (distanciaAlCentro < 1) {
        // Ecuación de la elipse: medio alto del agua en esta columna = radioY * √(1 - u²)
        const medioAltoAgua = reserva.radioY * Math.sqrt(1 - u * u);
        // La cáscara de hielo termina 3 a 5 celdas debajo del agua (más gruesa en el centro)
        const fondoCascara = Math.round(centroY + medioAltoAgua + 3 + (1 - u * u) * 2);
        for (let y = 2; y <= fondoCascara; y++) pintarHieloLibreSiEsAire(x, y);
        for (let y = Math.max(3, Math.ceil(centroY - medioAltoAgua)); y <= Math.floor(centroY + medioAltoAgua); y++) {
          pintar(x, y, AGUA, gradosReserva);
        }
      } else {
        // Hombros: hielo que baja en rampa desde el borde de la reserva
        const rampa = 1 - (distanciaAlCentro - 1) * reserva.radioX / margen;
        const fondoHombro = Math.round(centroY + 3 * rampa);
        for (let y = 2; y <= fondoHombro; y++) pintarHieloLibreSiEsAire(x, y);
      }
    }
  }
}

/* ---------- Burbujas de agua dentro del techo ----------
   Círculos de agua encerrados en el hielo del techo, en todas las alturas:
   al romper el techo con fuego se van destapando por capas.
   Para cubrir TODO el techo se prueban muchas posiciones al azar y se pone una
   burbuja en cada lugar donde entra (con una pared de hielo de 1 celda alrededor).
   A medida que el techo se llena, cada vez menos intentos tienen lugar: el
   resultado es un techo "lleno" sin que las burbujas se toquen. */
const INTENTOS_BURBUJAS = 7200;
const RADIO_MINIMO_BURBUJA = 3;
const RADIO_MAXIMO_BURBUJA = 5.5;

/* Cada burbuja (y cada reserva) arranca a una temperatura distinta, así no se
   congelan todas al mismo tiempo: las más tibias tardan más en llegar al punto
   de congelamiento. El rango es chico a propósito: entre burbujas hay paredes de
   hielo de 1 celda, y agua mucho más caliente que 0° las derretiría. */
const TEMPERATURA_MINIMA_BURBUJA = -2.5;
const TEMPERATURA_MAXIMA_BURBUJA = 4;
function generarBurbujasEnElTecho(aleatorioEntre, enteroEntre) {
  // Fila donde termina el hielo del techo en cada columna (primera celda de aire)
  const fondoTecho = new Int16Array(ANCHO_GRILLA);
  for (let x = 0; x < ANCHO_GRILLA; x++) {
    let y = 0;
    while (y < ALTO_GRILLA && material[indiceDeCelda(x, y)] !== AIRE) y++;
    fondoTecho[x] = y;
  }
  // Las paredes laterales son hielo hasta el fondo: sin este tope, aparecerían
  // burbujas sueltas dentro de la pared. Se usa el techo más bajo (fuera de la pared).
  const techoMasBajo = Math.max(...fondoTecho.slice(MARGEN_PARED, ANCHO_GRILLA - MARGEN_PARED));
  for (let x = 0; x < ANCHO_GRILLA; x++) fondoTecho[x] = Math.min(fondoTecho[x], techoMasBajo);

  for (let intento = 0; intento < INTENTOS_BURBUJAS; intento++) {
    const radio = aleatorioEntre(RADIO_MINIMO_BURBUJA, RADIO_MAXIMO_BURBUJA);
    const centroX = aleatorioEntre(3, ANCHO_GRILLA - 3);
    // Altura al azar entre la fila 3 (abajo de la piedra) y 2 celdas por encima del borde inferior del techo
    const filaMinima = 3 + radio;
    const filaMaxima = fondoTecho[Math.floor(centroX)] - radio - 2;
    if (filaMaxima <= filaMinima) continue;
    const centroY = aleatorioEntre(filaMinima, filaMaxima);

    // Se pide 1 celda extra de radio toda de hielo: así cada burbuja queda
    // envuelta por una pared y no se une con otra burbuja ni con una reserva.
    if (!circuloEsTodoHielo(centroX, centroY, radio + 1)) continue;
    const gradosBurbuja = aleatorioEntre(TEMPERATURA_MINIMA_BURBUJA, TEMPERATURA_MAXIMA_BURBUJA);
    for (let y = Math.floor(centroY - radio); y <= Math.ceil(centroY + radio); y++) {
      for (let x = Math.floor(centroX - radio); x <= Math.ceil(centroX + radio); x++) {
        if (distancia(x + 0.5, y + 0.5, centroX, centroY) <= radio) pintar(x, y, AGUA, gradosBurbuja);
      }
    }
  }
}

/* ¿Todas las celdas del círculo son hielo? */
function circuloEsTodoHielo(centroX, centroY, radio) {
  for (let y = Math.floor(centroY - radio); y <= Math.ceil(centroY + radio); y++) {
    for (let x = Math.floor(centroX - radio); x <= Math.ceil(centroX + radio); x++) {
      if (distancia(x + 0.5, y + 0.5, centroX, centroY) > radio) continue;
      if (!estaDentroDeLaGrilla(x, y) || material[indiceDeCelda(x, y)] !== HIELO) return false;
    }
  }
  return true;
}

/* ---------- Estalactitas decorativas (también se pueden romper) ---------- */
function generarEstalactitas(aleatorioEntre, enteroEntre) {
  const cantidad = enteroEntre(7, 14);
  for (let n = 0; n < cantidad; n++) {
    const x0 = enteroEntre(14, ANCHO_GRILLA - 14);
    // Buscar dónde termina el techo en esa columna
    let filaBorde = 0;
    while (filaBorde < ALTO_GRILLA - 1 && material[indiceDeCelda(x0, filaBorde)] !== AIRE) filaBorde++;
    if (filaBorde > 40 + DESCENSO_TECHO) continue;

    const largo = enteroEntre(4, 10);
    const anchoBase = aleatorioEntre(1.5, 3.2);
    for (let k = 0; k < largo; k++) {
      // Triángulo: el ancho se achica linealmente hasta la punta
      const medioAncho = anchoBase * (1 - k / largo);
      for (let x = Math.round(x0 - medioAncho); x <= Math.round(x0 + medioAncho); x++) {
        pintarHieloLibreSiEsAire(x, filaBorde + k);
      }
    }
  }
}

/* ---------- 4. Plataformas de arranque (una por personaje) ----------
   Se reparten las de un lado a lo ancho de la mitad izquierda, dejando lugar
   en el centro para el puente central. Cada una ocupa como mucho el 80% de su
   tramo, así siempre queda un hueco para tender un puente con la siguiente. */
/* Primera columna utilizable para plataformas y piedras. Entre la pared y este
   margen queda libre la franja por donde cae la cascada: la pared mide hasta 11
   celdas y el chorro se abre unas 8 celdas al caer. Si una plataforma quedara
   pegada a la pared, entre las dos se formaría un pozo cerrado que la cascada
   llenaría hasta desbordar sobre la plataforma y ahogar a la llama. */
const MARGEN_PARED = 24;
const MITAD_PUENTE_CENTRAL = 22; // columnas reservadas a cada lado del centro
const RADIO_MAXIMO_PLATAFORMA = 32;

function generarPlataformas(semilla, cantidadPlataformas, aleatorioEntre, enteroEntre) {
  const porLado = Math.max(1, Math.ceil(cantidadPlataformas / 2));
  const anchoUtil = (MITAD_ANCHO - MITAD_PUENTE_CENTRAL) - MARGEN_PARED;
  const tramo = anchoUtil / porLado; // columnas disponibles para cada plataforma

  const plataformas = [];
  const variacion = porLado > 1 ? VARIACION_ARENA : VARIACION_ARENA / 2;
  for (let i = 0; i < porLado; i++) {
    const radioX = Math.min(RADIO_MAXIMO_PLATAFORMA, Math.floor(tramo * 0.4)) - enteroEntre(0, 4);
    // Cada plataforma (y su espejo) tiene su altura, distinta a la de la vecina
    let filaSuperior = enteroEntre(FILA_ARENA - variacion, FILA_ARENA + variacion);
    for (let intento = 0; intento < 40 && i > 0 && Math.abs(filaSuperior - plataformas[i - 1].filaSuperior) < DESNIVEL_MINIMO_VECINAS; intento++) {
      filaSuperior = enteroEntre(FILA_ARENA - variacion, FILA_ARENA + variacion);
    }
    plataformas.push({
      // Centro del tramo con un corrimiento chico al azar (±8% del tramo)
      centroX: MARGEN_PARED + tramo * (i + 0.5) + aleatorioEntre(-0.08, 0.08) * tramo,
      radioX,
      filaSuperior,
      profundidad: enteroEntre(16, 26),   // cuánto cuelga la parte de abajo
      grosorHielo: enteroEntre(3, 5)      // capa de hielo sobre la piedra
    });
  }

  for (const plataforma of plataformas) {
    for (let x = Math.floor(plataforma.centroX - plataforma.radioX); x <= Math.ceil(plataforma.centroX + plataforma.radioX); x++) {
      if (x < 0 || x >= MITAD_ANCHO) continue;
      const u = (x - plataforma.centroX) / plataforma.radioX; // -1..1 a lo ancho de la plataforma
      const distanciaAlCentro = Math.abs(u);
      if (distanciaAlCentro > 1) continue;

      // Superficie: plana en casi todo el ancho (u⁶ casi no crece hasta el borde),
      // cae unas 4 celdas en las puntas y tiene una rugosidad de ±0.5 celdas
      const rugosidad = (ruidoSuave(x * 0.35, 9.1, semilla) - 0.5);
      const filaArriba = plataforma.filaSuperior + Math.round(distanciaAlCentro ** 6 * 4 + rugosidad);
      // Base redondeada: cuelga más en el centro (1 - u²)
      const filaAbajo = plataforma.filaSuperior + plataforma.grosorHielo + 2 + Math.round(plataforma.profundidad * Math.pow(1 - u * u, 0.7));

      for (let y = filaArriba; y <= filaAbajo; y++) {
        // Piedra adentro, hielo en la cáscara exterior (arriba, abajo y los bordes)
        const esNucleo = y >= filaArriba + plataforma.grosorHielo && y <= filaAbajo - 2 && distanciaAlCentro < 0.86;
        pintarSimetrico(x, y, esNucleo ? PIEDRA : HIELO, PARAMETROS.temperaturaAmbiente);
      }
    }
  }
  return plataformas;
}

/* ---------- Puentes de hielo con pozos ----------
   A veces se tiende un puente entre plataformas vecinas de la izquierda, y a
   veces uno central desde la plataforma más cercana al centro hasta su espejo.
   El puente central solo se pinta hasta el centro: el espejo completa la otra mitad. */
const GROSOR_PUENTE = 6;
const DESNIVEL_MAXIMO_PUENTE = 22;  // filas de diferencia entre dos plataformas para poder unirlas
const PROBABILIDAD_PUENTE = 0.5;

function generarPuentes(plataformas, aleatorioEntre, enteroEntre, aleatorio) {
  // El puente arranca un poco adentro de la plataforma (80% del radio) para quedar pegado
  const bordeDerecho = p => ({ x: p.centroX + p.radioX * 0.8, y: p.filaSuperior + 2 });
  const bordeIzquierdo = p => ({ x: p.centroX - p.radioX * 0.8, y: p.filaSuperior + 2 });

  // Entre vecinas solo se tiende un puente si casi están a la misma altura (si no, la
  // rampa sería demasiado empinada para caminarla) y, aun así, solo a veces.
  for (let i = 0; i < plataformas.length - 1; i++) {
    const desnivel = Math.abs(plataformas[i].filaSuperior - plataformas[i + 1].filaSuperior);
    if (desnivel > DESNIVEL_MAXIMO_PUENTE || aleatorio() > PROBABILIDAD_PUENTE) continue;
    const inicio = bordeDerecho(plataformas[i]);
    const fin = bordeIzquierdo(plataformas[i + 1]);
    pintarPuente(inicio, fin, false, aleatorioEntre, enteroEntre, aleatorio);
  }

  // El puente central une la plataforma más cercana al centro con su espejo (a la misma
  // altura). Con una sola plataforma por lado se tiende más seguido: es la única forma
  // de cruzar caminando.
  if (aleatorio() < (plataformas.length === 1 ? 0.6 : PROBABILIDAD_PUENTE)) {
    const inicioCentral = bordeDerecho(plataformas[plataformas.length - 1]);
    // Espejo de una columna x: ANCHO_GRILLA - 1 - x
    const finCentral = { x: ANCHO_GRILLA - 1 - inicioCentral.x, y: inicioCentral.y };
    pintarPuente(inicioCentral, finCentral, true, aleatorioEntre, enteroEntre, aleatorio);
  }
}

/* El puente es una RAMPA a dos aguas: sube en línea recta desde cada extremo
   hasta el medio. La forma (1 - |2t - 1|) vale 0 en las puntas (t=0 y t=1)
   y 1 en el medio (t=0.5), creciendo y bajando linealmente. */
function pintarPuente(inicio, fin, esCentral, aleatorioEntre, enteroEntre, aleatorio) {
  // Cuántas filas sube el medio respecto de los extremos. En puentes cortos (modo
  // Worms, entre plataformas vecinas) se limita al 25% del largo: la pendiente
  // queda en 0.5 filas por columna como mucho y se puede subir caminando.
  const largo = fin.x - inicio.x;
  const elevacion = Math.min(aleatorioEntre(10, 16), largo * 0.25);
  const pozos = elegirPozos(inicio.x, fin.x, esCentral, aleatorioEntre, enteroEntre, aleatorio);
  const ultimaColumna = Math.min(Math.floor(fin.x), MITAD_ANCHO - 1);

  // Altura de la rampa en la columna x (sin pozos). El eje Y apunta hacia abajo:
  // "subir" es restar filas.
  const alturaRampa = x => {
    const t = (x - inicio.x) / (fin.x - inicio.x); // 0 en el inicio, 1 en el fin
    return interpolar(inicio.y, fin.y, t) - elevacion * (1 - Math.abs(2 * t - 1));
  };

  // 1) Fila de la superficie de cada columna del puente
  const primeraColumna = Math.ceil(inicio.x);
  const superficies = [];
  for (let x = primeraColumna; x <= ultimaColumna; x++) {
    const pozo = pozos.find(p => Math.abs(x - p.centroX) < p.medioAncho);
    let alturaSuperficie;
    if (pozo) {
      // El cuenco se hace HORIZONTAL (si siguiera la pendiente, el agua se escaparía
      // por el borde de abajo). Su nivel es el de la rampa en su borde MÁS BAJO
      // (mayor fila, porque Y crece hacia abajo): así ese borde empalma con la rampa
      // y del lado de arriba queda un escalón que baja hacia el pozo.
      const nivel = Math.max(alturaRampa(pozo.centroX - pozo.medioAncho), alturaRampa(pozo.centroX + pozo.medioAncho));
      const relativa = (x - pozo.centroX) / pozo.medioAncho;
      alturaSuperficie = nivel + pozo.profundidad * (1 - relativa * relativa);
    } else {
      alturaSuperficie = alturaRampa(x);
    }
    superficies.push(Math.round(alturaSuperficie));
  }

  // 2) Pintar cada columna: GROSOR_PUENTE celdas de hielo desde su superficie y,
  // si una vecina tiene la superficie más abajo, se estira hasta tocarla. Sin esto,
  // en un escalón de GROSOR_PUENTE filas o más (el borde alto de un pozo en una
  // rampa empinada) las dos columnas quedarían una sobre otra sin tocarse: el
  // puente se cortaría y el pozo perdería agua por el hueco.
  superficies.forEach((filaSuperficie, n) => {
    const izquierda = n > 0 ? superficies[n - 1] : filaSuperficie;
    const derecha = n < superficies.length - 1 ? superficies[n + 1] : filaSuperficie;
    const ultimaFila = Math.max(filaSuperficie + GROSOR_PUENTE - 1, izquierda, derecha);
    for (let y = filaSuperficie; y <= ultimaFila; y++) pintarHieloSiEsAire(primeraColumna + n, y);
  });
}

/* Cada pozo es un cuenco: profundidad × (1 - (distancia / medioAncho)²).
   Es una parábola: máxima en el centro y 0 en los bordes. La pendiente más fuerte
   (en el borde) es 2 × profundidad / medioAncho, menor que GROSOR_PUENTE; además,
   en el borde del pozo la rampa da un salto de medioAncho × pendiente de la rampa
   (unas 3 filas). Mientras esos saltos sean menores que el grosor, la pared del
   pozo no tiene huecos por donde se escape el agua. */

function elegirPozos(xInicio, xFin, esCentral, aleatorioEntre, enteroEntre, aleatorio) {
  const pozos = [];
  const crearPozo = centroX => {
    const medioAncho = enteroEntre(6, 10);
    // Con profundidad ≤ 1.4 × medioAncho la pendiente máxima es ≤ 2.8 < GROSOR_PUENTE
    const profundidad = Math.min(enteroEntre(5, 9), Math.floor(medioAncho * 1.4));
    return { centroX, medioAncho, profundidad };
  };

  // En el puente central, 50% de probabilidad de un pozo justo en el medio
  if (esCentral && aleatorio() < 0.5) pozos.push(crearPozo(MITAD_ANCHO - 0.5));

  // Zona válida: lejos de las plataformas (8 celdas) y, en el central, sin cruzar el centro
  const desde = xInicio + 8;
  const hasta = (esCentral ? MITAD_ANCHO - 2 : xFin) - 8;
  if (hasta <= desde) return pozos;
  const cantidadDeseada = pozos.length + Math.max(1, Math.floor((hasta - desde) / 30));

  let intentos = 0;
  while (pozos.length < cantidadDeseada && intentos++ < 60) {
    const nuevo = crearPozo(aleatorioEntre(desde, hasta));
    // En el central, el pozo queda a 6 celdas o más del centro: si no, entre él y su
    // espejo quedaría una cresta finita y puntiaguda en la cumbre de la rampa
    if (esCentral && nuevo.centroX + nuevo.medioAncho >= MITAD_ANCHO - 6) continue;
    const separado = pozos.every(p => Math.abs(p.centroX - nuevo.centroX) > p.medioAncho + nuevo.medioAncho + 6);
    if (separado) pozos.push(nuevo);
  }
  return pozos;
}

/* ---------- Estructuras sueltas: cuencos en U con agua y repisas chicas ----------
   Un CUENCO es una U de paredes de 3 celdas (piedra por dentro, hielo por fuera)
   con una cavidad semielíptica. Se llena de agua hasta una fracción al azar:
   desde poco más de un tercio hasta el borde. Una REPISA es una losa flotante
   chica (hielo arriba, piedra por dentro): sirve para pararse o engancharse con la
   lengua. Las repisas nunca quedan DEBAJO de un cuenco, así el agua de un cuenco
   roto cae libre en vez de quedar atajada. */

/* ¿Hay lugar para una estructura que ocupa [x0, x1] × [y0, y1] (con su margen de aire)? */
function hayLugar(x0, y0, x1, y1) {
  const m = SEPARACION_ENTRE_ESTRUCTURAS;
  if (x0 - m < MARGEN_ESTRUCTURAS || x1 + m > ANCHO_GRILLA - 1 - MARGEN_ESTRUCTURAS) return false;
  if (y0 - m < FILA_MINIMA_ESTRUCTURAS || y1 + m > mapa.filaSuperiorLago - 30) return false;
  return rectanguloEsTodoAire(x0 - m, y0 - m, x1 + m, y1 + m);
}

/* Fracción de agua de un cuenco: todos tienen agua, en distintas cantidades. */
function sortearLlenado(aleatorio, aleatorioEntre) {
  const sorteo = aleatorio();
  if (sorteo < 0.3) return aleatorioEntre(0.35, 0.55);
  if (sorteo < 0.7) return aleatorioEntre(0.55, 0.85);
  return aleatorioEntre(0.85, 1);
}

const FORMA_U = 2.6; // exponente de la superelipse: 2 = elipse (cuenco chato), más alto = U más cuadrada

/* Cuenco con el borde superior en la fila "filaBorde", centrado en "centroX".
   Devuelve false (sin pintar nada) si no hay lugar. */
function colocarCuenco(centroX, filaBorde, mitadAncho, profundidad, llenado, aleatorioEntre) {
  const grosor = 3;
  const x0 = Math.floor(centroX - mitadAncho - grosor), x1 = Math.ceil(centroX + mitadAncho + grosor);
  const y0 = filaBorde, y1 = filaBorde + profundidad + grosor;
  if (!hayLugar(x0, y0, x1, y1)) return false;
  columnasDeCuencos.push({ x0, x1, filaBorde }); // para no poner repisas debajo (ver colocarRepisa)

  const gradosAgua = aleatorioEntre(TEMPERATURA_MINIMA_BURBUJA, TEMPERATURA_MAXIMA_BURBUJA);
  const ambiente = PARAMETROS.temperaturaAmbiente;
  const filaSuperficie = filaBorde + profundidad * (1 - llenado); // el agua llena de acá hacia abajo
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const px = x + 0.5, py = y + 0.5;
      const uExterior = (px - centroX) / (mitadAncho + grosor);
      if (Math.abs(uExterior) >= 1) continue;
      const fondoExterior = filaBorde + (profundidad + grosor) * Math.pow(1 - Math.pow(Math.abs(uExterior), FORMA_U), 1 / FORMA_U);
      if (py > fondoExterior) continue;

      const uInterior = (px - centroX) / mitadAncho;
      const hayCavidad = Math.abs(uInterior) < 1;
      const fondoInterior = hayCavidad ? filaBorde + profundidad * Math.pow(1 - Math.pow(Math.abs(uInterior), FORMA_U), 1 / FORMA_U) : -1;
      if (hayCavidad && py < fondoInterior) {
        if (py >= filaSuperficie) pintar(x, y, AGUA, gradosAgua);
        continue;
      }
      // Pared: hielo en la capa exterior (distancia radial normalizada cerca de 1), piedra por dentro
      const vExterior = (py - filaBorde) / (profundidad + grosor);
      const radio = Math.pow(Math.pow(Math.abs(uExterior), FORMA_U) + Math.pow(vExterior, FORMA_U), 1 / FORMA_U);
      const capaDeHielo = 1.5 / Math.min(mitadAncho + grosor, profundidad + grosor);
      pintar(x, y, radio > 1 - capaDeHielo ? HIELO : PIEDRA, ambiente);
    }
  }
  return true;
}

/* Columnas que ocupa cada cuenco del mapa actual: debajo de ellas no van repisas. */
let columnasDeCuencos = [];

/* Repisa flotante chica: losa de ancho 2 × mitadAncho con el borde superior en
   "filaBorde". No se pone si quedaría debajo de un cuenco (taparía su caída de agua)
   ni si no hay lugar. */
function colocarRepisa(centroX, filaBorde, mitadAncho, grosor, semilla) {
  const x0 = Math.floor(centroX - mitadAncho), x1 = Math.ceil(centroX + mitadAncho);
  const y0 = filaBorde - 1, y1 = filaBorde + grosor + 3;
  const margen = 3; // el chorro de un cuenco roto se abre un poco al caer
  const debajoDeUnCuenco = columnasDeCuencos.some(c => c.filaBorde < y0 && x1 >= c.x0 - margen && x0 <= c.x1 + margen);
  if (debajoDeUnCuenco || !hayLugar(x0, y0, x1, y1)) return false;

  const ambiente = PARAMETROS.temperaturaAmbiente;
  for (let x = x0; x <= x1; x++) {
    const u = (x - centroX) / mitadAncho;
    if (Math.abs(u) > 1) continue;
    const rugosidad = ruidoSuave(x * 0.3, filaBorde * 0.1, semilla + 21) - 0.5;
    const filaArriba = filaBorde + Math.round(Math.abs(u) ** 5 * 2 + rugosidad);
    const filaAbajo = filaBorde + 1 + Math.round(grosor * Math.pow(1 - u * u, 0.7));
    for (let y = filaArriba; y <= filaAbajo; y++) {
      const esHielo = y < filaArriba + 2 || y > filaAbajo - 1 || Math.abs(u) > 0.85;
      pintar(x, y, esHielo ? HIELO : PIEDRA, ambiente);
    }
  }
  return true;
}

/* Dimensiones al azar de un cuenco: de chato (más ancho que hondo) a una U angosta y honda. */
function sortearCuenco(aleatorioEntre, enteroEntre) {
  const mitadAncho = enteroEntre(8, 22);
  const profundidad = Math.min(30, Math.max(8, Math.round(mitadAncho * aleatorioEntre(0.7, 1.4))));
  return { mitadAncho, profundidad };
}

/* ---------- Techos de roca sobre las llamas ----------
   Encima de cada plataforma de arranque, una losa de roca (piedra) más chica que
   la plataforma: protege a la llama del agua que cae desde arriba. Entre las dos
   quedan ALTURA_BAJO_TECHO filas de aire para saltar, apuntar y moverse. Se pinta
   con pintarSimetrico, así el techo de la plataforma espejada es idéntico. */
const ALTURA_BAJO_TECHO = 22;            // filas de aire entre la plataforma y el techo
const PROPORCION_ANCHO_TECHO = 0.6;      // el techo mide el 60% del ancho de la plataforma

function generarTechosDeRoca(plataformas, enteroEntre) {
  const ambiente = PARAMETROS.temperaturaAmbiente;
  for (const plataforma of plataformas) {
    const radioX = Math.max(6, plataforma.radioX * PROPORCION_ANCHO_TECHO);
    const grosor = enteroEntre(4, 6);
    const filaInferior = plataforma.filaSuperior - ALTURA_BAJO_TECHO; // borde de abajo del techo
    for (let x = Math.floor(plataforma.centroX - radioX); x <= Math.ceil(plataforma.centroX + radioX); x++) {
      if (x < 0 || x >= MITAD_ANCHO) continue;
      const u = (x - plataforma.centroX) / radioX; // -1..1 a lo ancho del techo
      if (Math.abs(u) > 1) continue;
      // Abajo plano; arriba bombeado (más grueso en el centro, se afina hacia las puntas)
      const filaArriba = filaInferior - Math.round(grosor * Math.pow(1 - u * u, 0.5));
      for (let y = filaArriba; y <= filaInferior; y++) pintarSimetrico(x, y, PIEDRA, ambiente);
    }
  }
}

/* Cuencos con agua y repisas chicas repartidos por la zona alta y la zona baja,
   evitando la franja de la arena (donde están las plataformas y sus techos de roca).
   Primero van todos los cuencos y después las repisas, así cada repisa ya sabe
   dónde hay cuencos y no se pone debajo de ninguno. */
function generarEstructurasSueltas(aleatorioEntre, enteroEntre, aleatorio) {
  const semilla = mapa.semilla;
  const arribaDeLaArena = mapa.filaArenaMinima - ESPACIO_SOBRE_ARENA;  // las estructuras de la zona alta terminan acá
  const debajoDeLaArena = mapa.filaArenaMaxima + ESPACIO_BAJO_ARENA;   // y las de la zona baja empiezan acá
  const zonas = [
    { desde: FILA_MINIMA_ESTRUCTURAS, hasta: arribaDeLaArena, cuencos: 22, repisas: 7 },
    { desde: debajoDeLaArena, hasta: mapa.filaSuperiorLago - 50, cuencos: 9, repisas: 4 }
  ];
  columnasDeCuencos = [];
  for (const zona of zonas) {
    let cuencos = 0, intentos = 0;
    while (cuencos < zona.cuencos && intentos++ < 500) {
      const centroX = aleatorioEntre(MARGEN_ESTRUCTURAS, ANCHO_GRILLA - MARGEN_ESTRUCTURAS);
      const { mitadAncho, profundidad } = sortearCuenco(aleatorioEntre, enteroEntre);
      const fila = Math.floor(aleatorioEntre(zona.desde, zona.hasta - profundidad - 3));
      if (fila + profundidad + 3 > zona.hasta) continue;
      if (colocarCuenco(centroX, fila, mitadAncho, profundidad, sortearLlenado(aleatorio, aleatorioEntre), aleatorioEntre)) cuencos++;
    }
  }
  for (const zona of zonas) {
    let repisas = 0, intentos = 0;
    while (repisas < zona.repisas && intentos++ < 500) {
      const centroX = aleatorioEntre(MARGEN_ESTRUCTURAS, ANCHO_GRILLA - MARGEN_ESTRUCTURAS);
      const grosor = enteroEntre(3, 5);
      const fila = Math.floor(aleatorioEntre(zona.desde, zona.hasta - grosor - 4));
      if (fila + grosor + 4 > zona.hasta) continue;
      // Chicas: de 10 a 20 celdas de ancho (antes llegaban a 90)
      if (colocarRepisa(centroX, fila, enteroEntre(5, 10), grosor, semilla)) repisas++;
    }
  }
}

/* ---------- Piedras de salvación ----------
   Piedras chicas entre la arena y el lago (la bola de fuego las rompe). Un personaje
   que se cae (resbalando o empujado por una explosión) puede, con suerte,
   aterrizar en una en vez de terminar en el lago. */
const ESPACIO_LIBRE_SOBRE_PIEDRA = 10; // filas de aire sobre la piedra: más que el alto del personaje (7)

function generarPiedrasDeSalvacion(aleatorioEntre, enteroEntre) {
  const cantidad = enteroEntre(12, 17);
  const primeraFila = mapa.filaArenaMaxima + ESPACIO_BAJO_ARENA + 4;
  let creadas = 0, intentos = 0;
  while (creadas < cantidad && intentos++ < 600) {
    const radioX = enteroEntre(4, 7);
    const alto = enteroEntre(3, 5);
    // Fuera de la franja de la cascada (ver MARGEN_PARED)
    const centroX = aleatorioEntre(MARGEN_PARED + radioX, ANCHO_GRILLA - MARGEN_PARED - radioX);
    // Entre la arena y 14 filas por encima del lago (más abajo las tapaba la barra de armas del HUD)
    const filaSuperior = enteroEntre(primeraFila, mapa.filaSuperiorLago - 14);

    // Solo si toda la zona (la piedra + el espacio para caer encima) está vacía:
    // así no se pega a una plataforma, a un puente ni a otra piedra.
    const izquierda = Math.floor(centroX - radioX) - 1, derecha = Math.ceil(centroX + radioX) + 1;
    if (!rectanguloEsTodoAire(izquierda, filaSuperior - ESPACIO_LIBRE_SOBRE_PIEDRA, derecha, filaSuperior + alto + 1)) continue;

    for (let x = Math.floor(centroX - radioX); x <= Math.ceil(centroX + radioX); x++) {
      const u = (x - centroX) / radioX; // -1..1 a lo ancho de la piedra
      if (Math.abs(u) > 1) continue;
      // Arriba casi plana (baja 1 celda en las puntas); abajo redondeada, más gruesa en el centro
      const filaArriba = filaSuperior + Math.round(u * u);
      const filaAbajo = filaSuperior + Math.round(alto * Math.sqrt(1 - u * u));
      for (let y = filaArriba; y <= filaAbajo; y++) pintar(x, y, PIEDRA, PARAMETROS.temperaturaAmbiente);
    }
    creadas++;
  }
}

function rectanguloEsTodoAire(x1, y1, x2, y2) {
  for (let y = y1; y <= y2; y++) {
    for (let x = x1; x <= x2; x++) {
      if (!estaDentroDeLaGrilla(x, y) || material[indiceDeCelda(x, y)] !== AIRE) return false;
    }
  }
  return true;
}

/* ---------- Fondo de la caverna y textura (solo visual) ---------- */
function generarFondoYTextura(semilla) {
  for (let y = 0; y < ALTO_GRILLA; y++) {
    for (let x = 0; x < ANCHO_GRILLA; x++) {
      const indice = indiceDeCelda(x, y);
      const alturaRelativa = y / ALTO_GRILLA; // 0 arriba, 1 abajo
      // Degradé azul oscuro: más claro arriba, más oscuro abajo
      let rojo = 22 - 10 * alturaRelativa;
      let verde = 38 - 16 * alturaRelativa;
      let azul = 64 - 26 * alturaRelativa;

      // Siluetas de roca lejana: zonas donde el ruido supera 0.55 se oscurecen
      const siluetaLejana = ruidoFractal(x * 0.035, y * 0.05, semilla + 50);
      if (siluetaLejana > 0.55) {
        const oscurecer = Math.min(1, (siluetaLejana - 0.55) * 6);
        rojo *= 1 - 0.45 * oscurecer;
        verde *= 1 - 0.45 * oscurecer;
        azul *= 1 - 0.35 * oscurecer;
      }
      // Vetas verticales sutiles (ruido estirado en y)
      const veta = ruidoSuave(x * 0.6, y * 0.02, semilla + 60) * 5;
      fondoRojo[indice] = aByte(rojo + veta * 0.5);
      fondoVerde[indice] = aByte(verde + veta * 0.8);
      fondoAzul[indice] = aByte(azul + veta);

      // Textura por celda: 75% ruido suave + 25% ruido puro (da grano)
      texturaRuido[indice] = aByte((ruidoFractal(x * 0.18, y * 0.18, semilla + 77) * 0.75 + Math.random() * 0.25) * 255);
    }
  }
}
