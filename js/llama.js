'use strict';
/* =============================================================================
   LLAMAS (Elementales de fuego)

   Cada llama es un personaje. Pertenece a un EQUIPO (J1 o J2): en el modo
   Clásico cada equipo tiene 1 llama y en el modo Worms tiene 3. Un equipo
   pierde cuando se le apagan todas sus llamas.

   Cada llama es una caja (AABB: rectángulo alineado a los ejes) que choca
   contra las celdas sólidas de la grilla, igual que en el demo Uint8Array.

   Movimiento por sub-pasos: se avanza de a 1/4 de celda como máximo y en cada
   sub-paso se prueba primero el eje X y después el Y. Si la nueva posición se
   superpone con algo sólido, no se avanza en ese eje.
   ============================================================================= */

const ARMA_BOLA_DE_FUEGO = 0;
const ARMA_MAGMA = 1;

const VIDA_MAXIMA = 100;
const FRACCION_SUMERGIDA_SIN_DANIO = 0.2; // agua por los tobillos (~1 fila de 7) no daña
const FRACCION_PARA_AHOGARSE = 0.85;

let llamas = [];

class Llama {
  constructor(numero, equipo, x, y) {
    this.numero = numero;               // índice único en "llamas" (0, 1, 2...)
    this.equipo = equipo;               // 0 = J1 (rojo), 1 = J2 (azul)
    this.paleta = PALETAS_JUGADORES[equipo];
    this.x = x;                         // esquina superior izquierda del hitbox (en celdas)
    this.y = y;
    this.ancho = FISICA_LLAMA.ancho;
    this.alto = FISICA_LLAMA.alto;
    this.velocidadX = 0;
    this.velocidadY = 0;
    this.enSuelo = false;
    this.vida = VIDA_MAXIMA;
    this.vivo = true;
    // 1 = derecha, -1 = izquierda. Empieza mirando hacia el centro del mapa
    this.mirando = x + this.ancho / 2 < ANCHO_GRILLA / 2 ? 1 : -1;
    this.angulo = 40;                   // grados sobre la horizontal
    this.arma = ARMA_BOLA_DE_FUEGO;
    this.cargando = false;              // ¿está manteniendo el botón de disparo?
    this.potencia = 0;                  // carga del disparo: 0 a 1
    this.recarga = 0;                   // Tiempo real: segundos hasta poder volver a disparar
    this.esperaSalto = 0;               // segundos hasta poder volver a saltar
    this.tiempoHerido = 0;              // para el parpadeo blanco al recibir daño
    this.fraccionMojada = 0;            // 0 = seco, 1 = completamente bajo el agua
    this.curandose = false;
  }
  get centroX() { return this.x + this.ancho / 2; }
  get centroY() { return this.y + this.alto / 2; }
}

/* ---------- Consultas sobre la grilla ---------- */

/* Recorre todas las celdas que toca un rectángulo.
   Se resta un épsilon al borde derecho/inferior: un rectángulo que termina
   exactamente en x=10 toca las celdas 0..9, no la 10. */
const EPSILON = 1e-4;

function rectanguloTocaSolido(x, y, ancho, alto) {
  const primeraColumna = Math.floor(x), ultimaColumna = Math.floor(x + ancho - EPSILON);
  const primeraFila = Math.floor(y), ultimaFila = Math.floor(y + alto - EPSILON);
  for (let fila = primeraFila; fila <= ultimaFila; fila++) {
    for (let columna = primeraColumna; columna <= ultimaColumna; columna++) {
      // Fuera del mundo por los costados o por abajo cuenta como pared
      if (columna < 0 || columna >= ANCHO_GRILLA || fila >= ALTO_GRILLA) return true;
      if (fila < 0) continue;
      if (esSolidoParaLlama(material[fila * ANCHO_GRILLA + columna])) return true;
    }
  }
  return false;
}

/* Busca la primera fila (desde arriba) donde la llama apoyaría los pies.
   Se empieza por debajo del techo (que baja DESCENSO_TECHO filas); si no, la
   llama aparecería metida en el hielo y el choque la empujaría hacia arriba. */
function buscarAlturaDeAparicion(x, ancho, alto) {
  for (let y = 50 + DESCENSO_TECHO; y < ALTO_GRILLA - 10; y++) {
    if (rectanguloTocaSolido(x, y, ancho, alto)) return y - 1;
  }
  return 60 + DESCENSO_TECHO;
}

