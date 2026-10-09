'use strict';
/* =============================================================================
   HUD (interfaz sobre el juego)
   Todo se mide en "unidades": 1 unidad = 1% del ancho de un área 16:9 que
   entra en la ventana. Así el HUD se ve igual en cualquier resolución.

   Disposición:
     [Panel J1]   [Temporizador][Viento]   [Panel J2]      <- franja superior
                        ...mapa...
              [Bola de fuego][Escupir magma]               <- abajo al centro
   ============================================================================= */

function calcularUnidadHud(anchoPantalla, altoPantalla) {
  return Math.min(anchoPantalla, altoPantalla * 16 / 9) / 100;
}

function fuente(unidad, tamanio, peso = '') {
  return `${peso} ${tamanio * unidad}px system-ui,sans-serif`;
}

/* Fondo semitransparente de cada panel */
function dibujarPanel(x, y, ancho, alto) {
  trazarRectanguloRedondeado(ctx, x, y, ancho, alto, Math.min(ancho, alto) * 0.18);
  ctx.fillStyle = 'rgba(6,10,20,0.66)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx.lineWidth = 1;
  ctx.stroke();
}

function dibujarHud(anchoPantalla, altoPantalla, unidad) {
  ctx.setTransform(1, 0, 0, 1, 0, 0); // de acá en adelante, píxeles de pantalla
  ctx.textBaseline = 'alphabetic';

  if (llamas.length > 0) {
    dibujarPanelJugador(0, 1.2 * unidad, 1.2 * unidad, unidad, false);
    dibujarPanelJugador(1, anchoPantalla - 1.2 * unidad, 1.2 * unidad, unidad, true);
  }

  if (juego.pantalla === 'jugando') {
    dibujarTemporizadorYViento(anchoPantalla, unidad);
    dibujarSelectoresDeArmas(anchoPantalla, altoPantalla, unidad);
  }
  if (juego.cartel && juego.pantalla === 'jugando') dibujarCartel(anchoPantalla, altoPantalla, unidad);
  if (juego.pantalla === 'titulo' || juego.pantalla === 'fin') dibujarPantallaSuperpuesta(anchoPantalla, altoPantalla, unidad);
}

/* ---------- Panel de cada jugador (equipo) ----------
   - Ícono: la llama "representante" del equipo (la que juega este turno, o la
     última que jugó). Su tamaño refleja la vida; si no quedan llamas, el fósforo.
   - Una barra de vida por llama (en Clásico, una sola). La representante se resalta.
   - Abajo: "% mojado" (Clásico) o cuántas llamas le quedan (Worms).
   alineadoDerecha: el panel del J2 se ancla al borde derecho y queda espejado. */
