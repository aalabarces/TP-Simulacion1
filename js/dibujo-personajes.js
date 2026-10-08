'use strict';
/* =============================================================================
   PERSONAJES DIBUJADOS POR CÓDIGO
   Las coordenadas de estos dibujos son "locales": el origen (0, 0) está en
   los pies del personaje y se usa escala para agrandarlos o achicarlos.
   Así el mismo dibujo sirve en el mundo (en celdas) y en el HUD (en píxeles).
   ============================================================================= */

/* Elemental de fuego.
   - El tamaño depende de la vida: con vida 0 mide el 55% y con vida 100 el 100%.
   - Las lenguas de fuego se mueven con senos de distinta frecuencia (parpadeo).
   - Con poca vida (< 35%) la llama titila.
   vidaRelativa: 0..1, tiempo: segundos (para animar), mirada: -1 izquierda / 1 derecha. */
function dibujarLlama(ctx, x, y, escala, paleta, vidaRelativa, tiempo, mirada, herido) {
  const tamanio = escala * (0.55 + 0.45 * vidaRelativa);
  const titileo = vidaRelativa < 0.35 ? (Math.sin(tiempo * 40) > 0 ? 1 : 0.55) : 1;

  ctx.save();
  ctx.translate(x, y);
  ctx.scale(tamanio, tamanio);
  ctx.globalAlpha = titileo * (herido ? 0.75 : 1);

  // Oscilación de las tres puntas de la llama
  const puntaCentral = Math.sin(tiempo * 9) * 0.4;
  const puntaIzquierda = Math.sin(tiempo * 7 + 1.3) * 0.5;
  const puntaDerecha = Math.sin(tiempo * 11 + 2.1) * 0.35;

  // Contorno: cuerpo redondo abajo y tres lenguas de fuego arriba
  ctx.beginPath();
  ctx.moveTo(-3, -2.2);
  ctx.bezierCurveTo(-3.4, -4.5, -2.6 + puntaIzquierda * 0.3, -5.5, -2.2 + puntaIzquierda, -7.2); // lengua izquierda
  ctx.quadraticCurveTo(-1.2, -5.8, -0.6, -6.2);
  ctx.quadraticCurveTo(-0.2 + puntaCentral * 0.5, -8.5, 0.3 + puntaCentral, -9.8);               // lengua central
  ctx.quadraticCurveTo(1.2, -7, 1.6, -6.4);
  ctx.quadraticCurveTo(2.4 + puntaDerecha, -7.6, 2.6 + puntaDerecha, -7.9);                      // lengua derecha
  ctx.bezierCurveTo(3.6, -5, 3.4, -3.4, 3, -2.2);
  ctx.bezierCurveTo(2.8, -0.3, 1.6, 0, 0, 0);                                                    // panza
  ctx.bezierCurveTo(-1.6, 0, -2.8, -0.3, -3, -2.2);
  ctx.closePath();

  // Degradé radial: núcleo claro -> color medio -> borde
  const degrade = ctx.createRadialGradient(0, -2.6, 0.4, 0, -3.5, 7);
  degrade.addColorStop(0, paleta.nucleo);
  degrade.addColorStop(0.35, paleta.medio);
  degrade.addColorStop(1, paleta.exterior);
  ctx.fillStyle = degrade;
  ctx.fill();
  if (herido) { ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.fill(); }

  // Ojos (se corren hacia donde mira)
  const corrimiento = mirada * 0.55;
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.ellipse(-1 + corrimiento, -3.3, 0.55, 0.78, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(1 + corrimiento, -3.3, 0.55, 0.78, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#1a1a22';
  ctx.beginPath(); ctx.arc(-1 + corrimiento + mirada * 0.2, -3.2, 0.32, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(1 + corrimiento + mirada * 0.2, -3.2, 0.32, 0, Math.PI * 2); ctx.fill();

  ctx.restore();
}

/* Fósforo apagado con ojos (estado de muerte, "estilo Clipo"). */
function dibujarFosforo(ctx, x, y, escala, mirada) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(escala * mirada, escala); // escala negativa en X = espejado
  ctx.lineCap = 'round';

  // Palito de madera y la parte quemada cerca de la cabeza
  ctx.strokeStyle = '#d2ab78'; ctx.lineWidth = 0.9;
  ctx.beginPath(); ctx.moveTo(-5, -0.5); ctx.lineTo(2, -1.1); ctx.stroke();
  ctx.strokeStyle = '#2c2019';
  ctx.beginPath(); ctx.moveTo(1, -1); ctx.lineTo(3, -1.2); ctx.stroke();

  // Cabeza carbonizada
  ctx.fillStyle = '#141414';
  ctx.beginPath(); ctx.ellipse(4.2, -1.5, 1.6, 1.3, -0.2, 0, Math.PI * 2); ctx.fill();

  // Ojos
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.ellipse(3.6, -1.8, 0.42, 0.56, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(4.7, -1.85, 0.42, 0.56, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#000';
  ctx.beginPath(); ctx.arc(3.65, -1.6, 0.24, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(4.75, -1.65, 0.24, 0, Math.PI * 2); ctx.fill();

  ctx.restore();
}

/* Rectángulo con bordes redondeados (usado por el HUD). */
function trazarRectanguloRedondeado(ctx, x, y, ancho, alto, radio) {
  ctx.beginPath();
  ctx.moveTo(x + radio, y);
  ctx.arcTo(x + ancho, y, x + ancho, y + alto, radio);
  ctx.arcTo(x + ancho, y + alto, x, y + alto, radio);
  ctx.arcTo(x, y + alto, x, y, radio);
  ctx.arcTo(x, y, x + ancho, y, radio);
  ctx.closePath();
}
