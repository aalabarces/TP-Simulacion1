# Online multiplayer for TP (Fire Splash): WebRTC + Firebase signaling

## Context

TP is a 2-player local game (real-time, "clasico" and "worms" turn-based modes) written as plain classic JS scripts, with no build step, that can be opened by double-click. It simulates a 384×540 cell grid (water, magma, temperature, ~2.7 MB of typed arrays), up to 6,000 water drops, flames, projectiles and cascades.

`D:\UNAHUR\simulaciones\webrtc` shows the pattern to reuse: Firebase Realtime Database is used **only for the handshake** (offer, answer, ICE candidates, a presence node, `onDisconnect` cleanup). After that everything flows peer-to-peer over RTCDataChannels. Its game is host-authoritative, with the host sending 20 Hz snapshots of 8 circles. That model **does not scale to TP**: a snapshot of the grid is ~2.7 MB.

Goal: online play of both real-time and turn-based modes, with minimal lag and minimal Firebase cost.

## Core decision: deterministic lockstep (both CPUs simulate everything, only inputs travel)

```
 Player A (host, team 0)                         Player B (guest, team 1)
 ┌────────────────────────┐                     ┌────────────────────────┐
 │ full simulation (60tps)│                     │ full simulation (60tps)│
 │ temp+fluids+drops+     │  inputs only        │ temp+fluids+drops+     │
 │ projectiles+flames     │◄───────────────────►│ projectiles+flames     │
 │ render (local)         │  WebRTC DataChannel │ render (local)         │
 └───────────┬────────────┘  ~2 KB/s each way   └───────────┬────────────┘
             │ offer/answer/ICE, once (a few KB)            │
             └──────────────► Firebase RTDB ◄───────────────┘
                              (then goOffline)
```

- **Where calculations happen:** every simulation calculation (heat diffusion, fluid CA, drops, projectiles, collisions, flame physics, turn state machine) runs on **both** CPUs, identically. Rendering, sound and particle effects are also local, and are never synchronized.
- **What the network carries:** only 2–3 bytes per player per tick (move, aim, jump, charge and action bits). That is about 2 KB/s, versus megabytes for state sync.
- **The "host" has no physics authority.** It only picks the seed and mode, assigns teams, and acts as the source of a full-state resync if a desync is detected.
- **Firebase is never in the game loop.** It is used for the handshake, then `goOffline()` frees the connection.

Rejected alternatives:
- *Host-authoritative snapshots:* the grid is too large to stream, and clients would still need local simulation for prediction.
- *Rollback netcode:* it needs a 2.7 MB state save per tick plus re-simulation, which is too costly in JS here.

### Lag handling

| Mode | Strategy |
|---|---|
| Real-time | **Input delay** lockstep. Local input at tick `t` executes on both sides at `t + D`, where `D = ceil(RTT/2 / 16.7ms) + 1`, clamped to 2–8 ticks (33–133 ms), re-evaluated slowly, and a visible ping indicator. Local sound and aim cursor react instantly; only the simulated effect is delayed by D. |
| Turn-based | Same engine, with small D (imperceptible for aiming and shooting). Optional later optimization (phase 6): the active player free-runs with zero delay and streams inputs plus a "frontier" tick, while the passive peer replays slightly behind. Nobody waits during the 45 s turn or the 7 s water settling, because neither requires inputs. |
| Packet loss | Inputs go on an **unordered, unreliable** channel (`ordered:false, maxRetransmits:0`) with **redundancy**: every packet carries the last ~8 ticks of inputs. There is no head-of-line blocking, and a lost packet is covered by the next one. Control messages (start, hashes, resync, chat) use a separate reliable channel. |
| Slow peer | Lockstep waits for the slowest peer. Mitigation: the existing sleeping-block optimization, a profiling pass in phase 0, and a "waiting for opponent" indicator. |

## Determinism work required (the real cost of this project)

Findings from the exploration; all of these must be fixed in the authoritative simulation:

