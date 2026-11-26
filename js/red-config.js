'use strict';
/* =============================================================================
   CONFIGURACIÓN DEL JUEGO ONLINE

   Cómo funciona (resumen; el detalle está en plans/multijugador-online.md):
   las dos PCs simulan TODO el juego y solo se mandan los controles. Firebase se usa
   únicamente para el "apretón de manos" (que las PCs se encuentren e intercambien
   cómo conectarse); después los controles viajan directo entre las PCs por WebRTC.

   Para usar Firebase hay que crear un proyecto gratis y pegar abajo su configuración:
   ver firebase/CONFIGURAR.md. Sin eso, el online solo funciona en modo de prueba
   local (abrir el juego con ?red=local en dos pestañas del mismo navegador).
   ============================================================================= */
const RED_CONFIG = {
  /* Pegar acá el objeto "firebaseConfig" de la consola de Firebase. No es secreto
     (va en cualquier web), pero conviene restringir la API key a tu dominio. */
  firebase: {
    apiKey: "AIzaSyBvPU_mb8I-aL3kVYE7MZRYWO_NsiA5yiw",
    authDomain: "tp-simulacion1.firebaseapp.com",
    databaseURL: "https://tp-simulacion1-default-rtdb.firebaseio.com",
    projectId: "tp-simulacion1",
    storageBucket: "tp-simulacion1.firebasestorage.app",
    messagingSenderId: "278631085234",
    appId: "1:278631085234:web:3bf4dcda3ed5ed18d145ab",
    measurementId: "G-SJ2GB0PYRB"
  },

  /* STUN: le dice a cada PC cuál es su dirección pública. Sirve para la mayoría de las
     redes. Si dos jugadores no logran conectarse (NAT estricto, algunas redes de
     celular o de oficina) hace falta un servidor TURN que retransmita: agregarlo acá, por
     ejemplo { urls: 'turn:servidor:3478', username: '...', credential: '...' }. */
  servidoresIce: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ],

  longitudCodigoDeSala: 6,
  /* Sin 0/O ni 1/I/L para que el código se pueda dictar sin confusiones (32 símbolos) */
  alfabetoCodigoDeSala: 'ABCDEFGHJKMNPQRSTUVWXYZ23456789',

  tiempoParaAbrirCanalesMs: 20000,   // desde que hay oferta y respuesta hasta que el canal abre
  tiempoDeEsperaDeCandidatosMs: 4000, // tope para juntar las direcciones de red antes de ofrecer
  tiempoDeEsperaDeInvitadoMs: 10 * 60 * 1000 // cuánto espera el anfitrión a que alguien se una
};

function firebaseConfigurado() {
  const c = RED_CONFIG.firebase;
  return !!(c.apiKey && c.databaseURL && c.projectId);
}

/* ¿Se pidió el modo de prueba local (?red=local)? Usa BroadcastChannel en vez de Firebase:
   sirve para probar con dos pestañas del mismo navegador, sin internet. */
function senalizacionLocalPedida() {
  try { return new URLSearchParams(location.search).get('red') === 'local'; }
  catch (e) { return false; }
}

/* Estado de la partida online (lo lee entrada.js para saber qué controles son locales). */
const redOnline = {
  lobbyAbierto: false,  // el panel de "Jugar online" está en pantalla (el juego ignora sus teclas)
  activa: false,        // hay una partida online en curso
  esAnfitrion: false,
  equipoLocal: 0,       // 0 = J1 (anfitrión), 1 = J2 (invitado)
  conexion: null,       // ConexionRed (red-conexion.js)
  sync: null            // SincronizacionRed (red-sincronizacion.js), existe mientras dura la partida
};
