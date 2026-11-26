'use strict';
/* =============================================================================
   LOBBY ONLINE: crear una sala, unirse con un código, elegir el modo y empezar.

   Es un panel HTML (no se dibuja en el canvas) porque hay que escribir un código y el
   teclado del celular no funciona con el canvas. Se abre con el botón "Jugar online" de la
   pantalla de título o con la tecla O.

   Flujo:
     anfitrión: Crear sala → ve el código → el otro se une → conectados → elige el modo y
                "Empezar" → manda {inicio, semilla, modo} por el canal de control
     invitado:  escribe el código → conectados → recibe "inicio", arranca y responde "listo"
     Los dos arrancan la partida con la MISMA semilla y modo (ver iniciarPartidaOnline).
   ============================================================================= */

const lobby = {
  panel: null,          // elementos del DOM
  vista: 'cerrado',     // cerrado | inicio | esperando | conectando | conectados | error
  intento: 0,           // se incrementa al cancelar: las operaciones viejas se descartan
  senalizacion: null,
  conexion: null,       // conexión en curso (todavía no es la de la partida)
  codigo: '',
  temporizadorPing: null,
  inicioPendiente: null // { semilla, modo } mientras el anfitrión espera el "listo" del invitado
};

/* ---------- Interfaz ---------- */

const ESTILO_LOBBY = `
#lobby-fondo { position: fixed; inset: 0; z-index: 50; display: none; align-items: center; justify-content: center;
  background: rgba(8, 6, 14, 0.82); font-family: system-ui, sans-serif; color: #f1ece4; }
#lobby-fondo.visible { display: flex; }
#lobby { width: min(420px, 92vw); max-height: 92vh; overflow: auto; padding: 22px 24px; border-radius: 14px;
  background: #1d1826; border: 1px solid #4a3d63; box-shadow: 0 10px 40px rgba(0,0,0,.6); outline: none; }
#lobby h2 { margin: 0 0 4px; font-size: 22px; color: #ffd38a; }
#lobby p { margin: 8px 0; line-height: 1.4; font-size: 15px; }
#lobby .nota { color: #b8aecb; font-size: 13px; }
#lobby button { font: inherit; font-weight: 600; padding: 10px 16px; border-radius: 9px; border: 0; cursor: pointer;
  background: #e0561c; color: #fff; }
#lobby button.secundario { background: #3a3150; color: #e6dff3; }
#lobby button:disabled { opacity: .45; cursor: default; }
#lobby .fila { display: flex; gap: 8px; margin-top: 10px; }
#lobby .fila > * { flex: 1; }
#lobby input[type=text] { font: inherit; font-size: 20px; letter-spacing: .25em; text-align: center; text-transform: uppercase;
  padding: 9px; border-radius: 9px; border: 1px solid #5b4d7a; background: #120f1a; color: #fff; width: 100%; box-sizing: border-box; }
#lobby .codigo { font-size: 42px; font-weight: 800; letter-spacing: .22em; text-align: center; margin: 14px 0 6px;
  color: #fff; font-variant-numeric: tabular-nums; }
#lobby .error { color: #ff9b8a; }
#lobby label.modo { display: block; padding: 8px 10px; margin-top: 6px; border: 1px solid #4a3d63; border-radius: 9px; cursor: pointer; }
#lobby label.modo small { display: block; color: #b8aecb; }
#lobby hr { border: 0; border-top: 1px solid #3a3150; margin: 16px 0; }
#boton-online { position: fixed; top: 10px; right: 10px; z-index: 40; display: none; font: 600 14px system-ui, sans-serif;
  padding: 9px 14px; border-radius: 9px; border: 1px solid #ffd38a; background: rgba(29,24,38,.92); color: #ffd38a; cursor: pointer; }
`;

