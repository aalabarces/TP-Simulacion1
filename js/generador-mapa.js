'use strict';
/* =============================================================================
   GENERADOR PROCEDURAL DEL MAPA
   Se genera solo la MITAD IZQUIERDA y se copia en espejo a la derecha,
   así el mapa es simétrico y justo para los dos jugadores.

   Partes del mapa (de arriba hacia abajo):
     1. Techo de hielo con estalactitas, reservas de agua colgantes y burbujas
        de agua encerradas dentro del hielo.
     2. Paredes laterales de hielo.
     3. Una plataforma por personaje (núcleo de piedra + superficie de hielo),
        la mitad de cada lado.
     4. Puentes de hielo entre plataformas, con pozos que juntan agua.
     5. Piedras chicas flotando más abajo: con suerte, frenan una caída.
     6. Lago de agua "termal" en el fondo (caer ahí es ahogarse).
   ============================================================================= */

const MITAD_ANCHO = ANCHO_GRILLA / 2;

/* Cuántas filas se baja el techo (y con él las reservas de agua). Con la potencia
   máxima el tiro no llega a más de ~55 celdas sobre el tirador a media distancia:
   un techo más alto dejaba las reservas fuera de alcance. */
const DESCENSO_TECHO = 30;

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

/* Piedra del BORDE del mapa (techo, paredes, lecho del lago): igual que
   pintarSimetrico, pero queda marcada como indestructible. La piedra de las
   islas se pinta con pintarSimetrico y sí se puede romper. */
function pintarBordeSimetrico(x, y) {
  if (x < 0 || x >= MITAD_ANCHO || y < 0 || y >= ALTO_GRILLA) return;
  pintarSimetrico(x, y, PIEDRA, PARAMETROS.temperaturaAmbiente);
  celdaIndestructible[indiceDeCelda(x, y)] = 1;
  celdaIndestructible[indiceDeCelda(ANCHO_GRILLA - 1 - x, y)] = 1;
}

/* Rellena con hielo solo las celdas que todavía son aire (no pisa el agua de las reservas). */
function pintarHieloSiEsAire(x, y) {
  if (material[indiceDeCelda(x, y)] === AIRE) pintarSimetrico(x, y, HIELO, PARAMETROS.temperaturaAmbiente);
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
  generarReservasDeAgua(aleatorioEntre, enteroEntre, aleatorio);
  generarEstalactitas(aleatorioEntre, enteroEntre);
  generarBurbujasEnElTecho(aleatorioEntre, enteroEntre);
  const plataformas = generarPlataformas(semilla, cantidadPlataformas, aleatorioEntre, enteroEntre);
  generarPuentes(plataformas, aleatorioEntre, enteroEntre, aleatorio);
  generarPiedrasDeSalvacion(aleatorioEntre, enteroEntre);

  // Un punto de aparición por plataforma, en PARES espejados: el par n tiene una
  // plataforma a la izquierda (lado 0) y su espejo a la derecha (lado 1,
  // x' = ANCHO_GRILLA - x). Qué jugador va en cada una lo decide turnos.js.
  mapa.puntosDeAparicion = [
    ...plataformas.map((p, par) => ({ par, lado: 0, x: p.centroX })),
    ...plataformas.map((p, par) => ({ par, lado: 1, x: ANCHO_GRILLA - p.centroX }))
  ];

  generarFondoYTextura(semilla);
  despertarTodo(); // mapa nuevo: todo el agua se calcula al menos una vez hasta quedar quieta
}

/* ---------- 1. Techo y lago ---------- */
function generarTechoYLago(semilla) {
  const ambiente = PARAMETROS.temperaturaAmbiente;
  for (let x = 0; x < MITAD_ANCHO; x++) {
    // Grosor del techo: entre 8 y 19 celdas (más DESCENSO_TECHO), variando suavemente con el ruido
    const grosorTecho = Math.round(8 + DESCENSO_TECHO + ruidoFractal(x * 0.045, 0.5, semilla) * 11);
    for (let y = 0; y < grosorTecho; y++) {
      // Las 2 primeras filas son piedra indestructible: el techo nunca se puede atravesar
      if (y < 2) pintarBordeSimetrico(x, y);
      else pintarSimetrico(x, y, HIELO, ambiente);
    }
    // Lecho del lago: piedra indestructible e irregular en las últimas 3 a 7 filas
    const filaLecho = ALTO_GRILLA - 3 - Math.round(ruidoFractal(x * 0.09, 3.7, semilla + 3) * 4);
    for (let y = mapa.filaSuperiorLago; y < ALTO_GRILLA; y++) {
      if (y >= filaLecho) pintarBordeSimetrico(x, y);
      else pintarSimetrico(x, y, AGUA, 4); // el lago empieza a 4° (es termal)
    }
  }
}

