'use strict';
/* =============================================================================
   DIBUJO DEL MUNDO

   1) El terreno se pinta píxel por píxel en una imagen chica de 320x180
      (un píxel por celda) y después se estira al tamaño de la pantalla sin
      suavizado, para que se vea pixelado.
   2) Encima se dibujan, ya en coordenadas de celda, las luces, las gotas,
      el proyectil, los personajes, la mira y los efectos.
   3) Por último el HUD, en píxeles de pantalla (ver hud.js).
   ============================================================================= */

const lienzo = document.getElementById('lienzo');
const ctx = lienzo.getContext('2d');

// Imagen fuera de pantalla donde se pinta el terreno
const lienzoTerreno = document.createElement('canvas');
lienzoTerreno.width = ANCHO_GRILLA;
lienzoTerreno.height = ALTO_GRILLA;
const ctxTerreno = lienzoTerreno.getContext('2d');
const imagenTerreno = ctxTerreno.createImageData(ANCHO_GRILLA, ALTO_GRILLA);
// Vista de 32 bits sobre los mismos bytes: escribir un número = escribir un píxel entero
const pixelesTerreno = new Uint32Array(imagenTerreno.data.buffer);

const vista = { temperatura: false, grilla: false }; // vistas de debug (teclas T y G)
let tiempoTotal = 0;                                 // segundos desde que abrió el juego (animaciones)
let densidadPixeles = 1;

function ajustarTamanioLienzo() {
  // En pantallas de alta densidad se dibuja con más píxeles (máximo x2 por rendimiento)
  densidadPixeles = Math.min(window.devicePixelRatio || 1, 2);
  lienzo.width = Math.floor(innerWidth * densidadPixeles);
  lienzo.height = Math.floor(innerHeight * densidadPixeles);
}
window.addEventListener('resize', ajustarTamanioLienzo);
ajustarTamanioLienzo();

/* ---------- Colores del terreno ---------- */

/* Escala de colores de la vista de temperatura: [grados, rojo, verde, azul].
   Entre dos puntos se interpola linealmente. */
const ESCALA_TEMPERATURA = [
  [-20, 20, 40, 140],    // muy frío: azul oscuro
  [-5, 60, 140, 255],    // frío: azul
  [0, 230, 240, 255],    // 0°: blanco
  [30, 255, 230, 120],   // tibio: amarillo
  [100, 255, 140, 40],   // caliente: naranja
  [600, 220, 30, 20],    // muy caliente: rojo
  [1000, 255, 255, 255]  // magma: blanco incandescente
];

function colorDeTemperatura(grados) {
  if (grados <= ESCALA_TEMPERATURA[0][0]) {
    const [, r, g, b] = ESCALA_TEMPERATURA[0];
    return colorPixel(r, g, b);
  }
  for (let k = 1; k < ESCALA_TEMPERATURA.length; k++) {
    const hasta = ESCALA_TEMPERATURA[k];
    if (grados <= hasta[0]) {
      const desde = ESCALA_TEMPERATURA[k - 1];
      const t = (grados - desde[0]) / (hasta[0] - desde[0]); // 0..1 dentro del tramo
      return colorPixel(interpolar(desde[1], hasta[1], t), interpolar(desde[2], hasta[2], t), interpolar(desde[3], hasta[3], t));
    }
  }
  return colorPixel(255, 255, 255);
}

// Colores planos de la vista de grilla (uno por material)
const COLORES_VISTA_GRILLA = [
  colorPixel(12, 14, 20),   // aire
  colorPixel(120, 200, 255),// hielo
  colorPixel(110, 110, 115),// piedra
  colorPixel(30, 80, 255),  // agua (en la grilla = Euleriana)
  colorPixel(255, 120, 0),  // magma
  colorPixel(150, 90, 50)   // magma sólido
];