function dibujarPanelJugador(equipo, xAncla, y, unidad, alineadoDerecha) {
  const ancho = 23 * unidad, alto = 7.4 * unidad;
  const x = alineadoDerecha ? xAncla - ancho : xAncla;
  const paleta = PALETAS_JUGADORES[equipo];
  const delEquipo = llamasDelEquipo(equipo);
  const vivas = delEquipo.filter(llama => llama.vivo);
  const representante = elegirLlamaRepresentante(equipo, vivas);
  dibujarPanel(x, y, ancho, alto);

  const xIcono = alineadoDerecha ? x + ancho - 3.6 * unidad : x + 3.6 * unidad;
  const mirada = alineadoDerecha ? -1 : 1;
  if (representante) {
    dibujarLlama(ctx, xIcono, y + alto - 1.1 * unidad, unidad * 0.55, paleta, representante.vida / VIDA_MAXIMA,
                 tiempoTotal + representante.numero * 3, mirada, representante.tiempoHerido > 0);
  } else {
    dibujarFosforo(ctx, xIcono, y + alto - 2 * unidad, unidad * 0.45, mirada);
  }

  const xTexto = alineadoDerecha ? x + 1.2 * unidad : x + 7.2 * unidad;
  ctx.textAlign = 'left';
  ctx.fillStyle = paleta.hud;
  ctx.font = fuente(unidad, 1.7, 700);
  ctx.fillText(`${paleta.nombre} · Elemental ${equipo === 0 ? 'Rojo' : 'Azul'}`, xTexto, y + 2.3 * unidad);

  // Barras de vida: el ancho total se reparte entre las llamas, con una separación entre ellas
  const anchoTotal = 14.5 * unidad, altoBarra = 1.3 * unidad, yBarra = y + 3.3 * unidad;
  const separacion = delEquipo.length > 1 ? 0.5 * unidad : 0;
  const anchoBarra = (anchoTotal - separacion * (delEquipo.length - 1)) / delEquipo.length;
  delEquipo.forEach((llama, n) => {
    const xBarra = xTexto + n * (anchoBarra + separacion);
    trazarRectanguloRedondeado(ctx, xBarra, yBarra, anchoBarra, altoBarra, altoBarra / 2);
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.fill();
    if (llama.vida > 0) {
      const anchoLleno = Math.max(altoBarra, anchoBarra * llama.vida / VIDA_MAXIMA);
      trazarRectanguloRedondeado(ctx, xBarra, yBarra, anchoLleno, altoBarra, altoBarra / 2);
      const degrade = ctx.createLinearGradient(xBarra, 0, xBarra + anchoBarra, 0);
      degrade.addColorStop(0, paleta.exterior);
      degrade.addColorStop(1, paleta.medio);
      ctx.fillStyle = degrade;
      ctx.fill();
    }
    if (delEquipo.length > 1 && llama === representante) {
      trazarRectanguloRedondeado(ctx, xBarra, yBarra, anchoBarra, altoBarra, altoBarra / 2);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = Math.max(1, 0.15 * unidad);
      ctx.stroke();
    }
  });

  ctx.font = fuente(unidad, 1.3);
  const yLinea = y + 6.3 * unidad;
  if (!representante) {
    ctx.fillStyle = '#ff6b5a';
    ctx.fillText(delEquipo.length > 1 ? 'SIN LLAMAS 💀' : 'APAGADO 💀', xTexto, yLinea);
    return;
  }
  if (delEquipo.length > 1) {
    ctx.fillStyle = '#ffd38a';
    ctx.fillText(`🔥 ${vivas.length}/${delEquipo.length} llamas`, xTexto, yLinea);
  } else {
    // "% mojado" = la vida que perdió por el agua
    ctx.fillStyle = '#cfe6ff';
    ctx.fillText(`💧 Mojado ${Math.round(VIDA_MAXIMA - representante.vida)}%`, xTexto, yLinea);
  }
  ctx.fillStyle = representante.curandose ? '#8dff9e' : '#9aa7bd';
  ctx.textAlign = 'right';
  const vida = Math.ceil(representante.vida);
  ctx.fillText(representante.curandose ? `▲${vida}` : `HP ${vida}`, xTexto + anchoTotal, yLinea);
}

/* La que juega si es el turno de ese equipo; si no, la última que jugó (si sigue
   viva); si no, la primera viva. null si el equipo se quedó sin llamas. */
function elegirLlamaRepresentante(equipo, vivas) {
  if (vivas.length === 0) return null;
  if (juego.pantalla === 'jugando' && juego.equipoActual === equipo) {
    const actual = llamaActual();
    if (actual && actual.vivo) return actual;
  }
  const ultima = llamas[juego.ultimaLlamaDeCadaEquipo[equipo]];
  return ultima && ultima.vivo ? ultima : vivas[0];
}

