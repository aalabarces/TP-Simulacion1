'use strict';
/* =============================================================================
   PROYECTILES Y EXPLOSIONES

   Tiro parabólico clásico de artillería:
     velocidad inicial = potencia * (cos(ángulo) * dirección, -sin(ángulo))
     (el eje Y apunta hacia ABAJO en pantalla, por eso el seno va negativo)
   En cada paso:
     velocidadY += gravedad * dt                         (cae)
     velocidadX += viento * vientoSobreProyectiles * dt  (lo desvía el viento;
                   con viento en contra puede frenarlo y hacerlo volver, ver configuracion.js)
   ============================================================================= */

/* Proyectiles en vuelo. En los modos por turnos hay como mucho uno; en Tiempo
   real cada jugador puede tener el suyo en el aire al mismo tiempo. */
let proyectiles = [];

const POTENCIA_MINIMA = 0.12; // aun sin cargar, el disparo sale con el 12% de la potencia

function disparar(tirador) {
  const anguloRadianes = tirador.angulo * Math.PI / 180;
  // Con potencia 0 sale al 12% y con potencia 1 al 100%
  const rapidez = PARAMETROS.potenciaMaxima * (POTENCIA_MINIMA + (1 - POTENCIA_MINIMA) * tirador.potencia);
  const direccionX = Math.cos(anguloRadianes) * tirador.mirando;
  const direccionY = -Math.sin(anguloRadianes);

  proyectiles.push({
    // Sale 3 celdas por delante del centro de la llama para no chocar consigo misma
    x: tirador.centroX + direccionX * 3,
    y: tirador.centroY - 1 + direccionY * 3,
    velocidadX: direccionX * rapidez,
    velocidadY: direccionY * rapidez,
    arma: tirador.arma,
    numeroTirador: tirador.numero,
    edad: 0
  });
  sonarDisparo(tirador.arma);
  tirador.cargando = false;
  tirador.potencia = 0;
  if (MODOS_DE_JUEGO[juego.modo].tiempoReal) {
    // Tiempo real: se mantiene el arma elegida; solo hay que esperar la recarga
    tirador.recarga = PARAMETROS.recargaDisparo;
  } else {
    // Por turnos: la próxima vez que juegue, la llama arranca con la Bola de Fuego
    // (el proyectil ya lanzado guarda su propia arma, no cambia)
    tirador.arma = ARMA_BOLA_DE_FUEGO;
    juego.fase = 'vuelo';
  }
}

function simularProyectiles(dt) {
  // Se recorre al revés para poder sacar de la lista los que explotan
  for (let n = proyectiles.length - 1; n >= 0; n--) {
    if (!simularProyectil(proyectiles[n], dt)) proyectiles.splice(n, 1);
  }
}

/* Mueve un proyectil. Devuelve false si explotó o salió del mundo. */
function simularProyectil(p, dt) {
  p.edad += dt;
  p.velocidadY += PARAMETROS.gravedad * dt;
  p.velocidadX += viento * PARAMETROS.vientoSobreProyectiles * dt;

  // Sub-pasos de media celda para no atravesar paredes finas
  const mayorVelocidad = Math.max(Math.abs(p.velocidadX), Math.abs(p.velocidadY));
  const cantidadSubpasos = Math.max(1, Math.ceil(mayorVelocidad * dt / 0.5));
  const avanceX = p.velocidadX * dt / cantidadSubpasos;
  const avanceY = p.velocidadY * dt / cantidadSubpasos;

  for (let s = 0; s < cantidadSubpasos; s++) {
    const nuevaX = p.x + avanceX, nuevaY = p.y + avanceY;

    // Salió del mundo: disparo perdido
    if (nuevaX < 0 || nuevaX >= ANCHO_GRILLA || nuevaY >= ALTO_GRILLA) {
      alTerminarElDisparo();
      return false;
    }
    // Choca con cualquier cosa que no sea aire (incluida el agua)
    if (nuevaY >= 0 && material[Math.floor(nuevaY) * ANCHO_GRILLA + Math.floor(nuevaX)] !== AIRE) {
      explotar(p, nuevaX, nuevaY);
      return false;
    }
    // Impacto directo contra una llama (la que disparó es inmune los primeros 0.25 s)
    for (const llama of llamas) {
      if (!llama.vivo) continue;
      if (llama.numero === p.numeroTirador && p.edad < 0.25) continue;
      const margen = 0.5;
      const loToca = nuevaX >= llama.x - margen && nuevaX <= llama.x + llama.ancho + margen
                  && nuevaY >= llama.y - margen && nuevaY <= llama.y + llama.alto + margen;
      if (loToca) { explotar(p, nuevaX, nuevaY); return false; }
    }
    p.x = nuevaX;
    p.y = nuevaY;
  }

  if (Math.random() < 0.8) crearEstela(p.x, p.y, p.arma === ARMA_BOLA_DE_FUEGO ? '255,170,60' : '255,90,20');
  return true;
}

function explotar(p, x, y) {
  if (p.arma === ARMA_BOLA_DE_FUEGO) {
    explotarBolaDeFuego(x, y);
  } else {
    // El charco de magma se corre 1.5 celdas hacia atrás de la trayectoria,
    // así queda apoyado SOBRE la superficie y no metido adentro.
    const rapidez = Math.hypot(p.velocidadX, p.velocidadY) || 1;
    explotarMagma(x - p.velocidadX / rapidez * 1.5, y - p.velocidadY / rapidez * 1.5);
  }
  alTerminarElDisparo();
}

