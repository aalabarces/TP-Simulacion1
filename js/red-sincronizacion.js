'use strict';
/* =============================================================================
   SINCRONIZACIÓN (lockstep determinista con retraso de entrada)

   Las dos PCs simulan TODO el juego, paso a paso, y solo se mandan los controles. Para que
   den lo mismo, las dos tienen que ejecutar cada paso con los mismos comandos:

   - El comando que apretás en el paso t se ejecuta en el paso t + D (D = "retraso", 2 a 8
     pasos = 33 a 133 ms), en TU PC y en la del otro. Ese margen es el tiempo que tiene el
     comando para viajar por la red. D se ajusta solo según el ping.
   - Un paso solo se ejecuta cuando ya se tiene el comando del otro jugador para ese paso. Si
     todavía no llegó, la simulación espera (se ve "Esperando al otro jugador…"). Nunca se
     ejecuta "a ciegas": ni hace falta corregir ni se pueden separar las dos partidas.
   - Los paquetes van por el canal NO confiable, sin orden. Cada paquete trae TODOS los
     comandos que el otro todavía no confirmó (ack), así que un paquete perdido lo cubre el
     siguiente, sin esperar reenvíos. Ver red-conexion.js.
   - Cada 60 pasos las PCs comparan un hash del estado para detectar si se separaron.

   Paquete (big-endian):  [0] versión=1  [1] cantidad n  [2..3] id de partida  [4..7] primer paso
                          [8..11] ack  [12] retraso que pide el que envía,
                          luego n comandos de 4 bytes (mover i8, apuntar i8, banderas u8, arma u8)
   El retraso D es COMPARTIDO: cada PC dice cuál le hace falta y las dos usan el mayor. Hace falta
   porque si una PC se queda esperando, lo que la arregla es que la OTRA mande sus comandos con más
   anticipación; subir su propio D no ayudaría.
   "ack" = el primer paso del que el que envía todavía NO tiene comando del otro (confirma
   todos los anteriores). El id de partida (sale de la semilla) hace que los paquetes y hashes
   que quedaron en vuelo de una partida anterior se descarten en vez de mezclarse con la nueva.
   ============================================================================= */

const SYNC = {
  retrasoInicial: 4,        // pasos "vacíos" con los que arrancan las dos PCs (no hace falta mandarlos)
  retrasoMinimo: 2,
  retrasoMaximo: 8,
  ventanaMaxima: 64,        // comandos máximos por paquete
  tamanioDelAnillo: 256,    // pasos que se recuerdan (potencia de 2)
  adelantoMaximoAceptado: 120,
  pasosEntreHashes: 60,
  trozosDeGrilla: 8         // cada hash cubre 1/8 de la grilla; en 8 hashes se cubre toda
};
const MS_POR_PASO = 1000 * PASO_SIMULACION;
const MASCARA_ANILLO = SYNC.tamanioDelAnillo - 1;
const BYTES_POR_COMANDO = 4;
const BYTES_DE_CABECERA = 13;
const EVALUACIONES_SIN_BAJAR_TRAS_ESPERAS = 10; // tras subir el retraso por esperas, no se baja durante ~10 s

/* ---------- Comandos en bytes ----------
   mover y apuntar se cuantizan a 1/127 (un joystick puede dar valores intermedios). Lo que
   se aplica es SIEMPRE lo decodificado, también en la PC que lo generó: así los dos lados
   usan exactamente los mismos números. */
function empaquetarComando(comando, bytes, posicion) {
  const enteros = new Int8Array(bytes.buffer, bytes.byteOffset, bytes.length);
  enteros[posicion] = Math.round(limitar(comando.mover, -1, 1) * 127);
  enteros[posicion + 1] = Math.round(limitar(comando.apuntar, -1, 1) * 127);
  bytes[posicion + 2] = (comando.saltar ? 1 : 0) | (comando.cargar ? 2 : 0) | ((comando.acciones & 7) << 2);
  bytes[posicion + 3] = comando.elegirArma >= 0 ? comando.elegirArma + 1 : 0;
}

function desempaquetarComando(bytes, posicion, comando) {
  const enteros = new Int8Array(bytes.buffer, bytes.byteOffset, bytes.length);
  const banderas = bytes[posicion + 2];
  comando.mover = enteros[posicion] / 127;
  comando.apuntar = enteros[posicion + 1] / 127;
  comando.saltar = (banderas & 1) !== 0;
  comando.cargar = (banderas & 2) !== 0;
  comando.acciones = (banderas >> 2) & 7;
  comando.elegirArma = bytes[posicion + 3] === 0 ? -1 : bytes[posicion + 3] - 1;
}

