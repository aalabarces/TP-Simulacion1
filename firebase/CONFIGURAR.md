# Configurar Firebase para jugar online

Firebase se usa **solo para que las dos PCs se encuentren** (unos pocos KB por partida).
Los controles viajan directo entre las PCs por WebRTC, así que no hay costo por jugar.
Alcanza con el plan gratuito **Spark**, que no cobra: si se pasara de los límites,
corta el servicio en vez de facturar.

## 1. Crear el proyecto

1. Entrar a <https://console.firebase.google.com> → **Agregar proyecto**.
2. Ponerle un nombre (por ejemplo `fire-splash`). **Desactivar Google Analytics** (no hace falta).

## 2. Realtime Database

1. **Compilación → Realtime Database → Crear base de datos**.
2. Ubicación: la más cercana a los jugadores (`us-central1` es la más cercana a Argentina de las que ofrece).
3. Elegir **modo bloqueado**.
4. Pestaña **Reglas** → pegar el contenido de [`database.rules.json`](database.rules.json) → **Publicar**.

Las reglas permiten que solo el anfitrión cree y borre su sala, que un invitado solo pueda
ocupar el lugar de invitado (si está libre) y escribir su respuesta, y limitan el tamaño de los datos.

## 3. Autenticación anónima

1. **Compilación → Authentication → Comenzar → Método de acceso → Anónimo → Habilitar**.

No se piden cuentas ni datos: cada navegador recibe un identificador anónimo que las reglas usan
para saber quién es el anfitrión y quién el invitado.

## 4. Registrar la app web y copiar la configuración

1. **Configuración del proyecto (el engranaje) → Tus apps → Web (`</>`)**.
2. Registrar la app (no hace falta Firebase Hosting).
3. Copiar el objeto `firebaseConfig` y pegar sus valores en [`js/red-config.js`](../js/red-config.js),
   en `RED_CONFIG.firebase`. Hay que completar `apiKey`, `authDomain`, `databaseURL`, `projectId` y `appId`.
   La `databaseURL` aparece en la pestaña **Datos** de Realtime Database (depende de la ubicación elegida).

## 5. Dominios autorizados

**Authentication → Configuración → Dominios autorizados**: agregar el dominio donde se publique el juego
(por ejemplo `tu-usuario.github.io`). `localhost` ya viene autorizado.

## 6. Proteger la API key (recomendado)

La configuración web no es secreta, pero conviene restringirla: en
[Google Cloud Console](https://console.cloud.google.com) → **APIs y servicios → Credenciales** → la clave de
navegador del proyecto → **Restricciones de aplicaciones → Sitios web** → agregar tu dominio y `localhost`.

## 7. Dónde se juega

El online necesita **http(s)**: sirve GitHub Pages, o localmente `python .claude/servidor.py 8123`
y abrir <http://localhost:8123>. Abrir el HTML con doble clic (`file://`) sigue funcionando
para jugar **sin red**, pero no para el online.

## Probar sin Firebase

Para probar el flujo con dos pestañas del mismo navegador, sin internet ni Firebase, abrir
`http://localhost:8123/?red=local` en las dos pestañas: una crea la sala y la otra se une con el código.

## Si dos jugadores no logran conectarse

Algunas redes (NAT estricto, ciertos celulares u oficinas) no permiten la conexión directa. Hace falta un servidor
**TURN** que retransmita los datos (el consumo es mínimo, unos 2 KB/s). Agregar sus datos a
`RED_CONFIG.servidoresIce` en `js/red-config.js`. Hay servicios con plan gratuito (por ejemplo Metered o
Cloudflare TURN; conviene revisar sus límites vigentes).

## Qué hay en la base de datos

Solo existe mientras dos jugadores se conectan, y se borra apenas el canal abre (o si el anfitrión se
desconecta, por `onDisconnect`):

```
rooms/{CODIGO}/host    id anónimo del anfitrión
rooms/{CODIGO}/creada  hora de creación
rooms/{CODIGO}/guest   id anónimo del invitado
rooms/{CODIGO}/offer   oferta de conexión WebRTC (texto)
rooms/{CODIGO}/answer  respuesta del invitado (texto)
```
