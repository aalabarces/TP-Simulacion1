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
  jet: null,               // turbina del jetpack
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

/* Llama que se apaga: siseo largo + una vocecita que grita "¡me muero!". */
function sonarApagarse() {
  if (!audioListo()) return;
  const t = sonido.contexto.currentTime;
  fuenteDeRuido(t, 1.4).connect(crearFiltro('highpass', 2500)).connect(envolvente(t, 0.3, 0.02, 1.3));
  sonarMeMuero(t + 0.05);
}

/* "¡Me muero!" con SÍNTESIS DE FORMANTES, como un sintetizador de voz muy simple.
   La voz humana es un zumbido (las cuerdas vocales: acá una onda diente de sierra,
   rica en armónicos) que pasa por la boca, que lo filtra: cada vocal refuerza dos
   franjas de frecuencia propias, los FORMANTES F1 y F2 (la "a" ~800/1200 Hz, la
   "u" ~330/800 Hz...). Moviendo dos filtros pasabanda de una vocal a la otra
   mientras cambia el volumen, el zumbido "dice" la frase. La voz es aguda y rápida,
   de dibujito (como los gusanos del Worms), y la "o" final cae con un temblor. */
const SONIDOS_ME_MUERO = [
  // [duración (s), F1 (Hz), F2 (Hz), volumen relativo, altura de la voz (Hz)]
  [0.06, 300, 1300, 0.25, 470],  // m (labios cerrados: suena sordo y flojo)
  [0.10, 480, 2200, 1.00, 500],  // e
  [0.05, 300, 1200, 0.25, 470],  // m
  [0.09, 340, 820, 0.90, 440],   // u
  [0.09, 500, 2000, 1.00, 430],  // e
  [0.03, 420, 1500, 0.35, 410],  // r (un golpecito de lengua: casi un corte)
  [0.38, 540, 900, 1.00, 400]    // ooo (larga, la voz se cae)
];

function sonarMeMuero(inicio) {
  const contexto = sonido.contexto;
  const duracionTotal = SONIDOS_ME_MUERO.reduce((suma, s) => suma + s[0], 0);

  const cuerdas = contexto.createOscillator();
  cuerdas.type = 'sawtooth';
  // Temblor de la voz (vibrato): un oscilador lento que mueve la altura ±4%
  const temblor = contexto.createOscillator();
  temblor.frequency.value = 9;
  const anchoTemblor = contexto.createGain();
  anchoTemblor.gain.value = 18;
  temblor.connect(anchoTemblor).connect(cuerdas.frequency);

  const formante1 = crearFiltro('bandpass', 0, 7);
  const formante2 = crearFiltro('bandpass', 0, 9);
  const volumenF2 = contexto.createGain();
  volumenF2.gain.value = 0.6;
  const voz = contexto.createGain();
  voz.connect(sonido.salida);
  cuerdas.connect(formante1).connect(voz);
  cuerdas.connect(formante2).connect(volumenF2).connect(voz);

  // Cada sonido se alcanza con una rampa corta (la boca no salta de una vocal a otra)
  const NIVEL = 0.9;
  const [, f1Inicial, f2Inicial, , alturaInicial] = SONIDOS_ME_MUERO[0];
  formante1.frequency.setValueAtTime(f1Inicial, inicio);
  formante2.frequency.setValueAtTime(f2Inicial, inicio);
  cuerdas.frequency.setValueAtTime(alturaInicial, inicio);
  voz.gain.setValueAtTime(0.0001, inicio);
  let t = inicio;
  for (const [duracion, f1, f2, volumen, altura] of SONIDOS_ME_MUERO) {
    const llegada = t + Math.min(0.03, duracion * 0.6);
    formante1.frequency.linearRampToValueAtTime(f1, llegada);
    formante2.frequency.linearRampToValueAtTime(f2, llegada);
    cuerdas.frequency.linearRampToValueAtTime(altura, llegada);
    voz.gain.linearRampToValueAtTime(NIVEL * volumen, llegada);
    t += duracion;
  }
  // La "o" final: la voz cae una quinta y se apaga
  cuerdas.frequency.linearRampToValueAtTime(260, t);
  voz.gain.setValueAtTime(NIVEL, t - 0.15);
  voz.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);

  cuerdas.start(inicio);
  temblor.start(inicio);
  cuerdas.stop(inicio + duracionTotal + 0.1);
  temblor.stop(inicio + duracionTotal + 0.1);
}