/* ---------- Temporizador del turno y panel de viento (centro arriba) ---------- */
function dibujarTemporizadorYViento(anchoPantalla, unidad) {
  const anchoPanel = 14 * unidad, altoPanel = 7.4 * unidad, y = 1.2 * unidad;
  const xTemporizador = anchoPantalla / 2 - anchoPanel - 0.5 * unidad;
  const xViento = anchoPantalla / 2 + 0.5 * unidad;
  const paletaActual = PALETAS_JUGADORES[juego.equipoActual];

  // Temporizador: el texto cambia según la fase del turno
  dibujarPanel(xTemporizador, y, anchoPanel, altoPanel);
  let textoGrande, textoChico;
  if (esTiempoReal()) {
    // Sin turnos: el panel muestra cuánto falta para que cambie el viento
    textoGrande = `${Math.max(0, Math.ceil(juego.tiempoHastaCambioDeViento))}s`;
    textoChico = 'Cambia el viento';
  } else {
    switch (juego.fase) {
      case 'apuntar': textoGrande = `${Math.max(0, Math.ceil(juego.tiempoTurnoRestante))}s`; textoChico = `Turno ${paletaActual.nombre}`; break;
      case 'vuelo': textoGrande = '···'; textoChico = 'Disparo'; break;
      case 'escape': textoGrande = `${juego.tiempoEnFase.toFixed(1)}s`; textoChico = '¡Escapá!'; break;
      default: textoGrande = '≈'; textoChico = 'Simulando…';
    }
  }
  const centroTemporizador = xTemporizador + anchoPanel / 2;
  ctx.textAlign = 'center';
  const ultimosSegundos = !esTiempoReal() && juego.fase === 'apuntar' && juego.tiempoTurnoRestante < 10;
  ctx.fillStyle = ultimosSegundos ? '#ff6b5a' : '#fff'; // rojo en los últimos 10 s del turno
  ctx.font = fuente(unidad, 3.4, 800);
  ctx.fillText(textoGrande, centroTemporizador, y + 4.1 * unidad);
  ctx.fillStyle = esTiempoReal() ? '#bfe3ff' : paletaActual.hud;
  ctx.font = fuente(unidad, 1.4, 600);
  ctx.fillText(textoChico, centroTemporizador, y + 6.3 * unidad);

  // Viento: flecha cuyo largo es proporcional a la fuerza
  dibujarPanel(xViento, y, anchoPanel, altoPanel);
  const centroViento = xViento + anchoPanel / 2;
  const flechaTexto = viento < -0.02 ? '←' : viento > 0.02 ? '→' : '';
  ctx.fillStyle = '#9ec9ff';
  ctx.font = fuente(unidad, 1.15, 600);
  ctx.fillText(`VIENTO ${Math.abs(viento).toFixed(2)} ${flechaTexto}`, centroViento, y + 2.3 * unidad);

  const yFlecha = y + altoPanel * 0.66, largoMaximo = 5.2 * unidad;
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.lineWidth = 0.3 * unidad;
  ctx.beginPath(); ctx.moveTo(centroViento - largoMaximo, yFlecha); ctx.lineTo(centroViento + largoMaximo, yFlecha); ctx.stroke();

  const vientoRelativo = PARAMETROS.vientoMaximo > 0 ? viento / PARAMETROS.vientoMaximo : 0; // -1..1
  if (Math.abs(vientoRelativo) > 0.02) {
    const largo = vientoRelativo * largoMaximo, sentido = Math.sign(largo);
    ctx.strokeStyle = '#bfe3ff';
    ctx.lineWidth = 0.45 * unidad;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(centroViento, yFlecha); ctx.lineTo(centroViento + largo, yFlecha); ctx.stroke();
    // Punta de la flecha (triángulo)
    ctx.fillStyle = '#bfe3ff';
    ctx.beginPath();
    ctx.moveTo(centroViento + largo + sentido * 1.0 * unidad, yFlecha);
    ctx.lineTo(centroViento + largo - sentido * 0.2 * unidad, yFlecha - 0.8 * unidad);
    ctx.lineTo(centroViento + largo - sentido * 0.2 * unidad, yFlecha + 0.8 * unidad);
    ctx.closePath();
    ctx.fill();
  } else {
    ctx.fillStyle = '#bfe3ff';
    ctx.fillText('calma', centroViento, yFlecha + 0.45 * unidad);
  }
}