/* Qué fracción del hitbox está cubierta de agua y si la cabeza está tapada. */
function medirInmersion(llama) {
  const primeraColumna = Math.floor(llama.x), ultimaColumna = Math.floor(llama.x + llama.ancho - EPSILON);
  const primeraFila = Math.floor(llama.y), ultimaFila = Math.floor(llama.y + llama.alto - EPSILON);
  let celdasTotales = 0, celdasConAgua = 0, celdasCabeza = 0, celdasCabezaConAgua = 0;

  for (let fila = primeraFila; fila <= ultimaFila; fila++) {
    for (let columna = primeraColumna; columna <= ultimaColumna; columna++) {
      if (!estaDentroDeLaGrilla(columna, fila)) continue;
      celdasTotales++;
      const indiceCelda = fila * ANCHO_GRILLA + columna;
      // Una celda con poca agua moja proporcionalmente (masa 0 = recién creada = llena)
      const agua = material[indiceCelda] === AGUA ? Math.min(1, masaAgua[indiceCelda] || 1) : 0;
      celdasConAgua += agua;
      if (fila === primeraFila) {           // la fila de arriba es la "cabeza"
        celdasCabeza++;
        if (agua >= 0.5) celdasCabezaConAgua++;
      }
    }
  }
  return {
    fraccion: celdasTotales ? celdasConAgua / celdasTotales : 0,
    cabezaCubierta: celdasCabeza > 0 && celdasCabezaConAgua === celdasCabeza
  };
}

/* Material que pisa la llama (el hielo tiene prioridad porque resbala). */
function materialBajoLosPies(llama) {
  const filaPies = Math.floor(llama.y + llama.alto + 0.05);
  if (filaPies >= ALTO_GRILLA) return PIEDRA;
  let encontrado = AIRE;
  for (let columna = Math.floor(llama.x); columna <= Math.floor(llama.x + llama.ancho - EPSILON); columna++) {
    if (columna < 0 || columna >= ANCHO_GRILLA) continue;
    const tipo = material[filaPies * ANCHO_GRILLA + columna];
    if (tipo === HIELO) return HIELO;
    if (esSolidoParaLlama(tipo)) encontrado = tipo;
  }
  return encontrado;
}

/* ---------- Daño y muerte ---------- */

function aplicarDanio(llama, cantidad) {
  if (!llama.vivo || cantidad <= 0) return;
  llama.vida -= cantidad;
  llama.tiempoHerido = 0.25;
  if (llama.vida <= 0) apagarLlama(llama);
}

function apagarLlama(llama) {
  if (!llama.vivo) return;
  llama.vivo = false;
  llama.vida = 0;
  crearHumo(llama.centroX, llama.y + 2, 18);
  crearVapor(llama.centroX, llama.y + 2, 20);
  sonarApagarse();

  const nombre = llama.paleta.nombre;
  const quedan = llamasVivasDelEquipo(llama.equipo).length;
  if (llamasPorEquipo() === 1) mostrarCartel(`¡${nombre} se apagó!`, llama.paleta.hud);
  else if (quedan === 0) mostrarCartel(`¡${nombre} se quedó sin llamas!`, llama.paleta.hud);
  else mostrarCartel(`¡Se apagó una llama de ${nombre}! (le ${quedan === 1 ? 'queda 1' : `quedan ${quedan}`})`, llama.paleta.hud);

  llama.cargando = false;
  llama.potencia = 0;
  // Si la que se apagó es la que estaba jugando, el turno termina (modos por turnos)
  const eraLaActiva = llama.numero === juego.llamaActual && !MODOS_DE_JUEGO[juego.modo].tiempoReal;
  if (eraLaActiva && juego.pantalla === 'jugando' && (juego.fase === 'apuntar' || juego.fase === 'escape')) pasarAFaseAsentando();
}

/* ---------- Movimiento con colisiones ---------- */