/* Mortero: un "¡pum!" grave (la explosión bajo los pies) y un silbido que sube mientras sale disparada. */
function sonarMortero() {
  if (!audioListo()) return;
  const t = sonido.contexto.currentTime;
  tono('sine', 140, 45, t, 0.3).connect(envolvente(t, 0.5, 0.004, 0.3));
  fuenteDeRuido(t, 0.35).connect(crearFiltro('lowpass', 900)).connect(envolvente(t, 0.35, 0.005, 0.3));
  const filtro = crearFiltro('bandpass', 700, 1.1);
  filtro.frequency.exponentialRampToValueAtTime(3000, t + 0.4);
  fuenteDeRuido(t + 0.03, 0.45).connect(filtro).connect(envolvente(t + 0.03, 0.2, 0.03, 0.4));
}

function sonarSalto() {
  if (!audioListo()) return;
  const t = sonido.contexto.currentTime;
  tono('sine', 280, 560, t, 0.12).connect(envolvente(t, 0.06, 0.005, 0.12));
}

/* Lengua de fuego: lanzarla ("fsst" agudo que sube), engancharse (golpecito + chisporroteo),
   soltarla (chasquido corto) y fallar (el "fsst" solo, más flojo y que se apaga). */
function sonarLenguaFalla() {
  if (!audioListo()) return;
  const t = sonido.contexto.currentTime;
  const filtro = crearFiltro('bandpass', 1200, 1.4);
  filtro.frequency.exponentialRampToValueAtTime(3200, t + 0.12);
  fuenteDeRuido(t, 0.2).connect(filtro).connect(envolvente(t, 0.16, 0.005, 0.15));
}

function sonarEnganche() {
  if (!audioListo()) return;
  const t = sonido.contexto.currentTime;
  const filtro = crearFiltro('bandpass', 1200, 1.4);
  filtro.frequency.exponentialRampToValueAtTime(3200, t + 0.1);
  fuenteDeRuido(t, 0.16).connect(filtro).connect(envolvente(t, 0.2, 0.005, 0.12));
  tono('triangle', 180, 90, t + 0.08, 0.14).connect(envolvente(t + 0.08, 0.3, 0.004, 0.14));
  fuenteDeRuido(t + 0.08, 0.3).connect(crearFiltro('highpass', 4000)).connect(envolvente(t + 0.08, 0.1, 0.005, 0.25));
}

function sonarSoltarLengua() {
  if (!audioListo()) return;
  const t = sonido.contexto.currentTime;
  fuenteDeRuido(t, 0.1).connect(crearFiltro('highpass', 3000)).connect(envolvente(t, 0.12, 0.003, 0.08));
  tono('sine', 420, 200, t, 0.08).connect(envolvente(t, 0.1, 0.003, 0.08));
}

/* Bate: "fsst" del palo cortando el aire (ruido que barre de grave a agudo). */
function sonarBatazo() {
  if (!audioListo()) return;
  const t = sonido.contexto.currentTime;
  const filtro = crearFiltro('bandpass', 500, 2);
  filtro.frequency.exponentialRampToValueAtTime(2500, t + 0.15);
  fuenteDeRuido(t, 0.22).connect(filtro).connect(envolvente(t, 0.25, 0.04, 0.16));
}

/* ¡HOME RUN! Tres capas, como en la tele:
   1. El "¡CRACK!" de la madera: un golpe de ruido muy corto y brillante más un
      "toc" con tono (la madera resuena cerca de 1 kHz).
   2. El órgano del estadio tocando el clásico "¡Charge!": Sol-Do-Mi-Sol... Mi-Sol.
      Cada nota es una onda cuadrada (suena a órgano) más su octava, cortita.
   3. La tribuna: ruido filtrado en la franja de las voces (500 a 2500 Hz) que crece,
      ondula (miles de gritos que no van parejos) y se apaga despacio. */
