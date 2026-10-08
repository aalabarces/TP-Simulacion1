'use strict';
/* =============================================================================
   GENERADOR PROCEDURAL DEL MAPA
   Se genera solo la MITAD IZQUIERDA y se copia en espejo a la derecha,
   así el mapa es simétrico y justo para los dos jugadores.

   Partes del mapa (de arriba hacia abajo):
     1. Techo de hielo con estalactitas y reservas de agua encapsuladas.
     2. Paredes laterales de hielo.
     3. De 3 a 5 islas flotantes: núcleo de piedra + superficie de hielo.
     4. Lago de agua "termal" en el fondo (caer ahí es ahogarse).
   ============================================================================= */

const MITAD_ANCHO = ANCHO_GRILLA / 2;

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
}

/* Rellena con hielo solo las celdas que todavía son aire (no pisa el agua de las reservas). */
function pintarHieloSiEsAire(x, y) {
  if (material[indiceDeCelda(x, y)] === AIRE) pintarSimetrico(x, y, HIELO, PARAMETROS.temperaturaAmbiente);
}

function generarMapa(semilla) {
  const aleatorio = crearAleatorioConSemilla(semilla);
  const aleatorioEntre = (minimo, maximo) => minimo + (maximo - minimo) * aleatorio();
  const enteroEntre = (minimo, maximo) => Math.floor(aleatorioEntre(minimo, maximo + 1));

  mapa.semilla = semilla;
  mapa.filaSuperiorLago = ALTO_GRILLA - 16;
  material.fill(AIRE);
  temperatura.fill(PARAMETROS.temperaturaAmbiente);

  generarTechoYLago(semilla);
  generarParedes(semilla);
  generarReservasDeAgua(aleatorioEntre, enteroEntre, aleatorio);
  generarEstalactitas(aleatorioEntre, enteroEntre);
  const islas = generarIslas(semilla, aleatorioEntre, enteroEntre);

  // El J1 aparece sobre la isla más a la izquierda (el J2 en su espejo)
  mapa.posicionInicialX = islas[0].centroX;

  generarFondoYTextura(semilla);
}

/* ---------- 1. Techo y lago ---------- */
function generarTechoYLago(semilla) {
  const ambiente = PARAMETROS.temperaturaAmbiente;
  for (let x = 0; x < MITAD_ANCHO; x++) {
    // Grosor del techo: entre 8 y 19 celdas, variando suavemente con el ruido
    const grosorTecho = Math.round(8 + ruidoFractal(x * 0.045, 0.5, semilla) * 11);
    for (let y = 0; y < grosorTecho; y++) {
      // Las 2 primeras filas son piedra: el techo nunca se puede atravesar
      pintarSimetrico(x, y, y < 2 ? PIEDRA : HIELO, ambiente);
    }
    // Lecho del lago: piedra irregular en las últimas 3 a 7 filas
    const filaLecho = ALTO_GRILLA - 3 - Math.round(ruidoFractal(x * 0.09, 3.7, semilla + 3) * 4);
    for (let y = mapa.filaSuperiorLago; y < ALTO_GRILLA; y++) {
      if (y >= filaLecho) pintarSimetrico(x, y, PIEDRA, ambiente);
      else pintarSimetrico(x, y, AGUA, 4); // el lago empieza a 4° (es termal)
    }
  }
}

/* ---------- 2. Paredes laterales ---------- */
function generarParedes(semilla) {
  for (let y = 0; y < ALTO_GRILLA; y++) {
    const grosorPared = Math.round(3 + ruidoFractal(0.5, y * 0.06, semilla + 11) * 8); // 3 a 11 celdas
    for (let x = 0; x < grosorPared; x++) {
      pintarSimetrico(x, y, x < 2 ? PIEDRA : HIELO, PARAMETROS.temperaturaAmbiente);
    }
  }
}

/* ---------- 3. Reservas de agua en el techo ----------
   Cada reserva es una elipse de agua envuelta en una "cáscara" de hielo
   que cuelga del techo. Romper la cáscara con fuego libera el agua. */