function moverConColisiones(llama, dt) {
  const estabaEnSuelo = llama.enSuelo;

  // Si quedó dentro de algo sólido (por ejemplo, se le congeló o cayó magma encima), subirla
  let intentos = 0;
  while (rectanguloTocaSolido(llama.x, llama.y, llama.ancho, llama.alto) && intentos++ < 8) llama.y -= 1;

  const mayorVelocidad = Math.max(Math.abs(llama.velocidadX), Math.abs(llama.velocidadY));
  const cantidadSubpasos = Math.max(1, Math.ceil(mayorVelocidad * dt / 0.25));
  const avanceX = llama.velocidadX * dt / cantidadSubpasos;
  const avanceY = llama.velocidadY * dt / cantidadSubpasos;
  let bloqueadoEnX = false;

  for (let s = 0; s < cantidadSubpasos; s++) {
    // --- Eje X ---
    if (avanceX !== 0 && !bloqueadoEnX) {
      const nuevaX = llama.x + avanceX;
      if (!rectanguloTocaSolido(nuevaX, llama.y, llama.ancho, llama.alto)) {
        llama.x = nuevaX;
      } else if (estabaEnSuelo && !rectanguloTocaSolido(nuevaX, llama.y - 1, llama.ancho, llama.alto)) {
        // Escalón de 1 celda: el terreno pixelado tiene muchos, se suben solos
        llama.x = nuevaX;
        llama.y -= 1;
      } else {
        llama.velocidadX *= -0.1; // pequeño rebote contra la pared
        bloqueadoEnX = true;
      }
    }
    // --- Eje Y ---
    if (avanceY !== 0) {
      const nuevaY = llama.y + avanceY;
      if (!rectanguloTocaSolido(llama.x, nuevaY, llama.ancho, llama.alto)) {
        llama.y = nuevaY;
      } else {
        if (avanceY > 0) {
          // Cayendo: apoyar los pies justo sobre la fila sólida
          const filaSolida = Math.floor(nuevaY + llama.alto - EPSILON);
          const yApoyado = filaSolida - llama.alto;
          if (yApoyado >= llama.y - 0.001 && !rectanguloTocaSolido(llama.x, yApoyado, llama.ancho, llama.alto)) {
            llama.y = yApoyado;
          }
        }
        llama.velocidadY = 0;
        break;
      }
    }
  }

  // Está en el suelo si bajándola un poquito tocaría algo sólido
  llama.enSuelo = rectanguloTocaSolido(llama.x, llama.y + 0.05, llama.ancho, llama.alto);

  // Se cayó del mundo
  if (llama.y > ALTO_GRILLA + 5) {
    if (llama.vivo) apagarLlama(llama);
    llama.y = ALTO_GRILLA + 5;
    llama.velocidadY = 0;
  }
}

/* "Frena" un factor por segundo, independiente de los FPS:
   retenerPorSegundo = 0.2 significa que después de 1 s queda el 20% de la velocidad.
   En un paso de dt segundos queda retenerPorSegundo ^ dt. */
function frenarExponencial(velocidad, retenerPorSegundo, dt) {
  return velocidad * Math.pow(retenerPorSegundo, dt);
}

/* ---------- Actualización por paso ----------
   controles = { mover (-1..1), saltar, ... } (ver leerControles en entrada.js)
   o null si la llama no se puede mover (no es su turno). */
function actualizarLlama(llama, dt, controles) {
  llama.tiempoHerido = Math.max(0, llama.tiempoHerido - dt);

  if (!llama.vivo) {
    // El fósforo apagado solo cae y larga humo
    llama.velocidadX = frenarExponencial(llama.velocidadX, 0.1, dt);
    llama.velocidadY = Math.min(llama.velocidadY + PARAMETROS.gravedad * dt, 60);
    moverConColisiones(llama, dt);
    if (Math.random() < dt * 3) crearHumo(llama.centroX + llama.mirando * 3, llama.y + llama.alto - 2, 1);
    return;
  }

  const fisica = FISICA_LLAMA;
  const enAgua = medirInmersion(llama).fraccion > FRACCION_SUMERGIDA_SIN_DANIO;

  // --- Movimiento horizontal ---
  // Con stick, "mover" puede ser intermedio: solo importa el sentido (el movimiento
  // es "tosco" a propósito, como pide el GDD)
  let direccion = 0;
  if (controles && controles.mover !== 0) {
    direccion = Math.sign(controles.mover);
    llama.mirando = direccion;
  }
  if (direccion !== 0) {
    const aceleracion = llama.enSuelo ? fisica.aceleracionEnSuelo : fisica.aceleracionEnAire;
    llama.velocidadX += direccion * aceleracion * dt * (enAgua ? 0.5 : 1);
  } else {
    // Fricción al soltar las teclas: en hielo frena poco (resbala), por eso la inercia
    let friccion = fisica.friccionAire;
    if (llama.enSuelo) friccion = materialBajoLosPies(llama) === HIELO ? fisica.friccionHielo : fisica.friccionSuelo;
    if (llama.velocidadX > 0) llama.velocidadX = Math.max(0, llama.velocidadX - friccion * dt);
    else if (llama.velocidadX < 0) llama.velocidadX = Math.min(0, llama.velocidadX + friccion * dt);
  }

  // Tope de velocidad. Un empujón (explosión, agua) puede superar el tope por un rato,
  // pero si la llama camina no puede acelerar por encima de él.
  const velocidadTope = enAgua ? fisica.velocidadMaximaEnAgua : fisica.velocidadMaxima;
  llama.velocidadX = limitar(llama.velocidadX, -velocidadTope * 1.6, velocidadTope * 1.6);
  if (direccion !== 0 && Math.abs(llama.velocidadX) > velocidadTope) {
    const exceso = Math.abs(llama.velocidadX) - velocidadTope;
    llama.velocidadX -= Math.sign(llama.velocidadX) * Math.min(exceso, 80 * dt);
  }

  // --- Salto / nado ---
  llama.esperaSalto -= dt;
  if (controles && controles.saltar && llama.esperaSalto <= 0) {
    if (llama.enSuelo) { llama.velocidadY = -fisica.velocidadSalto; llama.esperaSalto = 0.3; sonarSalto(); }
    else if (enAgua) { llama.velocidadY = -fisica.velocidadNado; llama.esperaSalto = 0.45; }
  }

  // --- Gravedad (en el agua pesa menos y hay mucho rozamiento) ---
  llama.velocidadY += PARAMETROS.gravedad * dt * (enAgua ? 0.45 : 1);
  if (enAgua) {
    llama.velocidadX = frenarExponencial(llama.velocidadX, 0.2, dt);
    llama.velocidadY = frenarExponencial(llama.velocidadY, 0.25, dt);
  }
  llama.velocidadY = limitar(llama.velocidadY, -80, fisica.velocidadCaidaMaxima);

  moverConColisiones(llama, dt);
  if (!llama.vivo) return;

  aplicarEfectosDelAgua(llama, dt);
  if (!llama.vivo) return;
  aplicarCuracionPorMagma(llama, dt);
}

