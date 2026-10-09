'use strict';
/* =============================================================================
   PARTÍCULAS DE AGUA (parte Lagrangiana)

   Cuando una gota de la grilla queda sin apoyo se convierte en partícula:
   tiene posición y velocidad propias, le afectan la gravedad y el viento, y
   empuja/moja a las llamas que toca. Al chocar con algo sólido (o con más
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
    if (!gota.deCascada) gota.velocidadX += aceleracionViento * dt; // las cascadas no las mueve el viento
    gota.velocidadX *= ROZAMIENTO_AIRE_AGUA;
    if (gota.velocidadY > VELOCIDAD_MAXIMA_CAIDA_AGUA) gota.velocidadY = VELOCIDAD_MAXIMA_CAIDA_AGUA;

    const sigueViva = moverGota(gota, dt);
    if (sigueViva) mojarLlamas(gota);
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
        despertarCelda(indice);
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

/* La gota vuelve a la grilla: su masa se SUMA a la celda donde chocó (la última
   celda libre que ocupó). Si esa celda ya se llenó con agua se le suma ahí; si
   se volvió sólida, sube hasta encontrar aire o agua. No hay torres: el exceso
   de una celda lo reparte el flujo de masa (ver fluidos.js). */
function devolverAGrilla(gota) {
  if (repartirEnElLago(gota)) return; // si cayó al lago, se reparte parejo (ver cascadas.js)
  // "Plip" de las gotas que caen con fuerza (las de la cascada ya tienen su sonido de ambiente)
  if (!gota.deCascada && gota.velocidadY > 20) registrarChapoteo();
  const x = limitar(Math.floor(gota.x), 0, ANCHO_GRILLA - 1);
  for (let fila = Math.floor(gota.y); fila >= 0; fila--) {
    const indice = fila * ANCHO_GRILLA + x;
    if (material[indice] === AIRE) {
      material[indice] = AGUA;
      masaAgua[indice] = gota.masa;
      temperatura[indice] = gota.grados;
      despertarCelda(indice); // agua nueva en la grilla: tiene que nivelarse
      return;
    }
    if (material[indice] === AGUA) {
      masaAgua[indice] = (masaAgua[indice] || MASA_MAXIMA) + gota.masa; // masa 0 = celda llena
      despertarCelda(indice);
      return;
    }
  }
}

/* Si la gota está dentro del hitbox de una llama: le hace daño y la empuja.
   Cada gota daña una sola vez a cada llama: se marca con un bit por llama
   (bit 0 = llama 0, bit 1 = llama 1...; alcanza para hasta 32 llamas). */
function mojarLlamas(gota) {
  for (const llama of llamas) {
    if (!llama.vivo) continue;
    const bitDeLaLlama = 1 << llama.numero;
    if (gota.llamasGolpeadas & bitDeLaLlama) continue;

    const adentro = gota.x >= llama.x && gota.x <= llama.x + llama.ancho
                 && gota.y >= llama.y && gota.y <= llama.y + llama.alto;
    if (!adentro) continue;

    gota.llamasGolpeadas |= bitDeLaLlama;
    aplicarDanio(llama, PARAMETROS.danioPorGota * gota.masa); // una gota con menos agua moja menos
    // Transferencia de impulso: la gota empuja a la llama en su dirección
    llama.velocidadX += gota.velocidadX * 0.05;
    llama.velocidadY += gota.velocidadY * 0.02;
    gota.velocidadX *= 0.5;
    if (Math.random() < 0.3) crearVapor(gota.x, gota.y, 1);
  }
}
