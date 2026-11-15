/* Mi Negocio Rentable — capa de plataforma para la versión comercial.
 * Conecta la app con: Supabase (inicio de sesión + base de datos con RLS), reconocimiento de voz
 * del navegador, voz sintetizada del navegador y la función de IA en el servidor (Edge Function "ia").
 * Expone las mismas interfaces que usa app.js (db, user, dictation, sample, tts, cuenta). */
(function () {
  'use strict';
  const cfg = window.MNR_CONFIG || {};
  let habilitar;
  window.MNR_PLATAFORMA = new Promise(r => { habilitar = r; });
  const $app = () => document.getElementById('app');
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- Instalación como app (Android/Chrome) ----------
  let eventoInstalar = null;
  window.addEventListener('beforeinstallprompt', ev => { ev.preventDefault(); eventoInstalar = ev; window.dispatchEvent(new Event('mnr-instalable')); });
  window.addEventListener('appinstalled', () => { eventoInstalar = null; window.dispatchEvent(new Event('mnr-instalable')); });
  const capInstalar = {
    disponible: () => !!eventoInstalar,
    instalada: () => window.matchMedia('(display-mode: standalone)').matches,
    instalar: async () => { if (!eventoInstalar) return false; eventoInstalar.prompt(); const r = await eventoInstalar.userChoice; eventoInstalar = null; window.dispatchEvent(new Event('mnr-instalable')); return r.outcome === 'accepted'; }
  };

  if (!window.supabase || !cfg.supabaseUrl || /TU-PROYECTO/.test(cfg.supabaseUrl)) {
    // Sin servidor configurado: MODO LOCAL. Cada persona se registra y sus datos se guardan solo en su celular.
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    const capsLocal = { db: crearDbLocal(), user: { id: async () => 'local', isOwner: () => true, canEdit: () => true, can: () => true },
      dictation: crearDictado(), tts: crearTTS(), instalar: capInstalar, cuenta: { local: true, email: null } };
    window.claude = { use: async n => capsLocal[n] || null };
    habilitar();
    return;
  }
  const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true } });

  // ---------- Inicio de sesión ----------
  function pantallaLogin(modo, aviso) {
    modo = modo || 'entrar';
    const titulos = { entrar: 'Ingresar', crear: 'Crear cuenta', recuperar: 'Recuperar contraseña' };
    $app().innerHTML = `<div class="card"><h1>Mi Negocio Rentable</h1><p class="muted">Controla compras, ventas, inventario y caja de tu negocio.</p>
      ${aviso ? `<div class="alerta ${aviso.tipo || 'info'}">${esc(aviso.texto)}</div>` : ''}
      <form id="fLogin" class="card" style="border:0;padding:0">
        <h2>${titulos[modo]}</h2>
        <label for="lEmail">Correo electrónico<input id="lEmail" type="email" required autocomplete="email" inputmode="email"></label>
        ${modo !== 'recuperar' ? `<label for="lPass">Contraseña<input id="lPass" type="password" required minlength="8" autocomplete="${modo === 'crear' ? 'new-password' : 'current-password'}"></label>` : ''}
        <button class="btn pri lg" type="submit">${titulos[modo]}</button>
      </form>
      <div class="row">${modo !== 'entrar' ? '<button class="btn grow" data-modo="entrar">Ya tengo cuenta</button>' : '<button class="btn grow" data-modo="crear">Crear cuenta nueva</button>'}
      ${modo !== 'recuperar' ? '<button class="btn grow" data-modo="recuperar">Olvidé mi contraseña</button>' : ''}</div>
      <p class="small muted">Las cuentas nuevas tienen 30 días de prueba.</p></div>`;
    $app().querySelectorAll('[data-modo]').forEach(b => b.onclick = () => pantallaLogin(b.dataset.modo));
    document.getElementById('fLogin').onsubmit = async ev => {
      ev.preventDefault();
      const btn = ev.target.querySelector('button[type=submit]'); btn.disabled = true;
      const email = document.getElementById('lEmail').value.trim();
      const pass = (document.getElementById('lPass') || {}).value;
      try {
        if (modo === 'entrar') {
          const { data, error } = await sb.auth.signInWithPassword({ email, password: pass });
          if (error) throw error; return habilitarApp(data.session);
        }
        if (modo === 'crear') {
          const { data, error } = await sb.auth.signUp({ email, password: pass });
          if (error) throw error;
          if (data.session) return habilitarApp(data.session);
          return pantallaLogin('entrar', { tipo: 'ok', texto: 'Cuenta creada. Revisa tu correo y confirma tu dirección; luego ingresa.' });
        }
        const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
        if (error) throw error;
        pantallaLogin('entrar', { tipo: 'ok', texto: 'Te enviamos un correo para crear una contraseña nueva.' });
      } catch (e) {
        btn.disabled = false;
        const m = String((e && e.message) || '');
        const texto = /Invalid login/i.test(m) ? 'Correo o contraseña incorrectos.' : /already registered/i.test(m) ? 'Ese correo ya tiene cuenta. Ingresa o recupera la contraseña.' : /Email not confirmed/i.test(m) ? 'Primero confirma tu correo con el enlace que te enviamos.' : /Password/i.test(m) ? 'La contraseña debe tener al menos 8 caracteres.' : 'No se pudo completar. Revisa tu conexión e inténtalo otra vez.';
        pantallaLogin(modo, { tipo: 'bad', texto });
      }
    };
  }

  function pantallaNuevaContrasena() {
    $app().innerHTML = `<div class="card"><h2>Nueva contraseña</h2><form id="fNueva" class="card" style="border:0;padding:0">
      <label for="nPass">Contraseña nueva (mínimo 8 caracteres)<input id="nPass" type="password" minlength="8" required autocomplete="new-password"></label>
      <button class="btn pri lg" type="submit">Guardar contraseña</button></form></div>`;
    document.getElementById('fNueva').onsubmit = async ev => {
      ev.preventDefault();
      const { data, error } = await sb.auth.updateUser({ password: document.getElementById('nPass').value });
      if (error) return pantallaLogin('recuperar', { tipo: 'bad', texto: 'No se pudo cambiar la contraseña. Pide otro correo.' });
      const s = (await sb.auth.getSession()).data.session; habilitarApp(s || data.session);
    };
  }

  // ---------- Base de datos (tabla public.documentos, protegida por RLS) ----------
  function crearDb(uid) {
    const docs = new Map(); const oyentes = [];
    const instantanea = () => ({ docs: Array.from(docs.values()).map(d => ({ id: d.id, exists: true, data: () => d, metadata: {} })), size: docs.size, empty: !docs.size, metadata: { fromCache: false, hasPendingWrites: false } });
    const avisar = () => oyentes.forEach(o => o.next(instantanea()));
    async function cargar() {
      const pagina = 1000; let desde = 0; const nuevos = new Map();
      for (;;) {
        const { data, error } = await sb.from('documentos').select('id,data').eq('user_id', uid).order('id').range(desde, desde + pagina - 1);
        if (error) throw error;
        data.forEach(r => nuevos.set(r.id, r.data));
        if (data.length < pagina) break; desde += pagina;
      }
      docs.clear(); nuevos.forEach((v, k) => docs.set(k, v));
    }
    const mapearError = e => {
      const c = String((e && e.code) || ''); const m = String((e && e.message) || '');
      if (c === '42501' || /row-level security/i.test(m)) return { code: 'invalid_argument', message: m };
      if (/Failed to fetch|NetworkError|network/i.test(m)) return { code: 'unavailable', message: m };
      return { code: 'unavailable', message: m };
    };
    // al volver a abrir la app, trae cambios hechos desde otro dispositivo
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && oyentes.length) cargar().then(avisar).catch(() => {}); });
    return {
      collection(path) {
        return {
          onSnapshot(next, error) {
            const o = { next, error }; oyentes.push(o);
            cargar().then(() => next(instantanea())).catch(e => error && error(mapearError(e)));
            return () => { const i = oyentes.indexOf(o); if (i >= 0) oyentes.splice(i, 1); };
          },
          doc(id) {
            return {
              async set(data) {
                const fila = { user_id: uid, id, kind: data.kind, data };
                // Productos se pueden editar; perfil, operaciones y cierres son solo de inserción (inmutables).
                const q = data.kind === 'producto'
                  ? sb.from('documentos').upsert(fila, { onConflict: 'user_id,id' })
                  : sb.from('documentos').upsert(fila, { onConflict: 'user_id,id', ignoreDuplicates: true });
                const { error } = await q;
                if (error) throw mapearError(error);
                docs.set(id, data); avisar();
              }
            };
          }
        };
      }
    };
  }

  // ---------- Base de datos local (modo sin servidor): mismas reglas que la nube ----------
  function crearDbLocal() {
    const CLAVE = 'mnr_datos_v1'; const oyentes = [];
    let docs = {};
    try { docs = JSON.parse(localStorage.getItem(CLAVE) || '{}'); } catch (e) { docs = {}; }
    const instantanea = () => ({ docs: Object.values(docs).map(d => ({ id: d.id, exists: true, data: () => d, metadata: {} })), size: Object.keys(docs).length, empty: !Object.keys(docs).length, metadata: { fromCache: false, hasPendingWrites: false } });
    return {
      collection() {
        return {
          onSnapshot(next) { oyentes.push(next); setTimeout(() => next(instantanea()), 0); return () => {}; },
          doc(id) {
            return {
              async set(data) {
                // perfil, operaciones y cierres: solo inserción (un reintento no duplica ni modifica)
                if (docs[id] && data.kind !== 'producto') return;
                const copia = Object.assign({}, docs); copia[id] = data;
                try { localStorage.setItem(CLAVE, JSON.stringify(copia)); }
                catch (e) { throw { code: 'quota_exceeded', message: 'Memoria del navegador llena' }; }
                docs = copia; oyentes.forEach(f => f(instantanea()));
              }
            };
          }
        };
      }
    };
  }

  // ---------- Voz → texto (Web Speech API de Chrome) ----------
  function crearDictado() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return null;
    const h = { partial: [], final: [], state: [] };
    let rec = null, alTerminar = null;
    const emitir = (t, v) => h[t].forEach(f => { try { f(v); } catch (e) { /* nada */ } });
    return {
      onPartial: f => h.partial.push(f), onFinal: f => h.final.push(f), onState: f => h.state.push(f),
      start() {
        return new Promise((resolve, reject) => {
          rec = new SR(); rec.lang = 'es-BO'; rec.continuous = true; rec.interimResults = true; rec.maxAlternatives = 1;
          rec.onstart = () => { emitir('state', { state: 'listening' }); resolve(); };
          rec.onresult = ev => {
            let parcial = '';
            for (let i = ev.resultIndex; i < ev.results.length; i++) {
              const r = ev.results[i];
              if (r.isFinal) emitir('final', { text: r[0].transcript.trim() }); else parcial += r[0].transcript;
            }
            if (parcial) emitir('partial', { text: parcial.trim() });
          };
          rec.onerror = ev => { if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') reject({ code: 'not_granted' }); };
          rec.onend = () => { emitir('state', { state: 'idle', reason: 'stopped' }); if (alTerminar) { alTerminar(); alTerminar = null; } rec = null; };
          try { rec.start(); } catch (e) { reject({ code: 'dismissed' }); }
        });
      },
      stop() { return new Promise(r => { if (!rec) return r(); alTerminar = r; rec.stop(); }); }
    };
  }

  // ---------- Texto → voz (speechSynthesis del navegador) ----------
  function crearTTS() {
    if (!('speechSynthesis' in window)) return null;
    const voz = () => speechSynthesis.getVoices().find(v => /^es(-|_)(BO|PE|419|MX|US|AR|CL)/i.test(v.lang)) || speechSynthesis.getVoices().find(v => /^es/i.test(v.lang));
    return {
      speak(texto) {
        return new Promise((resolve, reject) => {
          speechSynthesis.cancel();
          const u = new SpeechSynthesisUtterance(texto); u.lang = 'es-BO'; const v = voz(); if (v) u.voice = v; u.rate = 1;
          u.onend = () => resolve(); u.onerror = e => reject({ code: e.error || 'error' });
          speechSynthesis.speak(u);
        });
      },
      stop() { speechSynthesis.cancel(); }
    };
  }

  // ---------- IA (Edge Function "ia": la clave de Anthropic vive solo en el servidor) ----------
  function crearIA() {
    const aBase64 = blob => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.onerror = rej; fr.readAsDataURL(blob); });
    async function sample(prompt, opts) {
      opts = opts || {};
      const imagenes = opts.images ? await Promise.all(opts.images.map(aBase64)) : [];
      const { data, error } = await sb.functions.invoke('ia', { body: { prompt: String(prompt), imagenes, nivel: opts.modelTier || 'quick' } });
      if (error) {
        const st = error.context && error.context.status;
        throw { code: st === 429 ? 'rate_limited' : st === 402 ? 'not_granted' : 'unavailable', message: error.message };
      }
      return { text: (data && data.text) || '', truncated: false };
    }
    sample.json = async (prompt, opts) => {
      const { text } = await sample(prompt, opts);
      const ini = text.indexOf('{'), fin = text.lastIndexOf('}');
      if (ini < 0 || fin < ini) return null;
      return JSON.parse(text.slice(ini, fin + 1));
    };
    sample.limits = async () => ({ images: true });
    return sample;
  }

  function habilitarApp(session) {
    const uid = session.user.id;
    const caps = {
      db: crearDb(uid),
      user: { id: async () => uid, isOwner: () => true, canEdit: () => true, can: () => true },
      dictation: crearDictado(), sample: crearIA(), tts: crearTTS(), instalar: capInstalar,
      cuenta: { email: session.user.email, salir: async () => { await sb.auth.signOut(); location.reload(); } }
    };
    window.claude = { use: async n => caps[n] || null };
    $app().innerHTML = '<div class="card"><h2>Mi Negocio Rentable</h2><p class="muted">Cargando tu negocio…</p></div>';
    habilitar();
  }

  async function arrancar() {
    if (/type=recovery/.test(location.hash)) {
      sb.auth.onAuthStateChange(ev => { if (ev === 'PASSWORD_RECOVERY') pantallaNuevaContrasena(); });
      return;
    }
    const { data } = await sb.auth.getSession();
    if (data && data.session) habilitarApp(data.session); else pantallaLogin('entrar');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', arrancar); else arrancar();
})();