/* ---------- Hash del estado (detectar si las dos PCs se separaron) ----------
   Solo campos que importan para el juego: las llamas tienen campos puramente visuales (el
   parpadeo al herirse, por ejemplo) que pueden diferir sin que nada esté mal. */
const CAMPOS_DE_LLAMA = ['x', 'y', 'velocidadX', 'velocidadY', 'enSuelo', 'vida', 'vivo', 'mirando', 'angulo', 'arma',
  'cargando', 'potencia', 'recarga', 'esperaSalto', 'fraccionMojada', 'largoCuerda', 'recargaLengua', 'enganchesSeguidos',
  'tiempoSinColgar', 'cargarAnterior', 'lanzada', 'tiempoLanzada', 'combustible', 'propulsando', 'tiempoBatazo',
  'aguaManguera', 'rociando', 'usoLaManguera', 'gotasPendientes', 'mangueraVaciada', 'aturdida'];
const CAMPOS_DE_GOTA = ['x', 'y', 'velocidadX', 'velocidadY', 'masa', 'grados', 'edad'];
const CAMPOS_DE_PROYECTIL = ['x', 'y', 'velocidadX', 'velocidadY', 'arma', 'numeroTirador', 'edad'];

const _hashDoble = new Float64Array(1);
const _hashPalabras = new Uint32Array(_hashDoble.buffer);

/* Partes del hash, en el orden en que se calculan. "acumulados" (opcional) recibe el hash corrido
   después de cada parte: si dos PCs se separan, la primera parte que difiere dice dónde empezó. */
const PARTES_DEL_HASH = ['llamas', 'proyectiles', 'gotas', 'escalares', 'material', 'masaAgua', 'temperatura', 'frioAcumulado'];

function hashDeEstadoDelJuego(trozo, acumulados) {
  let h = 0x811c9dc5;
  const cerrarParte = () => { if (acumulados) acumulados.push(h >>> 0); };
  const mezclar = v => { h = Math.imul(h ^ v, 16777619); h ^= h >>> 15; };
  const numero = v => {
    if (typeof v === 'boolean') { mezclar(v ? 1 : 2); return; }
    _hashDoble[0] = v; mezclar(_hashPalabras[0]); mezclar(_hashPalabras[1]);
  };
  const campos = (objeto, lista) => { for (const campo of lista) numero(objeto[campo]); };
  const trozoDe = arreglo => {
    const palabras = new Uint32Array(arreglo.buffer, arreglo.byteOffset, arreglo.byteLength >> 2);
    const desde = Math.floor(palabras.length * trozo / SYNC.trozosDeGrilla);
    const hasta = Math.floor(palabras.length * (trozo + 1) / SYNC.trozosDeGrilla);
    for (let i = desde; i < hasta; i++) mezclar(palabras[i]);
  };

  mezclar(llamas.length);
  for (const llama of llamas) {
    campos(llama, CAMPOS_DE_LLAMA);
    if (llama.ancla) { mezclar(1); numero(llama.ancla.x); numero(llama.ancla.y); numero(llama.ancla.indice); } else mezclar(0);
  }
  cerrarParte();
  mezclar(proyectiles.length);
  for (const proyectil of proyectiles) campos(proyectil, CAMPOS_DE_PROYECTIL);
  cerrarParte();
  mezclar(particulasAgua.length);
  for (const gota of particulasAgua) campos(gota, CAMPOS_DE_GOTA);
  cerrarParte();
  numero(estadoAzarSim()); numero(viento); numero(numeroDePaso);
  numero(juego.equipoActual); numero(juego.llamaActual); numero(juego.tiempoTurnoRestante);
  numero(juego.tiempoEnFase); numero(juego.tiempoHastaCambioDeViento); numero(juego.tiempoParaTerminar);
  for (const texto of [juego.fase, juego.pantalla]) for (let i = 0; i < texto.length; i++) mezclar(texto.charCodeAt(i));
  cerrarParte();
  for (const arreglo of [material, masaAgua, temperatura, frioAcumulado]) { trozoDe(arreglo); cerrarParte(); }
  return h >>> 0;
}

