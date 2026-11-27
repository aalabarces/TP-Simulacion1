'use strict';
/* =============================================================================
   SEÑALIZACIÓN: cómo se encuentran las dos PCs

   Para abrir una conexión WebRTC, las PCs tienen que intercambiar una "oferta" y una
   "respuesta" (datos de cómo conectarse). Eso necesita un intermediario; acá es Firebase
   Realtime Database. Se usa solo para este intercambio: unos pocos KB por partida, y
   cuando el canal abre se borra la sala y se corta la conexión con Firebase.

   Las dos implementaciones tienen la misma interfaz:
     Anfitrión:  crearSala() → código;  publicarOferta(o);  esperarRespuesta() → respuesta
     Invitado:   unirseASala(código) → oferta;  publicarRespuesta(r)
     Ambos:      cerrar()

   - SenalizacionFirebase: la de verdad (ver firebase/CONFIGURAR.md).
   - SenalizacionLocal: para pruebas con dos pestañas del mismo navegador (?red=local).
   ============================================================================= */

/* Código de sala aleatorio, ej. "K7MQ2X". crypto.getRandomValues no es predecible. */
function codigoDeSalaAleatorio() {
  const { alfabetoCodigoDeSala: alfabeto, longitudCodigoDeSala: largo } = RED_CONFIG;
  const bytes = new Uint8Array(largo);
  crypto.getRandomValues(bytes);
  let codigo = '';
  for (let i = 0; i < largo; i++) codigo += alfabeto[bytes[i] % alfabeto.length]; // 32 símbolos: sin sesgo
  return codigo;
}