function pintarTerreno() {
  if (vista.temperatura) { pintarVistaTemperatura(); return; }
  if (vista.grilla) {
    for (let i = 0; i < TOTAL_CELDAS; i++) pixelesTerreno[i] = COLORES_VISTA_GRILLA[material[i]];
    return;
  }

  for (let y = 0; y < ALTO_GRILLA; y++) {
    for (let x = 0; x < ANCHO_GRILLA; x++) {
      const indice = y * ANCHO_GRILLA + x;
      const grados = temperatura[indice];
      const ruido = texturaRuido[indice] / 255 - 0.5;             // -0.5 .. 0.5
      const materialArriba = y > 0 ? material[indice - ANCHO_GRILLA] : PIEDRA;
      let rojo, verde, azul;

      switch (material[indice]) {
        case AIRE: {
          rojo = fondoRojo[indice]; verde = fondoVerde[indice]; azul = fondoAzul[indice];
          // El aire muy caliente (recién explotado) brilla anaranjado
          if (grados > 30) {
            const brillo = Math.min(1, (grados - 30) / 150);
            rojo += 110 * brillo; verde += 40 * brillo;
          }
          break;
        }
        case HIELO: {
          if (materialArriba === AIRE) {
            rojo = 222; verde = 244; azul = 255; // borde superior: escarcha clara
          } else {
            const profundo = y > 1 && material[indice - 2 * ANCHO_GRILLA] === HIELO ? 0.92 : 1;
            rojo = (160 + ruido * 34) * profundo;
            verde = (208 + ruido * 26) * profundo;
            azul = (238 + ruido * 14) * profundo;
          }
          // Hielo a punto de derretirse: se pone más cálido
          if (grados > -2) {
            const tibieza = Math.min(1, (grados + 2) / 2);
            rojo += 18 * tibieza; verde += 6 * tibieza;
          }
          break;
        }
        case PIEDRA: {
          const gris = 70 + ruido * 34;
          rojo = gris; verde = gris + 5; azul = gris + 16;
          break;
        }
        case AGUA: {
          // Cuántas celdas de agua hay arriba (hasta 5): más profunda = más oscura
          let profundidad = 0;
          for (let k = 1; k <= 5 && y - k >= 0; k++) {
            if (material[indice - k * ANCHO_GRILLA] === AGUA) profundidad++;
            else break;
          }
          if (profundidad === 0 && materialArriba === AIRE) {
            // Superficie: clara y con un brillo ondulante
            const onda = Math.sin(tiempoTotal * 3 + x * 0.45) * 12;
            rojo = 120 + onda; verde = 195 + onda; azul = 250;
          } else {
            // Agua semitransparente: 25% fondo + 75% azul
            const oscuridad = profundidad / 5;
            rojo = fondoRojo[indice] * 0.25 + (40 - 15 * oscuridad) * 0.75;
            verde = fondoVerde[indice] * 0.25 + (115 - 40 * oscuridad + ruido * 10) * 0.75;
            azul = fondoAzul[indice] * 0.25 + (215 - 40 * oscuridad) * 0.75;
          }
          break;
        }
        case MAGMA: {
          // Más caliente = más amarillo. El seno hace que "burbujee".
          const calor = limitar((grados - 600) / 400, 0, 1);
          const burbujeo = Math.sin(tiempoTotal * 6 + x * 0.7 + y * 0.5) * 20;
          rojo = 255;
          verde = 80 + calor * 140 + ruido * 40 + burbujeo;
          azul = 20 + calor * 60;
          break;
        }
        case MAGMA_SOLIDO: {
          // Roca marrón que brilla rojo mientras sigue caliente (y cura)
          const incandescencia = limitar((grados - PARAMETROS.temperaturaCuracion) / 450, 0, 1) * 0.85;
          rojo = 88 + ruido * 30; verde = 56 + ruido * 20; azul = 40 + ruido * 14;
          rojo += (235 - rojo) * incandescencia;
          verde += (95 - verde) * incandescencia;
          azul += (25 - azul) * incandescencia;
          break;
        }
      }
      pixelesTerreno[indice] = colorPixel(rojo, verde, azul);
    }
  }
}

function pintarVistaTemperatura() {
  for (let i = 0; i < TOTAL_CELDAS; i++) {
    const color = colorDeTemperatura(temperatura[i]);
    if (material[i] !== AIRE) { pixelesTerreno[i] = color; continue; }
    // El aire se oscurece al 35% para que se distingan las formas del terreno
    pixelesTerreno[i] = colorPixel(rojoDe(color) * 0.35, verdeDe(color) * 0.35, azulDe(color) * 0.35);
  }
}

/* ---------- Dibujo completo de un cuadro ---------- */

function dibujarCuadro() {
  const anchoPantalla = lienzo.width, altoPantalla = lienzo.height;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#05070c';
  ctx.fillRect(0, 0, anchoPantalla, altoPantalla);

  // Unidad del HUD: 1% del ancho de un área 16:9 que entra en la ventana
  const unidad = calcularUnidadHud(anchoPantalla, altoPantalla);

  // Escala del mundo: cuántos píxeles mide una celda. Se deja una franja
  // arriba para el HUD, así no tapa las reservas de agua del techo.
  const franjaHud = 9.8 * unidad;
  const pixelesPorCelda = Math.min(anchoPantalla / ANCHO_GRILLA, (altoPantalla - franjaHud) / ALTO_GRILLA);
  const margenX = (anchoPantalla - ANCHO_GRILLA * pixelesPorCelda) / 2;
  const margenY = franjaHud + (altoPantalla - franjaHud - ALTO_GRILLA * pixelesPorCelda) / 2;

  // Temblor de cámara: desplazamiento aleatorio que se achica con el tiempo
  const intensidadTemblor = juego.temblor * 1.2 * pixelesPorCelda;
  const temblorX = (Math.random() - 0.5) * intensidadTemblor;
  const temblorY = (Math.random() - 0.5) * intensidadTemblor;

  // Terreno
  pintarTerreno();
  ctxTerreno.putImageData(imagenTerreno, 0, 0);
  // A partir de acá se dibuja en unidades de CELDA
  ctx.setTransform(pixelesPorCelda, 0, 0, pixelesPorCelda, margenX + temblorX, margenY + temblorY);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(lienzoTerreno, 0, 0);

  if (vista.grilla) dibujarLineasDeGrilla(pixelesPorCelda);
  dibujarLuces();
  dibujarGotas();
  dibujarProyectil();
  dibujarJugadores();
  dibujarMira();
  dibujarEfectos();

  dibujarHud(anchoPantalla, altoPantalla, unidad);
}

