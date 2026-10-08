'use strict';
/* =============================================================================
   PARTÍCULAS DE AGUA (parte Lagrangiana)

   Cuando una gota de la grilla queda sin apoyo se convierte en partícula:
   tiene posición y velocidad propias, le afectan la gravedad y el viento, y
   empuja/moja a los jugadores que toca. Al chocar con algo sólido (o con más
   agua) vuelve a la grilla como una celda de AGUA.

   Integración (Euler semi-implícito), en cada paso:
       velocidad += aceleración * dt
       posición  += velocidad * dt
   ============================================================================= */

let particulasAgua = [];

const VELOCIDAD_MAXIMA_CAIDA_AGUA = 90;
const ROZAMIENTO_AIRE_AGUA = 0.995; // la velocidad horizontal se conserva al 99.5% por paso

function simularParticulasAgua(dt) {
  const aceleracionViento = viento * PARAMETROS.vientoSobreAgua;

  // Se recorre al revés para poder borrar partículas sin saltear ninguna
  for (let n = particulasAgua.length - 1; n >= 0; n--) {
    const gota = particulasAgua[n];
    gota.velocidadY += PARAMETROS.gravedad * dt;
    gota.velocidadX += aceleracionViento * dt;
    gota.velocidadX *= ROZAMIENTO_AIRE_AGUA;
    if (gota.velocidadY > VELOCIDAD_MAXIMA_CAIDA_AGUA) gota.velocidadY = VELOCIDAD_MAXIMA_CAIDA_AGUA;

    const sigueViva = moverGota(gota, dt);
    if (sigueViva) mojarJugadores(gota);
    else {
      // Borrado rápido: se pisa con la última y se achica el arreglo
      particulasAgua[n] = particulasAgua[particulasAgua.length - 1];
      particulasAgua.pop();
    }
  }
}

/* Mueve la gota en SUB-PASOS de media celda como máximo.
   Si se moviera de golpe varias celdas podría "atravesar" una pared fina
   sin detectarla (efecto túnel). Devuelve false si la gota dejó de existir. */
function moverGota(gota, dt) {
  const mayorVelocidad = Math.max(Math.abs(gota.velocidadX), Math.abs(gota.velocidadY));
  const cantidadSubpasos = Math.max(1, Math.ceil(mayorVelocidad * dt / 0.5));
  const avanceX = gota.velocidadX * dt / cantidadSubpasos;
  const avanceY = gota.velocidadY * dt / cantidadSubpasos;

  for (let s = 0; s < cantidadSubpasos; s++) {
    let nuevaX = gota.x + avanceX;
    let nuevaY = gota.y + avanceY;

    // Rebote suave contra los bordes laterales del mundo
    if (nuevaX < 0.5) { nuevaX = 0.5; gota.velocidadX = Math.abs(gota.velocidadX) * 0.3; }
    if (nuevaX > ANCHO_GRILLA - 0.5) { nuevaX = ANCHO_GRILLA - 0.5; gota.velocidadX = -Math.abs(gota.velocidadX) * 0.3; }
    if (nuevaY >= ALTO_GRILLA) return false;
    if (nuevaY < 0) { nuevaY = 0; gota.velocidadY = 0; }

    const indice = Math.floor(nuevaY) * ANCHO_GRILLA + Math.floor(nuevaX);
    const tipo = material[indice];
    if (tipo !== AIRE) {
      if (tipo === MAGMA) {
        // Agua sobre magma: se evapora y el magma se solidifica
        material[indice] = MAGMA_SOLIDO;
        crearVapor(nuevaX, nuevaY, 3);
      } else {
        devolverAGrilla(gota);
      }
      return false;
    }
    gota.x = nuevaX;
    gota.y = nuevaY;
  }
  return true;
}

/* La gota vuelve a ser una celda de AGUA en la última celda libre que ocupó.
   Si esa celda ya se llenó (otra gota llegó antes), busca hacia arriba. */
function devolverAGrilla(gota) {
  const x = limitar(Math.floor(gota.x), 0, ANCHO_GRILLA - 1);
  const y = Math.floor(gota.y);
  for (let subir = 0; subir < 10; subir++) {
    const fila = y - subir;
    if (fila < 0) return;
    const indice = fila * ANCHO_GRILLA + x;
    if (material[indice] === AIRE) {
      material[indice] = AGUA;
      temperatura[indice] = gota.grados;
      return;
    }
  }
}

/* Si la gota está dentro del hitbox de un jugador: le hace daño y lo empuja.
   Cada gota daña una sola vez a cada jugador (se marca con un bit). */
function mojarJugadores(gota) {
  for (const jugador of jugadores) {
    if (!jugador.vivo) continue;
    const bitDelJugador = 1 << jugador.numero;
    if (gota.jugadoresGolpeados & bitDelJugador) continue;

    const adentro = gota.x >= jugador.x && gota.x <= jugador.x + jugador.ancho
                 && gota.y >= jugador.y && gota.y <= jugador.y + jugador.alto;
    if (!adentro) continue;

    gota.jugadoresGolpeados |= bitDelJugador;
    aplicarDanio(jugador, PARAMETROS.danioPorGota);
    // Transferencia de impulso: la gota empuja al jugador en su dirección
    jugador.velocidadX += gota.velocidadX * 0.05;
    jugador.velocidadY += gota.velocidadY * 0.02;
    gota.velocidadX *= 0.5;
    if (Math.random() < 0.3) crearVapor(gota.x, gota.y, 1);
  }
}
