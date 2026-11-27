'use strict';
/* =============================================================================
   FOTO DEL ESTADO DE LA PARTIDA (para volver a sincronizar las dos PCs)

   Casi nunca hace falta: las dos PCs simulan lo mismo y solo se mandan los controles. Pero si
   los hashes dicen que se separaron, o si se cortó la conexión y se volvió a armar, el anfitrión
   manda una "foto" completa de la partida y el invitado la carga: desde ahí siguen iguales.

   Qué incluye: lo que cambia el resultado de la simulación (la grilla de material, temperatura,
   agua y frío; las llamas, proyectiles y gotas; el turno, el viento, el azar, la cascada y qué
   bloques están despiertos). No incluye lo visual (humo, chispas, cámara).

   Dos cuidados para que la foto sea EXACTA:
   - Los números se guardan sin perder nada: JSON pierde el signo del cero (-0) y no guarda
     NaN/Infinity, y el hash distingue -0 de 0 (ver textoExacto).
   - Los arreglos de trabajo (copias temporales de la grilla) no se mandan: se dejan en un valor
     conocido en LAS DOS PCs (normalizarEstadoOcultoDeLaSimulacion), incluida la que saca la foto.

   Tamaño: ~2,7 MB de grilla, que casi toda es la misma temperatura y aire, así que comprimida
   pesa poco. Se manda por el canal confiable en trozos de 16 KB.
   ============================================================================= */

const CAMPOS_DE_JUEGO_EN_LA_FOTO = ['pantalla', 'modo', 'fase', 'equipoActual', 'llamaActual', 'tiempoTurnoRestante',
  'tiempoEnFase', 'tiempoHastaCambioDeViento', 'tiempoParaTerminar', 'temblor', 'textoGanador', 'detalleFin'];
const TAMANIO_DE_TROZO = 16000;
const TIPO_DE_TROZO_DE_ESTADO = 2;

/* ---------- Números exactos en JSON ---------- */
function textoExacto(valor) {
  return JSON.stringify(valor, (clave, v) => {
    if (typeof v !== 'number') return v;
    if (Object.is(v, -0)) return '__-0';
    if (Number.isNaN(v)) return '__NaN';
    if (v === Infinity) return '__Inf';
    if (v === -Infinity) return '__-Inf';
    return v;
  });
}

function desdeTextoExacto(texto) {
  return JSON.parse(texto, (clave, v) => {
    if (v === '__-0') return -0;
    if (v === '__NaN') return NaN;
    if (v === '__Inf') return Infinity;
    if (v === '__-Inf') return -Infinity;
    return v;
  });
}

/* Deja los arreglos de trabajo en un valor conocido. Se llama en la PC que saca la foto y en la
   que la carga: así las dos arrancan de lo mismo. Todo esto se vuelve a calcular en cada paso, o
   no se lee antes de escribirse; si algo de eso no fuera cierto, el siguiente hash lo mostraría. */
function normalizarEstadoOcultoDeLaSimulacion() {
  temperaturaNueva.set(temperatura);
  masaAguaNueva.fill(0);
  pasoEnQueSeMovio.fill(0);
  ocupadaPorLlama.fill(0);
  llamaEnCelda.fill(-1);
}

/* ---------- Sacar la foto ---------- */
function capturarEstado() {
  normalizarEstadoOcultoDeLaSimulacion();
  const juegoCopia = {};
  for (const campo of CAMPOS_DE_JUEGO_EN_LA_FOTO) juegoCopia[campo] = juego[campo];
  juegoCopia.ultimaLlamaDeCadaEquipo = [...juego.ultimaLlamaDeCadaEquipo];
  juegoCopia.llamaBateada = juego.llamaBateada ? juego.llamaBateada.numero : -1; // referencia → número de llama
  juegoCopia.cartel = juego.cartel ? { ...juego.cartel } : null;

  const meta = {
    semilla: mapa.semilla,
    llamas: llamas.map(llama => { const copia = {}; for (const k of Object.keys(llama)) if (k !== 'paleta') copia[k] = llama[k]; return copia; }),
    proyectiles, particulasAgua,
    juego: juegoCopia,
    viento, azar: estadoAzarSim(), numeroDePaso,
    cascada: { ...cascada },
    bloqueDespierto: Array.from(bloqueDespierto), bloqueDespiertoProximo: Array.from(bloqueDespiertoProximo)
  };
  const json = new TextEncoder().encode(textoExacto(meta));
  const N = TOTAL_CELDAS;
  const bytes = new Uint8Array(4 + json.length + N + 3 * 4 * N);
  new DataView(bytes.buffer).setUint32(0, json.length);
  bytes.set(json, 4);
  let desde = 4 + json.length;
  bytes.set(material, desde); desde += N;
  for (const arreglo of [temperatura, masaAgua, frioAcumulado]) {
    bytes.set(new Uint8Array(arreglo.buffer, arreglo.byteOffset, 4 * N), desde); desde += 4 * N;
  }
  return bytes;
}

