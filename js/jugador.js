'use strict';
/* =============================================================================
   JUGADORES (Elementales de fuego)

   Cada jugador es una caja (AABB: rectángulo alineado a los ejes) que choca
   contra las celdas sólidas de la grilla, igual que en el demo Uint8Array.

   Movimiento por sub-pasos: se avanza de a 1/4 de celda como máximo y en cada
   sub-paso se prueba primero el eje X y después el Y. Si la nueva posición se
   superpone con algo sólido, no se avanza en ese eje.
   ============================================================================= */

const ARMA_BOLA_DE_FUEGO = 0;
const ARMA_MAGMA = 1;

const VIDA_MAXIMA = 100;
const RADIO_AURA = 5;                  // celdas alrededor del elemental que calienta
const FRACCION_SUMERGIDA_SIN_DANIO = 0.2; // agua por los tobillos (~1 fila de 7) no daña
const FRACCION_PARA_AHOGARSE = 0.85;

let jugadores = [];

class Jugador {
  constructor(numero, x, y) {
    this.numero = numero;               // 0 = J1, 1 = J2
    this.paleta = PALETAS_JUGADORES[numero];
    this.x = x;                         // esquina superior izquierda del hitbox (en celdas)
    this.y = y;
    this.ancho = FISICA_JUGADOR.ancho;
    this.alto = FISICA_JUGADOR.alto;
    this.velocidadX = 0;
    this.velocidadY = 0;
    this.enSuelo = false;
    this.vida = VIDA_MAXIMA;
    this.vivo = true;
    this.mirando = numero === 0 ? 1 : -1; // 1 = derecha, -1 = izquierda (empiezan enfrentados)
    this.angulo = 40;                   // grados sobre la horizontal
    this.arma = ARMA_BOLA_DE_FUEGO;
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
      if (esSolidoParaJugador(material[fila * ANCHO_GRILLA + columna])) return true;
    }
  }
  return false;
}

/* Busca la primera fila (desde arriba) donde el jugador apoyaría los pies. */
function buscarAlturaDeAparicion(x, ancho, alto) {
  for (let y = 40; y < ALTO_GRILLA - 10; y++) {
    if (rectanguloTocaSolido(x, y, ancho, alto)) return y - 1;
  }
  return 60;
}

/* Qué fracción del hitbox está cubierta de agua y si la cabeza está tapada. */
function medirInmersion(jugador) {
  const primeraColumna = Math.floor(jugador.x), ultimaColumna = Math.floor(jugador.x + jugador.ancho - EPSILON);
  const primeraFila = Math.floor(jugador.y), ultimaFila = Math.floor(jugador.y + jugador.alto - EPSILON);
  let celdasTotales = 0, celdasConAgua = 0, celdasCabeza = 0, celdasCabezaConAgua = 0;

  for (let fila = primeraFila; fila <= ultimaFila; fila++) {
    for (let columna = primeraColumna; columna <= ultimaColumna; columna++) {
      if (!estaDentroDeLaGrilla(columna, fila)) continue;
      celdasTotales++;
      const hayAgua = material[fila * ANCHO_GRILLA + columna] === AGUA;
      if (hayAgua) celdasConAgua++;
      if (fila === primeraFila) {           // la fila de arriba es la "cabeza"
        celdasCabeza++;
        if (hayAgua) celdasCabezaConAgua++;
      }
    }
  }
  return {
    fraccion: celdasTotales ? celdasConAgua / celdasTotales : 0,
    cabezaCubierta: celdasCabeza > 0 && celdasCabezaConAgua === celdasCabeza
  };
}

/* Material que pisa el jugador (el hielo tiene prioridad porque resbala). */
function materialBajoLosPies(jugador) {
  const filaPies = Math.floor(jugador.y + jugador.alto + 0.05);
  if (filaPies >= ALTO_GRILLA) return PIEDRA;
  let encontrado = AIRE;
  for (let columna = Math.floor(jugador.x); columna <= Math.floor(jugador.x + jugador.ancho - EPSILON); columna++) {
    if (columna < 0 || columna >= ANCHO_GRILLA) continue;
    const tipo = material[filaPies * ANCHO_GRILLA + columna];
    if (tipo === HIELO) return HIELO;
    if (esSolidoParaJugador(tipo)) encontrado = tipo;
  }
  return encontrado;
}

