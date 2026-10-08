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

  if (jugadores.length === 2) {
    dibujarPanelJugador(jugadores[0], 1.2 * unidad, 1.2 * unidad, unidad, false);
    dibujarPanelJugador(jugadores[1], anchoPantalla - 1.2 * unidad, 1.2 * unidad, unidad, true);
  }

  if (juego.pantalla === 'jugando') {
    dibujarTemporizadorYViento(anchoPantalla, unidad);
    dibujarSelectorDeArmas(anchoPantalla, altoPantalla, unidad);
  }
  if (juego.cartel && juego.pantalla === 'jugando') dibujarCartel(anchoPantalla, altoPantalla, unidad);
  if (juego.pantalla === 'titulo' || juego.pantalla === 'fin') dibujarPantallaSuperpuesta(anchoPantalla, altoPantalla, unidad);
}

/* ---------- Panel de cada jugador: llama de vida, barra y "% mojado" ----------
   alineadoDerecha: el panel del J2 se ancla al borde derecho y queda espejado. */
function dibujarPanelJugador(jugador, xAncla, y, unidad, alineadoDerecha) {
  const ancho = 23 * unidad, alto = 7.4 * unidad;
  const x = alineadoDerecha ? xAncla - ancho : xAncla;
  dibujarPanel(x, y, ancho, alto);

  // Ícono: la misma llama del juego (su tamaño refleja la vida) o el fósforo
  const xIcono = alineadoDerecha ? x + ancho - 3.6 * unidad : x + 3.6 * unidad;
  const mirada = alineadoDerecha ? -1 : 1;
  if (jugador.vivo) {
    dibujarLlama(ctx, xIcono, y + alto - 1.1 * unidad, unidad * 0.55, jugador.paleta, jugador.vida / VIDA_MAXIMA,
                 tiempoTotal + jugador.numero * 3, mirada, jugador.tiempoHerido > 0);
  } else {
    dibujarFosforo(ctx, xIcono, y + alto - 2 * unidad, unidad * 0.45, mirada);
  }

  const xTexto = alineadoDerecha ? x + 1.2 * unidad : x + 7.2 * unidad;
  ctx.textAlign = 'left';
  ctx.fillStyle = jugador.paleta.hud;
  ctx.font = fuente(unidad, 1.7, 700);
  ctx.fillText(`${jugador.paleta.nombre} · Elemental ${jugador.numero === 0 ? 'Rojo' : 'Azul'}`, xTexto, y + 2.3 * unidad);

  // Barra de vida (fondo + parte llena proporcional a la vida)
  const anchoBarra = 14.5 * unidad, altoBarra = 1.3 * unidad, yBarra = y + 3.3 * unidad;
  trazarRectanguloRedondeado(ctx, xTexto, yBarra, anchoBarra, altoBarra, altoBarra / 2);
  ctx.fillStyle = 'rgba(255,255,255,0.1)';
  ctx.fill();
  if (jugador.vida > 0) {
    const anchoLleno = Math.max(altoBarra, anchoBarra * jugador.vida / VIDA_MAXIMA);
    trazarRectanguloRedondeado(ctx, xTexto, yBarra, anchoLleno, altoBarra, altoBarra / 2);
    const degrade = ctx.createLinearGradient(xTexto, 0, xTexto + anchoBarra, 0);
    degrade.addColorStop(0, jugador.paleta.exterior);
    degrade.addColorStop(1, jugador.paleta.medio);
    ctx.fillStyle = degrade;
    ctx.fill();
  }

  ctx.font = fuente(unidad, 1.3);
  const yLinea = y + 6.3 * unidad;
  if (!jugador.vivo) {
    ctx.fillStyle = '#ff6b5a';
    ctx.fillText('APAGADO 💀', xTexto, yLinea);
    return;
  }
  // "% mojado" = la vida que perdió por el agua
  ctx.fillStyle = '#cfe6ff';
  ctx.fillText(`💧 Mojado ${Math.round(VIDA_MAXIMA - jugador.vida)}%`, xTexto, yLinea);
  ctx.fillStyle = jugador.curandose ? '#8dff9e' : '#9aa7bd';
  ctx.textAlign = 'right';
  ctx.fillText(jugador.curandose ? `▲${Math.ceil(jugador.vida)}` : `HP ${Math.ceil(jugador.vida)}`, xTexto + anchoBarra, yLinea);
}