/* ---------- Selectores de armas (abajo) ----------
   Por turnos: uno al centro, de la llama del turno.
   Tiempo real: uno por jugador (J1 abajo a la izquierda, J2 abajo a la derecha). */
const AYUDA_TECLAS_POR_TURNOS =
  'Mover A/D o ←/→ · Saltar Espacio o Shift der. · Apuntar W/S o ↑/↓ · Disparar F o Enter (mantener) · Arma Q o .';
const AYUDA_TECLAS_TIEMPO_REAL = [
  'J1: A/D mover · Espacio saltar · W/S apuntar · F disparar · Q arma',
  'J2: ←/→ mover · Shift der. saltar · ↑/↓ apuntar · Enter disparar · . arma'
];

function dibujarSelectoresDeArmas(anchoPantalla, altoPantalla, unidad) {
  const anchoBoton = 13 * unidad, altoBoton = 4.6 * unidad, separacion = 1 * unidad;
  const anchoSelector = 2 * anchoBoton + separacion;
  const y = altoPantalla - altoBoton - 1.4 * unidad;
  ctx.font = fuente(unidad, 1.05);
  ctx.fillStyle = 'rgba(200,215,235,0.55)';

  if (esTiempoReal()) {
    const margen = 1.2 * unidad;
    [0, 1].forEach(equipo => {
      const x = equipo === 0 ? margen : anchoPantalla - margen - anchoSelector;
      const llama = llamasDelEquipo(equipo)[0];
      if (llama) dibujarSelectorDeArmas(llama, x, y, anchoBoton, altoBoton, separacion, unidad);
      // La ayuda de J2 se alinea a la derecha para que no se salga de la pantalla
      ctx.textAlign = equipo === 0 ? 'left' : 'right';
      ctx.fillStyle = 'rgba(200,215,235,0.55)';
      ctx.font = fuente(unidad, 1.05);
      ctx.fillText(AYUDA_TECLAS_TIEMPO_REAL[equipo], equipo === 0 ? x : x + anchoSelector, y - 0.8 * unidad);
    });
    return;
  }

  const llama = llamaActual();
  if (!llama) return;
  const x = anchoPantalla / 2 - anchoSelector / 2;
  dibujarSelectorDeArmas(llama, x, y, anchoBoton, altoBoton, separacion, unidad);
  // Ayuda de controles sobre los botones
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(200,215,235,0.55)';
  ctx.font = fuente(unidad, 1.05);
  const ayudaCambio = llamasPorEquipo() > 1 ? ' · Tab cambiar llama' : '';
  ctx.fillText(`${AYUDA_TECLAS_POR_TURNOS}${ayudaCambio} · ángulo ${Math.round(llama.angulo)}°`, anchoPantalla / 2, y - 0.8 * unidad);
}