function dibujarLineasDeGrilla(pixelesPorCelda) {
  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.lineWidth = 1 / pixelesPorCelda; // 1 píxel de pantalla
  ctx.beginPath();
  for (let x = 0; x <= ANCHO_GRILLA; x++) { ctx.moveTo(x, 0); ctx.lineTo(x, ALTO_GRILLA); }
  for (let y = 0; y <= ALTO_GRILLA; y++) { ctx.moveTo(0, y); ctx.lineTo(ANCHO_GRILLA, y); }
  ctx.stroke();
}

/* Círculo de luz con degradé que se desvanece hacia el borde. */
function dibujarHalo(x, y, radio, colorRGB, opacidad) {
  const degrade = ctx.createRadialGradient(x, y, 0, x, y, radio);
  degrade.addColorStop(0, `rgba(${colorRGB},${opacidad})`);
  degrade.addColorStop(1, `rgba(${colorRGB},0)`);
  ctx.fillStyle = degrade;
  ctx.fillRect(x - radio, y - radio, radio * 2, radio * 2);
}

/* Luces con mezcla aditiva ('lighter'): los colores se SUMAN al fondo, como la luz real. */
function dibujarLuces() {
  ctx.globalCompositeOperation = 'lighter';
  for (const jugador of jugadores) {
    if (!jugador.vivo) continue;
    const opacidad = 0.12 + 0.12 * (jugador.vida / VIDA_MAXIMA); // más vida, más luz
    dibujarHalo(jugador.centroX, jugador.centroY, 22, jugador.paleta.brillo.join(','), opacidad);
  }
  if (proyectil) {
    dibujarHalo(proyectil.x, proyectil.y, 10, proyectil.arma === ARMA_BOLA_DE_FUEGO ? '255,150,40' : '255,80,20', 0.55);
  }
  for (const efecto of efectos) {
    if (efecto.tipo !== EFECTO_DESTELLO) continue;
    const restante = 1 - efecto.edad / efecto.duracion;
    dibujarHalo(efecto.x, efecto.y, efecto.radio, efecto.color, 0.8 * restante);
  }
  ctx.globalCompositeOperation = 'source-over';
}

/* Gotas en caída libre. En la vista de grilla se pintan de magenta para
   distinguir el estado Lagrangiano (partícula) del Euleriano (celda azul). */
function dibujarGotas() {
  const tamanio = vista.grilla ? 1.4 : 1;
  ctx.fillStyle = vista.grilla ? '#ff2bd6' : 'rgba(150,210,255,0.92)';
  ctx.beginPath(); // todas las gotas en un solo trazo: mucho más rápido
  for (const gota of particulasAgua) ctx.rect(gota.x - tamanio / 2, gota.y - tamanio / 2, tamanio, tamanio);
  ctx.fill();
}