const ORGANO_HOME_RUN = [
  // [frecuencia (Hz), comienzo (s), duración (s)]
  [392, 0.25, 0.12], [523, 0.39, 0.12], [659, 0.53, 0.12], [784, 0.67, 0.28],
  [659, 0.99, 0.12], [784, 1.13, 0.6]
];

function sonarHomeRun() {
  if (!audioListo()) return;
  const contexto = sonido.contexto;
  const t = contexto.currentTime;

  // 1. Crack
  fuenteDeRuido(t, 0.08).connect(crearFiltro('highpass', 1800)).connect(envolvente(t, 0.9, 0.002, 0.07));
  tono('triangle', 1100, 700, t, 0.12).connect(envolvente(t, 0.5, 0.002, 0.12));
  tono('sine', 180, 90, t, 0.15).connect(envolvente(t, 0.4, 0.002, 0.15));

  // 2. Órgano
  for (const [frecuencia, comienzo, duracion] of ORGANO_HOME_RUN) {
    const inicio = t + comienzo;
    for (const [multiplicador, nivel] of [[1, 0.07], [2, 0.035]]) {
      const nota = tono('square', frecuencia * multiplicador, frecuencia * multiplicador, inicio, duracion);
      const filtro = crearFiltro('lowpass', 2400);
      nota.connect(filtro).connect(envolvente(inicio, nivel, 0.01, duracion));
    }
  }

  // 3. Tribuna
  const duracionTribuna = 2.6;
  const voces = crearFiltro('bandpass', 1100, 0.6);
  const ondulacion = contexto.createGain();
  ondulacion.gain.value = 0.75;
  const variacion = contexto.createOscillator(); // la ovación sube y baja unas 3 veces por segundo
  variacion.frequency.value = 3.3;
  const anchoVariacion = contexto.createGain();
  anchoVariacion.gain.value = 0.25;
  variacion.connect(anchoVariacion).connect(ondulacion.gain);
  variacion.start(t);
  variacion.stop(t + duracionTribuna + 0.4);
  fuenteDeRuido(t + 0.05, duracionTribuna + 0.3).connect(voces).connect(ondulacion)
    .connect(envolvente(t + 0.05, 0.3, 0.5, duracionTribuna));
}

/* Golpe contra el suelo que aturde: más grave y largo cuanto más fuerte la caída (0 a 1). */
function sonarAturdimiento(fuerza) {
  if (!audioListo()) return;
  const t = sonido.contexto.currentTime;
  tono('sine', 110 - 30 * fuerza, 40, t, 0.35).connect(envolvente(t, 0.35 + 0.3 * fuerza, 0.004, 0.35));
  fuenteDeRuido(t, 0.25).connect(crearFiltro('lowpass', 500)).connect(envolvente(t, 0.25, 0.004, 0.22));
  // Campanitas mareadas
  tono('sine', 880, 700, t + 0.15, 0.4).connect(envolvente(t + 0.15, 0.05, 0.01, 0.4));
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

  // Jetpack: ruido grave y rasposo que sube de tono con el empuje. Sale por el canal de
  // efectos (no por el ambiente): es parte de la acción.
  const filtroJet = crearFiltro('lowpass', 900, 0.8);
  const volumenJet = sonido.contexto.createGain();
  volumenJet.gain.value = 0;
  fuenteDeRuido(t).connect(filtroJet).connect(volumenJet);
  volumenJet.connect(sonido.salida);
  sonido.jet = { volumen: volumenJet, filtro: filtroJet };
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

  // Turbina del jetpack: suena mientras alguna llama está empujando
  const propulsando = juego.pantalla === 'jugando' && llamas.some(llama => llama.vivo && llama.propulsando);
  sonido.jet.volumen.gain.setTargetAtTime(propulsando ? 0.16 : 0, t, 0.04);
  sonido.jet.filtro.frequency.setTargetAtTime(propulsando ? 700 + 250 * Math.sin(t * 17) : 500, t, 0.03);

  // Ambientes solo durante la partida, con volumen según el caudal y el viento
  const jugando = juego.pantalla === 'jugando';
  const fuerzaCascada = jugando ? Math.min(1, caudalCascada() / 25) : 0;
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
