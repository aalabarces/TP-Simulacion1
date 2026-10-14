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
const ARMA_LENGUA = 2;     // no dispara: se agarra de una pared y balancea (ver más abajo)
const ARMA_MORTERO = 3;    // no dispara: lanza a la propia llama como un proyectil
const ARMA_JETPACK = 4;    // no dispara: empuja a la llama hacia donde apunta mientras haya combustible
const CANTIDAD_ARMAS = 5;

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
    // Lengua de fuego
    this.ancla = null;                  // { x, y, indice, tiempo, tiempoTotal, edad } mientras está agarrada
    this.largoCuerda = 0;               // celdas de cuerda: la llama no puede alejarse más del ancla
    this.recargaLengua = 0;             // segundos hasta poder lanzarla de nuevo
    this.cargarAnterior = false;        // para detectar el momento en que se APRIETA disparar
    // Mortero y jetpack
    this.lanzada = false;               // volando después de lanzarse con el mortero (hasta aterrizar)
    this.tiempoLanzada = 0;
    this.combustible = 1;               // tanque del jetpack: 0 a 1
    this.propulsando = false;           // el jetpack está empujando en este paso
    // Caídas
    this.aturdida = 0;                  // segundos sin control después de un golpe fuerte
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

/* Busca la primera fila (desde "filaInicial" hacia abajo) donde la llama apoyaría
   los pies. Se empieza unas filas sobre la plataforma (ver mapa.puntosDeAparicion):
   si no, aparecería metida en el hielo y el choque la empujaría hacia arriba. */
function buscarAlturaDeAparicion(x, ancho, alto, filaInicial) {
  for (let y = filaInicial; y < ALTO_GRILLA - 10; y++) {
    if (rectanguloTocaSolido(x, y, ancho, alto)) return y - 1;
  }
  return filaInicial;
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
  llama.ancla = null;
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
  let velocidadDeImpacto = 0; // si aterriza, a qué velocidad cayó (para el aturdimiento)

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
          velocidadDeImpacto = llama.velocidadY;
        }
        llama.velocidadY = 0;
        break;
      }
    }
  }

  // Está en el suelo si bajándola un poquito tocaría algo sólido
  llama.enSuelo = rectanguloTocaSolido(llama.x, llama.y + 0.05, llama.ancho, llama.alto);

  aturdirPorCaida(llama, velocidadDeImpacto);

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

/* ---------- Caídas ----------
   Si la llama aterriza a más de PARAMETROS.aturdimientoVelocidad celdas/s (un salto
   normal llega a ~32; caer 30 celdas, a ~77) queda aturdida: no responde a ningún
   control. Cuanto más fuerte el golpe, más tarda en recuperarse. Caer al agua no aturde. */
function aturdirPorCaida(llama, velocidadDeImpacto) {
  const umbral = PARAMETROS.aturdimientoVelocidad;
  if (!llama.vivo || PARAMETROS.aturdimientoMaximo <= 0) return;
  if (velocidadDeImpacto <= umbral || llama.fraccionMojada > FRACCION_SUMERGIDA_SIN_DANIO) return;
  const fuerza = limitar((velocidadDeImpacto - umbral) / Math.max(1, FISICA_LLAMA.velocidadCaidaMaxima - umbral), 0, 1);
  const duracion = Math.max(0.3, PARAMETROS.aturdimientoMaximo * fuerza);
  llama.aturdida = Math.max(llama.aturdida, duracion);
  llama.cargando = false;
  llama.potencia = 0;
  llama.velocidadX *= 0.3;
  crearHumo(llama.centroX, llama.y + llama.alto - 1, 4 + Math.round(fuerza * 6));
  crearChispas(llama.centroX, llama.y + llama.alto, 6, '255,220,150');
  sonarAturdimiento(fuerza);
}

/* ---------- Lengua de fuego ----------
   Un arma que no dispara: la llama lanza una lengua de fuego en la dirección de la
   mira (en línea recta, alcance PARAMETROS.lenguaLargoMaximo). Si toca hielo,
   piedra o roca volcánica se agarra y queda colgada como de una soga:
     - la cuerda tiene el largo que tenía al engancharse y no se estira, pero tampoco
       empuja: si la llama se acerca al ancla, la cuerda queda floja;
     - A / D balancean; arriba / abajo (los controles de apuntar) acortan y alargan
       la cuerda; saltar o apretar disparar suelta, conservando la velocidad.
   El ANCLA SE DERRITE: la lengua le suma calor al hielo y cuando se funde la llama se
   suelta. La roca y la piedra no se derriten: aguantan un tiempo fijo.
   Si no toca nada, falla y no gasta nada; se puede volver a lanzar enseguida. */