/* ---------- Daño y muerte ---------- */

function aplicarDanio(jugador, cantidad) {
  if (!jugador.vivo || cantidad <= 0) return;
  jugador.vida -= cantidad;
  jugador.tiempoHerido = 0.25;
  if (jugador.vida <= 0) apagarJugador(jugador);
}

function apagarJugador(jugador) {
  if (!jugador.vivo) return;
  jugador.vivo = false;
  jugador.vida = 0;
  crearHumo(jugador.centroX, jugador.y + 2, 18);
  crearVapor(jugador.centroX, jugador.y + 2, 20);
  mostrarCartel(`¡${jugador.paleta.nombre} se apagó!`, jugador.paleta.hud);
  // Si se apagó durante su propio turno, el turno termina
  if (juego.pantalla === 'jugando' && (juego.fase === 'apuntar' || juego.fase === 'escape')) pasarAFaseAsentando();
}

/* ---------- Movimiento con colisiones ---------- */

function moverConColisiones(jugador, dt) {
  const estabaEnSuelo = jugador.enSuelo;

  // Si quedó dentro de algo sólido (por ejemplo, se le congeló o cayó magma encima), subirlo
  let intentos = 0;
  while (rectanguloTocaSolido(jugador.x, jugador.y, jugador.ancho, jugador.alto) && intentos++ < 8) jugador.y -= 1;

  const mayorVelocidad = Math.max(Math.abs(jugador.velocidadX), Math.abs(jugador.velocidadY));
  const cantidadSubpasos = Math.max(1, Math.ceil(mayorVelocidad * dt / 0.25));
  const avanceX = jugador.velocidadX * dt / cantidadSubpasos;
  const avanceY = jugador.velocidadY * dt / cantidadSubpasos;
  let bloqueadoEnX = false;

  for (let s = 0; s < cantidadSubpasos; s++) {
    // --- Eje X ---
    if (avanceX !== 0 && !bloqueadoEnX) {
      const nuevaX = jugador.x + avanceX;
      if (!rectanguloTocaSolido(nuevaX, jugador.y, jugador.ancho, jugador.alto)) {
        jugador.x = nuevaX;
      } else if (estabaEnSuelo && !rectanguloTocaSolido(nuevaX, jugador.y - 1, jugador.ancho, jugador.alto)) {
        // Escalón de 1 celda: el terreno pixelado tiene muchos, se suben solos
        jugador.x = nuevaX;
        jugador.y -= 1;
      } else {
        jugador.velocidadX *= -0.1; // pequeño rebote contra la pared
        bloqueadoEnX = true;
      }
    }
    // --- Eje Y ---
    if (avanceY !== 0) {
      const nuevaY = jugador.y + avanceY;
      if (!rectanguloTocaSolido(jugador.x, nuevaY, jugador.ancho, jugador.alto)) {
        jugador.y = nuevaY;
      } else {
        if (avanceY > 0) {
          // Cayendo: apoyar los pies justo sobre la fila sólida
          const filaSolida = Math.floor(nuevaY + jugador.alto - EPSILON);
          const yApoyado = filaSolida - jugador.alto;
          if (yApoyado >= jugador.y - 0.001 && !rectanguloTocaSolido(jugador.x, yApoyado, jugador.ancho, jugador.alto)) {
            jugador.y = yApoyado;
          }
        }
        jugador.velocidadY = 0;
        break;
      }
    }
  }

  // Está en el suelo si bajándolo un poquito tocaría algo sólido
  jugador.enSuelo = rectanguloTocaSolido(jugador.x, jugador.y + 0.05, jugador.ancho, jugador.alto);

  // Se cayó del mundo
  if (jugador.y > ALTO_GRILLA + 5) {
    if (jugador.vivo) apagarJugador(jugador);
    jugador.y = ALTO_GRILLA + 5;
    jugador.velocidadY = 0;
  }
}