/* ---------- 2. Paredes laterales ---------- */
function generarParedes(semilla) {
  for (let y = 0; y < ALTO_GRILLA; y++) {
    const grosorPared = Math.round(3 + ruidoFractal(0.5, y * 0.06, semilla + 11) * 8); // 3 a 11 celdas
    for (let x = 0; x < grosorPared; x++) {
      // Las 2 primeras columnas son piedra indestructible (el borde del mundo)
      if (x < 2) pintarBordeSimetrico(x, y);
      else pintarSimetrico(x, y, HIELO, PARAMETROS.temperaturaAmbiente);
    }
  }
}

/* ---------- 3. Reservas de agua en el techo ----------
   Cada reserva es una elipse de agua envuelta en una "cáscara" de hielo
   que cuelga del techo. Romper la cáscara con fuego libera el agua. */
function generarReservasDeAgua(aleatorioEntre, enteroEntre, aleatorio) {
  const reservas = [];
  // 60% de probabilidad de una reserva justo en el centro (el espejo la completa)
  if (aleatorio() < 0.6) reservas.push({ centroX: MITAD_ANCHO - 0.5, radioX: enteroEntre(7, 11), radioY: enteroEntre(4, 6) });

  // De 4 a 5 reservas más en la mitad izquierda, separadas entre sí al menos 6 celdas
  const cantidad = enteroEntre(4, 5);
  let intentos = 0;
  while (reservas.length < cantidad + 1 && intentos++ < 300) {
    const radioX = enteroEntre(6, 10);
    // El límite derecho evita que la reserva se toque con su propio espejo
    const centroX = aleatorioEntre(16 + radioX, MITAD_ANCHO - 8 - radioX);
    const noSeSuperpone = reservas.every(r => Math.abs(r.centroX - centroX) > r.radioX + radioX + 6);
    if (noSeSuperpone) reservas.push({ centroX, radioX, radioY: enteroEntre(4, 6) });
  }

  for (const reserva of reservas) {
    const centroY = 3 + DESCENSO_TECHO + reserva.radioY;
    const gradosReserva = aleatorioEntre(TEMPERATURA_MINIMA_BURBUJA, TEMPERATURA_MAXIMA_BURBUJA);
    const margen = 5; // "hombros" de hielo a cada lado de la reserva
    for (let x = Math.floor(reserva.centroX - reserva.radioX - margen); x <= Math.ceil(reserva.centroX + reserva.radioX + margen); x++) {
      if (x < 0 || x >= MITAD_ANCHO) continue;
      // u = posición horizontal normalizada: -1 en el borde izquierdo de la elipse, 0 en el centro, +1 en el derecho
      const u = (x - reserva.centroX) / reserva.radioX;
      const distanciaAlCentro = Math.abs(u);

      if (distanciaAlCentro < 1) {
        // Ecuación de la elipse: medio alto del agua en esta columna = radioY * √(1 - u²)
        const medioAltoAgua = reserva.radioY * Math.sqrt(1 - u * u);
        // La cáscara de hielo termina 3 a 5 celdas debajo del agua (más gruesa en el centro)
        const fondoCascara = Math.round(centroY + medioAltoAgua + 3 + (1 - u * u) * 2);
        for (let y = 2; y <= fondoCascara; y++) pintarHieloSiEsAire(x, y);
        for (let y = Math.max(3, Math.ceil(centroY - medioAltoAgua)); y <= Math.floor(centroY + medioAltoAgua); y++) {
          pintarSimetrico(x, y, AGUA, gradosReserva);
        }
      } else {
        // Hombros: hielo que baja en rampa desde el borde de la reserva
        const rampa = 1 - (distanciaAlCentro - 1) * reserva.radioX / margen;
        const fondoHombro = Math.round(centroY + 3 * rampa);
        for (let y = 2; y <= fondoHombro; y++) pintarHieloSiEsAire(x, y);
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
const INTENTOS_BURBUJAS = 3000;
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
  const fondoTecho = new Int16Array(MITAD_ANCHO);
  for (let x = 0; x < MITAD_ANCHO; x++) {
    let y = 0;
    while (y < ALTO_GRILLA && material[indiceDeCelda(x, y)] !== AIRE) y++;
    fondoTecho[x] = y;
  }
  // Las paredes laterales son hielo hasta el fondo: sin este tope, aparecerían
  // burbujas sueltas dentro de la pared. Se usa el techo más bajo (fuera de la pared).
  const techoMasBajo = Math.max(...fondoTecho.slice(MARGEN_PARED));
  for (let x = 0; x < MITAD_ANCHO; x++) fondoTecho[x] = Math.min(fondoTecho[x], techoMasBajo);

  for (let intento = 0; intento < INTENTOS_BURBUJAS; intento++) {
    const radio = aleatorioEntre(RADIO_MINIMO_BURBUJA, RADIO_MAXIMO_BURBUJA);
    const centroX = aleatorioEntre(3, MITAD_ANCHO - 1);
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
        if (distancia(x + 0.5, y + 0.5, centroX, centroY) <= radio) pintarSimetrico(x, y, AGUA, gradosBurbuja);
      }
    }
  }
}

/* ¿Todas las celdas del círculo (en la mitad izquierda) son hielo? */
function circuloEsTodoHielo(centroX, centroY, radio) {
  for (let y = Math.floor(centroY - radio); y <= Math.ceil(centroY + radio); y++) {
    for (let x = Math.floor(centroX - radio); x <= Math.ceil(centroX + radio); x++) {
      if (x >= MITAD_ANCHO) continue; // el lado derecho es espejo del izquierdo
      if (distancia(x + 0.5, y + 0.5, centroX, centroY) > radio) continue;
      if (!estaDentroDeLaGrilla(x, y) || material[indiceDeCelda(x, y)] !== HIELO) return false;
    }
  }
  return true;
}

/* ---------- Estalactitas decorativas (también se pueden romper) ---------- */
function generarEstalactitas(aleatorioEntre, enteroEntre) {
  const cantidad = enteroEntre(3, 6);
  for (let n = 0; n < cantidad; n++) {
    const x0 = enteroEntre(14, MITAD_ANCHO - 4);
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
        if (x >= 0 && x < MITAD_ANCHO) pintarHieloSiEsAire(x, filaBorde + k);
      }
    }
  }
}