const LARGO_MINIMO_CUERDA = 6;
const VELOCIDAD_DE_CUERDA = 28; // celdas/s al acortar o alargar
const TIEMPO_MAXIMO_ANCLA_DE_HIELO = 8; // por si el hielo no llega a derretirse (el calor se escapa a los vecinos)

function materialAgarrable(tipo) {
  return tipo === HIELO || tipo === PIEDRA || tipo === MAGMA_SOLIDO; // el agua y el magma líquido no
}

/* Punto de la mano de la llama (de donde sale la lengua y donde se ata la cuerda). */
function manoDeLaLlama(llama) {
  return { x: llama.centroX, y: llama.y + 1.5 };
}

/* Sigue el rayo de la mira hasta el primer material agarrable. Devuelve
   { x, y, indice, distancia } si se agarra, o { falla: true, x, y } con el punto
   donde terminó el intento (para dibujarlo). */
function buscarAnclaDeLengua(llama) {
  const anguloRadianes = llama.angulo * Math.PI / 180;
  const direccionX = Math.cos(anguloRadianes) * llama.mirando;
  const direccionY = -Math.sin(anguloRadianes);
  const mano = manoDeLaLlama(llama);
  const alcance = PARAMETROS.lenguaLargoMaximo;
  let distanciaRecorrida = 0;
  for (let d = 2; d <= alcance; d += 0.4) {
    distanciaRecorrida = d;
    const x = mano.x + direccionX * d, y = mano.y + direccionY * d;
    const columna = Math.floor(x), fila = Math.floor(y);
    if (columna < 0 || columna >= ANCHO_GRILLA || fila < 0 || fila >= ALTO_GRILLA) break;
    const indice = fila * ANCHO_GRILLA + columna;
    if (materialAgarrable(material[indice])) return { x, y, indice, distancia: d };
  }
  return { falla: true, x: mano.x + direccionX * distanciaRecorrida, y: mano.y + direccionY * distanciaRecorrida };
}

/* Cuánto aguanta un ancla de este material (segundos). */
function tiempoDeAncla(tipo) {
  if (tipo === HIELO) return TIEMPO_MAXIMO_ANCLA_DE_HIELO;
  if (tipo === MAGMA_SOLIDO) return PARAMETROS.lenguaTiempoRoca;
  return PARAMETROS.lenguaTiempoPiedra;
}

function lanzarLengua(llama) {
  const resultado = buscarAnclaDeLengua(llama);
  if (resultado.falla) {
    // Falló: no pasa nada (ni se gasta nada), solo una chispa donde terminó el intento
    llama.recargaLengua = 0.25;
    crearChispas(resultado.x, resultado.y, 5, '255,160,60');
    sonarLenguaFalla();
    return false;
  }
  const mano = manoDeLaLlama(llama);
  const tiempo = tiempoDeAncla(material[resultado.indice]);
  llama.ancla = { x: resultado.x, y: resultado.y, indice: resultado.indice, tiempo, tiempoTotal: tiempo, edad: 0 };
  llama.largoCuerda = Math.max(LARGO_MINIMO_CUERDA, distancia(mano.x, mano.y, resultado.x, resultado.y));
  crearChispas(resultado.x, resultado.y, 14, '255,170,70');
  sonarEnganche();
  return true;
}

function soltarLengua(llama) {
  if (!llama.ancla) return;
  llama.ancla = null;
  llama.recargaLengua = esTiempoReal() ? PARAMETROS.lenguaRecargaTiempoReal : PARAMETROS.lenguaRecarga;
  sonarSoltarLengua();
}

/* Antes de mover: calienta el ancla, cambia el largo de la cuerda y, si está tensa,
   le quita a la llama la velocidad con la que se aleja del ancla (la soga tira). */
function tensarCuerda(llama, dt, controles) {
  const ancla = llama.ancla;
  const tipo = material[ancla.indice];
  ancla.edad += dt;
  ancla.tiempo -= dt;
  // El ancla desapareció (se derritió, la rompió una explosión, se congeló el agua...) o se acabó el tiempo
  if (!materialAgarrable(tipo) || ancla.tiempo <= 0) { soltarLengua(llama); return; }
  if (tipo === HIELO) temperatura[ancla.indice] += PARAMETROS.lenguaCalor * dt; // al pasar 0° se funde (temperatura.js)

  // Arriba acorta (trepar) y abajo alarga; solo con la lengua elegida (si no, esas teclas apuntan)
  if (controles && llama.arma === ARMA_LENGUA) {
    llama.largoCuerda = limitar(llama.largoCuerda - controles.apuntar * VELOCIDAD_DE_CUERDA * dt,
                                LARGO_MINIMO_CUERDA, PARAMETROS.lenguaLargoMaximo);
  }

  const mano = manoDeLaLlama(llama);
  const dx = mano.x - ancla.x, dy = mano.y - ancla.y;
  const distanciaAlAncla = Math.hypot(dx, dy);
  if (distanciaAlAncla >= llama.largoCuerda - 0.05 && distanciaAlAncla > 0.001) {
    const normalX = dx / distanciaAlAncla, normalY = dy / distanciaAlAncla; // del ancla hacia la llama
    const alejamiento = llama.velocidadX * normalX + llama.velocidadY * normalY;
    if (alejamiento > 0) {
      llama.velocidadX -= alejamiento * normalX;
      llama.velocidadY -= alejamiento * normalY;
    }
  }
}

