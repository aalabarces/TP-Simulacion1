'use strict';
/* =============================================================================
   PANEL DE DEBUG
   - Vistas: temperatura (T) y grilla/estados (G). Solo una a la vez.
   - Estadísticas: FPS, tiempos, cantidad de agua en grilla vs. partículas.
   - Sliders que modifican PARAMETROS en vivo.
   ============================================================================= */

const panelDebug = document.getElementById('panel-debug');
const textoEstadisticas = document.getElementById('estadisticas');
const casillaTemperatura = document.getElementById('casilla-temperatura');
const casillaGrilla = document.getElementById('casilla-grilla');

function alternarPanelDebug() {
  panelDebug.classList.toggle('oculto');
}

function panelDebugVisible() {
  return !panelDebug.classList.contains('oculto');
}

/* Activa/desactiva una vista. Al activar una, se apaga la otra. */
function cambiarVista(nombre, activa) {
  vista[nombre] = activa;
  if (activa) {
    const otra = nombre === 'temperatura' ? 'grilla' : 'temperatura';
    vista[otra] = false;
  }
  casillaTemperatura.checked = vista.temperatura;
  casillaGrilla.checked = vista.grilla;
}

casillaTemperatura.addEventListener('change', () => cambiarVista('temperatura', casillaTemperatura.checked));
casillaGrilla.addEventListener('change', () => cambiarVista('grilla', casillaGrilla.checked));

document.getElementById('boton-nuevo-mapa').addEventListener('click', evento => {
  evento.target.blur(); // para que Espacio no vuelva a "apretar" el botón
  if (juego.pantalla === 'jugando') empezarPartida();
  else prepararMundo();
});

/* Leyenda de colores de la vista de grilla */
function construirLeyenda() {
  const colores = ['#0c0e14', '#78c8ff', '#6e6e73', '#1e50ff', '#ff7800', '#965a32'];
  const items = NOMBRES_MATERIALES.map((nombre, i) => `<span style="background:${colores[i]}"></span>${nombre}`);
  items.push('<span style="background:#ff2bd6"></span>Partícula');
  document.getElementById('leyenda').innerHTML = items.join(' ');
}

/* Un slider por cada entrada de SLIDERS_DEBUG */
function construirSliders() {
  const contenedor = document.getElementById('contenedor-sliders');
  for (const fila of SLIDERS_DEBUG) {
    if (fila.length === 1) {
      const titulo = document.createElement('h4');
      titulo.textContent = fila[0];
      contenedor.appendChild(titulo);
      continue;
    }
    const [clave, etiqueta, minimo, maximo, paso] = fila;
    const envoltorio = document.createElement('div');
    envoltorio.className = 'slider';

    const textoEtiqueta = document.createElement('label');
    const textoValor = document.createElement('b');
    textoValor.textContent = PARAMETROS[clave];
    textoEtiqueta.append(etiqueta, textoValor);

    const control = document.createElement('input');
    Object.assign(control, { type: 'range', min: minimo, max: maximo, step: paso, value: PARAMETROS[clave] });
    control.addEventListener('input', () => {
      PARAMETROS[clave] = parseFloat(control.value);
      textoValor.textContent = PARAMETROS[clave];
    });

    envoltorio.append(textoEtiqueta, control);
    contenedor.appendChild(envoltorio);
  }
}

function actualizarEstadisticas(estadisticas) {
  textoEstadisticas.textContent =
    `FPS         ${estadisticas.fps.toFixed(0)}\n` +
    `simulación  ${estadisticas.msSimulacion.toFixed(2)} ms/paso\n` +
    `dibujo      ${estadisticas.msDibujo.toFixed(2)} ms\n` +
    `grilla      ${ANCHO_GRILLA}×${ALTO_GRILLA} (${TOTAL_CELDAS} celdas)\n` +
    `agua grilla ${celdasDeAguaEnGrilla}  masa ${masaTotalDeAgua.toFixed(0)}\n` +
    `flujos/paso ${celdasDeAguaActivas}\n` +
    `partículas  ${particulasAgua.length}  efectos ${efectos.length}\n` +
    `fase        ${juego.pantalla}/${juego.fase}\n` +
    `viento      ${viento.toFixed(2)}\n` +
    `semilla     ${mapa.semilla}`;
}

construirLeyenda();
construirSliders();
