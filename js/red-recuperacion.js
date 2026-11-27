'use strict';
/* =============================================================================
   RECUPERACIÓN: qué pasa cuando algo sale mal (o cuando se quiere jugar de nuevo)

   - RESINCRONIZAR: si los hashes de las dos PCs difieren, el anfitrión manda una foto completa
     de la partida (red-estado.js) y el invitado la carga. Las dos arrancan una "época" nueva de
     sincronización (paso 0) desde esa foto. Si pasa más de 3 veces en un minuto, se rinde.
   - RECONECTAR: si se corta la conexión en plena partida, el anfitrión vuelve a abrir la MISMA
     sala en Firebase y el invitado reintenta con el mismo código; al conectar, el anfitrión manda la
     foto y se sigue donde estaban. Firebase solo se vuelve a usar en este caso. Hay 60 s de margen.
   - REVANCHA: al terminar, Enter en las dos PCs empieza otra partida con otra semilla.
   - SALIR: se avisa al otro con {salir}, así no intenta reconectar.
   ============================================================================= */

const recuperacion = {
  resincronizando: false,
  receptor: null,          // ReceptorDeEstado mientras llega una foto
  metaDeLaFoto: null,
  temporizador: null,      // si la foto no llega a tiempo
  intentos: [],            // instantes de las últimas resincronizaciones
  reconectando: null,      // { desde, hasta, cancelado } mientras se reintenta la conexión
  codigoDeSala: '',        // para reabrir la misma sala al reconectar
  revanchaPropia: false,
  revanchaRival: false,
  rivalSalio: false
};

const ESPERA_MAXIMA_DE_LA_FOTO_MS = 20000;
const MAXIMO_DE_RESINCRONIZACIONES_POR_MINUTO = 3;

function reiniciarEstadoDeRecuperacion() {
  clearTimeout(recuperacion.temporizador);
  Object.assign(recuperacion, { resincronizando: false, receptor: null, metaDeLaFoto: null, temporizador: null,
    revanchaPropia: false, revanchaRival: false, rivalSalio: false });
}

/* Nueva época de sincronización sobre la conexión actual (se usa al empezar una partida y tras una foto). */
function instalarSincronizacion(idDeEpoca) {
  const conexion = redOnline.conexion;
  const sync = redOnline.sync = new SincronizacionRed(conexion, redOnline.equipoLocal, idDeEpoca);
  sync.alDesincronizar = info => solicitarResincronizacion(`las partidas se separaron en el paso ${info.paso} (${info.primeraParteQueDifiere})`);
  conexion.alRecibirEntradas = buffer => sync.recibirPaquete(buffer);
  conexion.alRecibirBinario = manejarBinarioDeRecuperacion;
  tiempoAcumulado = 0; // principal.js
  return sync;
}

/* ---------- Resincronizar ---------- */

function solicitarResincronizacion(motivo) {
  if (!redOnline.activa || !redOnline.sync || recuperacion.resincronizando || recuperacion.reconectando) return;
  const ahora = performance.now();
  recuperacion.intentos = recuperacion.intentos.filter(t => ahora - t < 60000);
  if (recuperacion.intentos.length >= MAXIMO_DE_RESINCRONIZACIONES_POR_MINUTO) {
    alPerderLaConexion('Las partidas no logran mantenerse sincronizadas.', true);
    return;
  }
  recuperacion.intentos.push(ahora);
  console.warn('Resincronizando: ' + motivo);
  recuperacion.resincronizando = true;
  redOnline.sync.congelado = true; // se deja de simular hasta tener la misma foto en las dos
  if (redOnline.esAnfitrion) enviarEstadoAlInvitado(motivo);
  else {
    redOnline.conexion.enviarControl({ t: 'pedirEstado', id: redOnline.sync.idPartida });
    esperarLaFoto();
  }
}

/* El invitado no sigue esperando para siempre. */
function esperarLaFoto() {
  clearTimeout(recuperacion.temporizador);
  recuperacion.temporizador = setTimeout(() => {
    if (recuperacion.resincronizando) alPerderLaConexion('No llegó el estado de la partida.', true);
  }, ESPERA_MAXIMA_DE_LA_FOTO_MS);
}

function nuevoIdDeEpoca() {
  let id;
  do { id = 1 + Math.floor(Math.random() * 65534); } while (redOnline.sync && id === redOnline.sync.idPartida);
  return id;
}