/* Después de mover: si la llama quedó más lejos de lo que permite la cuerda, se la
   acerca al ancla (si hay una pared en el camino, solo lo que se pueda). */
function corregirPosicionPorCuerda(llama) {
  const ancla = llama.ancla;
  const mano = manoDeLaLlama(llama);
  const dx = mano.x - ancla.x, dy = mano.y - ancla.y;
  const distanciaAlAncla = Math.hypot(dx, dy);
  const exceso = distanciaAlAncla - llama.largoCuerda;
  if (exceso <= 0.01) return;
  const nuevaX = llama.x - dx / distanciaAlAncla * exceso, nuevaY = llama.y - dy / distanciaAlAncla * exceso;
  if (!rectanguloTocaSolido(nuevaX, nuevaY, llama.ancho, llama.alto)) { llama.x = nuevaX; llama.y = nuevaY; }
  else if (!rectanguloTocaSolido(nuevaX, llama.y, llama.ancho, llama.alto)) llama.x = nuevaX;
  else if (!rectanguloTocaSolido(llama.x, nuevaY, llama.ancho, llama.alto)) llama.y = nuevaY;
}

/* ---------- Mortero ----------
   Un arma que no dispara un proyectil: lanza a la propia llama. Se maneja como un
   disparo (mantener disparar carga la potencia, W/S giran el ángulo, soltar lanza)
   pero la llama sale volando en la dirección de la mira con una velocidad de hasta
   PARAMETROS.morteroVelocidad. Al despegar hay una explosión chica bajo los pies
   que rompe el suelo (sin lastimar ni empujar a la propia llama). No termina el
   turno ni tiene límite de usos: el costo es la caída (ver aturdirPorCaida). */
function lanzarseConMortero(llama) {
  const anguloRadianes = llama.angulo * Math.PI / 180;
  const direccionX = Math.cos(anguloRadianes) * llama.mirando;
  const direccionY = -Math.sin(anguloRadianes);
  const rapidez = PARAMETROS.morteroVelocidad * (POTENCIA_MINIMA + (1 - POTENCIA_MINIMA) * llama.potencia);

  soltarLengua(llama);
  explosionDeDespegue(llama);
  sonarMortero();
  llama.velocidadX = direccionX * rapidez;
  llama.velocidadY = direccionY * rapidez;
  llama.enSuelo = false;
  llama.lanzada = true;
  llama.tiempoLanzada = 0;
  llama.cargando = false;
  llama.potencia = 0;
  if (esTiempoReal()) llama.recarga = PARAMETROS.recargaDisparo;
}

/* ---------- Jetpack ----------
   Con el arma elegida, mantener disparar empuja a la llama hacia donde apunta
   (el empuje supera a la gravedad) mientras quede combustible. W/S giran el
   ángulo y A/D corrigen el rumbo. El tanque se llena al empezar cada turno (en
   tiempo real se recarga de a poco, apoyada en el suelo). El agua lo apaga. */