/* ---------- 3. Plataformas (una por personaje) ----------
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
  for (let i = 0; i < porLado; i++) {
    const radioX = Math.min(RADIO_MAXIMO_PLATAFORMA, Math.floor(tramo * 0.4)) - enteroEntre(0, 4);
    plataformas.push({
      // Centro del tramo con un corrimiento chico al azar (±8% del tramo)
      centroX: MARGEN_PARED + tramo * (i + 0.5) + aleatorioEntre(-0.08, 0.08) * tramo,
      radioX,
      filaSuperior: enteroEntre(100, 114),
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

/* ---------- 4. Puentes de hielo con pozos ----------
   Se tiende un puente entre cada par de plataformas vecinas de la izquierda,
   y uno central desde la plataforma más cercana al centro hasta su espejo.
   El puente central solo se pinta hasta el centro: el espejo completa la otra mitad. */
const GROSOR_PUENTE = 6;

function generarPuentes(plataformas, aleatorioEntre, enteroEntre, aleatorio) {
  // El puente arranca un poco adentro de la plataforma (80% del radio) para quedar pegado
  const bordeDerecho = p => ({ x: p.centroX + p.radioX * 0.8, y: p.filaSuperior + 2 });
  const bordeIzquierdo = p => ({ x: p.centroX - p.radioX * 0.8, y: p.filaSuperior + 2 });

  for (let i = 0; i < plataformas.length - 1; i++) {
    const inicio = bordeDerecho(plataformas[i]);
    const fin = bordeIzquierdo(plataformas[i + 1]);
    pintarPuente(inicio, fin, false, aleatorioEntre, enteroEntre, aleatorio);
  }

  const inicioCentral = bordeDerecho(plataformas[plataformas.length - 1]);
  // Espejo de una columna x: ANCHO_GRILLA - 1 - x
  const finCentral = { x: ANCHO_GRILLA - 1 - inicioCentral.x, y: inicioCentral.y };
  pintarPuente(inicioCentral, finCentral, true, aleatorioEntre, enteroEntre, aleatorio);
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

  for (let x = Math.ceil(inicio.x); x <= ultimaColumna; x++) {
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
    const filaSuperficie = Math.round(alturaSuperficie);
    // El hielo sigue la forma del pozo: el fondo del puente baja junto con la superficie
    for (let y = filaSuperficie; y < filaSuperficie + GROSOR_PUENTE; y++) pintarHieloSiEsAire(x, y);
  }
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

/* ---------- 5. Piedras de salvación ----------
   Piedras chicas entre las plataformas y el lago (la bola de fuego las rompe). Un personaje
   que se cae (resbalando o empujado por una explosión) puede, con suerte,
   aterrizar en una en vez de terminar en el lago. */
const ESPACIO_LIBRE_SOBRE_PIEDRA = 10; // filas de aire sobre la piedra: más que el alto del personaje (7)

function generarPiedrasDeSalvacion(aleatorioEntre, enteroEntre) {
  const cantidad = enteroEntre(4, 6);
  let creadas = 0, intentos = 0;
  while (creadas < cantidad && intentos++ < 300) {
    const radioX = enteroEntre(4, 7);
    const alto = enteroEntre(3, 5);
    // Fuera de la franja de la cascada (ver MARGEN_PARED)
    const centroX = aleatorioEntre(MARGEN_PARED + radioX, MITAD_ANCHO - 2 - radioX);
    // Entre 40 y 14 filas por encima del lago (más abajo las tapaba la barra de armas del HUD)
    const filaSuperior = enteroEntre(mapa.filaSuperiorLago - 40, mapa.filaSuperiorLago - 14);

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
      for (let y = filaArriba; y <= filaAbajo; y++) pintarSimetrico(x, y, PIEDRA, PARAMETROS.temperaturaAmbiente);
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