/* Recorre todas las celdas dentro de un círculo y llama a la función con
   (indice, distanciaAlCentro, x, y). Se recorre el cuadrado que lo contiene
   y se descartan las celdas cuyo centro queda fuera del radio. */
function recorrerCirculo(centroX, centroY, radio, funcion) {
  for (let y = Math.floor(centroY - radio); y <= Math.ceil(centroY + radio); y++) {
    if (y < 0 || y >= ALTO_GRILLA) continue;
    for (let x = Math.floor(centroX - radio); x <= Math.ceil(centroX + radio); x++) {
      if (x < 0 || x >= ANCHO_GRILLA) continue;
      const distanciaAlCentro = distancia(x + 0.5, y + 0.5, centroX, centroY);
      if (distanciaAlCentro <= radio) funcion(y * ANCHO_GRILLA + x, distanciaAlCentro, x, y);
    }
  }
}

/* BOLA DE FUEGO
   - Núcleo (radioCrater): todo pasa a AIRE muy caliente (hielo, agua, magma y la
     piedra de las islas), salvo la piedra indestructible de los bordes del mapa.
   - Anillo (de radioCrater a radioAnilloCalor): recibe calor que disminuye
     linealmente hacia afuera. Con el calor por defecto, el hielo del borde
     interno se derrite en agua y el del borde externo solo se entibia. */
function explotarBolaDeFuego(x, y) {
  const radioCrater = PARAMETROS.radioCrater;
  const radioAnillo = Math.max(PARAMETROS.radioAnilloCalor, radioCrater + 1);

  recorrerCirculo(x, y, radioAnillo, (indice, distanciaAlCentro, celdaX, celdaY) => {
    const tipo = material[indice];
    if (distanciaAlCentro <= radioCrater) {
      // La piedra de los bordes del mapa es indestructible; la de las islas se rompe
      if (celdaIndestructible[indice]) { temperatura[indice] += 40; return; }
      if (tipo === AGUA && Math.random() < 0.4) crearVapor(celdaX + 0.5, celdaY + 0.5, 1);
      material[indice] = AIRE;
      masaAgua[indice] = 0;
      temperatura[indice] = 150;
    } else if (tipo !== AIRE) {
      // cercania: 1 en el borde del cráter, 0 en el borde exterior del anillo
      const cercania = 1 - (distanciaAlCentro - radioCrater) / (radioAnillo - radioCrater);
      // Siempre llega al menos un 10% del calor
      temperatura[indice] += PARAMETROS.calorAnillo * (0.1 + 0.9 * cercania);
    }
  });
  // El agua alrededor del cráter puede caer o correrse: despertar toda la zona (con 1 celda de margen)
  despertarZona(x - radioAnillo - 1, y - radioAnillo - 1, x + radioAnillo + 1, y + radioAnillo + 1);

  empujarLlamas(x, y, radioAnillo + 4);
  sonarExplosion();
  crearChispas(x, y, 50, '255,160,50');
  crearHumo(x, y, 8);
  crearDestello(x, y, radioAnillo * 1.6, 0.35, '255,150,50');
  juego.temblor = 0.35;
}

/* Onda expansiva: empuja a las llamas alejándolas del centro.
   La fuerza es máxima en el centro y baja linealmente hasta 0 en el radio.
   Además los levanta un poco (-15 en Y) para que "salten" con la explosión. */
function empujarLlamas(x, y, radio) {
  for (const llama of llamas) {
    const dx = llama.centroX - x, dy = llama.centroY - y;
    const distanciaAlCentro = Math.hypot(dx, dy);
    if (distanciaAlCentro >= radio || distanciaAlCentro < 0.01) continue;
    const intensidad = 1 - distanciaAlCentro / radio;
    // (dx, dy) / distancia = dirección unitaria desde la explosión hacia la llama
    llama.velocidadX += dx / distanciaAlCentro * 45 * intensidad;
    llama.velocidadY += dy / distanciaAlCentro * 45 * intensidad - 15 * intensidad;
  }
}

/* ESCUPIR MAGMA
   Crea un charco circular de magma:
     AIRE  -> MAGMA líquido a temperaturaMagma (salvo donde hay una llama)
     HIELO -> MAGMA (lo derrite al instante)
     AGUA  -> MAGMA SÓLIDO + vapor (choque térmico)
     PIEDRA y MAGMA SÓLIDO no cambian. */
function explotarMagma(x, y) {
  let celdasDeAguaEvaporadas = 0;
  recorrerCirculo(x, y, PARAMETROS.radioMagma, (indice) => {
    const tipo = material[indice];
    if (tipo === AIRE && !ocupadaPorLlama[indice]) {
      material[indice] = MAGMA;
      temperatura[indice] = PARAMETROS.temperaturaMagma;
    } else if (tipo === AGUA) {
      material[indice] = MAGMA_SOLIDO;
      masaAgua[indice] = 0;
      temperatura[indice] = 350;
      celdasDeAguaEvaporadas++;
    } else if (tipo === HIELO) {
      material[indice] = MAGMA;
      temperatura[indice] = PARAMETROS.temperaturaMagma * 0.85;
    }
  });
  const radio = PARAMETROS.radioMagma;
  despertarZona(x - radio - 1, y - radio - 1, x + radio + 1, y + radio + 1); // el magma nuevo tiene que fluir
  if (celdasDeAguaEvaporadas) crearVapor(x, y, Math.min(40, celdasDeAguaEvaporadas * 2));
  crearChispas(x, y, 25, '255,90,20');
  sonarImpactoMagma();
  crearDestello(x, y, PARAMETROS.radioMagma * 2.5, 0.3, '255,80,20');
  juego.temblor = 0.2;
}