function aplicarEmpujeDeJetpack(llama, dt) {
  const anguloRadianes = llama.angulo * Math.PI / 180;
  const direccionX = Math.cos(anguloRadianes) * llama.mirando;
  const direccionY = -Math.sin(anguloRadianes);
  const rapidezAntes = Math.hypot(llama.velocidadX, llama.velocidadY);

  llama.velocidadX += direccionX * PARAMETROS.jetpackEmpuje * dt;
  llama.velocidadY += direccionY * PARAMETROS.jetpackEmpuje * dt;
  // El empuje no acelera más allá del tope (si ya iba más rápido, por un lanzamiento, no la frena)
  const rapidezDespues = Math.hypot(llama.velocidadX, llama.velocidadY);
  const tope = Math.max(PARAMETROS.jetpackVelocidadMaxima, rapidezAntes);
  if (rapidezDespues > tope) {
    llama.velocidadX *= tope / rapidezDespues;
    llama.velocidadY *= tope / rapidezDespues;
  }
  llama.combustible = Math.max(0, llama.combustible - PARAMETROS.jetpackConsumo * dt);
  // Llama de escape: sale hacia atrás, desde la espalda de la llama
  crearEscape(llama.centroX - direccionX * 3, llama.centroY - direccionY * 3, -direccionX, -direccionY);
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

  // Aturdida (por una caída fuerte): no responde a ningún control
  if (llama.aturdida > 0) {
    llama.aturdida = Math.max(0, llama.aturdida - dt);
    controles = null;
  }

  const fisica = FISICA_LLAMA;
  const enAgua = medirInmersion(llama).fraccion > FRACCION_SUMERGIDA_SIN_DANIO;
  const colgada = llama.ancla !== null;
  // Jetpack: empuja con el arma elegida, disparar apretado, combustible y sin estar mojada
  const empujando = llama.arma === ARMA_JETPACK && !!controles && controles.cargar && llama.combustible > 0 && !enAgua;
  llama.propulsando = empujando;
  // Lanzada por el mortero: vuela rápido hasta aterrizar o caer al agua
  if (llama.lanzada) {
    llama.tiempoLanzada += dt;
    if (enAgua || (llama.enSuelo && llama.tiempoLanzada > 0.15)) llama.lanzada = false;
  }
  const volandoRapido = colgada || llama.lanzada || empujando;

  // --- Movimiento horizontal ---
  // Con stick, "mover" puede ser intermedio: solo importa el sentido (el movimiento
  // es "tosco" a propósito, como pide el GDD)
  let direccion = 0;
  if (controles && controles.mover !== 0) {
    direccion = Math.sign(controles.mover);
    // Con el jetpack empujando, A/D corrigen el rumbo pero no dan vuelta la dirección del empuje
    if (!empujando) llama.mirando = direccion;
  }
  if (direccion !== 0) {
    // Colgada de la lengua se balancea con más fuerza (si no, no habría forma de tomar impulso)
    const aceleracion = colgada ? fisica.aceleracionColgada : llama.enSuelo ? fisica.aceleracionEnSuelo : fisica.aceleracionEnAire;
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
  // Colgada de la lengua el tope es mucho más alto: un péndulo largo llega a ~90 celdas/s
  const velocidadTope = enAgua ? fisica.velocidadMaximaEnAgua : fisica.velocidadMaxima;
  const topeAbsoluto = volandoRapido ? fisica.velocidadMaximaVuelo : velocidadTope * 1.6;
  llama.velocidadX = limitar(llama.velocidadX, -topeAbsoluto, topeAbsoluto);
  if (!volandoRapido && direccion !== 0 && Math.abs(llama.velocidadX) > velocidadTope) {
    const exceso = Math.abs(llama.velocidadX) - velocidadTope;
    llama.velocidadX -= Math.sign(llama.velocidadX) * Math.min(exceso, 80 * dt);
  }

  // --- Salto / nado ---
  llama.esperaSalto -= dt;
  if (controles && controles.saltar && llama.esperaSalto <= 0 && colgada) {
    soltarLengua(llama); // saltar estando colgada: suelta la lengua y sigue con la velocidad que llevaba
    llama.esperaSalto = 0.3;
  } else if (controles && controles.saltar && llama.esperaSalto <= 0) {
    if (llama.enSuelo) { llama.velocidadY = -fisica.velocidadSalto; llama.esperaSalto = 0.3; sonarSalto(); }
    else if (enAgua) { llama.velocidadY = -fisica.velocidadNado; llama.esperaSalto = 0.45; }
  }

  // --- Jetpack: empuje y combustible ---
  if (empujando) aplicarEmpujeDeJetpack(llama, dt);
  else if (llama.enSuelo && esTiempoReal()) {
    llama.combustible = Math.min(1, llama.combustible + PARAMETROS.jetpackRecargaTiempoReal * dt);
  }

  // --- Gravedad (en el agua pesa menos y hay mucho rozamiento) ---
  llama.velocidadY += PARAMETROS.gravedad * dt * (enAgua ? 0.45 : 1);
  if (enAgua) {
    llama.velocidadX = frenarExponencial(llama.velocidadX, 0.2, dt);
    llama.velocidadY = frenarExponencial(llama.velocidadY, 0.25, dt);
  }
  const caidaMaxima = volandoRapido ? fisica.velocidadMaximaVuelo : fisica.velocidadCaidaMaxima;
  llama.velocidadY = limitar(llama.velocidadY, volandoRapido ? -fisica.velocidadMaximaVuelo : -80, caidaMaxima);

  if (llama.ancla) tensarCuerda(llama, dt, controles);
  moverConColisiones(llama, dt);
  if (!llama.vivo) return;
  if (llama.ancla) corregirPosicionPorCuerda(llama);
  if (llama.lanzada && Math.random() < 0.8) crearEstela(llama.centroX, llama.centroY, '255,150,50'); // estela de fuego

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
