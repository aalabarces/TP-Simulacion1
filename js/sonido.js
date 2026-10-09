'use strict';
/* =============================================================================
   SONIDO (Web Audio API)

   Todos los sonidos se SINTETIZAN en el momento: no hay archivos de audio.
   Se arman con dos ingredientes:
     - Osciladores (ondas seno, triangular, etc.) para tonos: el "blorp" del
       magma, el tono de carga, las notas de cambio de turno.
     - Ruido blanco filtrado para lo que no tiene tono: explosiones (ruido grave),
       vapor (ruido agudo), viento y cascadas (ruido continuo).
   A cada sonido se le da forma con una ENVOLVENTE: el volumen sube rápido
   (ataque) y después cae de forma exponencial (caída), como un golpe real.

   Los navegadores no dejan reproducir audio hasta que el usuario toca una tecla:
   el audio se inicia con la primera tecla (ver entrada.js). N silencia/activa.
   ============================================================================= */

const sonido = {
  contexto: null,          // AudioContext: el "motor" de audio del navegador
  salida: null,            // volumen general (todo pasa por acá)
  salidaAmbiente: null,    // volumen del fondo (cascadas y viento), antes del general
  ruido: null,             // 2 segundos de ruido blanco reutilizable
  silenciado: false,
  cargas: new Map(),       // tono continuo de cada llama mientras carga el disparo
  cascada: null,           // ambiente de las cascadas
  viento: null,            // ambiente del viento
  vaporPendiente: 0,       // vapor acumulado en este cuadro (se suena todo junto)
  chapoteosPendientes: 0,  // gotas que cayeron en este cuadro
  ultimoVapor: 0,
  ultimoChapoteo: 0
};

/* ---------- Puesta en marcha ---------- */

function iniciarAudio() {
  if (!sonido.contexto) {
    const ContextoDeAudio = window.AudioContext || window.webkitAudioContext;
    if (!ContextoDeAudio) return; // navegador sin Web Audio: el juego sigue sin sonido
    sonido.contexto = new ContextoDeAudio();
    sonido.salida = sonido.contexto.createGain();
    sonido.salida.gain.value = PARAMETROS.volumen;
    sonido.salida.connect(sonido.contexto.destination);
    sonido.ruido = crearRuidoBlanco(2);
    crearAmbientes();
  }
  if (sonido.contexto.state === 'suspended') sonido.contexto.resume();
}

function audioListo() {
  return sonido.contexto !== null && sonido.contexto.state === 'running';
}

function alternarSilencio() {
  sonido.silenciado = !sonido.silenciado;
  mostrarCartel(sonido.silenciado ? '🔇 Sonido apagado' : '🔊 Sonido encendido', '#cfe0f5');
}

/* Ruido blanco: muestras al azar entre -1 y 1 (todas las frecuencias por igual). */
function crearRuidoBlanco(segundos) {
  const contexto = sonido.contexto;
  const buffer = contexto.createBuffer(1, Math.floor(contexto.sampleRate * segundos), contexto.sampleRate);
  const muestras = buffer.getChannelData(0);
  for (let i = 0; i < muestras.length; i++) muestras[i] = Math.random() * 2 - 1;
  return buffer;
}

/* ---------- Piezas para armar sonidos ---------- */

/* Envolvente de volumen conectada a la salida: arranca en silencio, sube hasta
   "nivel" en "ataque" segundos y cae hasta casi 0 en "caida" segundos.
   Se usan rampas EXPONENCIALES porque el oído percibe el volumen en escala
   logarítmica: una caída exponencial suena pareja y natural. */
function envolvente(inicio, nivel, ataque, caida) {
  const ganancia = sonido.contexto.createGain();
  ganancia.gain.setValueAtTime(0.0001, inicio); // las rampas exponenciales no aceptan 0
  ganancia.gain.exponentialRampToValueAtTime(Math.max(0.0001, nivel), inicio + ataque);
  ganancia.gain.exponentialRampToValueAtTime(0.0001, inicio + ataque + caida);
  ganancia.connect(sonido.salida);
  return ganancia;
}

function crearFiltro(tipo, frecuencia, resonancia = 1) {
  const filtro = sonido.contexto.createBiquadFilter();
  filtro.type = tipo;              // 'lowpass' deja pasar graves, 'highpass' agudos, 'bandpass' una franja
  filtro.frequency.value = frecuencia;
  filtro.Q.value = resonancia;
  return filtro;
}