function generarReservasDeAgua(aleatorioEntre, enteroEntre, aleatorio) {
  const reservas = [];
  let intentos = 0;
  // Dos reservas en la mitad izquierda, separadas entre sí
  while (reservas.length < 2 && intentos++ < 60) {
    const radioX = enteroEntre(9, 14);
    const centroX = aleatorioEntre(22 + radioX, MITAD_ANCHO - 8 - radioX);
    const noSeSuperpone = reservas.every(r => Math.abs(r.centroX - centroX) > r.radioX + radioX + 10);
    if (noSeSuperpone) reservas.push({ centroX, radioX, radioY: enteroEntre(5, 7) });
  }
  // 60% de probabilidad de una reserva extra justo en el centro
  if (aleatorio() < 0.6) reservas.push({ centroX: MITAD_ANCHO - 0.5, radioX: enteroEntre(10, 15), radioY: enteroEntre(5, 7) });

  for (const reserva of reservas) {
    const centroY = 3 + reserva.radioY;
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
          pintarSimetrico(x, y, AGUA, 2);
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

/* ---------- Estalactitas decorativas (también se pueden romper) ---------- */
function generarEstalactitas(aleatorioEntre, enteroEntre) {
  const cantidad = enteroEntre(3, 6);
  for (let n = 0; n < cantidad; n++) {
    const x0 = enteroEntre(14, MITAD_ANCHO - 4);
    // Buscar dónde termina el techo en esa columna
    let filaBorde = 0;
    while (filaBorde < ALTO_GRILLA - 1 && material[indiceDeCelda(x0, filaBorde)] !== AIRE) filaBorde++;
    if (filaBorde > 40) continue;

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

/* ---------- 4. Islas flotantes ---------- */
function generarIslas(semilla, aleatorioEntre, enteroEntre) {
  const cantidad = enteroEntre(3, 5);
  const crearIsla = (centroX, esCentral) => ({
    centroX,
    radioX: esCentral ? enteroEntre(18, 24) : enteroEntre(16, 21),
    filaSuperior: esCentral ? enteroEntre(90, 112) : enteroEntre(98, 118),
    profundidad: enteroEntre(14, 24),     // cuánto cuelga la parte de abajo
    grosorHielo: enteroEntre(3, 5)        // capa de hielo sobre la piedra
  });

  // Con cantidad impar hay una isla central (que el espejo completa).
  // Las posiciones están elegidas para que las islas no se toquen.
  const islas = [];
  if (cantidad === 3) islas.push(crearIsla(aleatorioEntre(50, 68), false), crearIsla(MITAD_ANCHO - 0.5, true));
  else if (cantidad === 4) islas.push(crearIsla(aleatorioEntre(36, 48), false), crearIsla(aleatorioEntre(104, 116), false));
  else islas.push(crearIsla(aleatorioEntre(32, 42), false), crearIsla(aleatorioEntre(92, 100), false), crearIsla(MITAD_ANCHO - 0.5, true));

  for (const isla of islas) {
    for (let x = Math.floor(isla.centroX - isla.radioX); x <= Math.ceil(isla.centroX + isla.radioX); x++) {
      if (x < 0 || x >= MITAD_ANCHO) continue;
      const u = (x - isla.centroX) / isla.radioX; // -1..1 a lo ancho de la isla
      const distanciaAlCentro = Math.abs(u);
      if (distanciaAlCentro > 1) continue;

      // Superficie: casi plana en el centro y cae en los bordes (u³), con un poco de rugosidad
      const rugosidad = (ruidoSuave(x * 0.35, 9.1, semilla) - 0.5) * 2;
      const filaArriba = isla.filaSuperior + Math.round(distanciaAlCentro ** 3 * 5 + rugosidad);
      // Base redondeada: cuelga más en el centro (1 - u²)
      const filaAbajo = isla.filaSuperior + isla.grosorHielo + 2 + Math.round(isla.profundidad * Math.pow(1 - u * u, 0.7));

      for (let y = filaArriba; y <= filaAbajo; y++) {
        // Piedra adentro, hielo en la cáscara exterior (arriba, abajo y los bordes)
        const esNucleo = y >= filaArriba + isla.grosorHielo && y <= filaAbajo - 2 && distanciaAlCentro < 0.86;
        pintarSimetrico(x, y, esNucleo ? PIEDRA : HIELO, PARAMETROS.temperaturaAmbiente);
      }
    }
  }
  return islas;
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
