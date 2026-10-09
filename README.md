# Fire Splash

Trabajo Práctico de Simulación I (UNAHUR). Juego de artillería por turnos, 1 vs 1 local, en el navegador.

- **Alumnos:** Alan Mazzalai, Agustín Alabarces Varela
- **Docente:** Facundo Saiegh
- **Documento de diseño:** [GDD TP Simulación 1 (1).pdf](GDD%20TP%20Simulación%201%20(1).pdf)

**Para jugar:** abrir `index.html` con doble clic (no hace falta servidor ni instalar nada).

## Modos de juego

- **Clásico 1 vs 1:** por turnos, una llama por jugador.
- **Worms:** por turnos, 3 llamas por jugador. Cada turno juega la siguiente
  llama viva del equipo y con **Tab** (o **Y** en el joystick) se puede cambiar
  a otra antes de cargar el disparo.
- **Tiempo real:** una llama por jugador, los dos se mueven y disparan a la vez.
  Entre disparos hay un tiempo de recarga y el viento cambia cada 20 s.
  Pensado para 2 joysticks (con teclado también se puede, para probar).

En todos, un jugador pierde cuando se le apagan todas sus llamas. El mapa
genera una plataforma por llama (2 o 6). En la pantalla de título el modo se
elige con ← / →, la cruz del joystick o 1 / 2 / 3.

## Estructura

```
index.html              página principal: carga los estilos y los scripts en orden
css/estilos.css         estilos del panel de debug
js/
  configuracion.js      constantes, materiales, parámetros ajustables, modos de juego
  utilidades.js         matemática general: aleatorio con semilla, ruido, colores
  grilla.js             estado de la grilla (arreglos tipados por celda)
  generador-mapa.js     mapa procedural simétrico (techo con reservas y burbujas,
                        una plataforma por llama, puentes con pozos, lago)
  temperatura.js        difusión de calor, enfriamiento y cambios de estado
  fluidos.js            autómata celular del agua y el magma (Euleriano)
  particulas-agua.js    agua en caída libre (Lagrangiano)
  cascadas.js           cascadas laterales que llenan el lago (muerte súbita)
  efectos.js            vapor, chispas, humo (solo visual)
  viento.js             estelas que muestran el viento (solo visual)
  llama.js              llamas (elementales): movimiento con colisiones, daño, curación
  proyectiles.js        disparo parabólico, bola de fuego y magma
  turnos.js             modos de juego, pantallas, turnos por equipo
  joystick.js           joysticks (Gamepad API)
  entrada.js            teclado (un esquema por jugador) y unión con los joysticks
  dibujo-personajes.js  llama y fósforo dibujados por código
  render.js             dibujo del terreno y del mundo
  hud.js                interfaz: vida, temporizador, viento, armas
  debug.js              panel de debug y sliders
  sonido.js             efectos de sonido sintetizados con Web Audio API (sin archivos)
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

**Optimización (agua dormida):** la grilla se divide en bloques de 16×16 y el
autómata del agua solo calcula los bloques donde hubo movimiento en el paso
anterior. El agua en reposo (lago, burbujas, pozos llenos) no consume
procesamiento, como plantea el GDD. Cualquier cambio (explosión, derretir,
gota que aterriza) despierta su zona. Con la vista de grilla (G) los bloques
despiertos se ven en amarillo.

## Controles

Un esquema de teclado por jugador (para que los dos entren a la vez en Tiempo
real). En los modos por turnos, el jugador activo puede usar cualquiera de los dos.

| Acción | J1 | J2 | Joystick (Xbox / PlayStation) |
|---|---|---|---|
| Mover | A / D | ← / → | Stick izquierdo o cruz ← → |
| Saltar | Espacio | Shift derecho | A / ✕ |
| Apuntar | W / S | ↑ / ↓ | Stick derecho o cruz ↑ ↓ |
| Cargar y disparar (mantener) | F | Enter | Gatillo derecho (RT / R2) |
| Cambiar de arma | Q | . (punto) | LB / RB (L1 / R1) |
| Cambiar de llama (Worms) | Tab | Tab | Y / △ |

Con joysticks, el primero que se conecta es de J1 y el segundo de J2 (en los
modos por turnos alcanza con uno). El navegador los reconoce recién cuando se
aprieta algún botón con la página abierta.

| Otras teclas | Acción |
|---|---|
| Enter / Start | Empezar, revancha |
| ← / → o 1 / 2 / 3 (en el título) | Elegir modo de juego |
| M / Back (al terminar) | Volver al menú |
| N | Sonido encendido / apagado |
| P | Panel de debug con sliders |
| 8 | Vista de temperatura |
| 9 | Vista de grilla y partículas |
| 0 | Nuevo mapa |