/* ---------- La sincronización ---------- */
class SincronizacionRed {
  constructor(conexion, equipoLocal, semilla) {
    this.conexion = conexion;
    this.idPartida = semilla & 0xFFFF; // distingue esta partida de una anterior (ver arriba)
    this.equipoLocal = equipoLocal;
    this.equipoRemoto = 1 - equipoLocal;

    // Comandos por equipo y por paso (anillo de 256 pasos, 4 bytes cada uno).
    // Los primeros pasos son comandos vacíos (ceros) en las dos PCs.
    this.anillos = [new Uint8Array(SYNC.tamanioDelAnillo * BYTES_POR_COMANDO), new Uint8Array(SYNC.tamanioDelAnillo * BYTES_POR_COMANDO)];
    this.marcaRemota = new Float64Array(SYNC.tamanioDelAnillo); // marcaRemota[t % 256] = t + 1 si llegó el comando del paso t

    this.tick = 0;                          // próximo paso a ejecutar
    this.retrasoDeseado = SYNC.retrasoInicial; // el que me hace falta a mí (según ping y esperas)
    this.retrasoRemoto = SYNC.retrasoInicial;  // el que pide el otro (viene en cada paquete)
    this.retraso = SYNC.retrasoInicial;        // D que se usa: el mayor de los dos
    this.proximoLocal = SYNC.retrasoInicial; // primer paso para el que todavía no hay comando mío
    this.proximoRemoto = SYNC.retrasoInicial; // primer paso para el que todavía no tengo el del otro
    this.ackRemoto = 0;                     // hasta qué paso el otro confirmó los míos
    this.accionesRetenidas = 0;             // acciones de un solo toque que no se pudieron programar todavía
    this.armaRetenida = -1;

    this.tickMaximo = Infinity;             // solo para pruebas: no pasar de este paso

    // Estadísticas y ajuste del retraso
    this.bloqueadoDesde = 0;                // instante en que empezó a esperar al otro (0 = no espera)
    this.bloqueosEnVentana = 0;
    this.evaluacionesConRetrasoAlto = 0;    // cuántas evaluaciones seguidas pidieron bajar el retraso
    this.evaluacionesSinBajar = 0;          // mientras sea > 0 no se baja (se subió hace poco por esperas)

    // Detección de desincronización
    this.hashesPropios = new Map();
    this.hashesRemotos = new Map();
    this.comparaciones = 0;
    this.coincidencias = 0;
    this.desincronizado = null;             // { paso, propio, remoto } si se separaron
    this.alDesincronizar = null;
  }

  /* ¿Se puede ejecutar el paso actual? Si sí, deja listos los comandos de los dos equipos. */
  prepararPaso() {
    const t = this.tick;
    if (t >= this.tickMaximo) return false;
    if (t >= this.proximoRemoto) {
      if (this.bloqueadoDesde === 0) this.bloqueadoDesde = performance.now();
      this.bloqueosEnVentana++;
      return false;
    }
    this.bloqueadoDesde = 0;

    // Mis controles de ahora se ejecutarán dentro de "retraso" pasos
    muestrearControlesLocales();
    this._programarLocal(t + this.retraso, comandosDelPaso[this.equipoLocal]);

    // Los comandos que se ejecutan EN ESTE paso (los dos equipos, mismos bytes en las dos PCs)
    for (let equipo = 0; equipo < 2; equipo++) {
      desempaquetarComando(this.anillos[equipo], (t & MASCARA_ANILLO) * BYTES_POR_COMANDO, comandosDelPaso[equipo]);
    }
    return true;
  }

  /* Programa mi comando para el paso "destino". Nunca se modifica un paso ya programado
     (el otro ya pudo haberlo recibido). */
  _programarLocal(destino, comando) {
    const anillo = this.anillos[this.equipoLocal];
    if (destino < this.proximoLocal) {
      // El retraso bajó: ese paso ya está programado. Las acciones de un solo toque no se pierden: esperan.
      this.accionesRetenidas |= comando.acciones;
      if (comando.elegirArma >= 0) this.armaRetenida = comando.elegirArma;
      return;
    }
    // Si el retraso subió quedan pasos sin programar: se rellenan repitiendo mis controles
    // continuos (sin acciones de un solo toque, que se ejecutarían varias veces)
    if (destino > this.proximoLocal) {
      const continuo = { mover: comando.mover, apuntar: comando.apuntar, saltar: comando.saltar, cargar: comando.cargar, acciones: 0, elegirArma: -1 };
      for (let t = this.proximoLocal; t < destino; t++) empaquetarComando(continuo, anillo, (t & MASCARA_ANILLO) * BYTES_POR_COMANDO);
    }
    const completo = {
      mover: comando.mover, apuntar: comando.apuntar, saltar: comando.saltar, cargar: comando.cargar,
      acciones: comando.acciones | this.accionesRetenidas,
      elegirArma: comando.elegirArma >= 0 ? comando.elegirArma : this.armaRetenida
    };
    this.accionesRetenidas = 0;
    this.armaRetenida = -1;
    empaquetarComando(completo, anillo, (destino & MASCARA_ANILLO) * BYTES_POR_COMANDO);
    this.proximoLocal = destino + 1;
  }