/* "Frena" un factor por segundo, independiente de los FPS:
   retenerPorSegundo = 0.2 significa que después de 1 s queda el 20% de la velocidad.
   En un paso de dt segundos queda retenerPorSegundo ^ dt. */
function frenarExponencial(velocidad, retenerPorSegundo, dt) {
  return velocidad * Math.pow(retenerPorSegundo, dt);
}

/* ---------- Actualización por paso ----------
   controles = { izquierda, derecha, saltar } o null si el jugador no puede moverse. */
function actualizarJugador(jugador, dt, controles) {
  jugador.tiempoHerido = Math.max(0, jugador.tiempoHerido - dt);

  if (!jugador.vivo) {
    // El fósforo apagado solo cae y larga humo
    jugador.velocidadX = frenarExponencial(jugador.velocidadX, 0.1, dt);
    jugador.velocidadY = Math.min(jugador.velocidadY + PARAMETROS.gravedad * dt, 60);
    moverConColisiones(jugador, dt);
    if (Math.random() < dt * 3) crearHumo(jugador.centroX + jugador.mirando * 3, jugador.y + jugador.alto - 2, 1);
    return;
  }

  const fisica = FISICA_JUGADOR;
  const enAgua = medirInmersion(jugador).fraccion > FRACCION_SUMERGIDA_SIN_DANIO;

  // --- Movimiento horizontal ---
  let direccion = 0;
  if (controles) {
    if (controles.izquierda) { direccion -= 1; jugador.mirando = -1; }
    if (controles.derecha) { direccion += 1; jugador.mirando = 1; }
  }
  if (direccion !== 0) {
    const aceleracion = jugador.enSuelo ? fisica.aceleracionEnSuelo : fisica.aceleracionEnAire;
    jugador.velocidadX += direccion * aceleracion * dt * (enAgua ? 0.5 : 1);
  } else {
    // Fricción al soltar las teclas: en hielo frena poco (resbala), por eso la inercia
    let friccion = fisica.friccionAire;
    if (jugador.enSuelo) friccion = materialBajoLosPies(jugador) === HIELO ? fisica.friccionHielo : fisica.friccionSuelo;
    if (jugador.velocidadX > 0) jugador.velocidadX = Math.max(0, jugador.velocidadX - friccion * dt);
    else if (jugador.velocidadX < 0) jugador.velocidadX = Math.min(0, jugador.velocidadX + friccion * dt);
  }

  // Tope de velocidad. Un empujón (explosión, agua) puede superar el tope por un rato,
  // pero si el jugador camina no puede acelerar por encima de él.
  const velocidadTope = enAgua ? fisica.velocidadMaximaEnAgua : fisica.velocidadMaxima;
  jugador.velocidadX = limitar(jugador.velocidadX, -velocidadTope * 1.6, velocidadTope * 1.6);
  if (direccion !== 0 && Math.abs(jugador.velocidadX) > velocidadTope) {
    const exceso = Math.abs(jugador.velocidadX) - velocidadTope;
    jugador.velocidadX -= Math.sign(jugador.velocidadX) * Math.min(exceso, 80 * dt);
  }

  // --- Salto / nado ---
  jugador.esperaSalto -= dt;
  if (controles && controles.saltar && jugador.esperaSalto <= 0) {
    if (jugador.enSuelo) { jugador.velocidadY = -fisica.velocidadSalto; jugador.esperaSalto = 0.3; }
    else if (enAgua) { jugador.velocidadY = -fisica.velocidadNado; jugador.esperaSalto = 0.45; }
  }

  // --- Gravedad (en el agua pesa menos y hay mucho rozamiento) ---
  jugador.velocidadY += PARAMETROS.gravedad * dt * (enAgua ? 0.45 : 1);
  if (enAgua) {
    jugador.velocidadX = frenarExponencial(jugador.velocidadX, 0.2, dt);
    jugador.velocidadY = frenarExponencial(jugador.velocidadY, 0.25, dt);
  }
  jugador.velocidadY = limitar(jugador.velocidadY, -80, fisica.velocidadCaidaMaxima);

  moverConColisiones(jugador, dt);
  if (!jugador.vivo) return;

  aplicarEfectosDelAgua(jugador, dt);
  if (!jugador.vivo) return;
  aplicarCuracionPorMagma(jugador, dt);
}