1. **Two RNG streams.** Create a seeded sim RNG (reuse `crearAleatorioConSemilla`, mulberry32, in `js/utilidades.js:25-33`) for gameplay, and keep `Math.random()` only for visuals. Replace the gameplay `Math.random` calls:
   - `js/fluidos.js:136` (drop dispersion) and `fluidos.js:336-337` (magma)
   - `js/cascadas.js:81-82` and `cascadas.js:173`
   - `js/llama.js:508-509` (hose)
   - `js/turnos.js:79` (wind), `turnos.js:258` (platform sides) and `turnos.js:227` (map seed, which must come from the host)
2. **Trig and math.** `Math.sin/cos/atan2/hypot` (used in `proyectiles.js:21-25`, `llama.js`) can differ across engines (V8, SpiderMonkey, JavaScriptCore). Replace them in the sim with a deterministic implementation (lookup table or polynomial). `+ - * / sqrt` and `Float32Array` rounding are safe. Grep for `Math.pow/exp/hypot` too.
3. **Fixed tick, no clock coupling.** `js/principal.js:63-69` caps at 3 steps per frame and discards lag. For online, step count must depend only on the lockstep state: stall when inputs are missing, catch up (a higher cap) when behind, and never discard ticks.
4. **Inputs as per-tick commands.** `leerControles` (`js/entrada.js:70-96`) reads global keyboard state inside `simularPaso`. Refactor to sample once per tick into a command struct `{mover, apuntar, saltar, cargar, acciones-bitmask}` per team. Discrete actions from `ejecutarAccion` (`entrada.js:106-151`: change flame, change weapon) also become command bits. Local play keeps working by filling the buffer from the local devices.
5. **Hidden state.** Reset `numeroDePaso` (`js/grilla.js:62`) and call `despertarTodo()` at match start on both peers. Awake blocks (`grilla.js:101-146`) are deterministic given identical inputs, so they are not synchronized, but they are hashed for verification.
6. **Pause.** `juego.pausado` freezes only the local simulation. Online, the pause menu must **not** freeze the sim. It only offers "Leave room".
7. **Match start.** Both peers call `prepararMundo(seed)` (already accepts a seed, `turnos.js:226`) with the host's seed and mode, from a clean state at tick 0.

Gate: **no online work proceeds until a determinism test passes** (phase 0).

## Desync detection and recovery

- Every 30 ticks each peer sends a 32-bit hash of the entity state (flames, projectiles, RNG state, `juego` phase) plus a rotating 1/8 slice of the grid (`material`, `masaAgua`, `temperatura` as `Uint32` views). Full coverage every ~4 s at about 1 ms cost.
- Mismatch → the host sends a full snapshot (typed arrays + entity lists), compressed with `CompressionStream('deflate')` (mostly air, so it compresses very well), chunked at 16 KB over the reliable channel. The guest loads it and resumes. This also serves reconnect after a drop.
- Fallback if resync fails: end the match with a "desync" message.

## Reducing Firebase cost and requests