  alTerminarPaso() {
    const hecho = this.tick;
    this.tick++;
    if ((hecho + 1) % SYNC.pasosEntreHashes === 0) {
      this._compartirHash(hecho);
      this._ajustarRetraso();
    }
  }

  /* ---------- Red ---------- */

  /* Se llama una vez por cuadro: manda todos mis comandos que el otro todavía no confirmó. */
  enviarPaquete() {
    const desde = Math.max(this.ackRemoto, this.proximoLocal - SYNC.ventanaMaxima);
    const cantidad = this.proximoLocal - desde;
    const buffer = new ArrayBuffer(BYTES_DE_CABECERA + cantidad * BYTES_POR_COMANDO);
    const vista = new DataView(buffer);
    vista.setUint8(0, 1);
    vista.setUint8(1, cantidad);
    vista.setUint16(2, this.idPartida);
    vista.setUint32(4, desde);
    vista.setUint32(8, this.proximoRemoto);
    vista.setUint8(12, this.retrasoDeseado);
    const bytes = new Uint8Array(buffer, BYTES_DE_CABECERA);
    const anillo = this.anillos[this.equipoLocal];
    for (let i = 0; i < cantidad; i++) {
      const origen = ((desde + i) & MASCARA_ANILLO) * BYTES_POR_COMANDO;
      bytes.set(anillo.subarray(origen, origen + BYTES_POR_COMANDO), i * BYTES_POR_COMANDO);
    }
    this.conexion.enviarEntradas(buffer);
  }

  /* Llega un paquete del otro jugador. Lo que viene de la red se valida siempre. */
  recibirPaquete(buffer) {
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < BYTES_DE_CABECERA) return;
    const vista = new DataView(buffer);
    if (vista.getUint8(0) !== 1) return;
    const cantidad = vista.getUint8(1);
    if (cantidad > SYNC.ventanaMaxima || buffer.byteLength !== BYTES_DE_CABECERA + cantidad * BYTES_POR_COMANDO) return;
    if (vista.getUint16(2) !== this.idPartida) return; // de otra partida
    const primero = vista.getUint32(4);
    const ack = vista.getUint32(8);
    this.retrasoRemoto = limitar(vista.getUint8(12), SYNC.retrasoMinimo, SYNC.retrasoMaximo);
    this._recalcularRetraso();
    if (ack > this.ackRemoto && ack <= this.proximoLocal) this.ackRemoto = ack; // no puede confirmar lo que no programé