function crearInterfazDelLobby() {
  if (lobby.panel) return;
  const estilo = document.createElement('style');
  estilo.textContent = ESTILO_LOBBY;
  document.head.appendChild(estilo);

  const fondo = document.createElement('div');
  fondo.id = 'lobby-fondo';
  const panel = document.createElement('div');
  panel.id = 'lobby';
  panel.tabIndex = -1;
  fondo.appendChild(panel);
  document.body.appendChild(fondo);
  // Las teclas del panel (Enter, flechas, letras del código) no deben llegar al juego
  for (const tipo of ['keydown', 'keyup']) panel.addEventListener(tipo, e => e.stopPropagation());

  const boton = document.createElement('button');
  boton.id = 'boton-online';
  boton.textContent = 'Jugar online (O)';
  boton.addEventListener('click', abrirLobby);
  document.body.appendChild(boton);

  lobby.panel = { fondo, panel, boton };
  // El botón solo se ve en la pantalla de título
  setInterval(() => {
    const visible = juego.pantalla === 'titulo' && !redOnline.activa && lobby.vista === 'cerrado';
    boton.style.display = visible ? 'block' : 'none';
  }, 250);
}

function elemento(etiqueta, props = {}, hijos = []) {
  const e = document.createElement(etiqueta);
  const { texto, alClick, ...resto } = props;
  Object.assign(e, resto);
  if (texto !== undefined) e.textContent = texto;
  if (alClick) e.addEventListener('click', alClick);
  for (const h of hijos) e.appendChild(h);
  return e;
}

/* Dibuja una vista del panel. Los datos varían según la vista. */
function mostrarVista(vista, datos = {}) {
  crearInterfazDelLobby();
  lobby.vista = vista;
  redOnline.lobbyAbierto = vista !== 'cerrado';
  clearInterval(lobby.temporizadorPing);
  const { fondo, panel } = lobby.panel;
  fondo.classList.toggle('visible', vista !== 'cerrado');
  panel.replaceChildren();
  if (vista === 'cerrado') return;

  const titulo = elemento('h2', { texto: 'Jugar online' });
  panel.appendChild(titulo);

  if (vista === 'inicio') {
    const local = senalizacionLocalPedida();
    const enArchivo = location.protocol === 'file:';
    const disponible = !enArchivo && (local || firebaseConfigurado());
    panel.appendChild(elemento('p', { texto: 'Jugá contra otra persona en otra PC. Uno crea la sala y el otro se une con el código.' }));
    if (local) panel.appendChild(elemento('p', { className: 'nota', texto: 'Modo de prueba local: sirve entre dos pestañas de este mismo navegador.' }));
    if (enArchivo) panel.appendChild(elemento('p', { className: 'error', texto: 'El online necesita abrir el juego desde una dirección http(s) (por ejemplo python .claude/servidor.py 8123 y abrir http://localhost:8123), no con doble clic.' }));
    else if (!disponible) panel.appendChild(elemento('p', { className: 'error', texto: 'Falta configurar Firebase. Seguí los pasos de firebase/CONFIGURAR.md y pegá la configuración en js/red-config.js.' }));
    const crear = elemento('button', { texto: 'Crear sala', disabled: !disponible, alClick: crearSalaOnline });
    panel.appendChild(elemento('div', { className: 'fila' }, [crear]));
    panel.appendChild(elemento('hr'));
    const entrada = elemento('input', { type: 'text', maxLength: 12, placeholder: 'CÓDIGO', autocomplete: 'off', spellcheck: false, disabled: !disponible });
    const unirse = elemento('button', { texto: 'Unirse', disabled: !disponible, alClick: () => unirseASalaOnline(entrada.value) });
    entrada.addEventListener('keydown', e => { if (e.key === 'Enter') unirseASalaOnline(entrada.value); });
    panel.appendChild(entrada);
    panel.appendChild(elemento('div', { className: 'fila' }, [unirse]));
    panel.appendChild(elemento('div', { className: 'fila' }, [elemento('button', { className: 'secundario', texto: 'Cerrar', alClick: cerrarLobby })]));
    (disponible ? entrada : panel).focus();
  } else if (vista === 'esperando') {
    panel.appendChild(elemento('p', { texto: 'Sala creada. Pasale este código al otro jugador:' }));
    panel.appendChild(elemento('div', { className: 'codigo', texto: datos.codigo }));
    panel.appendChild(elemento('p', { className: 'nota', texto: 'Esperando que se una…' }));
    panel.appendChild(elemento('div', { className: 'fila' }, [elemento('button', { className: 'secundario', texto: 'Cancelar', alClick: cancelarYVolver })]));
    panel.focus();
  } else if (vista === 'conectando') {
    panel.appendChild(elemento('p', { texto: datos.mensaje || 'Conectando…' }));
    panel.appendChild(elemento('div', { className: 'fila' }, [elemento('button', { className: 'secundario', texto: 'Cancelar', alClick: cancelarYVolver })]));
    panel.focus();
  } else if (vista === 'conectados') {
    const ping = elemento('span', { texto: '…' });
    panel.appendChild(elemento('p', {}, [document.createTextNode('✔ Conectados. Ping: '), ping, document.createTextNode(' ms')]));
    const actualizarPing = () => { const r = redOnline.conexion && redOnline.conexion.rttMs; ping.textContent = r == null ? '…' : Math.round(r); };
    actualizarPing();
    lobby.temporizadorPing = setInterval(actualizarPing, 500);
    if (redOnline.esAnfitrion) {
      panel.appendChild(elemento('p', { texto: 'Elegí el modo de juego:' }));
      for (const clave of ORDEN_DE_MODOS) {
        const modo = MODOS_DE_JUEGO[clave];
        const radio = elemento('input', { type: 'radio', name: 'modo-online', value: clave, checked: clave === juego.modo });
        panel.appendChild(elemento('label', { className: 'modo' }, [radio, elemento('b', { texto: ' ' + modo.nombre }), elemento('small', { texto: modo.detalle })]));
      }
      const empezar = elemento('button', { texto: 'Empezar partida', alClick: () => {
        const elegido = panel.querySelector('input[name=modo-online]:checked');
        empezarPartidaComoAnfitrion(elegido ? elegido.value : juego.modo);
      } });
      panel.appendChild(elemento('div', { className: 'fila' }, [empezar]));
    } else {
      panel.appendChild(elemento('p', { texto: 'Esperando que el anfitrión elija el modo y empiece…' }));
    }
    panel.appendChild(elemento('div', { className: 'fila' }, [elemento('button', { className: 'secundario', texto: 'Salir', alClick: () => { salirDeLaSala(); mostrarVista('inicio'); } })]));
    panel.focus();
  } else if (vista === 'error') {
    panel.appendChild(elemento('p', { className: 'error', texto: datos.mensaje || 'Algo salió mal.' }));
    panel.appendChild(elemento('div', { className: 'fila' }, [elemento('button', { texto: 'Volver', alClick: () => mostrarVista('inicio') })]));
    panel.focus();
  }
}

