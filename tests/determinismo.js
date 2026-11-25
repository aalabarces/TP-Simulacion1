'use strict';
/* =============================================================================
   TEST DE DETERMINISMO (fase 0 del juego en red)

   El juego online hace que las dos PCs simulen todo y solo se manden los controles,
   así que la simulación tiene que dar EXACTAMENTE el mismo resultado en las dos.
   Este script carga la simulación real (los mismos js/*.js del juego, sin dibujo ni
   audio) en un contexto aislado de Node y repite la misma partida con condiciones que
   harían aparecer cualquier no-determinismo escondido:

     A) base:        arranque limpio
     B) "otra PC":   Math.sin/cos/pow/exp/log/hypot perturbados (simula otro motor JS),
                     Math.random con otra secuencia (lo visual), y el mundo "sucio"
                     (la pantalla de título ya simuló cientos de pasos antes)
     C) otros controles o semilla: tiene que dar DISTINTO (si no, el test no prueba nada)

   Uso:  node tests/determinismo.js          (completo, tarda; sale con código 1 si algo falla)
         node tests/determinismo.js --base   (solo la partida base y la regresión vs. fase 0)
   ============================================================================= */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const CARPETA_JS = path.join(__dirname, '..', 'js');
// Todo lo que simula (sin render, hud, sonido, cámara, entrada, joystick, debug ni táctil)
const ARCHIVOS = ['configuracion', 'utilidades', 'grilla', 'generador-mapa', 'temperatura', 'fluidos',
  'particulas-agua', 'cascadas', 'efectos', 'viento', 'llama', 'proyectiles', 'turnos', 'comandos', 'principal'];
const CODIGO = ARCHIVOS.map(nombre => ({ nombre, texto: fs.readFileSync(path.join(CARPETA_JS, nombre + '.js'), 'utf8') }));

/* ---------- Controles de prueba: función pura de (tick, jugador) ---------- */
function mezclar(a) {
  a = Math.imul(a ^ (a >>> 16), 0x45d9f3b); a = Math.imul(a ^ (a >>> 16), 0x45d9f3b);
  return (a ^ (a >>> 16)) >>> 0;
}
function controlesDePrueba(tick, jugador, semillaControles) {
  const h = mezclar(Math.floor(tick / 25) * 7919 + (jugador + 3) * 131 + semillaControles);
  return {
    mover: (h & 3) % 3 - 1,
    apuntar: ((h >>> 2) & 3) % 3 - 1,
    saltar: ((h >>> 4) & 7) === 0 && tick % 25 === 0,
    cargar: (tick % 90) < 45 && ((h >>> 8) & 1) === 1   // mantiene ~0.75 s y suelta: dispara
  };
}

/* ---------- Contexto aislado con la simulación cargada ---------- */
const PERTURBACION_MATH = `(function () {
  const o = { sin: Math.sin, cos: Math.cos, pow: Math.pow, exp: Math.exp, log: Math.log, hypot: Math.hypot, atan2: Math.atan2 };
  Math.sin = x => o.sin(x) * (1 + 3e-13);       // cada motor de JS redondea estas funciones distinto
  Math.cos = x => o.cos(x) * (1 - 2e-13);
  Math.pow = (a, b) => o.pow(a, b) * (1 + 5e-14);
  Math.exp = x => o.exp(x) * (1 + 7e-14);
  Math.log = x => o.log(x) * (1 - 4e-14);
  Math.hypot = (a, b) => o.hypot(a, b) * (1 + 9e-14);
  Math.atan2 = (a, b) => o.atan2(a, b) * (1 - 6e-14);
})();`;

const HASH_DE_ESTADO = `(function () {
  const escala = new Float64Array(1), vista = new Uint32Array(escala.buffer);
  let h = 0x811c9dc5;
  const mezcla = v => { h = Math.imul(h ^ v, 16777619); h ^= h >>> 15; };
  const buffer = typed => { const u = new Uint32Array(typed.buffer, typed.byteOffset, typed.byteLength >> 2); for (let i = 0; i < u.length; i++) mezcla(u[i]); };
  const valor = v => {
    if (typeof v === 'number') { escala[0] = v; mezcla(vista[0]); mezcla(vista[1]); }
    else if (typeof v === 'boolean') mezcla(v ? 1 : 2);
    else if (typeof v === 'string') for (let i = 0; i < v.length; i++) mezcla(v.charCodeAt(i));
    else if (v && typeof v === 'object') objeto(v);
    else mezcla(3);
  };
  const objeto = o => { for (const k of Object.keys(o)) valor(o[k]); };
  return function hashEstado() {
    h = 0x811c9dc5;
    buffer(material); buffer(masaAgua); buffer(temperatura); buffer(frioAcumulado); buffer(celdaIndestructible);
    mezcla(llamas.length); for (const l of llamas) objeto(l);
    mezcla(proyectiles.length); for (const p of proyectiles) objeto(p);
    mezcla(particulasAgua.length); for (const g of particulasAgua) objeto(g);
    valor(estadoAzarSim()); valor(viento); valor(numeroDePaso);
    valor(juego.fase); valor(juego.equipoActual); valor(juego.llamaActual); valor(juego.tiempoTurnoRestante);
    valor(juego.tiempoEnFase); valor(juego.pantalla); valor(juego.textoGanador);
    buffer(bloqueDespierto);
    return h >>> 0;
  };
})()`;