/* Ruido blanco que suena desde "inicio" durante "duracion" (o sin fin si es ambiente). */
function fuenteDeRuido(inicio, duracion) {
  const fuente = sonido.contexto.createBufferSource();
  fuente.buffer = sonido.ruido;
  fuente.loop = true;
  fuente.start(inicio, Math.random() * 1.5); // arranca en un punto al azar: cada golpe suena distinto
  if (duracion !== undefined) fuente.stop(inicio + duracion);
  return fuente;
}

/* Tono cuya frecuencia va de "desde" a "hasta" (Hz) en "duracion" segundos. */
function tono(tipo, desde, hasta, inicio, duracion) {
  const oscilador = sonido.contexto.createOscillator();
  oscilador.type = tipo;
  oscilador.frequency.setValueAtTime(desde, inicio);
  if (hasta !== desde) oscilador.frequency.exponentialRampToValueAtTime(hasta, inicio + duracion);
  oscilador.start(inicio);
  oscilador.stop(inicio + duracion + 0.05);
  return oscilador;
}

/* ---------- Sonidos de un solo golpe ---------- */

function sonarDisparo(arma) {
  if (!audioListo()) return;
  const t = sonido.contexto.currentTime;
  if (arma === ARMA_BOLA_DE_FUEGO) {
    // "Fuuush": ruido con un filtro que barre de agudo a grave + un tono que baja
    const filtro = crearFiltro('bandpass', 2200, 1.2);
    filtro.frequency.exponentialRampToValueAtTime(400, t + 0.3);
    fuenteDeRuido(t, 0.4).connect(filtro).connect(envolvente(t, 0.35, 0.01, 0.35));
    tono('sine', 240, 110, t, 0.25).connect(envolvente(t, 0.15, 0.005, 0.25));
  } else {
    // "Blorp" espeso del magma: un tono grave que cae, con un poco de ruido sordo
    tono('sine', 170, 55, t, 0.35).connect(envolvente(t, 0.4, 0.01, 0.35));
    fuenteDeRuido(t, 0.3).connect(crearFiltro('lowpass', 600)).connect(envolvente(t, 0.12, 0.01, 0.25));
  }
}

function sonarExplosion() {
  if (!audioListo()) return;
  const t = sonido.contexto.currentTime;
  // Estruendo: ruido grave cuyo filtro se va cerrando (suena cada vez más sordo)
  const filtro = crearFiltro('lowpass', 1400);
  filtro.frequency.exponentialRampToValueAtTime(180, t + 0.9);
  fuenteDeRuido(t, 1.1).connect(filtro).connect(envolvente(t, 0.8, 0.005, 1.0));
  // Golpe en el pecho: tono muy grave que cae
  tono('sine', 95, 35, t, 0.6).connect(envolvente(t, 0.6, 0.005, 0.6));
  // Chisporroteo agudo del hielo que se rompe
  fuenteDeRuido(t, 0.4).connect(crearFiltro('highpass', 3500)).connect(envolvente(t, 0.15, 0.005, 0.35));
}

function sonarImpactoMagma() {
  if (!audioListo()) return;
  const t = sonido.contexto.currentTime;
  fuenteDeRuido(t, 0.4).connect(crearFiltro('bandpass', 800, 0.8)).connect(envolvente(t, 0.3, 0.005, 0.35));
  tono('sine', 130, 50, t, 0.4).connect(envolvente(t, 0.35, 0.005, 0.4));
}

/* Siseo de vapor: ruido muy agudo. Más vapor = más fuerte y más largo, pero
   creciendo con el logaritmo (10 veces más vapor no suena 10 veces más fuerte). */
function sonarVapor(cantidad) {
  const t = sonido.contexto.currentTime;
  const fuerza = Math.log2(1 + cantidad);
  const duracion = 0.3 + Math.min(0.9, fuerza * 0.12);
  fuenteDeRuido(t, duracion + 0.1).connect(crearFiltro('highpass', 4500, 0.7))
    .connect(envolvente(t, Math.min(0.28, 0.035 * fuerza), 0.02, duracion));
}

/* "Plip" de una gota: tono corto que baja rápido, con frecuencia al azar. */
function sonarChapoteo() {
  const t = sonido.contexto.currentTime;
  const frecuencia = 500 + Math.random() * 700;
  tono('sine', frecuencia, frecuencia * 0.45, t, 0.09).connect(envolvente(t, 0.07, 0.003, 0.11));
}

/* Llama que se apaga: siseo largo + un tono triste que baja. */
function sonarApagarse() {
  if (!audioListo()) return;
  const t = sonido.contexto.currentTime;
  fuenteDeRuido(t, 1.4).connect(crearFiltro('highpass', 2500)).connect(envolvente(t, 0.35, 0.02, 1.3));
  tono('triangle', 620, 140, t + 0.1, 0.9).connect(envolvente(t + 0.1, 0.14, 0.02, 0.9));
}

