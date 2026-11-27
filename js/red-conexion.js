'use strict';
/* =============================================================================
   CONEXIÓN ENTRE LAS DOS PCs (WebRTC)

   Dos canales de datos, con propósitos distintos:

   - "entradas": NO confiable y sin orden (ordered:false, maxRetransmits:0). Es para los
     controles de cada paso. Si un paquete se pierde no se reenvía: cada paquete repite los
     últimos pasos (ver la sincronización), así que el siguiente lo cubre. Esto evita el
     "head-of-line blocking" de un canal confiable, donde un paquete perdido frena a todos los
     que vienen detrás: es lo que más lag mete en una red con pérdidas.
   - "control": confiable y ordenado. Para lo que no puede perderse: inicio de partida, hashes
     para detectar desincronización, reenvío del estado, etc. Mensajes JSON.

   El anfitrión crea los canales y la oferta; el invitado recibe los canales y responde.
   Se espera a juntar todas las direcciones de red (ICE) antes de ofrecer/responder, así
   solo hay UNA oferta y UNA respuesta que pasar por Firebase en vez de decenas de mensajes.
   ============================================================================= */

/* Simulador de mala red, SOLO para pruebas (por ejemplo desde la consola del navegador):
     RED_DEBUG.latenciaMs = 100;  RED_DEBUG.jitterMs = 40;  RED_DEBUG.perdida = 0.15;
   Se aplica a lo que ESTA PC envía. La pérdida y el jitter solo afectan al canal de
   entradas (el de control es confiable y ordenado, solo se le suma la latencia). */
const RED_DEBUG = { latenciaMs: 0, jitterMs: 0, perdida: 0 };

const INTERVALO_DE_PING_MS = 1000;

class ConexionRed {
  constructor(esAnfitrion) {
    this.esAnfitrion = esAnfitrion;
    this.estado = 'nueva';        // nueva → conectando → abierta → cerrada | fallo
    this.detalle = '';
    this.pc = null;
    this.canalEntradas = null;
    this.canalControl = null;
    this.rttMs = null;            // ida y vuelta, suavizado (se mide por el canal de control)
    this.temporizadorPing = null;

    // Callbacks que pone quien usa la conexión
    this.alCambiarEstado = null;  // (estado, detalle)
    this.alRecibirEntradas = null; // (ArrayBuffer)
    this.alRecibirControl = null;  // (objeto)
    this.alRecibirBinario = null;  // (ArrayBuffer): trozos de la foto del estado, por el canal confiable
  }

  /* ---------- Establecer la conexión ---------- */

  /* Anfitrión: crea los canales y la oferta, la publica y espera la respuesta. */
  async conectarComoAnfitrion(senalizacion, esperaMaximaMs = RED_CONFIG.tiempoDeEsperaDeInvitadoMs) {
    this._cambiarEstado('conectando', 'Preparando la conexión…');
    this._crearPeer();
    this.canalEntradas = this.pc.createDataChannel('entradas', { ordered: false, maxRetransmits: 0 });
    this.canalControl = this.pc.createDataChannel('control');
    this._enlazarCanal(this.canalEntradas);
    this._enlazarCanal(this.canalControl);

    await this.pc.setLocalDescription(await this.pc.createOffer());
    await this._esperarCandidatos();
    await senalizacion.publicarOferta(this._descripcionLocal());

    this._cambiarEstado('conectando', 'Esperando que alguien se una…');
    const respuesta = await senalizacion.esperarRespuesta(esperaMaximaMs);
    this._cambiarEstado('conectando', 'Conectando…');
    await this.pc.setRemoteDescription(respuesta);
    await this._esperarApertura();
  }

  /* Invitado: recibe la oferta, publica la respuesta y espera que abran los canales. */
  async conectarComoInvitado(senalizacion, oferta) {
    this._cambiarEstado('conectando', 'Conectando…');
    this._crearPeer();
    this.pc.ondatachannel = evento => {
      const canal = evento.channel;
      if (canal.label === 'entradas') this.canalEntradas = canal;
      else if (canal.label === 'control') this.canalControl = canal;
      else return;
      this._enlazarCanal(canal);
    };
    await this.pc.setRemoteDescription(oferta);
    await this.pc.setLocalDescription(await this.pc.createAnswer());
    await this._esperarCandidatos();
    await senalizacion.publicarRespuesta(this._descripcionLocal());
    await this._esperarApertura();
  }