/* Ahogamiento (muerte súbita) y daño por estar sumergido. */
function aplicarEfectosDelAgua(jugador, dt) {
  const inmersion = medirInmersion(jugador);
  jugador.fraccionMojada = inmersion.fraccion;

  if (inmersion.cabezaCubierta && inmersion.fraccion >= FRACCION_PARA_AHOGARSE) {
    apagarJugador(jugador);
    return;
  }
  // Daño proporcional a cuánto está sumergido (solo por encima de los tobillos)
  if (inmersion.fraccion > FRACCION_SUMERGIDA_SIN_DANIO) {
    aplicarDanio(jugador, PARAMETROS.danioSumergidoPorSegundo * inmersion.fraccion * dt);
  }
}

/* Pararse sobre magma líquido o magma sólido todavía caliente recupera vida. */
function aplicarCuracionPorMagma(jugador, dt) {
  jugador.curandose = false;
  const filaPies = Math.floor(jugador.y + jugador.alto + 0.05);
  // Se revisa la fila de los pies y la de abajo
  for (let fila = filaPies - 1; fila <= filaPies; fila++) {
    if (fila < 0 || fila >= ALTO_GRILLA) continue;
    for (let columna = Math.floor(jugador.x); columna <= Math.floor(jugador.x + jugador.ancho - EPSILON); columna++) {
      if (columna < 0 || columna >= ANCHO_GRILLA) continue;
      const indice = fila * ANCHO_GRILLA + columna;
      const tipo = material[indice];
      if (tipo === MAGMA || (tipo === MAGMA_SOLIDO && temperatura[indice] > PARAMETROS.temperaturaCuracion)) {
        jugador.curandose = true;
      }
    }
  }
  if (jugador.curandose) jugador.vida = Math.min(VIDA_MAXIMA, jugador.vida + PARAMETROS.curacionPorSegundo * dt);
}

/* El elemental calienta lo que lo rodea. El efecto baja linealmente con la
   distancia: máximo en el centro, cero a RADIO_AURA celdas.
   Si se queda quieto mucho tiempo, derrite el hielo que pisa. */
function aplicarAuraDeCalor(jugador, dt) {
  if (!jugador.vivo || PARAMETROS.auraDeCalor <= 0) return;
  const centroX = jugador.centroX, centroY = jugador.centroY;
  for (let y = Math.floor(centroY - RADIO_AURA); y <= Math.ceil(centroY + RADIO_AURA); y++) {
    if (y < 0 || y >= ALTO_GRILLA) continue;
    for (let x = Math.floor(centroX - RADIO_AURA); x <= Math.ceil(centroX + RADIO_AURA); x++) {
      if (x < 0 || x >= ANCHO_GRILLA) continue;
      const distanciaAlCentro = distancia(x + 0.5, y + 0.5, centroX, centroY);
      if (distanciaAlCentro > RADIO_AURA) continue;
      const indice = y * ANCHO_GRILLA + x;
      if (material[indice] !== AIRE) {
        temperatura[indice] += PARAMETROS.auraDeCalor * dt * (1 - distanciaAlCentro / RADIO_AURA);
      }
    }
  }
}

/* Marca qué celdas tapa cada jugador (se recalcula en cada paso). */
function marcarCeldasOcupadas() {
  ocupadaPorJugador.fill(0);
  for (const jugador of jugadores) {
    if (!jugador.vivo) continue;
    for (let y = Math.floor(jugador.y); y <= Math.floor(jugador.y + jugador.alto - EPSILON); y++) {
      if (y < 0 || y >= ALTO_GRILLA) continue;
      for (let x = Math.floor(jugador.x); x <= Math.floor(jugador.x + jugador.ancho - EPSILON); x++) {
        if (x >= 0 && x < ANCHO_GRILLA) ocupadaPorJugador[y * ANCHO_GRILLA + x] = 1;
      }
    }
  }
}