/* Anfitrión: saca la foto (con la simulación congelada), la manda, y arranca la época nueva. */
async function enviarEstadoAlInvitado(motivo) {
  const conexion = redOnline.conexion;
  try {
    if (redOnline.sync) redOnline.sync.congelado = true;
    const crudo = capturarEstado();
    const { bytes, comprimido } = await comprimirBytes(crudo);
    if (redOnline.conexion !== conexion) return; // mientras comprimía se cortó la conexión: lo maneja la reconexión
    const id = nuevoIdDeEpoca();
    conexion.enviarControl({ t: 'estado', id, bytes: bytes.length, crudo: crudo.length, comprimido, motivo });
    for (const trozo of partirEnTrozos(id, bytes)) conexion.enviarBinarioConfiable(trozo);
    // El estado del anfitrión ya es el definitivo: arranca la época nueva (el invitado la arranca al cargar la foto)
    instalarSincronizacion(id);
    recuperacion.resincronizando = false;
    console.info(`Estado enviado: ${Math.round(bytes.length / 1024)} KB (${comprimido ? 'comprimido' : 'sin comprimir'} de ${Math.round(crudo.length / 1024)} KB)`);
  } catch (error) {
    console.error('No se pudo enviar el estado', error);
    alPerderLaConexion('No se pudo enviar el estado de la partida.', true);
  }
}

/* Invitado: llegan los trozos por el canal confiable. */
function manejarBinarioDeRecuperacion(buffer) {
  if (!recuperacion.receptor) return;
  let completo;
  try { completo = recuperacion.receptor.recibir(buffer); }
  catch (error) { alPerderLaConexion('La foto del estado llegó mal.', true); return; }
  if (completo) cargarLaFoto(completo, recuperacion.metaDeLaFoto);
}

async function cargarLaFoto(bytes, meta) {
  recuperacion.receptor = null;
  try {
    const crudo = await descomprimirBytes(bytes, meta.comprimido);
    if (crudo.length !== meta.crudo) throw new Error('tamaño distinto al esperado');
    aplicarEstado(crudo);
    instalarSincronizacion(meta.id);
    clearTimeout(recuperacion.temporizador);
    recuperacion.resincronizando = false;
    recuperacion.metaDeLaFoto = null;
    console.info('Estado cargado (' + meta.motivo + ')');
  } catch (error) {
    console.error('No se pudo cargar el estado', error);
    alPerderLaConexion('No se pudo cargar el estado de la partida.', true);
  }
}

/* ---------- Mensajes de control de la recuperación ---------- */
function manejarControlDeRecuperacion(mensaje) {
  switch (mensaje.t) {
    case 'pedirEstado': // invitado → anfitrión. Si el invitado sigue en la época que el anfitrión ya dejó, es un pedido viejo.
      if (redOnline.esAnfitrion && redOnline.sync && mensaje.id === redOnline.sync.idPartida && !recuperacion.resincronizando) {
        solicitarResincronizacion('lo pidió el invitado');
      }
      break;
    case 'estado': // anfitrión → invitado: anuncia la foto que viene en trozos
      if (redOnline.esAnfitrion || !redOnline.sync) break;
      if (!Number.isInteger(mensaje.id) || !Number.isInteger(mensaje.bytes) || mensaje.bytes <= 0 || mensaje.bytes > 64 * 1024 * 1024) break;
      recuperacion.metaDeLaFoto = mensaje;
      recuperacion.receptor = new ReceptorDeEstado(mensaje.id, mensaje.bytes);
      if (!recuperacion.resincronizando) { // el anfitrión la mandó por su cuenta: el invitado todavía no había notado nada
        recuperacion.resincronizando = true;
        redOnline.sync.congelado = true;
      }
      esperarLaFoto();
      break;
    case 'salir':
      recuperacion.rivalSalio = true;
      alPerderLaConexion('El otro jugador salió de la partida.');
      break;
    case 'revancha':
      recuperacion.revanchaRival = true;
      empezarRevanchaSiCorresponde();
      break;
  }
}

/* ---------- Revancha ---------- */
function pedirRevancha() {
  if (!redOnline.activa || juego.pantalla !== 'fin' || recuperacion.revanchaPropia) return;
  recuperacion.revanchaPropia = true;
  redOnline.conexion.enviarControl({ t: 'revancha' });
  empezarRevanchaSiCorresponde();
}

