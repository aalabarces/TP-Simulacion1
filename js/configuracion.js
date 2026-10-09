'use strict';
/* =============================================================================
   CONFIGURACIÓN GENERAL
   Todas las constantes del juego en un solo lugar.
   ============================================================================= */

/* ---------- Tamaño del mundo ----------
   El mundo es una grilla de 320 x 180 celdas (proporción 16:9).
   Todas las distancias y velocidades del juego se miden en CELDAS
   (por ejemplo, "gravedad 100" = 100 celdas/s²). */
const ANCHO_GRILLA = 320;
const ALTO_GRILLA = 180;
const TOTAL_CELDAS = ANCHO_GRILLA * ALTO_GRILLA;

/* La simulación avanza en pasos fijos de 1/60 s (60 pasos por segundo),
   así se comporta igual en cualquier computadora. */
const PASO_SIMULACION = 1 / 60;

/* ---------- Materiales ----------
   Cada celda de la grilla guarda uno de estos números. */
const AIRE = 0;
const HIELO = 1;          // destructible, se derrite a más de 0°
const PIEDRA = 2;         // núcleo de las islas (la rompe la bola de fuego); en los bordes del mapa es indestructible
const AGUA = 3;           // el elemento letal
const MAGMA = 4;          // magma líquido (recién escupido, fluye)
const MAGMA_SOLIDO = 5;   // magma que se enfrió (destructible, como el hielo)

const NOMBRES_MATERIALES = ['Aire', 'Hielo', 'Piedra', 'Agua', 'Magma', 'Magma sólido'];

/* ---------- Propiedades térmicas por material ----------
   El índice del arreglo es el número del material (AIRE=0, HIELO=1, ...).

   CONDUCTIVIDAD: qué tan rápido pasa el calor hacia/desde las celdas vecinas.
     El aire conduce muy poco (aísla) y el magma muchísimo.

   ENFRIAMIENTO: qué fracción de la diferencia con la temperatura ambiente
     se pierde por segundo (ley de enfriamiento de Newton).
     El aire vuelve al ambiente enseguida (2/s); el agua tarda mucho (0.002/s),
     por eso los charcos tardan varios turnos en congelarse. */
//                                  AIRE  HIELO PIEDRA AGUA  MAGMA  M.SOLIDO
const CONDUCTIVIDAD = new Float32Array([0.03, 0.08, 0.10, 0.15, 1.00, 0.50]);
const ENFRIAMIENTO  = new Float32Array([2.00, 0.01, 0.01, 0.002, 0.03, 0.02]);

/* ---------- Parámetros ajustables ----------
   Se pueden cambiar en vivo desde el panel de debug (tecla P). */
const PARAMETROS = {
  // Física
  gravedad: 100,                  // celdas/s²
  vientoMaximo: 1,                // el viento de cada turno se sortea entre -max y +max
  /* Aceleración horizontal (celdas/s²) que el viento le da a los proyectiles con viento 1.
     Como es constante, la velocidad horizontal cambia como vx(t) = vx₀ + a·t: con viento
     en contra el proyectil se frena, a los vx₀/|a| segundos se detiene en X y después
     VUELVE hacia atrás. Pasa con tiros de poca velocidad horizontal (flojos o empinados):
     ej. 75° al 40% de carga sale con vx₀ ≈ 24 → con a = 50 se frena en medio segundo. */
  vientoSobreProyectiles: 50,
  vientoSobreAgua: 22,            // ídem para las gotas de agua en caída libre
  subpasosAgua: 3,                // veces por paso que fluye el agua: más = se nivela más rápido (cuesta CPU)
  /* Velocidad del proyectil con la carga al 100% (celdas/s).
     Para llegar a un punto a distancia horizontal d y altura h, la velocidad mínima es
         v² = gravedad × (h + √(h² + d²))
     Las reservas sobre el rival están a d ≈ 200 y h ≈ 55-70 → v ≈ 162-168.
     Con 200 sobra margen para tirar contra el viento. */
  potenciaMaxima: 200,
  caudalCascada: 25,              // celdas de agua por segundo que entran por CADA costado (ver cascadas.js)

  // Temperatura (en grados)
  temperaturaAmbiente: -6,        // la caverna tiende a esta temperatura
  difusionTermica: 0.25,          // multiplica a la conductividad
  escalaEnfriamiento: 1,          // multiplica al enfriamiento global
  temperaturaFusion: 0,           // hielo -> agua
  temperaturaCongelamiento: -3,   // agua -> hielo (más baja que la de fusión para que no oscile)
  /* "Grados de frío" extra que tiene que perder el agua ya en el punto de
     congelamiento antes de hacerse hielo (ver temperatura.js). Medido con el
     techo de burbujas: con 0 se congela todo entre los minutos 2 y 4; con 5 la
     mitad del agua sigue líquida a los 6 minutos y se congela de a poco. */
  calorLatente: 5,

  // Armas
  radioCrater: 6,                 // bola de fuego: radio donde todo pasa a AIRE
  radioAnilloCalor: 11,           // bola de fuego: radio exterior del anillo que se calienta
  calorAnillo: 32,                // grados que suma el anillo (en su borde interno)
  radioMagma: 4,                  // radio del charco de magma
  temperaturaMagma: 1000,         // temperatura del magma recién escupido
  temperaturaSolidificacion: 600, // magma líquido -> magma sólido
  fluidezMagma: 0.3,              // probabilidad por paso de que el magma se corra de costado

  // Daño y turnos
  temperaturaCuracion: 150,       // el magma sólido cura solo si está más caliente que esto
  curacionPorSegundo: 8,          // HP/s parado sobre magma caliente
  danioPorGota: 1.5,              // HP que saca cada gota que te toca
  danioSumergidoPorSegundo: 15,   // HP/s estando sumergido (multiplicado por cuánto estás sumergido)
  duracionTurno: 45,              // segundos por turno
  tiempoEscape: 3,                // segundos para moverse después de disparar
  recargaDisparo: 2.5,            // modo tiempo real: segundos entre un disparo y el siguiente
  cambioDeViento: 20,             // modo tiempo real: cada cuántos segundos cambia el viento

  // Sonido
  volumen: 0.6,                   // volumen general (0 a 1); N silencia
  volumenAmbiente: 0.6            // fondo (cascadas y viento), relativo al general
};