function sonarSalto() {
  if (!audioListo()) return;
  const t = sonido.contexto.currentTime;
  tono('sine', 280, 560, t, 0.12).connect(envolvente(t, 0.06, 0.005, 0.12));
}

/* Ráfaga al cambiar el sentido del viento: un "fuuush" que CRUZA de un parlante
   al otro en la dirección en la que ahora sopla (StereoPanner: -1 = izquierda,
   +1 = derecha). Cuanto más fuerte el viento nuevo, más fuerte y largo. */
function sonarCambioDeViento(vientoNuevo) {
  if (!audioListo()) return;
  const t = sonido.contexto.currentTime;
  const fuerza = PARAMETROS.vientoMaximo > 0 ? Math.min(1, Math.abs(vientoNuevo) / PARAMETROS.vientoMaximo) : 0;
  const duracion = 0.7 + 0.6 * fuerza;
  const sentido = Math.sign(vientoNuevo);

  const filtro = crearFiltro('bandpass', 300, 1.5);
  filtro.frequency.exponentialRampToValueAtTime(900, t + duracion * 0.5);   // la ráfaga "se levanta"
  filtro.frequency.exponentialRampToValueAtTime(350, t + duracion);         // y se aleja
  const paneo = sonido.contexto.createStereoPanner();
  paneo.pan.setValueAtTime(-sentido, t);                     // viene del lado de donde sopla
  paneo.pan.linearRampToValueAtTime(sentido, t + duracion);  // y se va hacia el otro
  fuenteDeRuido(t, duracion + 0.1).connect(filtro).connect(paneo)
    .connect(envolvente(t, 0.12 + 0.25 * fuerza, duracion * 0.4, duracion * 0.6));
}

/* Dos notas al empezar el turno; cada jugador tiene las suyas. */
const NOTAS_DE_TURNO = [[523, 784], [659, 988]]; // J1: Do-Sol · J2: Mi-Si (Hz)

function sonarTurno(equipo) {
  if (!audioListo()) return;
  const t = sonido.contexto.currentTime;
  NOTAS_DE_TURNO[equipo].forEach((frecuencia, n) => {
    const inicio = t + n * 0.12;
    tono('triangle', frecuencia, frecuencia, inicio, 0.25).connect(envolvente(inicio, 0.12, 0.01, 0.25));
  });
}

function sonarCambioDeLlama() {
  if (!audioListo()) return;
  const t = sonido.contexto.currentTime;
  tono('square', 1300, 1300, t, 0.04).connect(envolvente(t, 0.04, 0.002, 0.05));
}

/* Arpegio Do-Mi-Sol-Do al ganar. */
function sonarVictoria() {
  if (!audioListo()) return;
  const t = sonido.contexto.currentTime;
  [523, 659, 784, 1046].forEach((frecuencia, n) => {
    const inicio = t + n * 0.13;
    tono('triangle', frecuencia, frecuencia, inicio, 0.4).connect(envolvente(inicio, 0.15, 0.01, n === 3 ? 0.8 : 0.3));
  });
}

/* ---------- Registro de eventos que pasan muchas veces por cuadro ----------
   El vapor y las gotas se generan de a decenas: en vez de un sonido por
   partícula (saturaría), se acumulan y se suenan juntos en actualizarSonidos(). */
function registrarVapor(cantidad) {
  sonido.vaporPendiente += cantidad;
}

function registrarChapoteo() {
  sonido.chapoteosPendientes++;
}

/* ---------- Sonidos continuos ---------- */

/* Niveles máximos de los ambientes (antes de los volúmenes generales).
   Son ruido CONTINUO: suena todo el tiempo y en muchas frecuencias, así que a
   igual volumen se percibe mucho más fuerte que un golpe corto. Por eso van
   bastante por debajo de los efectos. */
const NIVEL_CASCADA = 0.035;
const NIVEL_VIENTO_BASE = 0.01;     // susurro de fondo aunque haya calma
const NIVEL_VIENTO_MAXIMO = 0.10;   // con el viento al máximo

/* Ambientes: ruido que suena siempre; solo se mueve su volumen.
   Pasan por su propio canal (sonido.salidaAmbiente) para poder regular el
   fondo aparte de los efectos, con el slider "Volumen ambiente". */