  _crearPeer() {
    // Para probar un servidor TURN: forzarRetransmision (o ?relay=1) hace que TODO pase por el TURN
    // en vez de la conexión directa; si no hay TURN configurado, no conecta (y eso es lo esperable)
    const soloRetransmision = RED_CONFIG.forzarRetransmision || new URLSearchParams(location.search).get('relay') === '1';
    this.pc = new RTCPeerConnection({
      iceServers: RED_CONFIG.servidoresIce,
      iceTransportPolicy: soloRetransmision ? 'relay' : 'all'
    });
    this.pc.onconnectionstatechange = () => {
      const estado = this.pc.connectionState;
      if (estado === 'failed') this._fallar('No se pudo conectar con el otro jugador (¿red estricta? ver TURN en firebase/CONFIGURAR.md)');
      else if (estado === 'closed' && this.estado === 'abierta') this._cambiarEstado('cerrada', 'Se cortó la conexión');
      else if (estado === 'disconnected') {
        // Puede ser un corte momentáneo: se espera un poco antes de darla por perdida
        setTimeout(() => {
          if (this.pc && this.pc.connectionState === 'disconnected') this._cerrarPorPerdida();
        }, 5000);
      }
    };
  }

  _descripcionLocal() {
    const d = this.pc.localDescription;
    return { type: d.type, sdp: d.sdp };
  }

  /* Espera a que el navegador termine de juntar sus direcciones de red (o un tope de tiempo). */
  _esperarCandidatos() {
    return new Promise(resolver => {
      if (this.pc.iceGatheringState === 'complete') return resolver();
      const terminar = () => { clearTimeout(tope); this.pc.removeEventListener('icegatheringstatechange', alCambiar); resolver(); };
      const alCambiar = () => { if (this.pc.iceGatheringState === 'complete') terminar(); };
      const tope = setTimeout(terminar, RED_CONFIG.tiempoDeEsperaDeCandidatosMs);
      this.pc.addEventListener('icegatheringstatechange', alCambiar);
    });
  }

  /* Resuelve cuando los DOS canales están abiertos; rechaza si tarda demasiado o falla. */
  _esperarApertura() {
    return new Promise((resolver, rechazar) => {
      const revisar = () => {
        if (this.estado === 'abierta') { clearTimeout(tope); this._alAbrir = null; resolver(); }
        else if (this.estado === 'fallo' || this.estado === 'cerrada') { clearTimeout(tope); this._alAbrir = null; rechazar(new Error(this.detalle || 'Conexión cerrada')); }
      };
      const tope = setTimeout(() => {
        this._fallar('Se agotó el tiempo para conectar con el otro jugador');
        revisar();
      }, RED_CONFIG.tiempoParaAbrirCanalesMs);
      this._alAbrir = revisar;
      revisar();
    });
  }

  /* ---------- Canales ---------- */

  _enlazarCanal(canal) {
    canal.binaryType = 'arraybuffer';
    canal.onopen = () => {
      if (this._canalAbierto(this.canalEntradas) && this._canalAbierto(this.canalControl) && this.estado === 'conectando') {
        this._cambiarEstado('abierta', 'Conectados');
        this._iniciarPing();
        if (this._alAbrir) this._alAbrir();
      }
    };
    canal.onclose = () => { if (this.estado === 'abierta') this._cerrarPorPerdida(); };
    canal.onerror = () => { /* el cierre posterior se encarga */ };
    canal.onmessage = evento => {
      if (canal === this.canalEntradas) {
        if (this.alRecibirEntradas) this.alRecibirEntradas(evento.data);
        return;
      }
      if (typeof evento.data !== 'string') { // binario por el canal de control: trozos de la foto del estado
        if (this.alRecibirBinario) this.alRecibirBinario(evento.data);
        return;
      }
      let mensaje;
      try { mensaje = JSON.parse(evento.data); } catch (e) { return; }
      if (mensaje.t === 'ping') this.enviarControl({ t: 'pong', n: mensaje.n });
      else if (mensaje.t === 'pong') this._registrarPing(performance.now() - mensaje.n);
      else if (this.alRecibirControl) this.alRecibirControl(mensaje);
    };
    // Si el canal ya abrió antes de enlazarlo (puede pasar en el invitado), el evento no va a llegar
    if (canal.readyState === 'open') canal.onopen();
  }