/* Sliders del panel de debug: [clave en PARAMETROS, etiqueta, mínimo, máximo, paso].
   Las filas con un solo texto son títulos de sección. */
const SLIDERS_DEBUG = [
  ['Física'],
  ['gravedad', 'Gravedad', 30, 200, 1],
  ['vientoMaximo', 'Viento máximo', 0, 2, 0.05],
  ['vientoSobreProyectiles', 'Viento → proyectiles', 0, 150, 1],
  ['vientoSobreAgua', 'Viento → agua', 0, 80, 1],
  ['subpasosAgua', 'Nivelación agua (subpasos)', 1, 8, 1],
  ['potenciaMaxima', 'Potencia máx.', 60, 300, 5],
  ['caudalCascada', 'Caudal cascadas (celdas/s)', 0, 60, 1],
  ['Temperatura'],
  ['temperaturaAmbiente', 'Temp. ambiente', -30, 5, 0.5],
  ['difusionTermica', 'Difusión térmica', 0, 2, 0.01],
  ['escalaEnfriamiento', 'Velocidad enfriamiento', 0, 10, 0.1],
  ['temperaturaCongelamiento', 'Temp. congelamiento', -15, 0, 0.5],
  ['calorLatente', 'Calor latente (congelar)', 0, 100, 1],
  ['Armas'],
  ['radioCrater', 'Radio cráter', 2, 14, 1],
  ['radioAnilloCalor', 'Radio anillo de calor', 3, 20, 1],
  ['calorAnillo', 'Calor del anillo', 0, 100, 1],
  ['radioMagma', 'Radio magma', 1, 10, 1],
  ['fluidezMagma', 'Fluidez magma', 0, 1, 0.01],
  ['temperaturaSolidificacion', 'Temp. solidificación', 100, 950, 10],
  ['Daño / turnos'],
  ['danioPorGota', 'Daño por gota', 0, 10, 0.1],
  ['danioSumergidoPorSegundo', 'Daño sumergido / s', 0, 60, 1],
  ['curacionPorSegundo', 'Curación magma / s', 0, 30, 0.5],
  ['duracionTurno', 'Tiempo de turno (s)', 10, 90, 1],
  ['recargaDisparo', 'Recarga tiempo real (s)', 0.3, 8, 0.1],
  ['cambioDeViento', 'Cambio de viento t. real (s)', 5, 60, 1],
  ['Sonido'],
  ['volumen', 'Volumen general', 0, 1, 0.05],
  ['volumenAmbiente', 'Volumen ambiente (cascada/viento)', 0, 1, 0.05]
];

/* ---------- Física de cada llama ----------
   Valores pensados para un movimiento "tosco y resbaladizo" (GDD). */
const FISICA_LLAMA = {
  ancho: 4,                  // hitbox en celdas
  alto: 7,
  aceleracionEnSuelo: 70,    // celdas/s² al apretar A/D apoyado
  aceleracionEnAire: 35,     // menos control en el aire
  velocidadMaxima: 22,       // celdas/s caminando
  velocidadMaximaEnAgua: 10,
  friccionHielo: 14,         // frenado al soltar las teclas sobre hielo (resbala mucho)
  friccionSuelo: 55,         // frenado sobre piedra o magma
  friccionAire: 3,
  velocidadSalto: 32,        // con gravedad 100 da un salto de ~5 celdas (v² / 2g)
  velocidadNado: 22,         // "patada" para salir del agua
  velocidadCaidaMaxima: 90
};

/* ---------- Jugadores (equipos) y modos de juego ----------
   Cada jugador es un EQUIPO de llamas. El mapa es simétrico, por eso son 2.
   El mapa genera UNA plataforma por llama (CANTIDAD_JUGADORES × llamasPorJugador),
   la mitad de cada lado. Un jugador pierde cuando se le apagan todas sus llamas. */
const CANTIDAD_JUGADORES = 2;

/* tiempoReal: sin turnos; los dos jugadores se mueven y disparan a la vez,
   con un tiempo de recarga entre disparos (PARAMETROS.recargaDisparo). */
const MODOS_DE_JUEGO = {
  clasico:    { nombre: 'Clásico 1 vs 1', detalle: 'Por turnos · una llama', llamasPorJugador: 1, tiempoReal: false },
  worms:      { nombre: 'Worms',          detalle: 'Por turnos · 3 llamas',  llamasPorJugador: 3, tiempoReal: false },
  tiempoReal: { nombre: 'Tiempo real',    detalle: 'A la vez · 2 joysticks', llamasPorJugador: 1, tiempoReal: true }
};
const ORDEN_DE_MODOS = ['clasico', 'worms', 'tiempoReal']; // orden en el menú

/* ---------- Colores de cada jugador ---------- */
const PALETAS_JUGADORES = [
  { nombre: 'J1', exterior: '#ff3d0f', medio: '#ff9a2e', nucleo: '#fff1b0', brillo: [255, 120, 30], hud: '#ff8a2a' },
  { nombre: 'J2', exterior: '#11b5f0', medio: '#8ef3ff', nucleo: '#ffffff', brillo: [60, 220, 255], hud: '#4fe3ff' }
];