function crearAmbientes() {
  const t = sonido.contexto.currentTime;
  sonido.salidaAmbiente = sonido.contexto.createGain();
  sonido.salidaAmbiente.gain.value = PARAMETROS.volumenAmbiente;
  sonido.salidaAmbiente.connect(sonido.salida);

  // Cascada: rumor grave. Se dejan pasar solo frecuencias entre 200 y 700 Hz:
  // sin los agudos deja de sonar a "shhh" de lluvia y queda de fondo.
  const volumenCascada = sonido.contexto.createGain();
  volumenCascada.gain.value = 0;
  fuenteDeRuido(t).connect(crearFiltro('highpass', 200)).connect(crearFiltro('lowpass', 700)).connect(volumenCascada);
  volumenCascada.connect(sonido.salidaAmbiente);
  sonido.cascada = volumenCascada;

  // Viento: una franja de ruido cuya frecuencia central se mueve despacio (ráfagas)
  const filtroViento = crearFiltro('bandpass', 500, 0.9);
  const volumenViento = sonido.contexto.createGain();
  volumenViento.gain.value = 0;
  fuenteDeRuido(t).connect(filtroViento).connect(volumenViento);
  volumenViento.connect(sonido.salidaAmbiente);
  sonido.viento = { volumen: volumenViento, filtro: filtroViento };
}

/* Un tono de carga por cada llama que está cargando (en tiempo real pueden ser
   las dos a la vez). Se guardan en sonido.cargas, por número de llama. */
function actualizarTonoDeCarga() {
  const t = sonido.contexto.currentTime;
  for (const llama of llamas) {
    const tono = sonido.cargas.get(llama.numero);
    if (llama.cargando && juego.pantalla === 'jugando') {
      let actual = tono;
      if (!actual) {
        // Diente de sierra suavizado: suena como un "zumbido" que se va tensando
        const oscilador = sonido.contexto.createOscillator();
        oscilador.type = 'sawtooth';
        const volumen = sonido.contexto.createGain();
        volumen.gain.setValueAtTime(0.0001, t);
        volumen.gain.exponentialRampToValueAtTime(0.05, t + 0.05);
        oscilador.connect(crearFiltro('lowpass', 1600)).connect(volumen).connect(sonido.salida);
        oscilador.start(t);
        actual = { oscilador, volumen };
        sonido.cargas.set(llama.numero, actual);
      }
      // La frecuencia sube con la potencia: de 180 Hz (vacía) a 700 Hz (llena).
      // J2 suena una quinta más agudo (×1.5) para distinguir las dos cargas.
      const base = llama.equipo === 0 ? 1 : 1.5;
      actual.oscilador.frequency.setTargetAtTime((180 + 520 * llama.potencia) * base, t, 0.02);
    } else if (tono) {
      tono.volumen.gain.setTargetAtTime(0.0001, t, 0.02);
      tono.oscilador.stop(t + 0.15);
      sonido.cargas.delete(llama.numero);
    }
  }
}

/* Se llama una vez por cuadro (principal.js). setTargetAtTime acerca el valor
   al objetivo de forma suave (exponencial), así los cambios no hacen "clicks". */
function actualizarSonidos() {
  if (!audioListo()) return;
  const t = sonido.contexto.currentTime;
  sonido.salida.gain.setTargetAtTime(sonido.silenciado ? 0 : PARAMETROS.volumen, t, 0.05);
  sonido.salidaAmbiente.gain.setTargetAtTime(PARAMETROS.volumenAmbiente, t, 0.05);

  actualizarTonoDeCarga();

  // Ambientes solo durante la partida, con volumen según el caudal y el viento
  const jugando = juego.pantalla === 'jugando';
  const fuerzaCascada = jugando ? Math.min(1, PARAMETROS.caudalCascada / 25) : 0;
  sonido.cascada.gain.setTargetAtTime(NIVEL_CASCADA * fuerzaCascada, t, 0.3);
  const fuerzaViento = jugando && PARAMETROS.vientoMaximo > 0 ? Math.min(1, Math.abs(viento) / PARAMETROS.vientoMaximo) : 0;
  sonido.viento.volumen.gain.setTargetAtTime(NIVEL_VIENTO_BASE + NIVEL_VIENTO_MAXIMO * fuerzaViento, t, 0.5);
  // Ráfagas: la franja de frecuencias sube y baja con dos senos lentos
  sonido.viento.filtro.frequency.setTargetAtTime(380 + 180 * Math.sin(t * 0.7) + 90 * Math.sin(t * 1.9), t, 0.2);

  // Vapor y gotas acumulados en este cuadro
  if (sonido.vaporPendiente > 0 && t - sonido.ultimoVapor > 0.08) {
    sonarVapor(sonido.vaporPendiente);
    sonido.vaporPendiente = 0;
    sonido.ultimoVapor = t;
  }
  if (sonido.chapoteosPendientes > 0 && t - sonido.ultimoChapoteo > 0.04) {
    sonarChapoteo();
    sonido.chapoteosPendientes = 0;
    sonido.ultimoChapoteo = t;
  }
}
