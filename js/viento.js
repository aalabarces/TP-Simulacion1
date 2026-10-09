'use strict';
/* =============================================================================
   VIENTO VISIBLE (solo visual)

   Estelas finas que cruzan la caverna a la velocidad del viento, para que se
   vea dentro del mapa (además del panel del HUD):
     - Cuanto más fuerte el viento, más estelas y más rápidas.
     - Sin viento casi no hay (unas pocas, quietas, que se desvanecen).
     - Solo se dibujan sobre AIRE: no aparecen dentro del hielo ni del agua.
   No afectan la simulación: el efecto real del viento está en proyectiles.js
   (disparos) y particulas-agua.js (gotas).
   ============================================================================= */

const ESTELAS_CON_VIENTO_MAXIMO = 90;  // cantidad de estelas con el viento al máximo
const ESTELAS_MINIMAS = 6;             // siempre hay algunas, aunque haya calma
const VELOCIDAD_VISUAL_VIENTO = 75;    // celdas/s de una estela con viento 1

let estelasViento = [];
const zonaViento = { filaMinima: 50, filaMaxima: 150 }; // franja de aire de la caverna

/* Después de generar el mapa: la franja va desde abajo del techo hasta el lago. */
function prepararViento() {
  let fila = 0;
  while (fila < ALTO_GRILLA - 1 && material[indiceDeCelda(MITAD_ANCHO, fila)] !== AIRE) fila++;
  zonaViento.filaMinima = fila + 2;
  estelasViento = [];
}

/* Una estela nueva. Si "desdeElBorde" es true nace en el borde por donde entra
   el viento (así las estelas "llegan" a la pantalla); si no, en cualquier lugar. */
function crearEstelaDeViento(desdeElBorde) {
  zonaViento.filaMaxima = mapa.filaSuperiorLago - 2; // el lago sube con las cascadas
  const sentido = viento >= 0 ? 1 : -1;
  return {
    x: desdeElBorde ? (sentido > 0 ? 0 : ANCHO_GRILLA) : Math.random() * ANCHO_GRILLA,
    y: zonaViento.filaMinima + Math.random() * Math.max(1, zonaViento.filaMaxima - zonaViento.filaMinima),
    largo: 3 + Math.random() * 6,
    rapidez: 0.7 + Math.random() * 0.6,  // cada estela va a una velocidad un poco distinta
    fase: Math.random() * Math.PI * 2,    // para la ondulación vertical
    edad: 0,
    duracion: 2 + Math.random() * 3
  };
}

function simularViento(dt) {
  // Cantidad deseada: proporcional a la fuerza relativa del viento (0 a 1)
  const fuerza = PARAMETROS.vientoMaximo > 0 ? Math.min(1, Math.abs(viento) / PARAMETROS.vientoMaximo) : 0;
  const deseadas = Math.round(ESTELAS_MINIMAS + fuerza * (ESTELAS_CON_VIENTO_MAXIMO - ESTELAS_MINIMAS));
  while (estelasViento.length < deseadas) estelasViento.push(crearEstelaDeViento(false));
  if (estelasViento.length > deseadas) estelasViento.length = deseadas;

  const velocidad = viento * VELOCIDAD_VISUAL_VIENTO;
  for (let n = 0; n < estelasViento.length; n++) {
    const estela = estelasViento[n];
    estela.edad += dt;
    estela.x += velocidad * estela.rapidez * dt;
    // Ondulación suave: la estela sube y baja siguiendo un seno
    estela.y += Math.sin(estela.edad * 2 + estela.fase) * 1.5 * dt;
    const salio = estela.x < -10 || estela.x > ANCHO_GRILLA + 10;
    if (salio || estela.edad > estela.duracion) estelasViento[n] = crearEstelaDeViento(salio);
  }
}

function dibujarEstelasViento() {
  const sentido = viento >= 0 ? 1 : -1;
  // Más largas cuanto más fuerte el viento (con calma son casi puntos)
  const estiramiento = 0.3 + Math.min(1, Math.abs(viento)) * 0.9;
  ctx.lineWidth = 0.35;
  ctx.lineCap = 'round';
  for (const estela of estelasViento) {
    const columna = Math.floor(estela.x), fila = Math.floor(estela.y);
    if (!estaDentroDeLaGrilla(columna, fila) || material[fila * ANCHO_GRILLA + columna] !== AIRE) continue;
    // Aparece y desaparece suavemente: opacidad = seno de la vida (0 al nacer, máxima a la mitad, 0 al morir)
    const opacidad = 0.28 * Math.sin(Math.PI * Math.min(1, estela.edad / estela.duracion));
    ctx.strokeStyle = `rgba(220,235,255,${opacidad})`;
    ctx.beginPath();
    ctx.moveTo(estela.x, estela.y);
    ctx.lineTo(estela.x - sentido * estela.largo * estiramiento, estela.y); // la cola queda del lado de donde viene
    ctx.stroke();
  }
}