function abrirLobby() {
  if (redOnline.activa || lobby.vista !== 'cerrado') return;
  mostrarVista('inicio');
}

function cerrarLobby() {
  mostrarVista('cerrado');
}

/* ---------- Conexión ---------- */

/* Deja de lado lo que hubiera en curso (sala a medio crear, conexión a medio abrir). */
function descartarIntento() {
  lobby.intento++;
  const { senalizacion, conexion } = lobby;
  lobby.senalizacion = lobby.conexion = null;
  if (conexion) { conexion.alCambiarEstado = null; conexion.cerrar(); }
  if (senalizacion) senalizacion.cerrar();
}

function cancelarYVolver() {
  descartarIntento();
  mostrarVista('inicio');
}

function fallarIntento(error) {
  descartarIntento();
  mostrarVista('error', { mensaje: error && error.message ? error.message : String(error) });
}

async function crearSalaOnline() {
  descartarIntento();
  const intento = lobby.intento;
  const senalizacion = lobby.senalizacion = crearSenalizacion();
  const conexion = lobby.conexion = new ConexionRed(true);
  mostrarVista('conectando', { mensaje: 'Creando la sala…' });
  conexion.alCambiarEstado = (estado, detalle) => {
    if (intento === lobby.intento && detalle === 'Conectando…') mostrarVista('conectando', { mensaje: 'Alguien se unió. Conectando…' });
  };
  try {
    lobby.codigo = await senalizacion.crearSala();
    if (intento !== lobby.intento) return;
    mostrarVista('esperando', { codigo: lobby.codigo });
    await conexion.conectarComoAnfitrion(senalizacion);
    if (intento !== lobby.intento) return;
    await alConectar(conexion, senalizacion, true);
  } catch (error) {
    if (intento === lobby.intento) fallarIntento(error);
  }
}