- Use **Realtime Database** (as the example does), with one-shot listeners (`onValue` / `onChildAdded`). No polling.
- **Join by short room code**, 6 characters from a 32-character alphabet. No public room list, because listing `rooms/` would download every room. A quick-match queue is optional and out of scope.
- Writes per session: room node, offer, answer, ~10-20 batched ICE candidates. That is a few KB in total.
- After the data channel opens: delete the room node and call `goOffline(db)`, which frees the connection slot. Use `onDisconnect().remove()` for abandoned rooms.
- Stay on the **Spark (free) plan**. It hard-caps instead of billing, so there are no surprise charges.
- Gameplay traffic never touches Firebase.
- ICE: Google STUN works for most NATs, but symmetric NAT fails (the example has no TURN). Add a free-tier TURN fallback (for example Metered's Open Relay or Cloudflare TURN; check current free limits). TURN costs almost nothing here, because only ~2 KB/s of inputs relay through it.

## Firebase setup instructions

1. Go to https://console.firebase.google.com → **Add project** (disable Analytics, it is not needed).
2. **Build → Realtime Database → Create database.** Pick the region closest to players (`us-central1` is the nearest of the three offered for Argentina). Start in **locked mode**. Note the `databaseURL`, whose domain depends on the region.
3. **Build → Authentication → Get started → Sign-in method → Anonymous → Enable.** Anonymous auth lets the rules require `auth != null`, which the example lacks.
4. **Realtime Database → Rules**, paste this starting point and Publish:
   ```json
   {
     "rules": {
       "rooms": {
         "$code": {
           ".read": "auth != null",
           ".write": "auth != null && (!data.exists() || data.child('host').val() === auth.uid || data.child('guest').val() === auth.uid || !data.child('guest').exists())",
           ".validate": "newData.hasChildren(['host'])",
           "offer":  { ".validate": "newData.isString() && newData.val().length < 8000" },
           "answer": { ".validate": "newData.isString() && newData.val().length < 8000" },
           "$other": { ".validate": true }
         }
       }
     }
   }
   ```
   Tighten after testing; the guest must be able to read the offer before registering.
5. **Project settings (gear) → Your apps → Web (`</>`)** → register an app (skip Hosting) → copy the `firebaseConfig` object.
6. Paste it into the new `js/red-config.js`. The web config is not secret, but restrict the API key in Google Cloud Console → APIs & Services → Credentials to your HTTP referrers (the GitHub Pages domain plus `localhost`).
7. **Authentication → Settings → Authorized domains:** add your GitHub Pages domain (`localhost` is there by default).
8. Optional: enable **App Check** later to block non-game clients.
9. Hosting for online play: keep the repo's GitHub Pages (https), or run `.claude/servidor.py` (port 8123, `localhost`). Local `file://` double-click keeps working for **offline** play only; online needs http(s) or localhost.

SDK loading without a bundler: use the Firebase **compat** builds (`firebase-app-compat.js`, `firebase-auth-compat.js`, `firebase-database-compat.js`, pinned 10.x, from gstatic CDN) as classic `<script>` tags. This keeps the project's classic-script, no-build style. The example's ES-module imports would not fit.

## Files

New (classic scripts, Spanish naming, loaded in `index.html` before `principal.js`):
- `js/red-config.js`: firebase config, ICE servers, constants (tick rate, redundancy, delay bounds)
- `js/red-senalizacion.js`: anonymous auth, `crearSala`, `unirseASala`, offer/answer/ICE exchange, cleanup (adapted from the example's `firebase-service.js`)
- `js/red-conexion.js`: `RTCPeerConnection`, an `entradas` channel (unreliable) and a `control` channel (reliable) (adapted from `rtc-connection.js`)
- `js/red-protocolo.js`: binary packets (header `[type u8, tick u32, ackTick u32, pingStamp]`, then redundant command array), adapted from the example's `rtc-protocol.js`
- `js/red-sincronizacion.js`: lockstep: command buffers, delay `D`, stall/catch-up, hashing, resync
- `js/azar.js` (or inside `utilidades.js`): sim RNG and deterministic trig
- `js/lobby.js`: small DOM overlay for room code entry (typing codes on canvas and mobile is painful); the rest of the menu stays on canvas

Modified:
- `index.html` (script tags), `js/principal.js` (tick loop), `js/entrada.js` (command sampling), `js/turnos.js` (seed, mode, pause, online mode), `js/grilla.js` (reset hidden state), `js/fluidos.js`, `js/cascadas.js`, `js/llama.js`, `js/proyectiles.js` (RNG and trig), `js/hud.js` and `js/configuracion.js` (an "Online" card in `dibujarSelectorDeModo`, pause option "Salir de la sala", ping indicator), `README.md`.

## Phases

0. **Determinism gate.** Implement the sim RNG and trig replacements, then record a seed plus a scripted input log. Replay it twice, and across Chrome and Firefox, and compare the state hashes. Also profile one `simularPaso` (it must be well under 16 ms on the weakest target device).
1. **Command refactor.** Per-tick command buffers. Local 2-player play must be unchanged.
2. **Signaling and transport.** Firebase handshake, data channels, room codes, and a lobby that exchanges seed and mode and starts both peers at tick 0.
3. **Real-time lockstep.** Delay-based, with redundancy, adaptive `D`, and a ping indicator.
4. **Turn-based modes.** `clasico` and `worms`, including the end-of-turn "asentando" phase.
5. **Desync detection, resync, reconnect, leave-room, and TURN fallback.**
6. **Optional:** free-running active player in turn-based mode.

## Verification

- Phase 0 test: identical hashes across two runs and across two browsers. Any divergence blocks the project.
- Two tabs on `localhost:8123` (host and guest): play both real-time and turn-based; confirm the same state on both (hash indicator in the debug panel `P`).
- Network fault injection: add a debug knob in `red-conexion.js` to simulate latency (50–300 ms), jitter and 10–30% loss. The game must keep running with no desync, and the delay must adapt.
- Cross-NAT test: two real devices on different networks, plus a symmetric NAT or mobile-data case to confirm TURN works.
- Firebase console → Realtime Database → Usage: confirm only a few KB per session and that rooms are removed.
- Forced desync (corrupt one cell on one peer) must trigger detection and a successful resync.
- Leave and rejoin, tab-close mid-game (`onDisconnect` cleanup), and the pause menu not freezing the sim online.

---

## Estado de avance

- **Fase 0 (determinismo): hecha.** `node tests/determinismo.js` (completo, ~36 min) o `--base` (rápido, ~7 min: compara con los hashes de la fase 0). Los tres modos reproducen los hashes de la fase 0 después de todos los cambios posteriores. Falta correr el mismo replay en Chrome *y* Firefox: el test de Node solo simula otro motor perturbando `Math.*`.
- **Fase 1 (comandos por paso): hecha.** `js/comandos.js`; la simulación solo lee `comandosDelPaso`.
- **Fase 2 (señalización, transporte, lobby): hecha y probada con Firebase real.** Crear sala, unirse, intruso rechazado, sala inexistente, la sala se borra al conectar y la base no se puede listar. También probada en modo local (`?red=local`, sin Firebase). Cambio respecto de lo planeado: se espera a juntar los candidatos ICE antes de ofrecer/responder (sin *trickle*): la sala usa solo 2 escrituras (`offer`, `answer`). Sin probar: dos redes distintas, TURN.
- **Fase 3 (lockstep en tiempo real): hecha.** `js/red-sincronizacion.js`. Retraso de entrada compartido (el mayor de lo que pide cada PC, 2 a 8 pasos), paquetes con todo lo no confirmado (ack) por el canal no confiable, hashes parciales cada 60 pasos que dicen qué parte difiere si hay desincronización. Probada con `tests/lockstep.html`: estado completo idéntico con red limpia y con latencia, jitter y pérdida de hasta 35 %.
  - Se encontraron y corrigieron en el camino: el retraso de cada PC no se podía arreglar solo (ahora es compartido); estado de `juego` heredado de la partida anterior que desincronizaba los reinicios (`reiniciarEstadoDeLaPartida`); paquetes de una partida anterior mezclándose con la nueva (id de partida).
- **Fase 4 (por turnos): hecha.** Clásico y Worms probados por la misma sincronización, con ciclos de turno completos (apuntar → vuelo del proyectil → escape → asentando → turno del rival), cada jugador actuando solo en su turno, estado idéntico. HUD: "Sos J1 · ▶ TU TURNO" / "turno del rival". En la pantalla de fin online no hay revancha (solo salir).
- **Fase 5: pendiente.** Reenvío del estado completo si hay desincronización (hoy solo se detecta y se avisa), reconexión, revancha, TURN, y volver al menú de forma prolija.
- **Fase 6 (opcional): pendiente.** Jugador activo sin retraso en turnos.

### Cómo se prueba

| Qué | Cómo |
|---|---|
| Determinismo de la simulación | `node tests/determinismo.js --base` |
| Sincronización online (dos juegos completos, red mala simulada, reinicios, ciclos de turno) | servir con `python .claude/servidor.py 8123` y abrir `http://localhost:8123/tests/lockstep.html` (tarda unos minutos; el resultado queda en pantalla) |
| A mano con dos pestañas, sin Firebase | `http://localhost:8123/?red=local` en las dos |
| A mano con Firebase | `http://localhost:8123/` en dos pestañas o dos PCs (ver `firebase/CONFIGURAR.md`) |