/* Ahogamiento (muerte súbita) y daño por estar sumergida. */
function aplicarEfectosDelAgua(llama, dt) {
  const inmersion = medirInmersion(llama);
  llama.fraccionMojada = inmersion.fraccion;

  if (inmersion.cabezaCubierta && inmersion.fraccion >= FRACCION_PARA_AHOGARSE) {
    apagarLlama(llama);
    return;
  }
  // Daño proporcional a cuánto está sumergida (solo por encima de los tobillos)
  if (inmersion.fraccion > FRACCION_SUMERGIDA_SIN_DANIO) {
    aplicarDanio(llama, PARAMETROS.danioSumergidoPorSegundo * inmersion.fraccion * dt);
  }
}

/* Pararse sobre magma líquido o magma sólido todavía caliente recupera vida. */
function aplicarCuracionPorMagma(llama, dt) {
  llama.curandose = false;
  const filaPies = Math.floor(llama.y + llama.alto + 0.05);
  // Se revisa la fila de los pies y la de abajo
  for (let fila = filaPies - 1; fila <= filaPies; fila++) {
    if (fila < 0 || fila >= ALTO_GRILLA) continue;
    for (let columna = Math.floor(llama.x); columna <= Math.floor(llama.x + llama.ancho - EPSILON); columna++) {
      if (columna < 0 || columna >= ANCHO_GRILLA) continue;
      const indice = fila * ANCHO_GRILLA + columna;
      const tipo = material[indice];
      if (tipo === MAGMA || (tipo === MAGMA_SOLIDO && temperatura[indice] > PARAMETROS.temperaturaCuracion)) {
        llama.curandose = true;
      }
    }
  }
  if (llama.curandose) llama.vida = Math.min(VIDA_MAXIMA, llama.vida + PARAMETROS.curacionPorSegundo * dt);
}


/* Marca qué celdas tapa cada llama (se recalcula en cada paso). */
function marcarCeldasOcupadas() {
  ocupadaPorLlama.fill(0);
  for (const llama of llamas) {
    if (!llama.vivo) continue;
    for (let y = Math.floor(llama.y); y <= Math.floor(llama.y + llama.alto - EPSILON); y++) {
      if (y < 0 || y >= ALTO_GRILLA) continue;
      for (let x = Math.floor(llama.x); x <= Math.floor(llama.x + llama.ancho - EPSILON); x++) {
        if (x >= 0 && x < ANCHO_GRILLA) ocupadaPorLlama[y * ANCHO_GRILLA + x] = 1;
      }
    }
  }
}

/* ---------- Consultas por equipo ---------- */

function llamasDelEquipo(equipo) {
  return llamas.filter(llama => llama.equipo === equipo);
}

function llamasVivasDelEquipo(equipo) {
  return llamas.filter(llama => llama.equipo === equipo && llama.vivo);
}

/* La llama que está jugando el turno actual. */
function llamaActual() {
  return llamas[juego.llamaActual];
}