/* Los dos botones de arma de una llama; el elegido se marca con el color del jugador. */
function dibujarSelectorDeArmas(llama, xInicial, y, anchoBoton, altoBoton, separacion, unidad) {
  const armas = [
    { nombre: 'Bola de Fuego', detalle: 'cráter + calor' },
    { nombre: 'Escupir Magma', detalle: 'barrera / cura' }
  ];

  armas.forEach((arma, numeroArma) => {
    const x = xInicial + numeroArma * (anchoBoton + separacion);
    const elegida = llama.arma === numeroArma;
    dibujarPanel(x, y, anchoBoton, altoBoton);
    if (elegida) {
      trazarRectanguloRedondeado(ctx, x, y, anchoBoton, altoBoton, altoBoton * 0.18);
      ctx.strokeStyle = llama.paleta.hud;
      ctx.lineWidth = 0.3 * unidad;
      ctx.stroke();
    }

    // Ícono
    const xIcono = x + 2.4 * unidad, yIcono = y + altoBoton / 2;
    if (numeroArma === ARMA_BOLA_DE_FUEGO) {
      const degrade = ctx.createRadialGradient(xIcono, yIcono, 0, xIcono, yIcono, 1.3 * unidad);
      degrade.addColorStop(0, '#fff3c4');
      degrade.addColorStop(0.5, '#ff9a2e');
      degrade.addColorStop(1, 'rgba(255,60,10,0)');
      ctx.fillStyle = degrade;
      ctx.beginPath(); ctx.arc(xIcono, yIcono, 1.3 * unidad, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.fillStyle = '#6b3d22';
      ctx.beginPath(); ctx.ellipse(xIcono, yIcono + 0.2 * unidad, 1.3 * unidad, 0.9 * unidad, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ff6a1a';
      ctx.beginPath(); ctx.ellipse(xIcono, yIcono - 0.2 * unidad, 0.8 * unidad, 0.45 * unidad, 0, 0, Math.PI * 2); ctx.fill();
    }

    ctx.textAlign = 'left';
    ctx.fillStyle = elegida ? '#fff' : '#8a96aa';
    ctx.font = fuente(unidad, 1.3, 600);
    ctx.fillText(arma.nombre, x + 4.4 * unidad, y + 2.1 * unidad);
    ctx.fillStyle = '#6f7c92';
    ctx.font = fuente(unidad, 1.05);
    ctx.fillText(arma.detalle, x + 4.4 * unidad, y + 3.6 * unidad);
  });
}

/* ---------- Cartel grande en el centro ("Turno de J2", "¡J1 se apagó!") ----------
   Aparece en 0.2 s, se queda y se desvanece en el último medio segundo. */
function dibujarCartel(anchoPantalla, altoPantalla, unidad) {
  const edad = juego.cartel.edad;
  let opacidad = 1;
  if (edad < 0.2) opacidad = edad / 0.2;
  else if (edad > DURACION_CARTEL - 0.5) opacidad = Math.max(0, (DURACION_CARTEL - edad) / 0.5);

  ctx.globalAlpha = opacidad;
  ctx.textAlign = 'center';
  ctx.font = fuente(unidad, 4.2, 800);
  ctx.fillStyle = 'rgba(0,0,0,0.5)'; // sombra
  ctx.fillText(juego.cartel.texto, anchoPantalla / 2 + 0.25 * unidad, altoPantalla * 0.36 + 0.25 * unidad);
  ctx.fillStyle = juego.cartel.color;
  ctx.fillText(juego.cartel.texto, anchoPantalla / 2, altoPantalla * 0.36);
  ctx.globalAlpha = 1;
}

/* ---------- Pantalla de título y de fin de partida ---------- */
function dibujarPantallaSuperpuesta(anchoPantalla, altoPantalla, unidad) {
  ctx.fillStyle = 'rgba(3,6,14,0.62)';
  ctx.fillRect(0, 0, anchoPantalla, altoPantalla);
  ctx.textAlign = 'center';

  const degradeTitulo = ctx.createLinearGradient(anchoPantalla / 2 - 25 * unidad, 0, anchoPantalla / 2 + 25 * unidad, 0);
  degradeTitulo.addColorStop(0, '#ff6a1a');
  degradeTitulo.addColorStop(0.5, '#ffd38a');
  degradeTitulo.addColorStop(1, '#4fe3ff');
  ctx.fillStyle = degradeTitulo;
  ctx.font = fuente(unidad, 8, 900);

  if (juego.pantalla === 'titulo') {
    ctx.fillText('FIRE SPLASH', anchoPantalla / 2, altoPantalla * 0.34);
    ctx.fillStyle = '#cfe0f5';
    ctx.font = fuente(unidad, 1.6);
    ctx.fillText('Dos elementales de fuego. Una caverna helada. Usá el agua para apagar a tu rival.', anchoPantalla / 2, altoPantalla * 0.34 + 4 * unidad);
    dibujarSelectorDeModo(anchoPantalla, altoPantalla * 0.43, unidad);
    const lineasAyuda = [
      'J1: A/D mover · Espacio saltar · W/S apuntar · F disparar (mantener) · Q arma',
      'J2: ←/→ mover · Shift der. saltar · ↑/↓ apuntar · Enter disparar (mantener) · . arma',
      '🎮 Joystick: stick mover · A saltar · stick der. apuntar · RT disparar · LB/RB arma · Y llama',
      'Por turnos se puede usar cualquiera de los controles · Tab cambia de llama (Worms)',
      'P debug · 8 temperatura · 9 grilla · 0 nuevo mapa · N sonido'
    ];
    ctx.textAlign = 'center';
    ctx.fillStyle = '#9fb2cc';
    ctx.font = fuente(unidad, 1.3);
    lineasAyuda.forEach((linea, n) => ctx.fillText(linea, anchoPantalla / 2, altoPantalla * 0.63 + n * 2.1 * unidad));
  } else {
    ctx.fillText(juego.textoGanador, anchoPantalla / 2, altoPantalla * 0.42);
    ctx.fillStyle = '#9fb2cc';
    ctx.font = fuente(unidad, 1.5);
    ctx.fillText(`Modo ${MODOS_DE_JUEGO[juego.modo].nombre}`, anchoPantalla / 2, altoPantalla * 0.42 + 3.5 * unidad);
  }

  // Texto que "respira": la opacidad oscila entre 0.1 y 1 con un seno
  const opacidad = 0.55 + 0.45 * Math.sin(tiempoTotal * 4);
  ctx.fillStyle = `rgba(255,255,255,${opacidad})`;
  ctx.font = fuente(unidad, 2, 700);
  ctx.textAlign = 'center';
  ctx.fillText(juego.pantalla === 'titulo' ? 'ENTER o START para empezar' : 'ENTER / START revancha   ·   M / BACK menú', anchoPantalla / 2, altoPantalla * 0.88);
}

/* Dos tarjetas (una por modo); la elegida se resalta. Se cambia con ←/→ o 1/2. */
function dibujarSelectorDeModo(anchoPantalla, y, unidad) {
  const anchoTarjeta = 20 * unidad, altoTarjeta = 6 * unidad, separacion = 1.5 * unidad;
  const anchoTotal = ORDEN_DE_MODOS.length * anchoTarjeta + (ORDEN_DE_MODOS.length - 1) * separacion;
  const xInicial = anchoPantalla / 2 - anchoTotal / 2;

  ORDEN_DE_MODOS.forEach((clave, n) => {
    const modo = MODOS_DE_JUEGO[clave];
    const elegido = clave === juego.modo;
    const x = xInicial + n * (anchoTarjeta + separacion);
    dibujarPanel(x, y, anchoTarjeta, altoTarjeta);
    if (elegido) {
      trazarRectanguloRedondeado(ctx, x, y, anchoTarjeta, altoTarjeta, altoTarjeta * 0.18);
      ctx.strokeStyle = '#ffd38a';
      ctx.lineWidth = 0.3 * unidad;
      ctx.stroke();
    }
    ctx.textAlign = 'center';
    ctx.fillStyle = elegido ? '#fff' : '#7f8ba0';
    ctx.font = fuente(unidad, 1.9, 800);
    ctx.fillText(`${n + 1} · ${modo.nombre}`, x + anchoTarjeta / 2, y + 2.6 * unidad);
    ctx.fillStyle = elegido ? '#cfe0f5' : '#6f7c92';
    ctx.font = fuente(unidad, 1.2);
    ctx.fillText(modo.detalle, x + anchoTarjeta / 2, y + 4.6 * unidad);
  });

  ctx.fillStyle = '#9fb2cc';
  ctx.font = fuente(unidad, 1.2);
  ctx.fillText('← / →  o la cruz del joystick: elegir modo', anchoPantalla / 2, y + altoTarjeta + 2 * unidad);
}
