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
genera una plataforma por llama (2 o 6): cada par espejado tiene su propia
altura, casi no hay puentes entre ellas (hay que caerse, tirarse con la lengua
o romper terreno) y no tienen nada que las cubra; encima puede haber (al azar) un cuenco con agua, uno vacío, una
repisa o nada. El agua de las cascadas sube desde el fondo (muerte súbita). En la pantalla de título el modo se
elige con ← / →, la cruz del joystick o 1 / 2 / 3.

## Estructura

```
index.html              página principal: carga los estilos y los scripts en orden
css/estilos.css         estilos del panel de debug
js/
  configuracion.js      constantes, materiales, parámetros ajustables, modos de juego
  utilidades.js         matemática general: aleatorio con semilla, ruido, colores
  grilla.js             estado de la grilla (arreglos tipados por celda)
  generador-mapa.js     mapa procedural vertical 384×540: techo con reservas y burbujas,
                        zona alta y baja con cuencos en U (distinto llenado) y repisas,
                        arena central con una plataforma por llama (simétrica) y
                        puentes con pozos, piedras de salvación, lago
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
  controles-tactiles.js botones en pantalla y gestos para jugar desde el celular
  dibujo-personajes.js  llama y fósforo dibujados por código
  camara.js             cámara: zoom, desplazamiento (teclado/joystick) y seguimiento
  render.js             dibujo del terreno y del mundo (solo lo que ve la cámara)
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

## Celular

En pantallas táctiles aparecen botones sobre el juego (solo modos por turnos,
con el teléfono horizontal):

| Botón / gesto | Acción |
|---|---|
| ◀ ▶ | Mover |
| ⤒ | Saltar |
| ▲ ▼ | Ángulo |
| 🔥 (mantener y soltar) | Cargar y disparar |
| Tocar un arma del selector | Elegir arma |
| ⇄ | Cambiar de llama (Worms) |
| Arrastrar un dedo / pellizcar | Mover la cámara / zoom |
| ⛶ | Pantalla completa |

En el celular no se puede abrir el HTML con doble clic: hay que publicarlo, por
ejemplo con **GitHub Pages** (Settings → Pages del repo, rama `master`, carpeta raíz).
Para probar los controles táctiles en la PC: abrir `index.html?tactil=1`.

## Controles

Un esquema de teclado por jugador (para que los dos entren a la vez en Tiempo
real). En los modos por turnos, el jugador activo puede usar cualquiera de los dos.

| Acción | J1 | J2 | Joystick (Xbox / PlayStation) |
|---|---|---|---|
| Mover | A / D | ← / → | Stick izquierdo o cruz ← → |
| Saltar | Espacio | Shift derecho | A / ✕ |
| Apuntar | W / S | ↑ / ↓ | Stick derecho o izquierdo ↑ ↓, o cruz ↑ ↓ |
| Cargar y disparar (mantener) | F | Enter | Gatillo derecho (RT / R2) o B / ○ |
| Arma anterior / siguiente (bola · magma · lengua · mortero · jetpack) | Q / E | , / . | LB / RB (L1 / R1) |
| Cambiar de llama (Worms) | Tab | Tab | Y / △ |
| Volver al menú principal | Escape (o M) | Escape (o M) | ≡ (Start) o ⧉ (Back) |

Con joysticks, el primero que se conecta es de J1 y el segundo de J2 (en los
modos por turnos alcanza con uno). El navegador los reconoce recién cuando se
aprieta algún botón con la página abierta.

### Lengua de fuego

Tercera arma (la elegís con **Q / E**, junto a la bola de fuego y el magma). No
dispara: lanza una lengua de fuego en la dirección de la mira (alcance 70
celdas) y, si toca hielo, piedra o roca volcánica, te dejás colgar de ella y te
balanceás como en una soga.

- **Disparar** (F / Enter / RT / B) la lanza; con la lengua enganchada, la suelta. Si
  no toca nada falla y no gasta nada.
- **A / D** balancean; **W / S** (apuntar) acortan y alargan la cuerda.
- **Saltar** también suelta, conservando la velocidad con la que ibas.
- **El ancla de hielo se derrite**: la lengua calienta el hielo y a los ~3 s se
  funde y te suelta. En piedra y roca volcánica aguanta sin límite.
- **Hasta 3 enganches seguidos**; después de 2 s sin estar colgada se recuperan.
  Al terminar el turno la lengua se suelta.
- No termina el turno: podés reposicionarte y después disparar (bola de fuego o
  magma) con el resto del turno, incluso colgado.
- **Caídas fuertes aturden:** si aterrizás a más de 55 celdas/s (caer unas 15
  celdas) no podés controlar a la llama hasta 2 s, según la fuerza del golpe.
  Caer al agua no aturde. Todos los valores se ajustan en el panel de debug (P).

### Mortero

Cuarta arma. Se maneja como un disparo: **mantener disparar** carga la potencia,
**W / S** giran el ángulo (una parábola punteada muestra por dónde saldrías) y
al **soltar** la propia llama sale volando en esa dirección, hasta 100 celdas/s.

- Al despegar hay una **explosión chica bajo los pies** (radio 3) que rompe el
  suelo y empuja a las otras llamas cercanas, pero no a la tuya.
- No termina el turno y **no tiene límite de usos**: el costo es la caída. Si
  aterrizás a más de 55 celdas/s quedás aturdida, y caer al agua es peligroso.
- En tiempo real tiene la misma recarga que un disparo.

### Jetpack

Quinta arma. **Mantener disparar** empuja a la llama hacia donde apunta (W / S
giran el ángulo; A / D corrigen el rumbo sin dar vuelta el empuje) mientras
quede combustible: unos 3 s de empuje continuo, que dan para subir ~150 celdas.

- El tanque se **llena al empezar cada turno**; en tiempo real se recarga de a
  poco (0,15/s) y solo apoyada en el suelo.
- **El agua lo apaga:** dentro del agua no empuja.
- La barra de combustible está sobre la llama. Sin combustible en el aire, te
  caés (y la caída fuerte aturde).
- No termina el turno: podés volar y después disparar con otra arma.

### Cámara

El mundo es más grande que la pantalla. Por turnos la cámara sigue a la llama
del turno, al proyectil y al lugar del impacto; en Tiempo real encuadra a las
dos llamas. También se maneja a mano y vuelve sola al empezar el turno, al
disparar, con **C** o tras 6 s sin tocarla.

| Acción | Teclado | Joystick |
|---|---|---|
| Mover | I J K L | mantener LT + stick derecho |
| Zoom | − / = | mantener LT + cruz ↑ ↓ |
| Recentrar | C | |

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