function dibujarProyectil() {
  if (!proyectil) return;
  if (proyectil.arma === ARMA_BOLA_DE_FUEGO) {
    ctx.fillStyle = '#fff3c4';
    ctx.beginPath(); ctx.arc(proyectil.x, proyectil.y, 1.1, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#ff8a1e'; ctx.lineWidth = 0.6; ctx.stroke();
  } else {
    ctx.fillStyle = '#ff5a14';
    ctx.beginPath(); ctx.arc(proyectil.x, proyectil.y, 1.3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#3a1608';
    ctx.beginPath(); ctx.arc(proyectil.x - 0.3, proyectil.y - 0.3, 0.5, 0, Math.PI * 2); ctx.fill();
  }
}

function dibujarJugadores() {
  for (const jugador of jugadores) {
    const pies = jugador.y + jugador.alto;
    if (jugador.vivo) {
      dibujarLlama(ctx, jugador.centroX, pies + 0.3, 0.82, jugador.paleta, jugador.vida / VIDA_MAXIMA,
                   tiempoTotal + jugador.numero * 3, jugador.mirando, jugador.tiempoHerido > 0);
      if (jugador.curandose) {
        // "+" verde que sube en loop
        ctx.fillStyle = 'rgba(120,255,140,0.9)';
        ctx.font = '3px sans-serif';
        ctx.fillText('+', jugador.centroX + 2.5, jugador.y - 1 - (tiempoTotal * 4 % 3));
      }
      // Flechita sobre el jugador del turno
      if (juego.pantalla === 'jugando' && jugador.numero === juego.jugadorActual && juego.fase !== 'asentando') {
        const yFlecha = jugador.y - 9 + Math.sin(tiempoTotal * 5) * 0.6;
        ctx.fillStyle = jugador.paleta.hud;
        ctx.beginPath();
        ctx.moveTo(jugador.centroX - 1.3, yFlecha);
        ctx.lineTo(jugador.centroX + 1.3, yFlecha);
        ctx.lineTo(jugador.centroX, yFlecha + 1.6);
        ctx.closePath();
        ctx.fill();
      }
    } else {
      dibujarFosforo(ctx, jugador.centroX, pies, 0.9, jugador.mirando);
    }
    if (vista.grilla) {
      ctx.strokeStyle = '#ffeb3b'; ctx.lineWidth = 0.25;
      ctx.strokeRect(jugador.x, jugador.y, jugador.ancho, jugador.alto); // hitbox
    }
  }
}

/* Mira: puntos en la dirección del ángulo, retícula a 17 celdas y barra de potencia. */
function dibujarMira() {
  if (juego.pantalla !== 'jugando' || juego.fase !== 'apuntar') return;
  const jugador = jugadores[juego.jugadorActual];
  if (!jugador.vivo) return;

  const anguloRadianes = jugador.angulo * Math.PI / 180;
  const direccionX = Math.cos(anguloRadianes) * jugador.mirando;
  const direccionY = -Math.sin(anguloRadianes);
  const origenX = jugador.centroX, origenY = jugador.centroY - 1;

  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  for (let d = 5; d <= 14; d += 2.2) {
    ctx.beginPath(); ctx.arc(origenX + direccionX * d, origenY + direccionY * d, 0.35, 0, Math.PI * 2); ctx.fill();
  }

  const reticulaX = origenX + direccionX * 17, reticulaY = origenY + direccionY * 17;
  ctx.strokeStyle = jugador.paleta.hud; ctx.lineWidth = 0.4;
  ctx.beginPath(); ctx.arc(reticulaX, reticulaY, 1.5, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(reticulaX - 2.4, reticulaY); ctx.lineTo(reticulaX - 0.8, reticulaY);
  ctx.moveTo(reticulaX + 0.8, reticulaY); ctx.lineTo(reticulaX + 2.4, reticulaY);
  ctx.moveTo(reticulaX, reticulaY - 2.4); ctx.lineTo(reticulaX, reticulaY - 0.8);
  ctx.moveTo(reticulaX, reticulaY + 0.8); ctx.lineTo(reticulaX, reticulaY + 2.4);
  ctx.stroke();

  if (juego.cargando) {
    const anchoBarra = 10, xBarra = jugador.centroX - anchoBarra / 2, yBarra = jugador.y - 5.5;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(xBarra, yBarra, anchoBarra, 1.4);
    const degrade = ctx.createLinearGradient(xBarra, 0, xBarra + anchoBarra, 0);
    degrade.addColorStop(0, '#ffe066');
    degrade.addColorStop(1, '#ff3b1f');
    ctx.fillStyle = degrade;
    ctx.fillRect(xBarra, yBarra, anchoBarra * juego.potencia, 1.4);
  }
}

function dibujarEfectos() {
  for (const efecto of efectos) {
    const restante = 1 - efecto.edad / efecto.duracion; // 1 recién creado, 0 al desaparecer
    if (efecto.tipo === EFECTO_VAPOR) {
      ctx.fillStyle = `rgba(235,242,255,${0.35 * restante})`;
      ctx.beginPath(); ctx.arc(efecto.x, efecto.y, efecto.radio, 0, Math.PI * 2); ctx.fill();
    } else if (efecto.tipo === EFECTO_CHISPA) {
      ctx.fillStyle = `rgba(${efecto.color},${restante})`;
      ctx.fillRect(efecto.x - 0.35, efecto.y - 0.35, 0.7, 0.7);
    } else if (efecto.tipo === EFECTO_HUMO) {
      ctx.fillStyle = `rgba(40,40,48,${0.5 * restante})`;
      ctx.beginPath(); ctx.arc(efecto.x, efecto.y, efecto.radio, 0, Math.PI * 2); ctx.fill();
    }
  }
}