/* Normaliza lo que tipea el usuario: mayúsculas y sin espacios ni guiones. */
function normalizarCodigoDeSala(texto) {
  return String(texto || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/* ---------- Firebase ---------- */
class SenalizacionFirebase {
  constructor() {
    this.codigo = null;
    this.uid = null;
    this.bd = null;
    this.sala = null;
    this.esAnfitrion = false;
    this.escuchas = []; // [referencia, evento, función] para dar de baja al cerrar
  }

  /* Inicia Firebase y entra de forma anónima (las reglas piden estar autenticado). */
  async iniciar() {
    if (typeof firebase === 'undefined') throw new Error('No se pudo cargar Firebase (¿sin internet?)');
    if (!firebaseConfigurado()) throw new Error('Falta configurar Firebase (ver firebase/CONFIGURAR.md)');
    if (!firebase.apps.length) firebase.initializeApp(RED_CONFIG.firebase);
    const credencial = await firebase.auth().signInAnonymously();
    this.uid = credencial.user.uid;
    this.bd = firebase.database();
    this.bd.goOnline();
  }

  /* codigoFijo: para volver a abrir la MISMA sala al reconectar (el invitado ya conoce el código). */
  async crearSala(codigoFijo) {
    await this.iniciar();
    this.esAnfitrion = true;
    // Si el código ya existe (muy improbable) se prueba con otro; con código fijo se intenta una sola vez
    for (let intento = 0; intento < (codigoFijo ? 1 : 5); intento++) {
      const codigo = codigoFijo || codigoDeSalaAleatorio();
      const sala = this.bd.ref('rooms/' + codigo);
      const resultado = await sala.transaction(actual =>
        actual === null ? { host: this.uid, creada: firebase.database.ServerValue.TIMESTAMP } : undefined);
      if (resultado.committed) {
        this.codigo = codigo;
        this.sala = sala;
        sala.onDisconnect().remove(); // si el anfitrión se va, la sala desaparece sola
        return codigo;
      }
    }
    throw new Error('No se pudo crear la sala, probá de nuevo');
  }

  publicarOferta(oferta) {
    return this.sala.child('offer').set(JSON.stringify(oferta));
  }

  /* Espera a que el invitado publique su respuesta. */
  esperarRespuesta(tiempoMaximoMs) {
    return this._esperarValor('answer', tiempoMaximoMs, 'Nadie se unió a la sala');
  }

  async unirseASala(codigo, tiempoMaximoMs = 15000) {
    await this.iniciar();
    this.esAnfitrion = false;
    codigo = normalizarCodigoDeSala(codigo);
    const sala = this.bd.ref('rooms/' + codigo);
    const existente = await sala.child('host').once('value');
    if (!existente.exists()) throw new Error('No existe una sala con ese código');
    // Ocupar el lugar de invitado: solo lo logra uno (transacción)
    const lugar = await sala.child('guest').transaction(actual => actual === null ? this.uid : undefined);
    if (!lugar.committed) throw new Error('La sala ya tiene un invitado');
    this.codigo = codigo;
    this.sala = sala;
    // El anfitrión publica la oferta cuando termina de juntar sus direcciones de red (1-4 s)
    return this._esperarValor('offer', tiempoMaximoMs, 'El anfitrión no respondió');
  }

  publicarRespuesta(respuesta) {
    return this.sala.child('answer').set(JSON.stringify(respuesta));
  }

  _esperarValor(hijo, tiempoMaximoMs, mensajeDeTiempo) {
    return new Promise((resolver, rechazar) => {
      const referencia = this.sala.child(hijo);
      const temporizador = setTimeout(() => { quitar(); rechazar(new Error(mensajeDeTiempo)); }, tiempoMaximoMs);
      const alCambiar = instantanea => {
        if (!instantanea.exists()) return;
        quitar();
        clearTimeout(temporizador);
        try { resolver(JSON.parse(instantanea.val())); }
        catch (e) { rechazar(new Error('Datos de conexión inválidos')); }
      };
      const quitar = () => referencia.off('value', alCambiar);
      referencia.on('value', alCambiar);
      this.escuchas.push([referencia, 'value', alCambiar]);
    });
  }

  /* Borra la sala (si es el anfitrión) y suelta la conexión con Firebase. Se llama apenas
     el canal WebRTC abre: de ahí en adelante Firebase no participa. */
  async cerrar() {
    for (const [referencia, evento, funcion] of this.escuchas) referencia.off(evento, funcion);
    this.escuchas = [];
    try {
      if (this.sala && this.esAnfitrion) {
        // Con tope de tiempo: si la conexión anda mal no hay que quedarse esperando la confirmación
        const borrar = this.sala.remove();
        await Promise.race([borrar, new Promise(resolver => setTimeout(resolver, 3000))]);
      }
    } catch (e) { /* si falla, onDisconnect (que sigue armado) la borra al cortar la conexión */ }
    try { if (this.bd) this.bd.goOffline(); } catch (e) { /* nada que hacer */ }
    this.sala = null;
  }
}

/* ---------- Prueba local (BroadcastChannel) ----------
   Dos pestañas (o dos objetos en la misma página) del mismo navegador y origen se pasan
   los mensajes por un canal. No persiste: si el invitado llega tarde, pide la oferta con "hola". */
class SenalizacionLocal {
  constructor() {
    this.codigo = null;
    this.canal = null;
    this.oferta = null;
    this.resolverRespuesta = null;
    this.temporizadorHola = null;
  }

  _abrirCanal(alRecibir) {
    this.canal = new BroadcastChannel('fire-splash-senalizacion');
    this.canal.onmessage = evento => {
      const mensaje = evento.data;
      if (mensaje && mensaje.codigo === this.codigo) alRecibir(mensaje);
    };
  }

  async crearSala(codigoFijo) {
    this.codigo = codigoFijo || codigoDeSalaAleatorio();
    this._abrirCanal(mensaje => {
      if (mensaje.tipo === 'hola' && this.oferta) this._enviar('oferta', this.oferta);
      if (mensaje.tipo === 'respuesta' && this.resolverRespuesta) {
        this.resolverRespuesta(mensaje.datos);
        this.resolverRespuesta = null; // un solo invitado por sala
      }
    });
    return this.codigo;
  }

  publicarOferta(oferta) {
    this.oferta = oferta;
    this._enviar('oferta', oferta);
  }

  esperarRespuesta(tiempoMaximoMs) {
    return new Promise((resolver, rechazar) => {
      const temporizador = setTimeout(() => rechazar(new Error('Nadie se unió a la sala')), tiempoMaximoMs);
      this.resolverRespuesta = respuesta => { clearTimeout(temporizador); resolver(respuesta); };
    });
  }

  unirseASala(codigo, tiempoMaximoMs = 8000) {
    this.codigo = normalizarCodigoDeSala(codigo);
    return new Promise((resolver, rechazar) => {
      const terminar = () => { clearInterval(this.temporizadorHola); clearTimeout(temporizador); };
      const temporizador = setTimeout(() => { terminar(); rechazar(new Error('No existe una sala con ese código')); }, tiempoMaximoMs);
      this._abrirCanal(mensaje => {
        if (mensaje.tipo !== 'oferta') return;
        terminar();
        resolver(mensaje.datos);
      });
      this._enviar('hola');
      this.temporizadorHola = setInterval(() => this._enviar('hola'), 500);
    });
  }

  publicarRespuesta(respuesta) {
    this._enviar('respuesta', respuesta);
  }

  _enviar(tipo, datos) {
    this.canal.postMessage({ codigo: this.codigo, tipo, datos });
  }

  async cerrar() {
    clearInterval(this.temporizadorHola);
    if (this.canal) this.canal.close();
    this.canal = null;
  }
}

/* La señalización que corresponde: local si se pidió (?red=local), si no Firebase. */
function crearSenalizacion() {
  return senalizacionLocalPedida() ? new SenalizacionLocal() : new SenalizacionFirebase();
}
