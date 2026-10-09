# Fire Splash

Trabajo Práctico de Simulación I (UNAHUR). Juego de artillería por turnos, 1 vs 1 local, en el navegador.

- **Alumnos:** Alan Mazzalai, Agustín Alabarces Varela
- **Docente:** Facundo Saiegh
- **Documento de diseño:** [GDD TP Simulación 1 (1).pdf](GDD%20TP%20Simulación%201%20(1).pdf)

**Para jugar:** abrir `index.html` con doble clic (no hace falta servidor ni instalar nada).

## Estructura

```
index.html              página principal: carga los estilos y los scripts en orden
css/estilos.css         estilos del panel de debug
js/
  configuracion.js      constantes, materiales, parámetros ajustables, física del jugador
  utilidades.js         matemática general: aleatorio con semilla, ruido, colores
  grilla.js             estado de la grilla (arreglos tipados por celda)
  generador-mapa.js     mapa procedural simétrico (techo, reservas, islas, lago)
  temperatura.js        difusión de calor, enfriamiento y cambios de estado
  fluidos.js            autómata celular del agua y el magma (Euleriano)
  particulas-agua.js    agua en caída libre (Lagrangiano)
  efectos.js            vapor, chispas, humo (solo visual)
  jugador.js            elementales: movimiento con colisiones, daño, curación, aura
  proyectiles.js        disparo parabólico, bola de fuego y magma
  turnos.js             pantallas y fases del turno
  entrada.js            teclado
  dibujo-personajes.js  llama y fósforo dibujados por código
  render.js             dibujo del terreno y del mundo
  hud.js                interfaz: vida, temporizador, viento, armas
  debug.js              panel de debug y sliders
  principal.js          paso de simulación y bucle principal
```

Los scripts no son módulos ES: se comparten las variables globales y por eso
**el orden de carga en `index.html` importa** (cada archivo usa lo de los anteriores).

## Cómo funciona la simulación (resumen)

Cada paso de 1/60 s, en este orden (`principal.js → simularPaso`):

1. **Ocupación:** se marcan las celdas tapadas por los jugadores.
2. **Temperatura:** el calor se difunde entre vecinas, todo se enfría hacia el
   ambiente y se aplican los cambios de estado (hielo↔agua, agua→vapor, magma→sólido).
3. **Fluidos (Euleriano):** cada celda de agua guarda cuánta agua tiene (`masaAgua`): la masa cae, se iguala con las vecinas y el exceso sube, así la superficie queda pareja y el agua se detiene sola; el agua sin apoyo pasa a partícula. El magma cae y se escurre.
4. **Partículas (Lagrangiano):** el agua sin apoyo cae con gravedad y viento, moja
   y empuja a los jugadores, y al tocar algo suma su masa a la grilla.
5. **Proyectil, jugadores, efectos y turnos.**

## Controles

| Tecla | Acción |
|---|---|
| A / D | Mover |
| W | Saltar |
| ↑ / ↓ | Ángulo |
| Espacio (mantener) | Cargar la potencia y disparar |
| Q / E (o 1 / 2) | Cambiar de arma |
| P | Panel de debug con sliders |
| T | Vista de temperatura |
| G | Vista de grilla y partículas |
| R | Nuevo mapa |