/* ---------- Cargar la foto ---------- */
function aplicarEstado(bytes) {
  const N = TOTAL_CELDAS;
  const vista = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const largoJson = vista.getUint32(0);
  if (4 + largoJson + N + 3 * 4 * N !== bytes.length) throw new Error('La foto del estado está incompleta');
  const meta = desdeTextoExacto(new TextDecoder().decode(bytes.subarray(4, 4 + largoJson)));
  if (meta.semilla !== mapa.semilla) throw new Error('La foto es de otra partida');

  // Grilla
  let desde = 4 + largoJson;
  material.set(bytes.subarray(desde, desde + N)); desde += N;
  for (const arreglo of [temperatura, masaAgua, frioAcumulado]) {
    new Uint8Array(arreglo.buffer, arreglo.byteOffset, 4 * N).set(bytes.subarray(desde, desde + 4 * N)); desde += 4 * N;
  }
  normalizarEstadoOcultoDeLaSimulacion();
  bloqueDespierto.set(meta.bloqueDespierto);
  bloqueDespiertoProximo.set(meta.bloqueDespiertoProximo);
  numeroDePaso = meta.numeroDePaso;
  Object.assign(cascada, meta.cascada);

  // Entidades (las llamas se rehacen con su constructor: la paleta es una referencia, no un dato)
  llamas = meta.llamas.map(datos => {
    const llama = new Llama(datos.numero, datos.equipo, datos.x, datos.y);
    return Object.assign(llama, datos);
  });
  proyectiles = meta.proyectiles;
  particulasAgua = meta.particulasAgua;
  efectos = []; // solo visual

  // La partida
  for (const campo of CAMPOS_DE_JUEGO_EN_LA_FOTO) juego[campo] = meta.juego[campo];
  juego.ultimaLlamaDeCadaEquipo = [...meta.juego.ultimaLlamaDeCadaEquipo];
  juego.llamaBateada = meta.juego.llamaBateada >= 0 ? llamas[meta.juego.llamaBateada] : null;
  juego.cartel = meta.juego.cartel;
  juego.pausado = false;
  viento = meta.viento;
  iniciarAzarSim(meta.azar);

  limpiarComandos();
  accionesPendientes.fill(0);
  armaElegidaPendiente.fill(-1);
  recentrarCamara();
  camara.foco = null;
}

/* ---------- Comprimir y partir en trozos ---------- */
async function comprimirBytes(bytes) {
  if (typeof CompressionStream === 'undefined') return { bytes, comprimido: false }; // navegador viejo: se manda sin comprimir
  const flujo = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
  return { bytes: new Uint8Array(await new Response(flujo).arrayBuffer()), comprimido: true };
}

async function descomprimirBytes(bytes, comprimido) {
  if (!comprimido) return bytes;
  const flujo = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(flujo).arrayBuffer());
}

/* Trozos: [0] tipo=2  [1..2] id de la foto  [3..4] número de trozo  [5..6] total  luego los datos. */
function partirEnTrozos(id, bytes) {
  const total = Math.max(1, Math.ceil(bytes.length / TAMANIO_DE_TROZO));
  const trozos = [];
  for (let i = 0; i < total; i++) {
    const datos = bytes.subarray(i * TAMANIO_DE_TROZO, (i + 1) * TAMANIO_DE_TROZO);
    const buffer = new ArrayBuffer(7 + datos.length);
    const vista = new DataView(buffer);
    vista.setUint8(0, TIPO_DE_TROZO_DE_ESTADO);
    vista.setUint16(1, id);
    vista.setUint16(3, i);
    vista.setUint16(5, total);
    new Uint8Array(buffer, 7).set(datos);
    trozos.push(buffer);
  }
  return trozos;
}

/* Junta los trozos de una foto. Lo que llega de la red se valida. */
class ReceptorDeEstado {
  constructor(id, bytesEsperados) {
    this.id = id;
    this.bytesEsperados = bytesEsperados;
    this.partes = null;
    this.recibidas = 0;
  }

  /* Devuelve los bytes completos cuando llegó el último trozo, o null si faltan. */
  recibir(buffer) {
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 7) return null;
    const vista = new DataView(buffer);
    if (vista.getUint8(0) !== TIPO_DE_TROZO_DE_ESTADO || vista.getUint16(1) !== this.id) return null;
    const numero = vista.getUint16(3), total = vista.getUint16(5);
    if (total === 0 || numero >= total) return null;
    if (!this.partes) this.partes = new Array(total).fill(null);
    if (total !== this.partes.length || this.partes[numero]) return null;
    this.partes[numero] = new Uint8Array(buffer, 7);
    if (++this.recibidas < total) return null;
    const completo = new Uint8Array(this.partes.reduce((suma, p) => suma + p.length, 0));
    let desde = 0;
    for (const parte of this.partes) { completo.set(parte, desde); desde += parte.length; }
    if (completo.length !== this.bytesEsperados) throw new Error('La foto del estado llegó con otro tamaño');
    return completo;
  }
}