  _canalAbierto(canal) {
    return !!canal && canal.readyState === 'open';
  }

  /* Controles de cada paso: puede perderse (lo cubre el paquete siguiente). */
  enviarEntradas(buffer) {
    if (RED_DEBUG.perdida > 0 && Math.random() < RED_DEBUG.perdida) return;
    const retraso = RED_DEBUG.latenciaMs + (RED_DEBUG.jitterMs > 0 ? Math.random() * RED_DEBUG.jitterMs : 0);
    this._enviarConRetraso(this.canalEntradas, buffer, retraso);
  }

  /* Mensajes que no pueden perderse. `mensaje` es un objeto (se manda como JSON). */
  enviarControl(mensaje) {
    this._enviarConRetraso(this.canalControl, JSON.stringify(mensaje), RED_DEBUG.latenciaMs);
  }

  /* Datos binarios que no pueden perderse ni llegar desordenados (trozos de la foto del estado). */
  enviarBinarioConfiable(buffer) {
    this._enviarConRetraso(this.canalControl, buffer, RED_DEBUG.latenciaMs);
  }

  _enviarConRetraso(canal, datos, retrasoMs) {
    const enviar = () => { if (this._canalAbierto(canal)) canal.send(datos); };
    if (retrasoMs > 0) setTimeout(enviar, retrasoMs); else enviar();
  }

  /* ---------- Ping ---------- */

  _iniciarPing() {
    const medir = () => this.enviarControl({ t: 'ping', n: performance.now() });
    medir();
    this.temporizadorPing = setInterval(medir, INTERVALO_DE_PING_MS);
  }

  _registrarPing(ms) {
    this.rttMs = this.rttMs === null ? ms : this.rttMs * 0.8 + ms * 0.2; // promedio móvil
  }

  /* ---------- Estado y cierre ---------- */

  _cambiarEstado(estado, detalle) {
    this.estado = estado;
    this.detalle = detalle || '';
    if (this.alCambiarEstado) this.alCambiarEstado(estado, this.detalle);
  }

  _fallar(detalle) {
    if (this.estado === 'fallo' || this.estado === 'cerrada') return;
    this._cambiarEstado('fallo', detalle);
    this._liberar();
  }

  _cerrarPorPerdida() {
    if (this.estado === 'cerrada' || this.estado === 'fallo') return;
    this._cambiarEstado('cerrada', 'El otro jugador se desconectó');
    this._liberar();
  }

  /* Cierre a pedido de este lado (salir de la sala). */
  cerrar() {
    if (this.estado !== 'cerrada' && this.estado !== 'fallo') this._cambiarEstado('cerrada', 'Conexión cerrada');
    this._liberar();
  }

  _liberar() {
    clearInterval(this.temporizadorPing);
    this.temporizadorPing = null;
    for (const canal of [this.canalEntradas, this.canalControl]) {
      if (!canal) continue;
      canal.onopen = canal.onclose = canal.onmessage = canal.onerror = null;
      try { canal.close(); } catch (e) { /* ya estaba cerrado */ }
    }
    if (this.pc) {
      this.pc.onconnectionstatechange = null;
      try { this.pc.close(); } catch (e) { /* ya estaba cerrada */ }
    }
    this.pc = null;
    this.canalEntradas = this.canalControl = null;
    if (this._alAbrir) this._alAbrir();
  }
}
