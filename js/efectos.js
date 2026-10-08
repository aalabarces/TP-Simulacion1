'use strict';
/* =============================================================================
   EFECTOS VISUALES
   Partículas que NO afectan la simulación: vapor, chispas, humo y destellos.
   ============================================================================= */

let efectos = [];

const MAXIMO_EFECTOS = 2500;
const EFECTO_VAPOR = 'vapor';
const EFECTO_CHISPA = 'chispa';
const EFECTO_HUMO = 'humo';
const EFECTO_DESTELLO = 'destello'; // luz circular de una explosión (no se mueve)

function hayLugarParaEfectos() {
  return efectos.length < MAXIMO_EFECTOS;
}

/* Vapor blanco que sube (choque térmico agua/fuego) */
function crearVapor(x, y, cantidad) {
  for (let n = 0; n < cantidad && hayLugarParaEfectos(); n++) {
    efectos.push({
      tipo: EFECTO_VAPOR, x, y,
      velocidadX: (Math.random() - 0.5) * 6,
      velocidadY: -6 - Math.random() * 8,
      edad: 0, duracion: 1 + Math.random() * 1.2,
      radio: 0.8 + Math.random()
    });
  }
}

/* Chispas que salen en todas direcciones y caen por gravedad */
function crearChispas(x, y, cantidad, colorRGB) {
  for (let n = 0; n < cantidad && hayLugarParaEfectos(); n++) {
    const angulo = Math.random() * Math.PI * 2;
    const rapidez = 10 + Math.random() * 45;
    efectos.push({
      tipo: EFECTO_CHISPA, x, y,
      velocidadX: Math.cos(angulo) * rapidez,
      velocidadY: Math.sin(angulo) * rapidez - 15, // un poco hacia arriba
      edad: 0, duracion: 0.4 + Math.random() * 0.6,
      color: colorRGB
    });
  }
}

/* Humo oscuro (explosiones y fósforos apagados) */
function crearHumo(x, y, cantidad) {
  for (let n = 0; n < cantidad && hayLugarParaEfectos(); n++) {
    efectos.push({
      tipo: EFECTO_HUMO, x: x + (Math.random() - 0.5), y,
      velocidadX: (Math.random() - 0.5) * 2,
      velocidadY: -3 - Math.random() * 3,
      edad: 0, duracion: 1.5 + Math.random(),
      radio: 0.6 + Math.random() * 0.6
    });
  }
}

function crearDestello(x, y, radio, duracion, colorRGB) {
  efectos.push({ tipo: EFECTO_DESTELLO, x, y, edad: 0, duracion, radio, color: colorRGB });
}

/* Partículas trazadoras que deja un proyectil en vuelo */
function crearEstela(x, y, colorRGB) {
  efectos.push({
    tipo: EFECTO_CHISPA, x, y,
    velocidadX: (Math.random() - 0.5) * 6,
    velocidadY: (Math.random() - 0.5) * 6,
    edad: 0, duracion: 0.35, color: colorRGB
  });
}

function simularEfectos(dt) {
  for (let n = efectos.length - 1; n >= 0; n--) {
    const efecto = efectos[n];
    efecto.edad += dt;
    if (efecto.edad >= efecto.duracion) {
      efectos[n] = efectos[efectos.length - 1];
      efectos.pop();
      continue;
    }
    if (efecto.tipo === EFECTO_DESTELLO) continue; // no se mueve

    if (efecto.tipo === EFECTO_CHISPA) {
      efecto.velocidadY += PARAMETROS.gravedad * 0.6 * dt;
    } else {
      // vapor y humo: los lleva el viento, se frenan y se agrandan
      efecto.velocidadX += viento * 6 * dt;
      efecto.velocidadY *= 0.98;
      efecto.radio += dt * 1.2;
    }
    efecto.x += efecto.velocidadX * dt;
    efecto.y += efecto.velocidadY * dt;
  }
}