/* Cuando las dos PCs la pidieron, el anfitrión empieza otra partida (otra semilla, mismo modo). */
function empezarRevanchaSiCorresponde() {
  if (recuperacion.revanchaPropia && recuperacion.revanchaRival && redOnline.esAnfitrion && redOnline.conexion) {
    empezarPartidaComoAnfitrion(juego.modo);
  }
}

/* ---------- Reconectar ---------- */

/* Se perdió la conexión en plena partida: se intenta recuperarla. Devuelve false si no corresponde
   (el otro se fue a propósito, no hay partida, o ya se está reconectando). */
function intentarReconectar(detalle) {
  if (!redOnline.activa || recuperacion.rivalSalio || recuperacion.reconectando || !recuperacion.codigoDeSala) return false;
  const vieja = redOnline.conexion;
  if (vieja) {
    vieja.alCambiarEstado = vieja.alRecibirControl = vieja.alRecibirEntradas = vieja.alRecibirBinario = null;
    vieja.cerrar();
  }
  redOnline.conexion = null;
  if (redOnline.sync) redOnline.sync.congelado = true; // el mundo queda quieto hasta volver a tener la foto
  clearTimeout(recuperacion.temporizador);
  Object.assign(recuperacion, { resincronizando: false, receptor: null, metaDeLaFoto: null });
  const ahora = performance.now();
  const intento = recuperacion.reconectando = { desde: ahora, hasta: ahora + RED_CONFIG.tiempoDeReconexionMs, cancelado: false };
  console.warn('Conexión perdida (' + detalle + '). Reconectando…');
  reconectar(intento);
  return true;
}

const esperarMs = ms => new Promise(resolver => setTimeout(resolver, ms));

/* El anfitrión reabre la sala con el mismo código; el invitado la busca hasta que aparece. */
async function reconectar(intento) {
  const codigo = recuperacion.codigoDeSala;
  while (!intento.cancelado && performance.now() < intento.hasta) {
    const senalizacion = crearSenalizacion();
    const conexion = new ConexionRed(redOnline.esAnfitrion);
    try {
      if (redOnline.esAnfitrion) {
        await senalizacion.crearSala(codigo);
        await conexion.conectarComoAnfitrion(senalizacion, Math.max(1000, intento.hasta - performance.now()));
      } else {
        const oferta = await senalizacion.unirseASala(codigo, 4000);
        if (intento.cancelado) throw new Error('cancelado');
        await conexion.conectarComoInvitado(senalizacion, oferta);
      }
      if (intento.cancelado) { conexion.cerrar(); senalizacion.cerrar(); return; }
      senalizacion.cerrar();
      alReconectar(conexion);
      return;
    } catch (error) {
      conexion.alCambiarEstado = null;
      conexion.cerrar();
      senalizacion.cerrar();
      if (intento.cancelado) return;
      await esperarMs(1500);
    }
  }
  if (!intento.cancelado) {
    recuperacion.reconectando = null;
    alPerderLaConexion('No se pudo reconectar con el otro jugador.', true);
  }
}

function alReconectar(conexion) {
  recuperacion.reconectando = null;
  redOnline.conexion = conexion;
  conexion.alRecibirControl = manejarControlDelLobby;
  conexion.alRecibirBinario = manejarBinarioDeRecuperacion;
  conexion.alCambiarEstado = (estado, detalle) => { if (estado === 'cerrada' || estado === 'fallo') alPerderLaConexion(detalle); };
  // La partida se retoma desde la foto del anfitrión
  recuperacion.resincronizando = true;
  if (redOnline.esAnfitrion) enviarEstadoAlInvitado('reconexión');
  else esperarLaFoto();
}

/* Salir a propósito (o cerrar la página) mientras se reintentaba: se corta el reintento. */
function cancelarReconexion() {
  if (recuperacion.reconectando) recuperacion.reconectando.cancelado = true;
  recuperacion.reconectando = null;
}

/* Si se cierra la pestaña en plena partida, se avisa al otro (llegue o no): así no pierde 60 s intentando reconectar. */
window.addEventListener('pagehide', () => {
  const conexion = redOnline.conexion;
  if (conexion && conexion.estado === 'abierta') { try { conexion.enviarControl({ t: 'salir' }); } catch (e) { /* ya se cierra */ } }
});