async function unirseASalaOnline(texto) {
  const codigo = normalizarCodigoDeSala(texto);
  if (codigo.length !== RED_CONFIG.longitudCodigoDeSala) {
    mostrarVista('error', { mensaje: 'El código tiene ' + RED_CONFIG.longitudCodigoDeSala + ' caracteres.' });
    return;
  }
  descartarIntento();
  const intento = lobby.intento;
  const senalizacion = lobby.senalizacion = crearSenalizacion();
  const conexion = lobby.conexion = new ConexionRed(false);
  mostrarVista('conectando', { mensaje: 'Buscando la sala ' + codigo + '…' });
  try {
    const oferta = await senalizacion.unirseASala(codigo);
    if (intento !== lobby.intento) return;
    mostrarVista('conectando', { mensaje: 'Sala encontrada. Conectando…' });
    await conexion.conectarComoInvitado(senalizacion, oferta);
    if (intento !== lobby.intento) return;
    await alConectar(conexion, senalizacion, false);
  } catch (error) {
    if (intento === lobby.intento) fallarIntento(error);
  }
}

/* Los canales abrieron: de acá en adelante Firebase no se usa más. */
async function alConectar(conexion, senalizacion, esAnfitrion) {
  lobby.senalizacion = lobby.conexion = null;
  senalizacion.cerrar(); // borra la sala y corta con Firebase (sin esperar)
  redOnline.conexion = conexion;
  redOnline.esAnfitrion = esAnfitrion;
  redOnline.equipoLocal = esAnfitrion ? 0 : 1;
  conexion.alRecibirControl = manejarControlDelLobby;
  conexion.alCambiarEstado = (estado, detalle) => {
    if (estado === 'cerrada' || estado === 'fallo') alPerderLaConexion(detalle);
  };
  mostrarVista('conectados');
}

function alPerderLaConexion(detalle) {
  const estabaJugando = redOnline.activa;
  salirDeLaSala();
  mostrarVista('error', { mensaje: (estabaJugando ? 'Se interrumpió la partida. ' : '') + (detalle || 'Se perdió la conexión.') });
}

/* ---------- Inicio de la partida ---------- */

function empezarPartidaComoAnfitrion(modo) {
  const semilla = Math.floor(Math.random() * 1e9);
  lobby.inicioPendiente = { semilla, modo };
  redOnline.conexion.enviarControl({ t: 'inicio', semilla, modo });
  // Si el "listo" del invitado no llegara, se arranca igual a los pocos segundos
  const conexion = redOnline.conexion;
  setTimeout(() => {
    if (lobby.inicioPendiente && redOnline.conexion === conexion) {
      const { semilla: s, modo: m } = lobby.inicioPendiente;
      lobby.inicioPendiente = null;
      iniciarPartidaOnline(s, m);
    }
  }, 4000);
}

function manejarControlDelLobby(mensaje) {
  if (mensaje.t === 'inicio' && !redOnline.esAnfitrion && MODOS_DE_JUEGO[mensaje.modo]) {
    iniciarPartidaOnline(mensaje.semilla | 0, mensaje.modo);
    redOnline.conexion.enviarControl({ t: 'listo' });
  } else if (mensaje.t === 'listo' && redOnline.esAnfitrion && lobby.inicioPendiente) {
    const { semilla, modo } = lobby.inicioPendiente;
    lobby.inicioPendiente = null;
    iniciarPartidaOnline(semilla, modo);
  }
}

/* Arranca la partida: las dos PCs, con la misma semilla y el mismo modo, desde un
   mundo recién generado y sin estado heredado (ver prepararMundo). */
function iniciarPartidaOnline(semilla, modo) {
  redOnline.activa = true;
  limpiarComandos();
  accionesPendientes.fill(0);
  armaElegidaPendiente.fill(-1);
  juego.modo = modo;
  empezarPartida(semilla);
  cerrarLobby();
}

/* Salir de la partida o de la sala: corta la conexión y vuelve al menú principal. */
function salirDeLaSala() {
  const conexion = redOnline.conexion;
  redOnline.conexion = null;
  redOnline.activa = false;
  lobby.inicioPendiente = null;
  if (conexion) { conexion.alCambiarEstado = null; conexion.alRecibirControl = null; conexion.cerrar(); }
  limpiarComandos();
  if (juego.pantalla !== 'titulo') volverAlMenuPrincipal();
}

// Arranque: crea el botón "Jugar online" y el panel (ocultos hasta que hagan falta)
crearInterfazDelLobby();