/* ---------- Temporizador del turno y panel de viento (centro arriba) ---------- */
function dibujarTemporizadorYViento(anchoPantalla, unidad) {
  const anchoPanel = 14 * unidad, altoPanel = 7.4 * unidad, y = 1.2 * unidad;
  const xTemporizador = anchoPantalla / 2 - anchoPanel - 0.5 * unidad;
  const xViento = anchoPantalla / 2 + 0.5 * unidad;
  const paletaActual = PALETAS_JUGADORES[juego.jugadorActual];

  // Temporizador: el texto cambia según la fase del turno
  dibujarPanel(xTemporizador, y, anchoPanel, altoPanel);
  let textoGrande, textoChico;
  switch (juego.fase) {
    case 'apuntar': textoGrande = `${Math.max(0, Math.ceil(juego.tiempoTurnoRestante))}s`; textoChico = `Turno ${paletaActual.nombre}`; break;
    case 'vuelo': textoGrande = '···'; textoChico = 'Disparo'; break;
    case 'escape': textoGrande = `${juego.tiempoEnFase.toFixed(1)}s`; textoChico = '¡Escapá!'; break;
    default: textoGrande = '≈'; textoChico = 'Simulando…';
  }
  const centroTemporizador = xTemporizador + anchoPanel / 2;
  ctx.textAlign = 'center';
  ctx.fillStyle = juego.fase === 'apuntar' && juego.tiempoTurnoRestante < 10 ? '#ff6b5a' : '#fff'; // rojo en los últimos 10 s
  ctx.font = fuente(unidad, 3.4, 800);
  ctx.fillText(textoGrande, centroTemporizador, y + 4.1 * unidad);
  ctx.fillStyle = paletaActual.hud;
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

/* ---------- Selector de armas (abajo al centro) ---------- */
function dibujarSelectorDeArmas(anchoPantalla, altoPantalla, unidad) {
  const jugador = jugadores[juego.jugadorActual];
  if (!jugador) return;
  const anchoBoton = 13 * unidad, altoBoton = 4.6 * unidad, separacion = 1 * unidad;
  const xInicial = anchoPantalla / 2 - anchoBoton - separacion / 2;
  const y = altoPantalla - altoBoton - 1.4 * unidad;
  const armas = [
    { nombre: 'Bola de Fuego', detalle: '1 · cráter + calor' },
    { nombre: 'Escupir Magma', detalle: '2 · barrera / cura' }
  ];

  armas.forEach((arma, numeroArma) => {
    const x = xInicial + numeroArma * (anchoBoton + separacion);
    const elegida = jugador.arma === numeroArma;
    dibujarPanel(x, y, anchoBoton, altoBoton);
    if (elegida) {
      trazarRectanguloRedondeado(ctx, x, y, anchoBoton, altoBoton, altoBoton * 0.18);
      ctx.strokeStyle = jugador.paleta.hud;
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

  // Ayuda de controles sobre los botones
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(200,215,235,0.55)';
  ctx.font = fuente(unidad, 1.05);
  ctx.fillText(`A/D mover · W saltar · ↑/↓ ángulo (${Math.round(jugador.angulo)}°) · Espacio cargar · Q/E arma`,
               anchoPantalla / 2, y - 0.8 * unidad);
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
    const lineasAyuda = [
      'A / D  mover (resbala en el hielo)   ·   W  saltar',
      '↑ / ↓  ángulo   ·   Espacio (mantener)  cargar potencia y disparar',
      'Q / E  cambiar arma: Bola de Fuego (cráter + derrite) · Escupir Magma (barrera, cura)',
      'Si el agua te cubre por completo, te apagás. Pararte sobre magma caliente te cura.',
      'P debug · T temperatura · G grilla · R nuevo mapa'
    ];
    ctx.fillStyle = '#9fb2cc';
    ctx.font = fuente(unidad, 1.35);
    lineasAyuda.forEach((linea, n) => ctx.fillText(linea, anchoPantalla / 2, altoPantalla * 0.5 + n * 2.4 * unidad));
  } else {
    ctx.fillText(juego.textoGanador, anchoPantalla / 2, altoPantalla * 0.42);
  }

  // Texto que "respira": la opacidad oscila entre 0.1 y 1 con un seno
  const opacidad = 0.55 + 0.45 * Math.sin(tiempoTotal * 4);
  ctx.fillStyle = `rgba(255,255,255,${opacidad})`;
  ctx.font = fuente(unidad, 2, 700);
  ctx.fillText(juego.pantalla === 'titulo' ? 'ENTER para empezar' : 'ENTER para la revancha', anchoPantalla / 2, altoPantalla * 0.82);
}