    const bytes = new Uint8Array(buffer, BYTES_DE_CABECERA);
    const anillo = this.anillos[this.equipoRemoto];
    for (let i = 0; i < cantidad; i++) {
      const paso = primero + i;
      if (paso < this.proximoRemoto || paso >= this.proximoRemoto + SYNC.adelantoMaximoAceptado) continue; // ya lo tengo / demasiado lejos
      const destino = (paso & MASCARA_ANILLO) * BYTES_POR_COMANDO;
      anillo.set(bytes.subarray(i * BYTES_POR_COMANDO, (i + 1) * BYTES_POR_COMANDO), destino);
      this.marcaRemota[paso & MASCARA_ANILLO] = paso + 1;
    }
    // El frente avanza mientras no falte ningún paso (un paquete perdido deja un hueco hasta el siguiente)
    while (this.marcaRemota[this.proximoRemoto & MASCARA_ANILLO] === this.proximoRemoto + 1) this.proximoRemoto++;
  }

  /* ---------- Retraso adaptativo ---------- */

  /* El D que se usa es el mayor de lo que pide cada PC. */
  _recalcularRetraso() {
    this.retraso = limitar(Math.max(this.retrasoDeseado, this.retrasoRemoto), SYNC.retrasoMinimo, SYNC.retrasoMaximo);
  }

  /* Cada PC pide un D que cubra lo que tarda un comando en llegar (ping/2), más 1 paso de margen.
     Sube enseguida si hace falta; baja de a uno y solo tras varios segundos estables. Se evalúa
     una vez por segundo. */
  _ajustarRetraso() {
    const rtt = this.conexion.rttMs;
    let objetivo = this.retrasoDeseado;
    if (rtt !== null) objetivo = limitar(Math.ceil((rtt / 2) / MS_POR_PASO) + 1, SYNC.retrasoMinimo, SYNC.retrasoMaximo);

    // Si igual hubo muchas esperas en el último segundo, el ping medido se queda corto (jitter, o la
    // otra PC manda tarde). Se pide un paso más de lo que se está usando, y no se baja por un rato
    // (si no, subiría y bajaría todo el tiempo). En los primeros 3 s no cuenta: es normal esperar
    // mientras la otra PC termina de arrancar.
    if (this.bloqueosEnVentana > 10 && this.tick > 180) {
      objetivo = Math.min(SYNC.retrasoMaximo, Math.max(objetivo, this.retraso + 1));
      this.evaluacionesSinBajar = EVALUACIONES_SIN_BAJAR_TRAS_ESPERAS;
    } else if (this.evaluacionesSinBajar > 0) this.evaluacionesSinBajar--;
    this.bloqueosEnVentana = 0;

    if (objetivo > this.retrasoDeseado) { this.retrasoDeseado = objetivo; this.evaluacionesConRetrasoAlto = 0; }
    else if (objetivo < this.retrasoDeseado && this.evaluacionesSinBajar === 0) {
      // Baja de a un paso tras varias evaluaciones seguidas: 2 si está muy por encima de lo
      // necesario (se recupera rápido después de un mal momento), 4 si está cerca (evita oscilar)
      const necesarias = this.retrasoDeseado - objetivo >= 3 ? 2 : 4;
      if (++this.evaluacionesConRetrasoAlto >= necesarias) { this.retrasoDeseado--; this.evaluacionesConRetrasoAlto = 0; }
    } else this.evaluacionesConRetrasoAlto = 0;
    this._recalcularRetraso();
  }

  /* ---------- Detección de desincronización ---------- */

  _compartirHash(paso) {
    const trozo = (paso / SYNC.pasosEntreHashes | 0) % SYNC.trozosDeGrilla;
    const acumulados = [];
    const hash = hashDeEstadoDelJuego(trozo, acumulados);
    this.hashesPropios.set(paso, { hash, acumulados });
    this.conexion.enviarControl({ t: 'hash', paso, h: hash, p: this.idPartida, c: acumulados });
    this._comparar(paso);
    this._limpiarHashesViejos();
  }

  recibirHash(mensaje) {
    if (!Number.isInteger(mensaje.paso) || !Number.isInteger(mensaje.h) || mensaje.p !== this.idPartida) return;
    const acumulados = Array.isArray(mensaje.c) ? mensaje.c.map(v => v >>> 0) : [];
    this.hashesRemotos.set(mensaje.paso, { hash: mensaje.h >>> 0, acumulados });
    this._comparar(mensaje.paso);
  }

  _comparar(paso) {
    if (!this.hashesPropios.has(paso) || !this.hashesRemotos.has(paso)) return;
    const propio = this.hashesPropios.get(paso), remoto = this.hashesRemotos.get(paso);
    this.hashesPropios.delete(paso);
    this.hashesRemotos.delete(paso);
    this.comparaciones++;
    if (propio.hash === remoto.hash) { this.coincidencias++; return; }
    if (!this.desincronizado) {
      // La primera parte que difiere dice dónde empezó la diferencia
      const indice = propio.acumulados.findIndex((v, i) => v !== remoto.acumulados[i]);
      const primeraParteQueDifiere = indice >= 0 ? PARTES_DEL_HASH[indice] : '?';
      this.desincronizado = { paso, propio: propio.hash, remoto: remoto.hash, primeraParteQueDifiere };
      console.error('Las dos partidas se separaron en el paso ' + paso + ' (primera parte que difiere: ' + primeraParteQueDifiere + ')', this.desincronizado);
      if (this.alDesincronizar) this.alDesincronizar(this.desincronizado);
    }
  }

  _limpiarHashesViejos() {
    for (const mapa of [this.hashesPropios, this.hashesRemotos]) {
      for (const paso of mapa.keys()) if (paso < this.tick - 20 * SYNC.pasosEntreHashes) mapa.delete(paso);
    }
  }

  /* Datos para mostrar en pantalla. */
  estado() {
    const espera = this.bloqueadoDesde === 0 ? 0 : performance.now() - this.bloqueadoDesde;
    return { pingMs: this.conexion.rttMs, retraso: this.retraso, esperandoMs: espera, desincronizado: this.desincronizado };
  }
}