/* Carga la simulación. Las funciones de dibujo/sonido/cámara que la simulación llama pero no
   existen acá se descubren probando (ReferenceError) y se reemplazan por funciones vacías. */
function crearContexto(opciones, stubs) {
  const caja = {
    console, performance: { now: () => 0 },
    requestAnimationFrame: () => 0,
    __tick: 0, __semillaControles: opciones.semillaControles
  };
  for (const nombre of stubs) caja[nombre] = () => 0;
  const ctx = vm.createContext(caja);
  if (opciones.perturbarMath) vm.runInContext(PERTURBACION_MATH, ctx);
  if (opciones.azarVisual !== undefined) {   // otra secuencia de Math.random: solo debería cambiar lo visual
    let estado = opciones.azarVisual;
    ctx.__azarVisual = () => { estado = (estado + 0x6D2B79F5) | 0; let t = Math.imul(estado ^ (estado >>> 15), 1 | estado); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    vm.runInContext('Math.random = __azarVisual;', ctx);
  }
  for (const { nombre, texto } of CODIGO) vm.runInContext(texto, ctx, { filename: nombre + '.js' });
  // Los comandos los da el test (no hay teclado), igual que haría la red: una función pura
  // de (tick, jugador). Mismo criterio que muestrearControlesLocales: en tiempo real cada
  // equipo trae los suyos; por turnos solo el equipo con el turno.
  ctx.__controles = (tick, jugador) => ({ ...controlesDePrueba(tick, jugador, opciones.semillaControles), acciones: 0 });
  vm.runInContext(`function __muestrear() {
    if (esTiempoReal()) { asignarComando(0, __controles(__tick, 0)); asignarComando(1, __controles(__tick, 1)); }
    else {
      asignarComando(0, comandoVacio()); asignarComando(1, comandoVacio());
      asignarComando(juego.equipoActual, __controles(__tick, -1));
    }
  }`, ctx);
  return ctx;
}

const STUBS = new Set(['prepararControlesTactiles']);
function crearContextoConStubs(opciones) {
  return crearContexto(opciones, STUBS);
}

/* Ejecuta fn; si la simulación llama a algo que solo existe en el navegador (sonido, cámara...),
   lo agrega a STUBS y repite todo desde cero. Los stubs descubiertos se recuerdan. */
function conStubs(fn) {
  for (let intento = 0; intento < 120; intento++) {
    try { return fn(); }
    catch (error) {
      const m = /^(\w+) is not defined$/.exec(error.message);
      if (!m || STUBS.has(m[1])) throw error;
      STUBS.add(m[1]);
    }
  }
  throw new Error('demasiados stubs');
}

/* ---------- Una partida ---------- */
const PASO = 1 / 60;
function jugarPartida(parametros) {
  return conStubs(() => jugarPartidaUnaVez(parametros));
}

function jugarPartidaUnaVez({ modo, semilla, pasos, pasosSucios = 0, perturbarMath = false, azarVisual, semillaControles = 12345 }) {
  const ctx = crearContextoConStubs({ perturbarMath, azarVisual, semillaControles });
  const correr = codigo => vm.runInContext(codigo, ctx);
  const hashEstado = correr(HASH_DE_ESTADO);

  // "Mundo sucio": al abrir el juego ya hay un mapa de fondo simulándose en el título
  ctx.__tick = 0;
  for (let i = 0; i < pasosSucios; i++) correr('simularPaso(' + PASO + ')');

  correr(`juego.modo = '${modo}'; empezarPartida(${semilla});`);

  const hashes = [];
  let msTotal = 0, gotasMaximas = 0, proyectilesVistos = 0;
  for (let tick = 0; tick < pasos; tick++) {
    ctx.__tick = tick;
    const inicio = process.hrtime.bigint();
    correr('__muestrear(); simularPaso(' + PASO + ')');
    msTotal += Number(process.hrtime.bigint() - inicio) / 1e6;
    gotasMaximas = Math.max(gotasMaximas, correr('particulasAgua.length'));
    proyectilesVistos = Math.max(proyectilesVistos, correr('proyectiles.length'));
    if (tick % 100 === 99) hashes.push(hashEstado());
  }
  return {
    hashes,
    msPorPaso: msTotal / pasos,
    gotasMaximas, proyectilesVistos,
    llamasVivas: correr('llamas.filter(l => l.vivo).length'),
    fase: correr('juego.fase'),
    pantalla: correr('juego.pantalla')
  };
}

/* ---------- Escenarios ---------- */
const escenarios = [
  { nombre: 'tiempoReal', modo: 'tiempoReal', semilla: 1234, pasos: 2400 },
  { nombre: 'worms (por turnos)', modo: 'worms', semilla: 98765, pasos: 3000 },
  { nombre: 'clasico (por turnos)', modo: 'clasico', semilla: 777, pasos: 2400 }
];

const SOLO_BASE = process.argv.includes('--base'); // rápido: solo la partida A y la comparación con la fase 0
const HASHES_DE_REFERENCIA = { 'tiempoReal': 'aa32c779', 'worms (por turnos)': '47deecd8', 'clasico (por turnos)': '39b15d80' };

let fallos = 0;
const fmt = h => h.toString(16).padStart(8, '0');
function comparar(a, b) {
  const n = Math.min(a.hashes.length, b.hashes.length);
  for (let i = 0; i < n; i++) if (a.hashes[i] !== b.hashes[i]) return i;
  return -1;
}

for (const e of escenarios) {
  console.log(`\n=== ${e.nombre} · semilla ${e.semilla} · ${e.pasos} pasos ===`);
  const base = jugarPartida(e);
  console.log(`A base            hash final ${fmt(base.hashes.at(-1))} · ${base.msPorPaso.toFixed(2)} ms/paso · gotas máx ${base.gotasMaximas} · proyectiles ${base.proyectilesVistos} · llamas vivas ${base.llamasVivas} · fase ${base.fase}`);

  if (SOLO_BASE) {
    // Regresión: estos hashes son los de la fase 0, antes de pasar los controles a comandos.
    // Si un refactor no cambia el comportamiento, la partida de prueba da lo mismo.
    const esperado = HASHES_DE_REFERENCIA[e.nombre];
    const coincide = fmt(base.hashes.at(-1)) === esperado;
    console.log(`  regresión vs. fase 0 (${esperado}) → ${coincide ? 'IGUAL ✔' : 'CAMBIÓ ✘'}`);
    if (!coincide) fallos++;
    continue;
  }

  const otraPC = jugarPartida({ ...e, perturbarMath: true, azarVisual: 987654321, pasosSucios: 777 });
  const divergencia = comparar(base, otraPC);
  console.log(`B "otra PC"       hash final ${fmt(otraPC.hashes.at(-1))} → ${divergencia < 0 ? 'IGUAL ✔' : 'DIVERGE en el paso ' + ((divergencia + 1) * 100) + ' ✘'}`);
  if (divergencia >= 0) fallos++;

  const otrosControles = jugarPartida({ ...e, semillaControles: 999 });
  const distintoControles = comparar(base, otrosControles) >= 0;
  console.log(`C otros controles hash final ${fmt(otrosControles.hashes.at(-1))} → ${distintoControles ? 'distinto ✔ (los controles importan)' : 'IGUAL ✘ (el test no prueba nada)'}`);
  if (!distintoControles) fallos++;

  const otraSemilla = jugarPartida({ ...e, semilla: e.semilla + 1 });
  const distintaSemilla = comparar(base, otraSemilla) >= 0;
  console.log(`C otra semilla    hash final ${fmt(otraSemilla.hashes.at(-1))} → ${distintaSemilla ? 'distinto ✔' : 'IGUAL ✘'}`);
  if (!distintaSemilla) fallos++;

  if (base.pantalla !== 'jugando' && base.pantalla !== 'fin') { console.log('   ✘ la partida no arrancó'); fallos++; }
}

console.log(fallos === 0 ? '\nTODO OK: la simulación es determinista.' : `\n${fallos} comprobación(es) fallaron.`);
process.exit(fallos === 0 ? 0 : 1);
