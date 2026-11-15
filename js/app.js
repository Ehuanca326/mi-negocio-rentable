/* Mi Negocio Rentable — interfaz y servicios (voz, foto, base de datos). Depende de core.js (window.MNR). */
(function () {
  'use strict';
  const M = window.MNR;
  const $app = document.getElementById('app');
  const $nav = document.getElementById('nav');

  // ---------- Estado ----------
  const S = {
    db: null, user: null, uid: null, dictado: null, ia: null, iaImagenes: false, tts: null,
    modoPrueba: false, cargado: false, sinConexion: false, errorCarga: null,
    perfil: null, productos: [], operaciones: [], cierres: [],
    vista: 'inicio',
    borrador: null, ctx: null, chat: [], escuchando: false, parcial: '', procesando: false, guardando: false, dupAviso: null,
    vozActiva: true, foto: null, cierreFecha: M.fechaLocal(), cierreContado: '', cierreInicial: null,
    filtroHist: 'todas', anulando: null
  };
  const store = { perfil: null, productos: new Map(), operaciones: new Map(), cierres: new Map() };

  // ---------- Utilidades de interfaz ----------
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const bs = M.formatoBs, cant = M.formatoCant;
  const ICON = {
    mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v4M8 22h8"/></svg>',
    cam: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M3 8h4l2-3h6l2 3h4v12H3z"/><circle cx="12" cy="13.5" r="3.8"/></svg>',
    caja: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M3 10h18v10H3zM6 10V6h12v4M12 14v2"/></svg>',
    casa: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M3 11l9-7 9 7v9h-6v-6H9v6H3z"/></svg>',
    inv: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10"/></svg>',
    fiado: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="9" cy="8" r="4"/><path d="M2 21c0-4 3-6 7-6s7 2 7 6M17 8h5M19.5 5.5v5"/></svg>',
    hist: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 5h16M4 12h16M4 19h10"/></svg>'
  };
  let toastT = null;
  function toast(msg, ms) {
    const t = document.getElementById('toast'); t.textContent = msg; t.style.display = 'block';
    clearTimeout(toastT); toastT = setTimeout(() => { t.style.display = 'none'; }, ms || 3200);
  }
  function hablar(texto) {
    if (!S.tts || !S.vozActiva || !texto) return;
    S.tts.speak(texto.slice(0, 1900)).catch(e => { if (e && e.code === 'not_granted') { S.tts = null; } });
  }

  // ---------- Conexión con la plataforma ----------
  function usar(nombre) {
    // Versión comercial: la plataforma (Supabase) se habilita después del inicio de sesión.
    if (window.MNR_PLATAFORMA) return window.MNR_PLATAFORMA.then(() => window.claude.use(nombre)).catch(() => null);
    return new Promise(resolve => {
      let intentos = 0;
      const prueba = () => {
        if (window.claude && typeof window.claude.use === 'function') window.claude.use(nombre).then(resolve, () => resolve(null));
        else if (++intentos > 30) resolve(null); else setTimeout(prueba, 100);
      };
      prueba();
    });
  }

  async function iniciar() {
    const [db, user, dictado, ia, tts, cuenta, demo, instalar] = await Promise.all([usar('db'), usar('user'), usar('dictation'), usar('sample'), usar('tts'), usar('cuenta'), usar('demo'), usar('instalar')]);
    S.user = user; S.cuenta = cuenta; S.demo = demo; S.instalar = instalar;
    window.addEventListener('mnr-instalable', () => pintar()); S.dictado = dictado; S.ia = ia; S.tts = tts;
    if (dictado) {
      dictado.onPartial(({ text }) => { S.parcial = text; pintarParcial(); });
      dictado.onFinal(({ text }) => { S.textoDictado = ((S.textoDictado || '') + ' ' + text).trim(); S.parcial = ''; pintarParcial(); programarFinDictado(); });
      dictado.onState(({ state }) => {
        const antes = S.escuchando; S.escuchando = state === 'listening';
        if (antes && !S.escuchando) finDictado(); else if (S.escuchando !== antes) pintar();
      });
    }
    if (ia && ia.limits) { try { S.iaImagenes = !!(await ia.limits()).images; } catch (e) { S.iaImagenes = false; } }
    if (user && db) { try { S.uid = await user.id(); } catch (e) { S.uid = null; } }
    // Visitante sin permiso de escritura (enlace compartido): se le ofrece la demostración en vez de un error.
    if (user && db && typeof user.can === 'function') { try { if ((await user.can('data.write')) === false) S.uid = null; } catch (e) { /* sin dato: se intenta normal */ } }
    if (!db || !S.uid) { S.sinConexion = true; S.cargado = true; pintar(); return; }
    S.db = db;
    const base = 'data/users/' + S.uid;
    const timer = setTimeout(() => { if (!S.cargado) { S.errorCarga = 'La base de datos todavía no responde. Revisa tu conexión a internet.'; pintar(); } }, 10000);
    db.collection(base).onSnapshot(snap => {
      if (!snap.metadata.fromCache) { clearTimeout(timer); S.errorCarga = null; }
      store.perfil = null; store.productos.clear(); store.operaciones.clear(); store.cierres.clear();
      snap.docs.forEach(d => {
        const x = d.data(); if (!x) return;
        if (x.kind === 'perfil') store.perfil = x;
        else if (x.kind === 'producto') store.productos.set(x.id, x);
        else if (x.kind === 'operacion') store.operaciones.set(x.id, x);
        else if (x.kind === 'cierre') store.cierres.set(x.id, x);
      });
      sincronizar(); S.cargado = true; pintar();
    }, err => { clearTimeout(timer); S.errorCarga = 'No se pudo leer tu información (' + (err && err.code) + ').'; S.cargado = true; pintar(); });
  }

  function sincronizar() {
    S.perfil = store.perfil;
    S.productos = Array.from(store.productos.values()).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    S.operaciones = Array.from(store.operaciones.values()).sort((a, b) => (a.creadoEn < b.creadoEn ? -1 : 1));
    S.cierres = Array.from(store.cierres.values()).sort((a, b) => (a.creadoEn < b.creadoEn ? -1 : 1));
  }

  // Escritura: un documento por registro; el id fijo hace que un reintento no duplique.
  async function guardarDoc(doc) {
    const limpio = JSON.parse(JSON.stringify(doc));
    if (S.modoPrueba) { const m = { perfil: null, producto: store.productos, operacion: store.operaciones, cierre: store.cierres }[doc.kind]; if (doc.kind === 'perfil') store.perfil = limpio; else m.set(doc.id, limpio); sincronizar(); return; }
    if (!S.db) throw { code: 'sin_base', message: 'No hay base de datos disponible.' };
    const ref = S.db.collection('data/users/' + S.uid).doc(doc.id);
    try { await ref.set(limpio); }
    catch (e) {
      if (e && e.code === 'unavailable') { await new Promise(r => setTimeout(r, 600 + Math.random() * 800)); await ref.set(limpio); }
      else throw e;
    }
  }
  function mensajeError(e) {
    const c = e && e.code;
    if (c === 'quota_exceeded') return 'Se llenó el espacio para guardar. Descarga una copia de seguridad (Ajustes) y pide la versión con servidor.';
    if (c === 'invalid_argument') return S.cuenta ? 'No se pudo guardar: tu periodo de prueba o tu suscripción no está activa. Comunícate con el proveedor.' : 'Tu cuenta no tiene permiso para guardar en esta app. Pide al dueño acceso de edición.';
    if (c === 'sin_base') return e.message;
    return 'No se pudo guardar. Revisa tu conexión e inténtalo otra vez.';
  }

  // ---------- Datos ficticios para el modo de prueba ----------
  function cargarDatosPrueba() {
    S.modoPrueba = true; S.sinConexion = false;
    store.perfil = { id: 'perfil', kind: 'perfil', nombreCompleto: 'María Quispe Mamani (ficticio)', nombreNegocio: 'Ganoderma Salud Total', rubro: 'Productos Ganoderma', creadoEn: new Date().toISOString() };
    store.productos.clear(); store.operaciones.clear(); store.cierres.clear();
    const prods = [
      ['p_cafe', 'Café Ganoderma 3 en 1 (caja 20 sobres)', 8500, 5], ['p_capsulas', 'Cápsulas Reishi (frasco 90)', 15000, 3],
      ['p_te', 'Té Ganoderma (caja 25 sobres)', 6000, 4], ['p_jabon', 'Jabón de Ganoderma', 2500, 6]
    ];
    prods.forEach(([id, nombre, pv, min]) => store.productos.set(id, { id, kind: 'producto', nombre, unidad: 'unidad', precioVentaCent: pv, stockMinimoM: min * 1000, activo: true, creadoEn: '2026-11-01T10:00:00.000Z' }));
    const hoy = M.fechaLocal(); const ayer = M.fechaLocal(new Date(Date.now() - 864e5));
    let n = 0; const t = f => new Date(Date.parse(f + 'T09:00:00') + (n++) * 600000).toISOString();
    const op = (fecha, o) => { const x = Object.assign({ id: M.uid('o_'), kind: 'operacion', fecha, creadoEn: t(fecha), lineas: [], pagos: [], origen: 'prueba', usuarioId: 'prueba' }, o); store.operaciones.set(x.id, x); };
    const L = (p, q, pr) => ({ productoId: p, cantM: q * 1000, precioCent: pr });
    op(ayer, { tipo: 'compra', lineas: [L('p_cafe', 20, 5200), L('p_capsulas', 8, 9800), L('p_te', 12, 3600), L('p_jabon', 10, 1400)], totalCent: 20 * 5200 + 8 * 9800 + 12 * 3600 + 10 * 1400, pagos: [{ metodo: 'efectivo', montoCent: 20 * 5200 + 8 * 9800 + 12 * 3600 + 10 * 1400 }] });
    op(ayer, { tipo: 'venta', lineas: [L('p_cafe', 2, 8500)], totalCent: 17000, pagos: [{ metodo: 'efectivo', montoCent: 17000 }] });
    op(ayer, { tipo: 'venta', lineas: [L('p_capsulas', 1, 15000)], totalCent: 15000, cliente: 'Doña Rosa Flores', pagos: [{ metodo: 'credito', montoCent: 15000 }] });
    store.cierres.set('c_prueba', { id: 'c_prueba', kind: 'cierre', fecha: ayer, efectivoInicialCent: 50000, efectivoContadoCent: 32000, creadoEn: t(ayer), usuarioId: 'prueba' });
    op(hoy, { tipo: 'venta', lineas: [L('p_cafe', 3, 8500)], totalCent: 25500, pagos: [{ metodo: 'efectivo', montoCent: 25500 }] });
    op(hoy, { tipo: 'venta', lineas: [L('p_te', 2, 6000), L('p_jabon', 2, 2500)], totalCent: 17000, pagos: [{ metodo: 'qr', montoCent: 17000, estado: 'declarado' }] });
    op(hoy, { tipo: 'venta', lineas: [L('p_capsulas', 1, 15000)], totalCent: 15000, cliente: 'Juan Choque', pagos: [{ metodo: 'efectivo', montoCent: 5000 }, { metodo: 'credito', montoCent: 10000 }] });
    op(hoy, { tipo: 'gasto', totalCent: 1500, categoria: 'Transporte', descripcion: 'Trufi al mercado', pagos: [{ metodo: 'efectivo', montoCent: 1500 }] });
    op(hoy, { tipo: 'cobro', cliente: 'Doña Rosa Flores', totalCent: 8000, pagos: [{ metodo: 'qr', montoCent: 8000, estado: 'declarado' }] });
    sincronizar(); S.cargado = true; S.vista = 'inicio'; pintar();
    toast('Modo de prueba: datos ficticios, no se guardan.');
  }

  // ---------- Derivados ----------
  const estado = () => M.calcularEstado(S.productos, S.operaciones);
  const prodNombre = id => (S.productos.find(p => p.id === id) || {}).nombre || 'Producto';
  const iniciales = () => {
    const sug = M.efectivoInicialSugerido(S.cierres.map(c => ({ ...c })), S.cierreFecha);
    return S.cierreInicial !== null ? S.cierreInicial : (sug ? sug.cent : 0);
  };

  // ---------- Pintado ----------
  function pintar() {
    if (!S.cargado) return;
    $nav.hidden = !S.perfil || (S.sinConexion && !S.modoPrueba);
    pintarNav();
    let html = '';
    if (S.modoPrueba) html += `<div class="demo">${S.demo ? 'DEMOSTRACIÓN' : 'MODO DE PRUEBA'} · datos ficticios · no se guardan</div>`;
    if (S.sinConexion && !S.modoPrueba) html += vistaSinConexion();
    else if (S.errorCarga) html += `<div class="alerta bad">${esc(S.errorCarga)}</div>`;
    if (!S.sinConexion || S.modoPrueba) {
      if (!S.perfil) html += vistaRegistro();
      else html += ({ inicio: vistaInicio, asistente: vistaAsistente, foto: vistaFoto, cierre: vistaCierre, inventario: vistaInventario, fiados: vistaFiados, historial: vistaHistorial, ajustes: vistaAjustes }[S.vista] || vistaInicio)();
    }
    // conservar lo que el usuario estaba escribiendo si la pantalla se redibuja (p. ej. llegan datos nuevos)
    const previo = document.getElementById('tTexto'); const texto = previo ? previo.value : ''; const enfocado = previo && document.activeElement === previo;
    $app.innerHTML = html;
    const nuevo = document.getElementById('tTexto'); if (nuevo && texto) { nuevo.value = texto; if (enfocado) nuevo.focus(); }
    enlazar();
  }

  function pintarNav() {
    const items = [['inicio', 'Inicio', ICON.casa], ['inventario', 'Inventario', ICON.inv], ['fiados', 'Fiados', ICON.fiado], ['historial', 'Historial', ICON.hist], ['cierre', 'Cierre', ICON.caja]];
    $nav.innerHTML = '<div>' + items.map(([v, t, i]) => `<button data-ir="${v}" ${S.vista === v ? 'aria-current="page"' : ''}>${i}<span>${t}</span></button>`).join('') + '</div>';
    $nav.querySelectorAll('[data-ir]').forEach(b => b.onclick = () => ir(b.dataset.ir));
  }
  function ir(v) { if (S.escuchando && S.dictado) S.dictado.stop().catch(() => {}); S.vista = v; if (v !== 'asistente' && v !== 'foto') { /* conserva el borrador si existe */ } pintar(); window.scrollTo(0, 0); }

  function vistaSinConexion() {
    return `<div class="card"><h1>Mi Negocio Rentable</h1>
      <p>Registra compras, ventas y gastos <b>hablando</b>, lee facturas con <b>foto</b> y cierra tu caja cada día sabiendo cuánto <b>ganaste de verdad</b>.</p>
      <div class="alerta info">Esta es la <b>versión de demostración</b>: puedes probar todo con datos de ejemplo. Nada se guarda.</div>
      <button class="btn pri lg" data-acc="prueba">Probar la demostración</button>
      <p class="small muted">Para tenerla a mano: menú ⋮ de Chrome → <b>${S.demo ? 'Instalar app' : 'Agregar a pantalla principal'}</b>. Para usarla con tus datos reales, pide tu acceso a quien te compartió el enlace.</p></div>`;
  }

  function botonInstalar() {
    if (!S.instalar || S.modoPrueba) return '';
    if (S.instalar.instalada && S.instalar.instalada()) return '';
    if (S.instalar.disponible()) return '<button class="btn voz lg" data-acc="instalar">Instalar la app en este celular</button>';
    return '<p class="small muted">Para instalarla: menú ⋮ de Chrome → <b>Instalar app</b> o <b>Agregar a pantalla principal</b>.</p>';
  }

  function vistaRegistro() {
    return `<div class="card"><h1>Bienvenido a Mi Negocio Rentable</h1>
      <p class="muted">Registra tus datos una sola vez. Tu información queda separada de la de cualquier otro negocio.</p>
      ${S.cuenta && S.cuenta.local ? '<div class="alerta info small">Tus datos se guardan <b>solo en este celular</b>. Nadie más los ve. Descarga una copia de seguridad cada semana desde Ajustes.</div>' : ''}
      ${botonInstalar()}
      <form id="fRegistro" class="card" style="border:0;padding:0">
        <label for="rNombre">Nombre completo del propietario o responsable<input id="rNombre" required autocomplete="name" placeholder="Ej.: María Quispe Mamani"></label>
        <label for="rNegocio">Nombre del negocio<input id="rNegocio" required placeholder="Ej.: Ganoderma Salud Total"></label>
        <label for="rRubro">Rubro<input id="rRubro" value="Productos Ganoderma"></label>
        <button class="btn pri lg" type="submit">Guardar y empezar</button>
      </form>
      ${S.modoPrueba ? '' : '<button class="btn" data-acc="prueba">Prefiero probar primero con datos ficticios</button>'}</div>`;
  }

  function vistaInicio() {
    const e = estado();
    const r = M.resumenDia(S.productos, S.operaciones, M.fechaLocal(), iniciales());
    const bajos = M.alertasStock(S.productos, e);
    return `<div class="top"><div><small>${esc(S.perfil.nombreNegocio)}</small><h1>Hola, ${esc(S.perfil.nombreCompleto.split(' ')[0])}</h1></div>
      <button class="btn" data-ir="ajustes" aria-label="Ajustes">Ajustes</button></div>
      <div class="big3">
        <button class="big voz" data-acc="hablar">${ICON.mic}<span>Hablar<small>Compra, venta, gasto o cobro</small></span></button>
        <button class="big foto" data-acc="foto">${ICON.cam}<span>Tomar foto<small>Factura o comprobante</small></span></button>
        <button class="big cierre" data-ir="cierre">${ICON.caja}<span>Cierre de hoy<small>Ventas, caja y ganancia</small></span></button>
      </div>
      ${S.instalar && S.instalar.disponible() && !S.modoPrueba ? botonInstalar() : ''}
      ${bajos.length ? `<div class="alerta"><b>Stock bajo:</b> ${bajos.map(p => esc(p.nombre) + ' (' + cant((e.inventario[p.id] || {}).cantM || 0) + ')').join(', ')}</div>` : ''}
      <div class="tiles">
        <div class="tile key"><span>Ventas de hoy (${r.nVentas})</span><b>${bs(r.ventasCent)}</b></div>
        <div class="tile key"><span>Ganancia neta estimada</span><b>${bs(r.utilidadNetaCent)}</b></div>
        <div class="tile"><span>Efectivo esperado en caja</span><b>${bs(r.efectivoEsperadoCent)}</b></div>
        <div class="tile"><span>QR declarado hoy</span><b>${bs(r.qrDeclaradoCent)}</b></div>
      </div>
      <div class="card"><h3>Registrar escribiendo</h3>
        <div class="grid2">
          <button class="btn" data-nuevo="venta">Nueva venta</button><button class="btn" data-nuevo="compra">Nueva compra</button>
          <button class="btn" data-nuevo="gasto">Nuevo gasto</button><button class="btn" data-nuevo="cobro">Cobro de fiado</button>
        </div></div>
      ${!S.productos.length ? '<div class="alerta info">Empieza registrando una compra: los productos se crean solos en tu inventario. Si ya tienes mercadería, usa <b>Inventario → Ajustar inventario</b> para cargar las existencias iniciales con su costo.</div>' : ''}`;
  }

  // ---------- Asistente (voz y borrador) ----------
  function vistaAsistente() {
    const hayDictado = !!S.dictado;
    const chat = S.chat.map(m => `<div class="burbuja ${m.de}">${esc(m.texto)}</div>`).join('') +
      (S.escuchando ? `<div class="burbuja user parcial" id="parcial">${esc(((S.textoDictado || '') + ' ' + S.parcial).trim() || 'Escuchando…')}</div>` : '') +
      (S.procesando ? '<div class="burbuja asist parcial">Entendiendo lo que dijiste…</div>' : '');
    return `<div class="top"><h2>Asistente</h2><button class="btn" data-acc="cancelar">Salir</button></div>
      <div class="chat" id="chat">${chat}</div>
      ${hayDictado ? `<button class="mic ${S.escuchando ? 'on' : ''}" data-acc="mic" aria-label="${S.escuchando ? 'Terminé de hablar' : 'Hablar'}">${ICON.mic}</button>
        <p class="small muted" style="text-align:center;margin:0">${S.escuchando ? 'Te escucho… toca otra vez cuando termines' : 'Toca el micrófono para hablar'}</p>`
      : '<div class="alerta info small">El micrófono de la app no está disponible en este dispositivo. Escribe abajo o usa el micrófono del teclado de tu celular.</div>'}
      <form id="fTexto" class="row"><input id="tTexto" class="grow" placeholder="O escribe: «vendí 3 café a 85 en efectivo»" autocomplete="off"><button class="btn" type="submit">Enviar</button></form>
      ${S.borrador ? editorBorrador() : ''}`;
  }

  function editorBorrador() {
    const b = S.borrador; const t = b.tipo;
    const segTipo = ['venta', 'compra', 'gasto', 'cobro', 'ajuste'].map(x => `<button type="button" data-tipo="${x}" aria-pressed="${t === x}">${{ venta: 'Venta', compra: 'Compra', gasto: 'Gasto', cobro: 'Cobro', ajuste: 'Ajuste' }[x]}</button>`).join('');
    let campos = '';
    if (['venta', 'compra', 'ajuste'].includes(t)) {
      const lista = S.productos.filter(p => p.activo !== false);
      const e = estado();
      campos += (b.items || []).map((it, i) => `<div class="card" style="padding:10px;gap:8px">
        <label for="bi_n${i}">Producto ${t === 'compra' || t === 'ajuste' ? '(elige o escribe uno nuevo)' : ''}
          <input id="bi_n${i}" list="dlProd" data-item="${i}" data-campo="nombre" value="${esc(it.nombre || '')}" placeholder="Nombre del producto"></label>
        <div class="grid2">
          <label for="bi_c${i}">Cantidad${t === 'ajuste' ? ' (+ entra / − sale)' : ''}<input id="bi_c${i}" inputmode="decimal" data-item="${i}" data-campo="cantidad" value="${esc(it.cantidad ?? '')}"></label>
          <label for="bi_p${i}">${t === 'venta' ? 'Precio unitario (Bs)' : 'Costo unitario (Bs)'}<input id="bi_p${i}" inputmode="decimal" data-item="${i}" data-campo="precioUnitario" value="${esc(it.precioUnitario ?? '')}"></label>
        </div>
        <div class="row between small muted"><span>${(() => { const p = M.buscarProducto(it.nombre, lista); return p ? 'Existencias: ' + cant((e.inventario[p.id] || {}).cantM || 0) + (p.precioVentaCent != null && t === 'venta' ? ' · precio sugerido ' + bs(p.precioVentaCent) : '') : (it.nombre ? (t === 'venta' ? 'No está en tu inventario' : 'Producto nuevo') : ''); })()}</span>
          ${(b.items || []).length > 1 ? `<button type="button" class="btn" data-quitar="${i}">Quitar</button>` : ''}</div></div>`).join('') +
        `<datalist id="dlProd">${lista.map(p => `<option value="${esc(p.nombre)}">`).join('')}</datalist>
        <button type="button" class="btn" data-acc="masItem">+ Otro producto</button>`;
      if (t === 'ajuste') campos += `<label for="bMotivo">Motivo<select id="bMotivo" data-campo="motivo"><option value="">Elige…</option>${['Inventario inicial', 'Merma o producto dañado', 'Producto vencido', 'Consumo propio o muestra', 'Conteo físico'].map(m => `<option ${b.motivo === m ? 'selected' : ''}>${m}</option>`).join('')}</select></label>`;
    }
    if (t === 'gasto') {
      campos += `<label for="bTotal">Importe (Bs)<input id="bTotal" inputmode="decimal" data-campo="total" value="${esc(b.total ?? '')}"></label>
        <label for="bCat">Categoría<select id="bCat" data-campo="categoria"><option value="">Elige…</option>${M.CATEGORIAS_GASTO.map(c => `<option ${b.categoria === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
        <label for="bDesc">Detalle<input id="bDesc" data-campo="descripcion" value="${esc(b.descripcion || '')}" placeholder="Ej.: trufi al mercado"></label>`;
    }
    if (t === 'cobro') {
      const deud = Object.values(estado().cxc).filter(c => c.saldoCent > 0);
      campos += `<label for="bCli">Cliente que paga<input id="bCli" list="dlCli" data-campo="cliente" value="${esc(b.cliente || '')}"></label>
        <datalist id="dlCli">${deud.map(c => `<option value="${esc(c.nombre)}">debe ${bs(c.saldoCent)}</option>`).join('')}</datalist>
        <label for="bTotal">Importe cobrado (Bs)<input id="bTotal" inputmode="decimal" data-campo="total" value="${esc(b.total ?? '')}"></label>`;
    }
    if (['venta', 'compra', 'gasto', 'cobro'].includes(t)) {
      const mets = t === 'venta' ? [['efectivo', 'Efectivo'], ['qr', 'QR'], ['credito', 'Fiado']] : [['efectivo', 'Efectivo'], ['qr', 'QR']];
      const activos = new Set((b.pagos || []).map(p => p.metodo));
      campos += `<div><div class="small muted" style="font-weight:600;margin-bottom:4px">Forma de pago (puedes elegir varias)</div>
        <div class="seg">${mets.map(([m, n]) => `<button type="button" data-metodo="${m}" aria-pressed="${activos.has(m)}">${n}</button>`).join('')}</div></div>`;
      if ((b.pagos || []).length > 1) campos += '<div class="grid2">' + b.pagos.map((p, i) => `<label for="bp${i}">${{ efectivo: 'Efectivo', qr: 'QR', credito: 'Fiado' }[p.metodo]} (Bs)<input id="bp${i}" inputmode="decimal" data-pago="${i}" value="${esc(p.monto ?? '')}"></label>`).join('') + '</div>';
      if (t === 'venta') campos += `<label for="bCliV">Cliente ${activos.has('credito') ? '(obligatorio si es fiado)' : '(opcional)'}<input id="bCliV" data-campo="cliente" value="${esc(b.cliente || '')}"></label>`;
    }
    if (b.comprobante) {
      const c = b.comprobante;
      campos += `<div class="alerta info small"><b>Datos del comprobante</b><br>${esc(c.tipoDocumento || 'Comprobante')} ${c.numero ? 'N.º ' + esc(c.numero) : '<span class="ilegible">sin número</span>'} · ${c.proveedor ? esc(c.proveedor) : '<span class="ilegible">proveedor no legible</span>'}${c.nit ? ' · NIT ' + esc(c.nit) : ''} · ${c.fecha ? esc(c.fecha) : '<span class="ilegible">fecha no legible</span>'}
        ${c.camposIlegibles && c.camposIlegibles.length ? '<br>No se pudo leer: ' + c.camposIlegibles.map(esc).join(', ') : ''}</div>`;
    }
    return `<div class="card resumen" id="editor"><h3>Revisa los datos</h3>
      <div class="seg">${segTipo}</div>
      <form id="fBorrador" class="card" style="border:0;padding:0" onsubmit="return false">${campos}</form>
      <div id="resumenBorrador">${resumenBorrador()}</div></div>`;
  }

  function convertir() {
    S.ctx.idsNuevos = S.ctx.idsNuevos || {};
    const r = M.borradorAOperacion(S.borrador, S.productos, Object.assign({ usarPrecioSugerido: false }, S.ctx, { usuarioId: S.uid || 'prueba' }));
    const errores = r.faltantes.length ? [] : M.validarOperacion(r.op, S.productos.concat(r.nuevosProductos), S.operaciones);
    return Object.assign(r, { errores });
  }

  function resumenBorrador() {
    if (!S.borrador.tipo) return '<p class="pregunta">¿Es una venta, una compra, un gasto o un cobro?</p>';
    const { op, nuevosProductos, faltantes, errores } = convertir();
    const nombreTipo = { venta: 'VENTA', compra: 'COMPRA', gasto: 'GASTO', cobro: 'COBRO DE FIADO', ajuste: 'AJUSTE DE INVENTARIO' }[op.tipo];
    let filas = '';
    op.lineas.forEach(l => {
      const nuevo = nuevosProductos.some(p => p.id === l.productoId);
      filas += `<tr><td>${esc(l.nombre || '¿producto?')}${nuevo ? ' <span class="chip warn">nuevo</span>' : ''}<br><span class="small muted">${l.cantM ? cant(l.cantM) : '¿?'} × ${l.precioCent != null ? bs(l.precioCent) : '¿precio?'}</span></td><td class="n">${l.cantM && l.precioCent != null ? bs(M.importeLinea(l.cantM, l.precioCent)) : '—'}</td></tr>`;
    });
    if (op.tipo === 'gasto') filas += `<tr><td>${esc(op.categoria || '¿categoría?')}${op.descripcion ? '<br><span class="small muted">' + esc(op.descripcion) + '</span>' : ''}</td><td class="n">${bs(op.totalCent)}</td></tr>`;
    if (op.tipo === 'cobro') filas += `<tr><td>Cliente: ${esc(op.cliente || '¿?')}</td><td class="n">${bs(op.totalCent)}</td></tr>`;
    if (op.tipo === 'ajuste' && op.motivo) filas += `<tr><td colspan="2" class="small muted">Motivo: ${esc(op.motivo)}</td></tr>`;
    const pagos = op.pagos.map(p => `<span class="chip">${{ efectivo: 'Efectivo', qr: 'QR · declarado', credito: 'Fiado' }[p.metodo]} ${p.montoCent != null ? bs(p.montoCent) : '¿?'}</span>`).join(' ');
    const dup = !faltantes.length && !errores.length ? M.posibleDuplicado(op, S.operaciones) : null;
    const listo = !faltantes.length && !errores.length;
    return `<div class="row between"><span class="chip ${op.tipo}">${nombreTipo}</span><span class="small muted">${esc(op.fecha)}</span></div>
      <table>${filas}</table>
      ${op.tipo !== 'ajuste' ? `<div class="total"><span>Total</span><span class="num">${bs(op.totalCent)}</span></div>` : ''}
      ${pagos ? `<div class="row">${pagos}</div>` : ''}
      ${op.cliente && op.tipo === 'venta' ? `<div class="small">Cliente: <b>${esc(op.cliente)}</b></div>` : ''}
      ${faltantes.map(f => `<div class="alerta">${esc(f)}</div>`).join('')}
      ${errores.map(f => `<div class="alerta bad">${esc(f)}</div>`).join('')}
      ${dup ? `<div class="alerta bad">Hace poco registraste una operación idéntica (${new Date(dup.creadoEn).toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' })}). Si es otra distinta, confirma de nuevo.</div>` : ''}
      ${listo ? '<p class="pregunta">¿Confirmas o deseas corregir?</p>' : ''}
      <div class="row">
        <button class="btn pri lg" data-acc="confirmar" ${listo && !S.guardando ? '' : 'disabled'}>${S.guardando ? 'Guardando…' : (dup && S.dupAviso !== dup.id ? 'Sí, es otra: confirmar' : 'Confirmar')}</button>
        ${S.dictado ? '<button class="btn voz lg" data-acc="mic">Corregir por voz</button>' : ''}
      </div>
      <button class="btn" data-acc="descartar">Descartar sin guardar</button>`;
  }

  function preguntaSiguiente() {
    if (!S.borrador) return null;
    if (!S.borrador.tipo) return '¿Es una venta, una compra, un gasto o un cobro?';
    const { op, faltantes, errores } = convertir();
    if (faltantes.length) return faltantes[0];
    if (errores.length) return errores[0];
    return frasesResumen(op) + ' ¿Confirmas o deseas corregir?';
  }
  function frasesResumen(op) {
    const n = x => bs(x).replace('Bs ', '') + ' bolivianos';
    const pagos = op.pagos.map(p => ({ efectivo: 'en efectivo', qr: 'por QR', credito: 'fiado' }[p.metodo]) + (op.pagos.length > 1 ? ' ' + n(p.montoCent) : '')).join(' y ');
    if (op.tipo === 'gasto') return `Gasto de ${n(op.totalCent)} en ${op.categoria}, pagado ${pagos}.`;
    if (op.tipo === 'cobro') return `${op.cliente} te pagó ${n(op.totalCent)} ${pagos}.`;
    const lineas = op.lineas.map(l => `${cant(l.cantM)} ${l.nombre} a ${n(l.precioCent)}`).join(', ');
    if (op.tipo === 'ajuste') return `Ajuste de inventario: ${op.lineas.map(l => cant(l.cantM) + ' ' + l.nombre).join(', ')}. Motivo: ${op.motivo}.`;
    return `${op.tipo === 'venta' ? 'Vendiste' : 'Compraste'} ${lineas}. Total ${n(op.totalCent)}, ${pagos}${op.cliente && op.tipo === 'venta' ? ', cliente ' + op.cliente : ''}.`;
  }

  function nuevoBorrador(tipo, origen, extra) {
    S.borrador = Object.assign({ tipo, items: ['venta', 'compra', 'ajuste'].includes(tipo) ? [{ nombre: '', cantidad: null, precioUnitario: null }] : [], total: null, pagos: [], cliente: null, categoria: null, descripcion: null, motivo: null }, extra || {});
    S.ctx = { id: M.uid('o_'), origen: origen || 'formulario', textoOriginal: null, idsNuevos: {}, creadoEn: null };
    S.dupAviso = null;
  }

  function decir(texto) { S.chat.push({ de: 'asist', texto }); hablar(texto); }

  // ---------- Dictado ----------
  let finTimer = null;
  function programarFinDictado() { clearTimeout(finTimer); finTimer = setTimeout(() => { if (S.escuchando && S.dictado) S.dictado.stop().catch(() => {}); }, 1800); }
  function pintarParcial() { const el = document.getElementById('parcial'); if (el) el.textContent = ((S.textoDictado || '') + ' ' + S.parcial).trim() || 'Escuchando…'; if (S.parcial) programarFinDictado(); }
  function alternarMic() {
    if (!S.dictado) return;
    if (S.escuchando) { S.dictado.stop().catch(() => {}); return; }
    if (S.tts) try { S.tts.stop(); } catch (e) { /* nada */ }
    S.textoDictado = ''; S.parcial = '';
    S.dictado.start().catch(e => {
      S.escuchando = false;
      if (e && e.code === 'not_granted') { S.dictado = null; decir('No tengo permiso para usar el micrófono. Puedes escribir o usar el micrófono del teclado.'); }
      pintar();
    });
    S.escuchando = true; pintar();
  }
  function finDictado() {
    clearTimeout(finTimer);
    const texto = (S.textoDictado || '').trim(); S.textoDictado = ''; S.parcial = '';
    if (texto) procesarTexto(texto, 'voz'); else pintar();
  }

  // ---------- Interpretación (IA con respaldo local) ----------
  async function procesarTexto(texto, fuente) {
    S.chat.push({ de: 'user', texto });
    if (M.esCierre(texto)) { decir('Vamos al cierre de hoy.'); S.vista = 'cierre'; pintar(); hablarCierre(); return; }
    if (S.borrador && M.esConfirmacion(texto)) { await confirmar(); return; }
    if (S.borrador && M.esCancelacion(texto)) { descartar('Listo, no guardé nada.'); return; }
    S.procesando = true; pintar();
    let nuevo = null, viaIA = false;
    if (S.ia) {
      try { nuevo = await interpretarConIA(texto, S.borrador); viaIA = true; }
      catch (e) { if (e && (e.code === 'not_granted')) S.ia = null; nuevo = null; }
    }
    if (!nuevo) nuevo = S.borrador ? M.corregirBorradorLocal(S.borrador, texto, S.productos) : M.interpretarTextoLocal(texto, S.productos);
    S.procesando = false;
    if (!S.borrador) { nuevoBorrador(nuevo.tipo, fuente || 'voz'); S.ctx.textoOriginal = texto; }
    else S.ctx.textoOriginal = (S.ctx.textoOriginal ? S.ctx.textoOriginal + ' | ' : '') + texto;
    S.borrador = Object.assign(S.borrador, nuevo);
    if (['venta', 'compra', 'ajuste'].includes(S.borrador.tipo) && !(S.borrador.items || []).length) S.borrador.items = [{ nombre: '', cantidad: null, precioUnitario: null }];
    S.ctx.via = viaIA ? 'ia' : 'reglas';
    decir(preguntaSiguiente());
    pintar();
  }

  function limpiarBorradorIA(x, anterior) {
    const num = v => (v === null || v === undefined || v === '' || isNaN(Number(v))) ? null : Number(v);
    const tipo = ['venta', 'compra', 'gasto', 'cobro', 'ajuste'].includes(x && x.tipo) ? x.tipo : (anterior && anterior.tipo) || null;
    const b = {
      tipo,
      items: Array.isArray(x.items) ? x.items.filter(i => i && (i.nombre || i.productoId)).map(i => {
        const p = i.productoId ? S.productos.find(q => q.id === i.productoId) : null;
        return { nombre: p ? p.nombre : String(i.nombre || ''), productoId: p ? p.id : undefined, cantidad: num(i.cantidad), precioUnitario: num(i.precioUnitario), subtotal: num(i.subtotal) };
      }) : [],
      total: num(x.total),
      pagos: Array.isArray(x.pagos) ? x.pagos.filter(p => p && M.METODOS.includes(p.metodo)).map(p => ({ metodo: p.metodo, monto: num(p.monto) })) : [],
      cliente: x.cliente ? String(x.cliente).slice(0, 80) : null,
      categoria: M.CATEGORIAS_GASTO.includes(x.categoria) ? x.categoria : null,
      descripcion: x.descripcion ? String(x.descripcion).slice(0, 140) : null,
      motivo: x.motivo ? String(x.motivo).slice(0, 80) : (anterior ? anterior.motivo : null)
    };
    if (anterior && anterior.comprobante) b.comprobante = anterior.comprobante;
    return b;
  }

  async function interpretarConIA(texto, anterior) {
    const e = estado();
    const productos = S.productos.filter(p => p.activo !== false).map(p => ({ id: p.id, nombre: p.nombre, existencias: (e.inventario[p.id] || {}).cantM / 1000 || 0 }));
    const deudores = Object.values(e.cxc).filter(c => c.saldoCent > 0).map(c => ({ cliente: c.nombre, debeBs: c.saldoCent / 100 }));
    const prompt = `Eres el asistente de registro de un pequeño comercio boliviano (moneda: bolivianos, Bs). Convierte lo que dijo el comerciante en un borrador JSON.
REGLAS ESTRICTAS:
- No inventes nada. Si un dato no fue dicho, usa null. No uses precios "habituales" ni supongas cantidades.
- tipo: "venta" (vendió), "compra" (compró mercadería para revender), "gasto" (pagó algo que no es mercadería: taxi, alquiler, luz, bolsas…), "cobro" (un cliente le pagó una deuda o fiado), "ajuste" (merma, vencido, inventario inicial). Si no está claro, null.
- items: solo para venta, compra y ajuste. Si el producto coincide con uno de la lista, pon su "productoId" y su nombre exacto; si no, pon el nombre como lo dijo. precioUnitario = precio por unidad; si dijo solo el total de ese producto, ponlo en "subtotal" y deja precioUnitario en null.
- pagos: metodo "efectivo", "qr" o "credito" (fiado, me debe, paga después). monto en Bs; si hay una sola forma de pago, monto puede ser null.
- categoria (solo gastos), una de: ${JSON.stringify(M.CATEGORIAS_GASTO)}.
- Números dichos en palabras: conviértelos ("ochenta con cincuenta" = 80.5).
${anterior ? '- Esto es una CORRECCIÓN del borrador actual: devuelve el borrador completo con solo los cambios que pidió; conserva lo demás.\nBORRADOR ACTUAL: ' + JSON.stringify(anterior) : ''}
PRODUCTOS DEL INVENTARIO: ${JSON.stringify(productos)}
CLIENTES QUE DEBEN: ${JSON.stringify(deudores)}
LO QUE DIJO: «${texto}»
Responde SOLO con JSON con esta forma exacta:
{"tipo":null,"items":[{"productoId":null,"nombre":"","cantidad":null,"precioUnitario":null,"subtotal":null}],"total":null,"pagos":[{"metodo":"efectivo","monto":null}],"cliente":null,"categoria":null,"descripcion":null,"motivo":null}`;
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 25000);
    try {
      const x = S.ia.json ? await S.ia.json(prompt, { modelTier: 'quick', signal: ctrl.signal, cache: false }) : JSON.parse((await S.ia(prompt, { modelTier: 'quick', signal: ctrl.signal, cache: false })).text.replace(/^[^{]*|[^}]*$/g, ''));
      if (!x || typeof x !== 'object') return null;
      return limpiarBorradorIA(x, anterior);
    } finally { clearTimeout(t); }
  }

  // ---------- Confirmar y guardar ----------
  async function confirmar() {
    if (!S.borrador || S.guardando) return;
    if (!S.ctx.creadoEn) S.ctx.creadoEn = new Date().toISOString();
    const { op, nuevosProductos, faltantes, errores } = convertir();
    if (faltantes.length || errores.length) { decir(faltantes[0] || errores[0]); pintar(); return; }
    const dup = M.posibleDuplicado(op, S.operaciones);
    if (dup && S.dupAviso !== dup.id) { S.dupAviso = dup.id; decir('Ya registraste una operación igual hace un momento. Si es otra distinta, confirma de nuevo.'); pintar(); return; }
    if (S.ctx.via) op.interpretacion = S.ctx.via;
    S.guardando = true; pintar();
    try {
      for (const p of nuevosProductos) if (!store.productos.has(p.id)) await guardarDoc(p);
      await guardarDoc(op);
      S.guardando = false;
      const frase = { venta: 'Venta registrada. Descontado del inventario.', compra: 'Compra registrada. Inventario actualizado.', gasto: 'Gasto registrado.', cobro: 'Cobro registrado. Se redujo la deuda del cliente.', ajuste: 'Ajuste de inventario registrado.' }[op.tipo];
      S.borrador = null; S.ctx = null; S.dupAviso = null;
      decir(frase + ' ¿Algo más?');
      toast('✓ ' + frase);
      const bajos = M.alertasStock(S.productos, estado()).filter(p => op.lineas.some(l => l.productoId === p.id));
      if (bajos.length) decir('Atención: queda poco de ' + bajos.map(p => p.nombre).join(', ') + '.');
    } catch (e) { S.guardando = false; decir(mensajeError(e)); }
    pintar();
  }
  function descartar(msg) { S.borrador = null; S.ctx = null; S.dupAviso = null; if (msg) decir(msg); pintar(); }

  // ---------- Fotografía ----------
  function vistaFoto() {
    const f = S.foto;
    return `<div class="top"><h2>Foto de comprobante</h2><button class="btn" data-acc="cancelarFoto">Salir</button></div>
      ${!S.ia || !S.iaImagenes ? '<div class="alerta">La lectura automática de imágenes no está disponible en esta sesión. Puedes adjuntar la foto y completar los datos a mano.</div>' : ''}
      <label class="btn pri lg" for="inFoto" style="flex-direction:row;justify-content:center;align-items:center;color:var(--accent-ink)">${ICON.cam.replace('<svg', '<svg style="width:28px;height:28px"')} ${f ? 'Tomar otra foto' : 'Abrir cámara o galería'}</label>
      <input id="inFoto" type="file" accept="image/*" capture="environment" hidden>
      ${f && f.url ? `<img class="foto-prev" src="${f.url}" alt="Comprobante fotografiado">` : ''}
      ${f && f.estado === 'leyendo' ? '<div class="alerta info">Leyendo el comprobante… esto puede tardar unos segundos.</div>' : ''}
      ${f && f.error ? `<div class="alerta bad">${esc(f.error)}</div>` : ''}
      ${f && f.estado === 'listo' && !S.borrador ? '' : ''}
      ${S.borrador ? editorBorrador() : (f && f.estado !== 'leyendo' ? '<div class="row"><button class="btn" data-nuevo="compra">Registrar como compra a mano</button><button class="btn" data-nuevo="gasto">Registrar como gasto a mano</button></div>' : '')}
      <p class="small muted">Consejo: foto de frente, con buena luz y el comprobante completo. Los datos que no se lean se dejan vacíos para que los completes; la app no los inventa.</p>`;
  }

  function reducirImagen(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file); const img = new Image();
      img.onload = () => {
        const max = 1600; const k = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        c.toBlob(b => b ? resolve({ blob: b, url: URL.createObjectURL(b) }) : reject(new Error('No se pudo procesar la imagen')), 'image/jpeg', 0.85);
        URL.revokeObjectURL(url);
      };
      img.onerror = () => reject(new Error('El archivo no es una imagen válida'));
      img.src = url;
    });
  }

  async function procesarFoto(file) {
    S.borrador = null; S.ctx = null;
    try {
      const { blob, url } = await reducirImagen(file);
      S.foto = { url, estado: 'leyendo' }; pintar();
      if (!S.ia || !S.iaImagenes) { S.foto.estado = 'manual'; pintar(); return; }
      const prompt = `Lee esta fotografía de un comprobante boliviano (factura, nota de venta o recibo) de un pequeño comercio.
REGLAS: transcribe solo lo que se lee con claridad. Si un dato está borroso, cortado o no aparece, usa null y anótalo en "camposIlegibles". Nunca estimes ni completes valores. Montos en bolivianos como números (1.250,50 → 1250.5).
"esCompraOGasto": "compra" si son productos para revender (por ejemplo productos de Ganoderma, café, cápsulas, té), "gasto" si es un servicio u otro pago (transporte, alquiler, luz, bolsas), null si no se puede saber.
Productos del inventario del comerciante (para referencia de nombres): ${JSON.stringify(S.productos.map(p => p.nombre))}
Responde SOLO JSON: {"tipoDocumento":null,"esCompraOGasto":null,"proveedor":null,"nit":null,"numero":null,"fecha":"AAAA-MM-DD o null","items":[{"descripcion":"","cantidad":null,"precioUnitario":null,"subtotal":null}],"total":null,"metodoPago":"efectivo|qr|null","camposIlegibles":[],"legible":true}`;
      const ctrl = new AbortController(); const tm = setTimeout(() => ctrl.abort(), 60000);
      let x;
      try {
        x = S.ia.json ? await S.ia.json(prompt, { images: [blob], modelTier: 'default', signal: ctrl.signal, cache: false })
          : JSON.parse((await S.ia(prompt, { images: [blob], modelTier: 'default', signal: ctrl.signal, cache: false })).text.replace(/^[^{]*|[^}]*$/g, ''));
      } finally { clearTimeout(tm); }
      if (!x || x.legible === false) { S.foto.estado = 'manual'; S.foto.error = 'No se pudo leer el comprobante. Toma otra foto con más luz o completa los datos a mano.'; pintar(); return; }
      const num = v => (v === null || v === undefined || v === '' || isNaN(Number(v))) ? null : Number(v);
      const tipo = x.esCompraOGasto === 'gasto' ? 'gasto' : x.esCompraOGasto === 'compra' ? 'compra' : null;
      const comprobante = { tipoDocumento: x.tipoDocumento || null, proveedor: x.proveedor || null, nit: x.nit || null, numero: x.numero || null, fecha: /^\d{4}-\d{2}-\d{2}$/.test(x.fecha || '') ? x.fecha : null, totalLeidoBs: num(x.total), camposIlegibles: Array.isArray(x.camposIlegibles) ? x.camposIlegibles.slice(0, 12).map(String) : [] };
      nuevoBorrador(tipo || 'compra', 'foto');
      const items = (x.items || []).filter(i => i && i.descripcion).map(i => {
        const p = M.buscarProducto(i.descripcion, S.productos);
        let precio = num(i.precioUnitario); const q = num(i.cantidad), sub = num(i.subtotal);
        return { nombre: p ? p.nombre : String(i.descripcion).slice(0, 80), productoId: p ? p.id : undefined, cantidad: q, precioUnitario: precio, subtotal: precio === null ? sub : null };
      });
      Object.assign(S.borrador, {
        tipo, comprobante,
        items: tipo === 'gasto' ? [] : (items.length ? items : [{ nombre: '', cantidad: null, precioUnitario: null }]),
        total: tipo === 'gasto' ? num(x.total) : num(x.total),
        categoria: tipo === 'gasto' ? M.detectarCategoria(M.normalizar([x.proveedor, ...(x.items || []).map(i => i && i.descripcion)].join(' '))) : null,
        descripcion: tipo === 'gasto' ? [x.proveedor, (x.items || []).map(i => i && i.descripcion).filter(Boolean).join(', ')].filter(Boolean).join(' — ').slice(0, 140) : null,
        pagos: x.metodoPago === 'efectivo' || x.metodoPago === 'qr' ? [{ metodo: x.metodoPago, monto: null }] : []
      });
      S.ctx.textoOriginal = 'Comprobante: ' + JSON.stringify(comprobante).slice(0, 600);
      S.ctx.via = 'ia';
      S.foto.estado = 'listo';
      if (!tipo) toast('No se sabe si es compra o gasto: elige el tipo.');
    } catch (e) {
      S.foto = Object.assign(S.foto || {}, { estado: 'manual', error: e && e.code === 'rate_limited' ? 'Demasiadas lecturas seguidas. Espera un minuto y vuelve a intentar.' : 'No se pudo leer la imagen (' + ((e && (e.code || e.message)) || 'error') + '). Puedes registrar a mano.' });
      if (e && e.code === 'not_granted') S.ia = null;
    }
    pintar();
  }

  // ---------- Cierre ----------
  function vistaCierre() {
    const ini = iniciales();
    const r = M.resumenDia(S.productos, S.operaciones, S.cierreFecha, ini);
    const sug = M.efectivoInicialSugerido(S.cierres, S.cierreFecha);
    const contado = M.aCentavos(S.cierreContado);
    const dif = contado !== null ? M.cerrarCaja(r, contado) : null;
    const previos = S.cierres.filter(c => c.fecha === S.cierreFecha);
    const cats = Object.entries(r.gastosPorCategoria);
    return `<div class="top"><h2>Cierre del día</h2><input type="date" id="cFecha" value="${esc(S.cierreFecha)}" style="width:auto" aria-label="Fecha del cierre"></div>
      <div class="card"><h3>Rentabilidad: lo que ganaste</h3>
        <div class="tiles">
          <div class="tile"><span>Ventas (${r.nVentas})</span><b>${bs(r.ventasCent)}</b></div>
          <div class="tile"><span>Costo de lo vendido</span><b>${bs(r.cmvCent)}</b></div>
          <div class="tile"><span>Utilidad bruta</span><b>${bs(r.utilidadBrutaCent)}</b></div>
          <div class="tile"><span>Gastos${r.mermasCent ? ' + mermas' : ''}</span><b>${bs(r.gastosCent + r.mermasCent)}</b></div>
          <div class="tile key full"><span>Utilidad neta estimada del día</span><b>${bs(r.utilidadNetaCent)}</b></div>
        </div>
        ${cats.length ? '<div class="small muted">Gastos: ' + cats.map(([c, v]) => esc(c) + ' ' + bs(v)).join(' · ') + '</div>' : ''}
      </div>
      <div class="card"><h3>Cobros: cómo te pagaron</h3>
        <div class="tiles">
          <div class="tile"><span>Ventas en efectivo</span><b>${bs(r.ventasEfectivoCent)}</b></div>
          <div class="tile"><span>Ventas por QR (declarado)</span><b>${bs(r.ventasQRCent)}</b></div>
          <div class="tile"><span>Vendido fiado hoy</span><b>${bs(r.ventasFiadoCent)}</b></div>
          <div class="tile"><span>Fiados cobrados hoy</span><b>${bs(r.cobrosFiadoEfectivoCent + r.cobrosFiadoQRCent)}</b></div>
          <div class="tile full"><span>Total por cobrar a clientes (todas las fechas)</span><b>${bs(r.porCobrarTotalCent)}</b></div>
        </div>
        <div class="alerta info small">El QR figura como <b>declarado</b>: verifica en tu banca móvil que llegaron ${bs(r.qrDeclaradoCent)}. La verificación automática con el banco aún no está conectada.</div>
      </div>
      <div class="card"><h3>Caja: el efectivo que debe haber</h3>
        <label for="cInicial">Efectivo al abrir la caja (Bs)${sug ? ` <span class="muted">· sugerido del cierre del ${esc(sug.fecha)}</span>` : ''}<input id="cInicial" inputmode="decimal" value="${esc(M.formatoBs(ini).replace('Bs ', '').replace(/\./g, ''))}"></label>
        <table class="k"><tbody>
          <tr><td>Efectivo al abrir</td><td>${bs(ini)}</td></tr>
          <tr><td>+ Ventas en efectivo</td><td>${bs(r.ventasEfectivoCent)}</td></tr>
          <tr><td>+ Fiados cobrados en efectivo</td><td>${bs(r.cobrosFiadoEfectivoCent)}</td></tr>
          <tr><td>− Compras pagadas en efectivo</td><td>${bs(r.comprasEfectivoCent)}</td></tr>
          <tr><td>− Gastos pagados en efectivo</td><td>${bs(r.gastosEfectivoCent)}</td></tr>
          <tr><th>= Efectivo esperado</th><th>${bs(r.efectivoEsperadoCent)}</th></tr>
        </tbody></table>
        ${r.efectivoEsperadoCent < 0 ? '<div class="alerta small">El efectivo esperado es negativo: pagaste más en efectivo de lo que había. Revisa el efectivo al abrir o si alguna compra se pagó por QR.</div>' : ''}
        <label for="cContado" style="font-size:1rem;color:var(--ink)">¿Cuánto efectivo tienes realmente?
          <div class="row"><input id="cContado" class="grow" inputmode="decimal" placeholder="Cuenta tu dinero y escribe el total" value="${esc(S.cierreContado)}">
          ${S.dictado ? `<button class="btn voz" type="button" data-acc="micCierre" aria-label="Decir el monto">${S.escuchando ? 'Escuchando…' : 'Decirlo'}</button>` : ''}</div></label>
        ${dif ? `<div class="alerta ${dif.estado === 'cuadra' ? 'ok' : 'bad'}"><b>${dif.estado === 'cuadra' ? 'La caja cuadra.' : dif.estado === 'faltante' ? 'Falta ' + bs(-dif.diferenciaCent) + ' en caja.' : 'Sobra ' + bs(dif.diferenciaCent) + ' en caja.'}</b>
          ${dif.estado !== 'cuadra' ? '<br><span class="small">Revisa ventas o gastos sin registrar, vueltos mal dados o pagos QR registrados como efectivo.</span>' : ''}</div>` : ''}
        <button class="btn pri lg" data-acc="guardarCierre" ${contado === null || S.guardando ? 'disabled' : ''}>Confirmar y guardar cierre</button>
        <p class="small muted">Las compras no reducen la ganancia: se convierten en inventario. Sí reducen el efectivo de caja.</p>
      </div>
      ${previos.length ? '<div class="card"><h3>Cierres guardados de esta fecha</h3>' + previos.map(c => `<div class="item"><span>${new Date(c.creadoEn).toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' })} · contado ${bs(c.efectivoContadoCent)}</span><span class="chip ${c.diferenciaCent === 0 ? 'venta' : 'bad'}">${c.diferenciaCent === 0 ? 'cuadró' : (c.diferenciaCent > 0 ? 'sobró ' : 'faltó ') + bs(Math.abs(c.diferenciaCent || 0))}</span></div>`).join('') + '<p class="small muted">Si vuelves a cerrar, el cierre anterior se conserva en el historial.</p></div>' : ''}`;
  }

  function hablarCierre() {
    const r = M.resumenDia(S.productos, S.operaciones, S.cierreFecha, iniciales());
    const n = x => bs(x).replace('Bs ', '') + ' bolivianos';
    hablar(`Hoy vendiste ${n(r.ventasCent)} en ${r.nVentas} ventas: ${n(r.ventasEfectivoCent)} en efectivo, ${n(r.ventasQRCent)} por QR y ${n(r.ventasFiadoCent)} fiado. Gastos: ${n(r.gastosCent)}. Ganancia neta estimada: ${n(r.utilidadNetaCent)}. Deberías tener ${n(r.efectivoEsperadoCent)} en efectivo. ¿Cuánto efectivo tienes realmente?`);
  }

  async function guardarCierre() {
    const ini = iniciales();
    const r = M.resumenDia(S.productos, S.operaciones, S.cierreFecha, ini);
    const contado = M.aCentavos(S.cierreContado);
    if (contado === null || contado < 0) { toast('Escribe el efectivo contado.'); return; }
    const d = M.cerrarCaja(r, contado);
    abrirModal(`<h2>¿Confirmas el cierre del ${esc(S.cierreFecha)}?</h2>
      <table class="k"><tbody><tr><td>Efectivo esperado</td><td>${bs(r.efectivoEsperadoCent)}</td></tr><tr><td>Efectivo contado</td><td>${bs(contado)}</td></tr><tr><th>Diferencia</th><th>${bs(d.diferenciaCent)}</th></tr><tr><td>Utilidad neta estimada</td><td>${bs(r.utilidadNetaCent)}</td></tr></tbody></table>
      <div class="row"><button class="btn pri lg" id="mSi">Confirmar</button><button class="btn lg" id="mNo">Corregir</button></div>`, async (box) => {
      box.querySelector('#mNo').onclick = cerrarModal;
      box.querySelector('#mSi').onclick = async () => {
        box.querySelector('#mSi').disabled = true;
        const c = { id: 'c_' + S.cierreFecha + '_' + M.uid(''), kind: 'cierre', fecha: S.cierreFecha, creadoEn: new Date().toISOString(), usuarioId: S.uid || 'prueba', efectivoInicialCent: ini, efectivoContadoCent: contado, diferenciaCent: d.diferenciaCent, estado: d.estado, resumen: r };
        try { await guardarDoc(c); cerrarModal(); toast('✓ Cierre guardado'); hablar(d.estado === 'cuadra' ? 'Cierre guardado. La caja cuadra.' : `Cierre guardado. ${d.estado === 'faltante' ? 'Faltan' : 'Sobran'} ${bs(Math.abs(d.diferenciaCent)).replace('Bs ', '')} bolivianos.`); S.cierreContado = ''; S.cierreInicial = null; pintar(); }
        catch (e) { cerrarModal(); toast(mensajeError(e), 5000); }
      };
    });
  }

  // micrófono para el monto contado
  function micCierre() {
    if (!S.dictado) return;
    if (S.escuchando) { S.dictado.stop().catch(() => {}); return; }
    S.textoDictado = ''; S.modoMicCierre = true;
    S.dictado.start().catch(() => { S.escuchando = false; S.modoMicCierre = false; pintar(); });
    S.escuchando = true; pintar();
  }
  const finDictadoBase = finDictado;
  finDictado = function () {
    if (S.modoMicCierre) {
      S.modoMicCierre = false; clearTimeout(finTimer);
      const t = M.palabrasANumeros(S.textoDictado || ''); S.textoDictado = '';
      const m = t.match(/\d+(?:[.,]\d+)?/);
      if (m) { S.cierreContado = m[0].replace('.', ','); hablar('Anoté ' + m[0] + ' bolivianos.'); } else toast('No entendí el monto. Escríbelo, por favor.');
      pintar(); return;
    }
    finDictadoBase();
  };

  // ---------- Inventario ----------
  function vistaInventario() {
    const e = estado();
    const total = Object.values(e.inventario).reduce((a, s) => a + s.valorCent, 0);
    const filas = S.productos.map(p => {
      const s = e.inventario[p.id] || { cantM: 0, valorCent: 0 };
      const bajo = p.stockMinimoM > 0 && s.cantM <= p.stockMinimoM;
      const prom = s.cantM > 0 ? Math.round(s.valorCent * 1000 / s.cantM) : null;
      return `<button class="item" style="background:none;border-left:0;border-right:0;border-top:0;width:100%;text-align:left;cursor:pointer" data-prod="${p.id}">
        <span class="grow"><b>${esc(p.nombre)}</b>${p.activo === false ? ' <span class="chip">inactivo</span>' : ''}<br><span class="small muted">Costo prom. ${prom !== null ? bs(prom) : '—'} · Precio venta ${p.precioVentaCent != null ? bs(p.precioVentaCent) : 'sin definir'} · Mín. ${cant(p.stockMinimoM || 0)}</span></span>
        <span style="text-align:right"><b class="num" style="font-size:1.2rem">${cant(s.cantM)}</b><br>${bajo ? '<span class="chip warn">stock bajo</span>' : `<span class="small muted">${bs(s.valorCent)}</span>`}</span></button>`;
    }).join('');
    return `<div class="top"><h2>Inventario</h2><span class="chip">Valor ${bs(total)}</span></div>
      <div class="row"><button class="btn grow" data-acc="nuevoProd">+ Producto</button><button class="btn grow" data-nuevo="ajuste">Ajustar inventario</button></div>
      <div class="card lista">${filas || '<p class="muted">Aún no hay productos. Registra una compra o un inventario inicial.</p>'}</div>
      <p class="small muted">Costo promedio ponderado: cada compra se promedia con lo que ya tenías. Toca un producto para ver sus movimientos (kardex).</p>`;
  }

  function abrirProducto(id) {
    const p = id ? S.productos.find(x => x.id === id) : null;
    const e = estado();
    const k = id ? e.kardex.filter(x => x.productoId === id).slice(-40).reverse() : [];
    abrirModal(`<h2>${p ? esc(p.nombre) : 'Nuevo producto'}</h2>
      <form id="fProd" class="card" style="border:0;padding:0">
        <label for="pNom">Nombre<input id="pNom" required value="${esc(p ? p.nombre : '')}"></label>
        <div class="grid2"><label for="pPv">Precio de venta sugerido (Bs)<input id="pPv" inputmode="decimal" value="${p && p.precioVentaCent != null ? esc((p.precioVentaCent / 100).toFixed(2).replace('.', ',')) : ''}"></label>
        <label for="pMin">Stock mínimo (alerta)<input id="pMin" inputmode="decimal" value="${p ? cant(p.stockMinimoM || 0) : '0'}"></label></div>
        ${p ? `<label class="row" style="flex-direction:row;align-items:center" for="pAct"><input id="pAct" type="checkbox" style="width:auto;min-height:0" ${p.activo !== false ? 'checked' : ''}> Producto activo</label>` : ''}
        <div class="row"><button class="btn pri lg" type="submit">Guardar</button><button class="btn lg" type="button" id="mNo">Cerrar</button></div>
      </form>
      ${p ? `<h3>Kardex (últimos movimientos)</h3><div class="tablewrap"><table class="k"><thead><tr><th>Fecha</th><th>Tipo</th><th>Entra</th><th>Sale</th><th>Costo</th><th>Saldo</th><th>Valor</th></tr></thead><tbody>
        ${k.map(x => `<tr><td>${esc(x.fecha.slice(5))}</td><td>${esc(x.tipo)}</td><td>${x.entradaM ? cant(x.entradaM) : ''}</td><td>${x.salidaM ? cant(x.salidaM) : ''}</td><td>${bs(x.costoCent)}</td><td>${cant(x.saldoM)}</td><td>${bs(x.saldoValorCent)}</td></tr>`).join('') || '<tr><td colspan="7">Sin movimientos</td></tr>'}
        </tbody></table></div>` : '<p class="small muted">Las existencias no se escriben aquí: entran con compras o con «Ajustar inventario → Inventario inicial».</p>'}`, box => {
      box.querySelector('#mNo').onclick = cerrarModal;
      box.querySelector('#fProd').onsubmit = async ev => {
        ev.preventDefault();
        const nombre = box.querySelector('#pNom').value.trim();
        if (!nombre) return;
        if (S.productos.some(x => x.id !== (p && p.id) && M.normalizar(x.nombre) === M.normalizar(nombre))) { toast('Ya existe un producto con ese nombre.'); return; }
        const pv = box.querySelector('#pPv').value.trim();
        const doc = Object.assign({}, p || { id: M.uid('p_'), kind: 'producto', unidad: 'unidad', creadoEn: new Date().toISOString() }, {
          nombre, precioVentaCent: pv ? M.aCentavos(pv) : null, stockMinimoM: M.aMilesimas(box.querySelector('#pMin').value || 0) || 0,
          activo: p ? box.querySelector('#pAct').checked : true, actualizadoEn: new Date().toISOString()
        });
        try { await guardarDoc(doc); cerrarModal(); toast('✓ Producto guardado'); pintar(); } catch (e) { toast(mensajeError(e), 5000); }
      };
    });
  }

  // ---------- Fiados ----------
  function vistaFiados() {
    const e = estado();
    const lista = Object.values(e.cxc).sort((a, b) => b.saldoCent - a.saldoCent);
    const total = lista.reduce((a, c) => a + c.saldoCent, 0);
    return `<div class="top"><h2>Fiados</h2><span class="chip warn">Por cobrar ${bs(total)}</span></div>
      <div class="card lista">${lista.filter(c => c.saldoCent > 0).map(c => `<div class="item"><span class="grow"><b>${esc(c.nombre)}</b><br><span class="small muted">${c.movimientos.length} movimientos · último ${esc(c.movimientos[c.movimientos.length - 1].fecha)}</span></span>
        <span style="text-align:right"><b class="num">${bs(c.saldoCent)}</b><br><button class="btn" data-cobrar="${esc(c.nombre)}">Registrar pago</button></span></div>`).join('') || '<p class="muted">Nadie te debe. Las ventas fiadas aparecerán aquí.</p>'}</div>
      ${lista.some(c => c.saldoCent === 0) ? `<details class="card"><summary>Clientes al día (${lista.filter(c => c.saldoCent === 0).length})</summary>${lista.filter(c => c.saldoCent === 0).map(c => `<div class="item"><span>${esc(c.nombre)}</span><span class="chip venta">pagado</span></div>`).join('')}</details>` : ''}`;
  }

  // ---------- Historial ----------
  function descripcionOp(o) {
    if (o.tipo === 'gasto') return esc(o.categoria) + (o.descripcion ? ' · ' + esc(o.descripcion) : '');
    if (o.tipo === 'cobro') return 'Pago de ' + esc(o.cliente);
    if (o.tipo === 'anulacion') { const x = S.operaciones.find(y => y.id === o.anulaA); return 'Anula ' + (x ? x.tipo + ' de ' + bs(x.totalCent) : 'operación') + ' · ' + esc(o.motivo); }
    return (o.lineas || []).map(l => cant(Math.abs(l.cantM)) + ' ' + esc(prodNombre(l.productoId)) + (o.tipo !== 'ajuste' ? ' × ' + bs(l.precioCent) : '')).join(', ') + (o.cliente ? ' · ' + esc(o.cliente) : '') + (o.motivo ? ' · ' + esc(o.motivo) : '');
  }
  function vistaHistorial() {
    const e = estado();
    const f = S.filtroHist;
    const ops = S.operaciones.filter(o => f === 'todas' || o.tipo === f).slice().reverse().slice(0, 200);
    let fecha = null, html = '';
    for (const o of ops) {
      if (o.fecha !== fecha) { fecha = o.fecha; html += `<h3 style="margin-top:8px">${esc(new Date(fecha + 'T12:00:00').toLocaleDateString('es-BO', { weekday: 'long', day: 'numeric', month: 'long' }))}</h3>`; }
      const anulada = e.anuladas.has(o.id);
      const pagos = (o.pagos || []).map(p => `<span class="chip">${{ efectivo: 'Efectivo', qr: 'QR ' + (p.estado || 'declarado'), credito: 'Fiado' }[p.metodo]}</span>`).join(' ');
      html += `<div class="item ${anulada ? 'anulada' : ''}"><span class="grow"><span class="chip ${o.tipo}">${o.tipo}</span> ${anulada ? '<span class="chip bad">ANULADA</span>' : ''} <span class="small muted">${new Date(o.creadoEn).toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' })} · ${esc(o.origen || '')}</span>
        <div class="det small">${descripcionOp(o)}</div><div class="row" style="margin-top:4px">${pagos}</div>
        ${S.anulando === o.id ? `<form class="row" data-anularform="${o.id}" style="margin-top:6px"><input class="grow" id="motAn" required placeholder="Motivo de la anulación"><button class="btn peligro" type="submit">Anular</button><button class="btn" type="button" data-acc="noAnular">No</button></form>` : ''}</span>
        <span style="text-align:right">${o.tipo !== 'anulacion' && o.tipo !== 'ajuste' ? '<b class="num">' + bs(o.totalCent) + '</b><br>' : ''}${!anulada && o.tipo !== 'anulacion' && S.anulando !== o.id ? `<button class="btn" data-anular="${o.id}">Anular</button>` : ''}</span></div>`;
    }
    const filtros = [['todas', 'Todas'], ['venta', 'Ventas'], ['compra', 'Compras'], ['gasto', 'Gastos'], ['cobro', 'Cobros'], ['ajuste', 'Ajustes'], ['anulacion', 'Anulaciones']];
    return `<div class="top"><h2>Historial</h2></div>
      <div class="seg">${filtros.map(([k, n]) => `<button data-filtro="${k}" aria-pressed="${f === k}">${n}</button>`).join('')}</div>
      <div class="card lista">${html || '<p class="muted">Sin operaciones.</p>'}</div>
      <p class="small muted">Las operaciones confirmadas no se borran ni se editan. Para corregir, anula y registra de nuevo: ambas quedan en el historial.</p>`;
  }

  async function anular(id, motivo) {
    const op = { id: M.uid('o_'), kind: 'operacion', tipo: 'anulacion', fecha: M.fechaLocal(), creadoEn: new Date().toISOString(), anulaA: id, motivo, lineas: [], pagos: [], totalCent: 0, origen: 'formulario', usuarioId: S.uid || 'prueba' };
    const err = M.validarOperacion(op, S.productos, S.operaciones);
    if (err.length) { toast(err.join(' '), 6000); return; }
    try { await guardarDoc(op); S.anulando = null; toast('✓ Operación anulada'); pintar(); } catch (e) { toast(mensajeError(e), 5000); }
  }

  // ---------- Ajustes ----------
  function vistaAjustes() {
    const iaTxt = S.ia ? (S.iaImagenes ? 'Activa (texto e imágenes)' : 'Activa (solo texto)') : 'No disponible: se usa el intérprete básico';
    return `<div class="top"><h2>Ajustes</h2><button class="btn" data-ir="inicio">Volver</button></div>
      <div class="card"><h3>Negocio</h3><div>${esc(S.perfil.nombreNegocio)} · ${esc(S.perfil.rubro || '')}</div><div class="small muted">Responsable: ${esc(S.perfil.nombreCompleto)} · registrado el ${esc((S.perfil.creadoEn || '').slice(0, 10))}</div></div>
      <div class="card"><h3>Servicios</h3>
        <div class="item"><span>Base de datos</span><span class="chip ${S.modoPrueba ? 'warn' : 'venta'}">${S.modoPrueba ? 'Modo de prueba (no guarda)' : (S.cuenta && S.cuenta.local ? 'En este celular · privada' : 'Conectada · privada')}</span></div>
        <div class="item"><span>Micrófono (dictado)</span><span class="chip ${S.dictado ? 'venta' : 'warn'}">${S.dictado ? 'Disponible' : 'No disponible aquí'}</span></div>
        <div class="item"><span>Inteligencia artificial</span><span class="chip ${S.ia ? 'venta' : 'warn'}">${iaTxt}</span></div>
        <div class="item"><span>Voz del asistente</span>${S.tts ? `<button class="btn" data-acc="voz">${S.vozActiva ? 'Activada' : 'Desactivada'}</button>` : '<span class="chip">No disponible aquí</span>'}</div>
        <div class="item"><span>Banco (verificación de QR)</span><span class="chip">Pendiente de convenio</span></div>
      </div>
      ${!S.modoPrueba ? '<div class="card"><h3>Probar sin afectar tus datos</h3><p class="small muted">Carga datos ficticios en memoria. Al recargar la página vuelves a tus datos reales.</p><button class="btn" data-acc="prueba">Entrar al modo de prueba</button></div>' : '<div class="card"><button class="btn" data-acc="salirPrueba">Salir del modo de prueba</button></div>'}
      ${S.cuenta && !S.modoPrueba ? `<div class="card"><h3>${S.cuenta.local ? 'Copias de seguridad' : 'Cuenta'}</h3>${S.cuenta.email ? `<div class="small muted">${esc(S.cuenta.email)}</div>` : ''}
        ${S.cuenta.local ? '<p class="small muted">Tus datos están solo en este celular. Si borras los datos de Chrome o cambias de celular, se pierden: descarga una copia cada semana y guárdala en Drive o WhatsApp.</p>' : ''}
        <button class="btn" data-acc="copia">Descargar copia de seguridad</button>
        <label class="btn" for="inCopia" style="flex-direction:row;justify-content:center;color:var(--ink)">Restaurar desde una copia</label><input id="inCopia" type="file" accept="application/json,.json" hidden>
        ${S.cuenta.salir ? '<button class="btn peligro" data-acc="salir">Cerrar sesión</button>' : ''}</div>` : ''}
      ${botonInstalar()}
      <p class="small muted">Mi Negocio Rentable v1 · ${S.operaciones.length} operaciones registradas.</p>`;
  }

  // Copia de seguridad: todos los registros del negocio en un archivo JSON (solo versión comercial)
  function descargarCopia() {
    const datos = { app: 'Mi Negocio Rentable', version: 1, exportadoEn: new Date().toISOString(), perfil: S.perfil, productos: S.productos, operaciones: S.operaciones, cierres: S.cierres };
    const url = URL.createObjectURL(new Blob([JSON.stringify(datos, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = 'copia-mi-negocio-' + M.fechaLocal() + '.json';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast('Copia descargada. Guárdala en Drive o en tu correo.');
  }

  // Restaurar: agrega los registros de una copia que no existan aún (nunca reemplaza operaciones existentes)
  async function restaurarCopia(file) {
    let datos;
    try { datos = JSON.parse(await file.text()); } catch (e) { toast('El archivo no es una copia válida.'); return; }
    if (!datos || datos.app !== 'Mi Negocio Rentable') { toast('El archivo no es una copia de Mi Negocio Rentable.'); return; }
    const existe = new Set([...(S.perfil ? ['perfil'] : []), ...S.productos.map(x => x.id), ...S.operaciones.map(x => x.id), ...S.cierres.map(x => x.id)]);
    const valido = d => d && typeof d === 'object' && typeof d.id === 'string' && ['perfil', 'producto', 'operacion', 'cierre'].includes(d.kind);
    const nuevos = [datos.perfil, ...(datos.productos || []), ...(datos.operaciones || []), ...(datos.cierres || [])].filter(valido).filter(d => !existe.has(d.id));
    if (!nuevos.length) { toast('No hay registros nuevos en esa copia.'); return; }
    abrirModal(`<h2>¿Restaurar ${nuevos.length} registros?</h2><p>Copia del ${esc(String(datos.exportadoEn || '').slice(0, 10))}. Solo se agregan registros que no tienes; nada se reemplaza.</p>
      <div class="row"><button class="btn pri lg" id="mSi">Restaurar</button><button class="btn lg" id="mNo">Cancelar</button></div>`, box => {
      box.querySelector('#mNo').onclick = cerrarModal;
      box.querySelector('#mSi').onclick = async () => {
        box.querySelector('#mSi').disabled = true;
        try { for (const d of nuevos.sort((a, b) => (a.kind === 'perfil' ? -1 : a.kind === 'producto' ? 0 : 1) - (b.kind === 'perfil' ? -1 : b.kind === 'producto' ? 0 : 1))) await guardarDoc(d); cerrarModal(); toast('✓ Copia restaurada'); pintar(); }
        catch (e) { cerrarModal(); toast(mensajeError(e), 5000); }
      };
    });
  }

  // ---------- Modal ----------
  function abrirModal(html, init) {
    cerrarModal();
    const m = document.createElement('div'); m.className = 'modal'; m.id = 'modal';
    m.innerHTML = '<div role="dialog" aria-modal="true">' + html + '</div>';
    m.addEventListener('click', ev => { if (ev.target === m) cerrarModal(); });
    document.body.appendChild(m); if (init) init(m.firstChild);
  }
  function cerrarModal() { const m = document.getElementById('modal'); if (m) m.remove(); }

  // ---------- Eventos ----------
  function enlazar() {
    $app.querySelectorAll('[data-ir]').forEach(b => b.onclick = () => ir(b.dataset.ir));
    $app.querySelectorAll('[data-nuevo]').forEach(b => b.onclick = () => {
      const tipo = b.dataset.nuevo;
      nuevoBorrador(tipo, S.vista === 'foto' ? 'foto' : 'formulario');
      if (S.vista !== 'foto') { S.chat = []; S.vista = 'asistente'; }
      pintar(); const ed = document.getElementById('editor'); if (ed) ed.scrollIntoView({ behavior: 'smooth' });
    });
    $app.querySelectorAll('[data-acc]').forEach(b => b.onclick = ev => {
      const a = b.dataset.acc;
      if (a === 'hablar') { S.vista = 'asistente'; if (!S.borrador) S.chat = [{ de: 'asist', texto: 'Te escucho. Dime qué compraste, vendiste, gastaste o cobraste. Por ejemplo: «vendí 3 café Ganoderma a 85 en efectivo».' }]; if (S.dictado) { S.textoDictado = ''; S.parcial = ''; S.dictado.start().catch(e => { S.escuchando = false; if (e && e.code === 'not_granted') S.dictado = null; pintar(); }); S.escuchando = true; } pintar(); }
      else if (a === 'mic') alternarMic();
      else if (a === 'micCierre') micCierre();
      else if (a === 'foto') { S.vista = 'foto'; S.foto = null; S.borrador = null; pintar(); setTimeout(() => { const i = document.getElementById('inFoto'); if (i) i.click(); }, 50); }
      else if (a === 'cancelar') { if (S.escuchando && S.dictado) S.dictado.stop().catch(() => {}); if (S.borrador) abrirModal('<h2>¿Salir sin guardar?</h2><p>El borrador actual no se registrará.</p><div class="row"><button class="btn peligro lg" id="mSi">Salir sin guardar</button><button class="btn lg" id="mNo">Seguir aquí</button></div>', box => { box.querySelector('#mNo').onclick = cerrarModal; box.querySelector('#mSi').onclick = () => { cerrarModal(); descartar(); S.chat = []; ir('inicio'); }; }); else { S.chat = []; ir('inicio'); } }
      else if (a === 'cancelarFoto') { S.foto = null; descartar(); ir('inicio'); }
      else if (a === 'confirmar') confirmar();
      else if (a === 'descartar') descartar('Descartado. No guardé nada.');
      else if (a === 'masItem') { S.borrador.items.push({ nombre: '', cantidad: null, precioUnitario: null }); pintar(); }
      else if (a === 'guardarCierre') guardarCierre();
      else if (a === 'nuevoProd') abrirProducto(null);
      else if (a === 'prueba') cargarDatosPrueba();
      else if (a === 'salirPrueba') { location.reload(); }
      else if (a === 'voz') { S.vozActiva = !S.vozActiva; pintar(); }
      else if (a === 'noAnular') { S.anulando = null; pintar(); }
      else if (a === 'salir' && S.cuenta) S.cuenta.salir();
      else if (a === 'copia') descargarCopia();
      else if (a === 'instalar' && S.instalar) S.instalar.instalar().then(ok => { if (ok) toast('✓ App instalada. Ábrela desde el ícono «Mi Negocio».'); pintar(); });
    });
    const fR = document.getElementById('fRegistro');
    if (fR) fR.onsubmit = async ev => {
      ev.preventDefault();
      const nombre = document.getElementById('rNombre').value.trim().replace(/\s+/g, ' ');
      if (nombre.split(' ').length < 2) { toast('Escribe nombre y apellido completos.'); return; }
      const doc = { id: 'perfil', kind: 'perfil', nombreCompleto: nombre, nombreNegocio: document.getElementById('rNegocio').value.trim(), rubro: document.getElementById('rRubro').value.trim(), creadoEn: new Date().toISOString(), usuarioId: S.uid || 'prueba' };
      try { await guardarDoc(doc); if (S.modoPrueba) pintar(); } catch (e) { toast(mensajeError(e), 5000); }
    };
    const fT = document.getElementById('fTexto');
    if (fT) fT.onsubmit = ev => { ev.preventDefault(); const v = document.getElementById('tTexto').value.trim(); if (v) { document.getElementById('tTexto').value = ''; procesarTexto(v, 'texto'); } };
    // editor del borrador
    $app.querySelectorAll('[data-tipo]').forEach(b => b.onclick = () => {
      const t = b.dataset.tipo; S.borrador.tipo = t;
      if (['venta', 'compra', 'ajuste'].includes(t) && !(S.borrador.items || []).length) S.borrador.items = [{ nombre: '', cantidad: null, precioUnitario: null }];
      if (t !== 'venta') S.borrador.pagos = (S.borrador.pagos || []).filter(p => p.metodo !== 'credito');
      pintar();
    });
    $app.querySelectorAll('[data-metodo]').forEach(b => b.onclick = () => {
      const m = b.dataset.metodo; const pagos = S.borrador.pagos || [];
      const i = pagos.findIndex(p => p.metodo === m);
      if (i >= 0) pagos.splice(i, 1); else pagos.push({ metodo: m, monto: null });
      if (pagos.length === 1) pagos[0].monto = null;
      S.borrador.pagos = pagos; pintar();
    });
    $app.querySelectorAll('[data-quitar]').forEach(b => b.onclick = () => { S.borrador.items.splice(+b.dataset.quitar, 1); pintar(); });
    const fB = document.getElementById('fBorrador');
    if (fB) fB.addEventListener('input', ev => {
      const el = ev.target; const v = el.value;
      if (el.dataset.item !== undefined) { const it = S.borrador.items[+el.dataset.item]; const c = el.dataset.campo; it[c] = c === 'nombre' ? v : (v.trim() === '' ? null : v.trim()); if (c === 'nombre') it.productoId = undefined; if (c === 'precioUnitario') it.subtotal = null; }
      else if (el.dataset.pago !== undefined) S.borrador.pagos[+el.dataset.pago].monto = v.trim() === '' ? null : v.trim();
      else if (el.dataset.campo) S.borrador[el.dataset.campo] = v.trim() === '' ? null : (el.dataset.campo === 'total' ? v.trim() : v);
      S.dupAviso = null;
      const r = document.getElementById('resumenBorrador'); if (r) { r.innerHTML = resumenBorrador(); r.querySelectorAll('[data-acc]').forEach(b => b.onclick = () => { const a = b.dataset.acc; if (a === 'confirmar') confirmar(); else if (a === 'mic') alternarMic(); else if (a === 'descartar') descartar('Descartado. No guardé nada.'); }); }
    });
    if (fB) fB.addEventListener('change', ev => { if (ev.target.tagName === 'SELECT' || ev.target.dataset.campo === 'nombre') pintar(); });
    const inC = document.getElementById('inCopia'); if (inC) inC.onchange = () => { const f = inC.files && inC.files[0]; if (f) restaurarCopia(f); };
    const inF = document.getElementById('inFoto');
    if (inF) inF.onchange = () => { const f = inF.files && inF.files[0]; if (f) procesarFoto(f); };
    const cF = document.getElementById('cFecha'); if (cF) cF.onchange = () => { S.cierreFecha = cF.value || M.fechaLocal(); S.cierreInicial = null; pintar(); };
    const cI = document.getElementById('cInicial'); if (cI) cI.onchange = () => { const v = M.aCentavos(cI.value); S.cierreInicial = v === null ? 0 : v; pintar(); };
    const cC = document.getElementById('cContado'); if (cC) cC.onchange = () => { S.cierreContado = cC.value; pintar(); };
    $app.querySelectorAll('[data-prod]').forEach(b => b.onclick = () => abrirProducto(b.dataset.prod));
    $app.querySelectorAll('[data-cobrar]').forEach(b => b.onclick = () => { nuevoBorrador('cobro', 'formulario', { cliente: b.dataset.cobrar }); S.chat = []; S.vista = 'asistente'; pintar(); });
    $app.querySelectorAll('[data-filtro]').forEach(b => b.onclick = () => { S.filtroHist = b.dataset.filtro; pintar(); });
    $app.querySelectorAll('[data-anular]').forEach(b => b.onclick = () => { S.anulando = b.dataset.anular; pintar(); const i = document.getElementById('motAn'); if (i) i.focus(); });
    $app.querySelectorAll('[data-anularform]').forEach(f => f.onsubmit = ev => { ev.preventDefault(); const mot = f.querySelector('input').value.trim(); if (mot) anular(f.dataset.anularform, mot); });
    const chat = document.getElementById('chat'); if (chat && S.vista === 'asistente' && !S.borrador) chat.lastElementChild && chat.lastElementChild.scrollIntoView({ block: 'nearest' });
  }

  iniciar();
})();
