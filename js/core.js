/* Mi Negocio Rentable — núcleo contable (sin dependencias).
 * Reglas: dinero en centavos enteros; cantidades con hasta 3 decimales (milésimas enteras);
 * libro de operaciones inmutable; inventario a costo promedio ponderado.
 * Se usa igual en el navegador (window.MNR) y en Node (module.exports) para pruebas. */
(function (root) {
  'use strict';

  // ---------- Dinero y cantidades ----------
  function aCentavos(valor) {
    if (valor === null || valor === undefined || valor === '') return null;
    if (typeof valor === 'number') {
      if (!isFinite(valor)) return null;
      return Math.round(valor * 100 + (valor >= 0 ? 1e-9 : -1e-9));
    }
    let s = String(valor).trim().replace(/bs\.?|bob|bolivianos?/gi, '').replace(/\s/g, '');
    if (!s) return null;
    // "1.234,50" -> 1234.50 ; "1,234.50" -> 1234.50 ; "12,5" -> 12.5
    const lastComma = s.lastIndexOf(','), lastDot = s.lastIndexOf('.');
    if (lastComma > -1 && lastDot > -1) {
      if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
      else s = s.replace(/,/g, '');
    } else if (lastComma > -1) {
      const dec = s.length - lastComma - 1;
      s = (dec === 3 && s.split(',').length === 2 && s.length > 4) ? s.replace(',', '') : s.replace(',', '.');
    } else if (lastDot > -1) {
      const parts = s.split('.');
      if (parts.length > 2 || (parts[1].length === 3 && parts[0].length >= 1 && parts.length === 2 && parts[0] !== '0')) {
        // "1.500" se interpreta como mil quinientos (uso local boliviano)
        s = s.replace(/\./g, '');
      }
    }
    if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
    const neg = s[0] === '-';
    if (neg) s = s.slice(1);
    const [ent, dec = ''] = s.split('.');
    const d2 = (dec + '000').slice(0, 3);
    let cents = parseInt(ent, 10) * 100 + parseInt(d2.slice(0, 2), 10);
    if (parseInt(d2[2], 10) >= 5) cents += 1;
    return neg ? -cents : cents;
  }

  function aMilesimas(cant) {
    if (cant === null || cant === undefined || cant === '') return null;
    const n = typeof cant === 'number' ? cant : Number(String(cant).replace(',', '.'));
    if (!isFinite(n)) return null;
    return Math.round(n * 1000);
  }
  function deMilesimas(m) { return m / 1000; }

  function formatoBs(cent) {
    if (cent === null || cent === undefined || isNaN(cent)) return '—';
    const neg = cent < 0; const a = Math.abs(cent);
    const ent = Math.floor(a / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    const dec = String(a % 100).padStart(2, '0');
    return (neg ? '−' : '') + 'Bs ' + ent + ',' + dec;
  }
  function formatoCant(m) {
    const n = m / 1000;
    return Number.isInteger(n) ? String(n) : n.toLocaleString('es-BO', { maximumFractionDigits: 3 });
  }

  // importe de línea = cantidad × precio, redondeado al centavo
  function importeLinea(cantM, precioCent) { return Math.round((cantM * precioCent) / 1000); }

  // ---------- Utilidades ----------
  function uid(prefijo) {
    let r = '';
    try {
      const a = new Uint8Array(10); (root.crypto || require('crypto').webcrypto).getRandomValues(a);
      r = Array.from(a, b => b.toString(16).padStart(2, '0')).join('');
    } catch (e) { r = Date.now().toString(36) + Math.random().toString(36).slice(2, 10); }
    return (prefijo || '') + r;
  }
  function fechaLocal(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function normalizar(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9ñ ]/g, ' ').replace(/\s+/g, ' ').trim();
  }
  const clienteClave = n => normalizar(n);

  const METODOS = ['efectivo', 'qr', 'credito'];
  const TIPOS = ['compra', 'venta', 'gasto', 'cobro', 'ajuste', 'anulacion'];
  const CATEGORIAS_GASTO = ['Transporte', 'Alquiler', 'Servicios (luz, agua, internet)', 'Teléfono', 'Publicidad',
    'Empaques y bolsas', 'Sueldos y ayudantes', 'Comisiones', 'Impuestos y trámites', 'Alimentación', 'Otros'];

  // ---------- Libro de operaciones: recálculo del estado ----------
  /* Devuelve el estado derivado: inventario, kardex, cuentas por cobrar, costo por operación.
   * Las operaciones anuladas se excluyen por completo; las anulaciones quedan en el historial. */
  function calcularEstado(productos, operaciones) {
    const prods = {};
    (productos || []).forEach(p => { prods[p.id] = p; });
    const anuladas = new Set();
    (operaciones || []).forEach(o => { if (o.tipo === 'anulacion' && o.anulaA) anuladas.add(o.anulaA); });
    const ops = (operaciones || []).filter(o => o.tipo !== 'anulacion' && !anuladas.has(o.id))
      .slice().sort((a, b) => (a.creadoEn < b.creadoEn ? -1 : a.creadoEn > b.creadoEn ? 1 : (a.id < b.id ? -1 : 1)));
    const inv = {};
    Object.keys(prods).forEach(id => { inv[id] = { cantM: 0, valorCent: 0 }; });
    const kardex = [];
    const cxc = {};
    const costos = {}; // opId -> { cmvCent, mermaCent }
    const errores = [];

    for (const o of ops) {
      const res = { cmvCent: 0, mermaCent: 0 };
      if (o.tipo === 'compra' || o.tipo === 'ajuste' || o.tipo === 'venta') {
        for (const l of (o.lineas || [])) {
          if (!inv[l.productoId]) inv[l.productoId] = { cantM: 0, valorCent: 0 };
          const s = inv[l.productoId];
          let q = l.cantM;
          if (o.tipo === 'venta') q = -Math.abs(q);
          if (q > 0) {
            const costo = o.tipo === 'compra' ? importeLinea(q, l.precioCent) : importeLinea(q, l.precioCent || 0);
            s.cantM += q; s.valorCent += costo;
            kardex.push({ opId: o.id, fecha: o.fecha, productoId: l.productoId, tipo: o.tipo, entradaM: q, salidaM: 0, costoCent: costo, saldoM: s.cantM, saldoValorCent: s.valorCent });
          } else if (q < 0) {
            const out = -q;
            if (out > s.cantM) {
              errores.push({ opId: o.id, productoId: l.productoId, mensaje: 'Existencias insuficientes', disponibleM: s.cantM, solicitadoM: out });
              continue;
            }
            const costo = out === s.cantM ? s.valorCent : Math.round(s.valorCent * out / s.cantM);
            s.cantM -= out; s.valorCent -= costo;
            if (o.tipo === 'venta') res.cmvCent += costo; else res.mermaCent += costo;
            kardex.push({ opId: o.id, fecha: o.fecha, productoId: l.productoId, tipo: o.tipo, entradaM: 0, salidaM: out, costoCent: costo, saldoM: s.cantM, saldoValorCent: s.valorCent });
          }
        }
      }
      if (o.tipo === 'venta') {
        const fiado = (o.pagos || []).filter(p => p.metodo === 'credito').reduce((a, p) => a + p.montoCent, 0);
        if (fiado > 0) {
          const k = clienteClave(o.cliente);
          cxc[k] = cxc[k] || { nombre: o.cliente, saldoCent: 0, movimientos: [] };
          cxc[k].saldoCent += fiado;
          cxc[k].movimientos.push({ opId: o.id, fecha: o.fecha, cargoCent: fiado, abonoCent: 0 });
        }
      }
      if (o.tipo === 'cobro') {
        const k = clienteClave(o.cliente);
        const c = cxc[k];
        if (!c || c.saldoCent < o.totalCent) {
          errores.push({ opId: o.id, mensaje: 'El cobro supera la deuda del cliente', disponibleCent: c ? c.saldoCent : 0 });
        } else {
          c.saldoCent -= o.totalCent;
          c.movimientos.push({ opId: o.id, fecha: o.fecha, cargoCent: 0, abonoCent: o.totalCent });
        }
      }
      costos[o.id] = res;
    }
    return { inventario: inv, kardex, cxc, costos, anuladas, errores, productos: prods };
  }

  // ---------- Validación de una operación nueva (antes de guardar) ----------
  function sumaPagos(pagos) { return (pagos || []).reduce((a, p) => a + (p.montoCent || 0), 0); }

  function validarOperacion(op, productos, operaciones) {
    const err = [];
    if (!TIPOS.includes(op.tipo)) err.push('Tipo de operación no válido.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(op.fecha || '')) err.push('Falta la fecha.');
    const conLineas = ['compra', 'venta', 'ajuste'].includes(op.tipo);
    if (conLineas) {
      if (!op.lineas || !op.lineas.length) err.push('Falta al menos un producto.');
      (op.lineas || []).forEach((l, i) => {
        const n = i + 1;
        if (!l.productoId) err.push(`Producto ${n}: no identificado.`);
        if (!l.cantM || (op.tipo !== 'ajuste' && l.cantM <= 0)) err.push(`Producto ${n}: falta la cantidad.`);
        if (op.tipo !== 'ajuste' && (l.precioCent === null || l.precioCent === undefined || l.precioCent < 0)) err.push(`Producto ${n}: falta el precio.`);
        if (op.tipo === 'ajuste' && l.cantM > 0 && (l.precioCent === null || l.precioCent === undefined)) err.push(`Producto ${n}: falta el costo unitario de la entrada.`);
      });
      if (op.tipo !== 'ajuste') {
        const t = (op.lineas || []).reduce((a, l) => a + importeLinea(l.cantM || 0, l.precioCent || 0), 0);
        if (t !== op.totalCent) err.push('El total no coincide con la suma de los productos.');
      }
    }
    if (op.tipo === 'gasto' || op.tipo === 'cobro') {
      if (!(op.totalCent > 0)) err.push('Falta el importe.');
    }
    if (op.tipo === 'gasto' && !op.categoria) err.push('Falta la categoría del gasto.');
    if (op.tipo === 'ajuste' && !String(op.motivo || '').trim()) err.push('Indica el motivo del ajuste (inventario inicial, merma, vencido…).');
    if (op.tipo === 'cobro' && !op.cliente) err.push('Falta el nombre del cliente.');
    if (['compra', 'venta', 'gasto', 'cobro'].includes(op.tipo)) {
      const pagos = op.pagos || [];
      if (!pagos.length) err.push('Falta la forma de pago.');
      pagos.forEach(p => {
        if (!METODOS.includes(p.metodo)) err.push('Forma de pago no válida.');
        if (!(p.montoCent > 0)) err.push('Hay un pago sin importe.');
      });
      if (pagos.length && sumaPagos(pagos) !== op.totalCent) err.push(`Los pagos (${formatoBs(sumaPagos(pagos))}) no suman el total (${formatoBs(op.totalCent)}).`);
      const credito = pagos.some(p => p.metodo === 'credito');
      if (credito && op.tipo !== 'venta') err.push('Solo las ventas pueden quedar fiadas en esta versión.');
      if (credito && op.tipo === 'venta' && !String(op.cliente || '').trim()) err.push('Una venta fiada necesita el nombre del cliente.');
      pagos.filter(p => p.metodo === 'qr').forEach(p => { if (p.estado && p.estado !== 'declarado') err.push('Un pago QR nuevo solo puede registrarse como declarado.'); });
    }
    if (op.tipo === 'anulacion') {
      if (!op.anulaA) err.push('Falta la operación a anular.');
      if (!String(op.motivo || '').trim()) err.push('Falta el motivo de la anulación.');
      const orig = (operaciones || []).find(o => o.id === op.anulaA);
      if (!orig) err.push('La operación a anular no existe.');
      else if (orig.tipo === 'anulacion') err.push('No se puede anular una anulación.');
      if ((operaciones || []).some(o => o.tipo === 'anulacion' && o.anulaA === op.anulaA)) err.push('Esa operación ya fue anulada.');
    }
    if (err.length) return err;
    // Simulación: el libro con la operación nueva no debe producir stock negativo ni cobros excesivos
    const antes = calcularEstado(productos, operaciones).errores.length;
    const despues = calcularEstado(productos, (operaciones || []).concat([op]));
    if (despues.errores.length > antes) {
      despues.errores.slice(antes).forEach(e => {
        const p = despues.productos[e.productoId];
        if (e.disponibleM !== undefined) err.push(`Existencias insuficientes de ${p ? p.nombre : 'producto'}: hay ${formatoCant(e.disponibleM)}.`);
        else if (e.disponibleCent !== undefined) err.push(`El cobro supera la deuda del cliente (${formatoBs(e.disponibleCent)}).`);
        else err.push(e.mensaje);
      });
      if (op.tipo === 'anulacion') err.push('Anularla dejaría movimientos posteriores sin respaldo (por ejemplo, ventas sin existencias).');
    }
    return err;
  }

  function posibleDuplicado(op, operaciones, ventanaMs) {
    ventanaMs = ventanaMs || 3 * 60 * 1000;
    const t = Date.parse(op.creadoEn || new Date().toISOString());
    const firma = o => JSON.stringify([o.tipo, o.totalCent, (o.lineas || []).map(l => [l.productoId, l.cantM, l.precioCent]), (o.pagos || []).map(p => [p.metodo, p.montoCent]), o.cliente || '', o.categoria || '']);
    const f = firma(op);
    return (operaciones || []).find(o => o.id !== op.id && Math.abs(t - Date.parse(o.creadoEn)) <= ventanaMs && firma(o) === f) || null;
  }

  // ---------- Resumen y cierre del día ----------
  function resumenDia(productos, operaciones, fecha, efectivoInicialCent) {
    const est = calcularEstado(productos, operaciones);
    const r = {
      fecha, efectivoInicialCent: efectivoInicialCent || 0,
      ventasCent: 0, nVentas: 0, ventasEfectivoCent: 0, ventasQRCent: 0, ventasFiadoCent: 0,
      cobrosFiadoEfectivoCent: 0, cobrosFiadoQRCent: 0,
      comprasCent: 0, comprasEfectivoCent: 0, comprasQRCent: 0,
      gastosCent: 0, gastosEfectivoCent: 0, gastosQRCent: 0, gastosPorCategoria: {},
      cmvCent: 0, mermasCent: 0, anuladasHoy: 0
    };
    const porMetodo = (o, m) => (o.pagos || []).filter(p => p.metodo === m).reduce((a, p) => a + p.montoCent, 0);
    for (const o of operaciones || []) {
      if (o.fecha !== fecha) continue;
      if (o.tipo === 'anulacion') { r.anuladasHoy++; continue; }
      if (est.anuladas.has(o.id)) continue;
      if (o.tipo === 'venta') {
        r.nVentas++; r.ventasCent += o.totalCent;
        r.ventasEfectivoCent += porMetodo(o, 'efectivo'); r.ventasQRCent += porMetodo(o, 'qr'); r.ventasFiadoCent += porMetodo(o, 'credito');
        r.cmvCent += (est.costos[o.id] || {}).cmvCent || 0;
      } else if (o.tipo === 'cobro') {
        r.cobrosFiadoEfectivoCent += porMetodo(o, 'efectivo'); r.cobrosFiadoQRCent += porMetodo(o, 'qr');
      } else if (o.tipo === 'compra') {
        r.comprasCent += o.totalCent; r.comprasEfectivoCent += porMetodo(o, 'efectivo'); r.comprasQRCent += porMetodo(o, 'qr');
      } else if (o.tipo === 'gasto') {
        r.gastosCent += o.totalCent; r.gastosEfectivoCent += porMetodo(o, 'efectivo'); r.gastosQRCent += porMetodo(o, 'qr');
        r.gastosPorCategoria[o.categoria] = (r.gastosPorCategoria[o.categoria] || 0) + o.totalCent;
      } else if (o.tipo === 'ajuste') {
        r.mermasCent += (est.costos[o.id] || {}).mermaCent || 0;
      }
    }
    r.utilidadBrutaCent = r.ventasCent - r.cmvCent;
    r.utilidadNetaCent = r.utilidadBrutaCent - r.gastosCent - r.mermasCent;
    r.qrDeclaradoCent = r.ventasQRCent + r.cobrosFiadoQRCent;
    r.efectivoEsperadoCent = r.efectivoInicialCent + r.ventasEfectivoCent + r.cobrosFiadoEfectivoCent - r.comprasEfectivoCent - r.gastosEfectivoCent;
    r.flujoNetoCajaCent = r.efectivoEsperadoCent - r.efectivoInicialCent + r.qrDeclaradoCent - r.comprasQRCent - r.gastosQRCent;
    r.porCobrarTotalCent = Object.values(est.cxc).reduce((a, c) => a + c.saldoCent, 0);
    return r;
  }

  function cerrarCaja(resumen, efectivoContadoCent) {
    const dif = efectivoContadoCent - resumen.efectivoEsperadoCent;
    return { diferenciaCent: dif, estado: dif === 0 ? 'cuadra' : dif > 0 ? 'sobrante' : 'faltante' };
  }

  // efectivo inicial sugerido = efectivo contado en el último cierre anterior a la fecha
  function efectivoInicialSugerido(cierres, fecha) {
    const prev = (cierres || []).filter(c => c.fecha < fecha).sort((a, b) => (a.fecha + a.creadoEn < b.fecha + b.creadoEn ? 1 : -1))[0];
    return prev ? { cent: prev.efectivoContadoCent, fecha: prev.fecha } : null;
  }

  function alertasStock(productos, estado) {
    return (productos || []).filter(p => p.activo !== false && p.stockMinimoM > 0 && (estado.inventario[p.id] || { cantM: 0 }).cantM <= p.stockMinimoM);
  }

  // ---------- Borradores (de voz, foto o formulario) ----------
  /* Borrador = estructura editable, en bolivianos decimales, tal como lo propone la IA o el intérprete local:
   * { tipo, items:[{nombre, productoId?, cantidad, precioUnitario}], total, pagos:[{metodo, monto}],
   *   cliente, categoria, descripcion, fecha } — cualquier campo puede ser null (= falta). */
  function buscarProducto(nombre, productos) {
    const n = normalizar(nombre);
    if (!n) return null;
    const lista = (productos || []).filter(p => p.activo !== false);
    let p = lista.find(x => normalizar(x.nombre) === n);
    if (p) return p;
    const VACIAS = ['de', 'del', 'con', 'los', 'las', 'para', 'la', 'el', 'en', 'un', 'una', 'y'];
    const tok = n.split(' ').filter(t => t.length > 1 && !VACIAS.includes(t));
    // Todas las palabras dichas deben coincidir con el producto; si hay empate, es ambiguo y se pregunta.
    const raiz = w => w.replace(/(es|s)$/, '');
    const candidatos = [];
    for (const x of lista) {
      const xt = normalizar(x.nombre).split(' ').filter(t => t.length > 1 && !VACIAS.includes(t));
      const comunes = tok.filter(t => xt.some(y => y === t || raiz(y) === raiz(t))).length;
      if (tok.length && comunes === tok.length) candidatos.push({ x, cobertura: comunes / xt.length });
    }
    if (!candidatos.length) return null;
    candidatos.sort((a, b) => b.cobertura - a.cobertura);
    if (candidatos.length > 1 && candidatos[0].cobertura === candidatos[1].cobertura) return null;
    return candidatos[0].x;
  }

  /* Convierte un borrador en operación lista para validar.
   * Devuelve { op, nuevosProductos, faltantes } — faltantes son preguntas para el usuario. */
  function borradorAOperacion(b, productos, ctx) {
    ctx = ctx || {};
    const faltantes = [];
    const nuevosProductos = [];
    const op = {
      id: ctx.id || uid('o_'), kind: 'operacion', tipo: b.tipo || null,
      fecha: b.fecha || fechaLocal(), creadoEn: ctx.creadoEn || new Date().toISOString(),
      lineas: [], pagos: [], totalCent: 0,
      cliente: b.cliente ? String(b.cliente).trim() : null,
      categoria: b.categoria || null, descripcion: b.descripcion || null,
      origen: ctx.origen || 'formulario', textoOriginal: ctx.textoOriginal || null,
      usuarioId: ctx.usuarioId || null,
      motivo: b.motivo || null,
      comprobante: b.comprobante || null
    };
    if (!op.tipo) faltantes.push('¿Es una compra, una venta, un gasto o un cobro?');
    if (['compra', 'venta', 'ajuste'].includes(op.tipo)) {
      const items = b.items || [];
      if (!items.length) faltantes.push(op.tipo === 'compra' ? '¿Qué producto compraste?' : '¿Qué producto vendiste?');
      items.forEach((it, i) => {
        let p = it.productoId ? (productos || []).find(x => x.id === it.productoId) : buscarProducto(it.nombre, productos);
        if (!p && it.nombre && (op.tipo === 'compra' || op.tipo === 'ajuste')) {
          const ya = nuevosProductos.find(x => normalizar(x.nombre) === normalizar(it.nombre));
          const clave = normalizar(it.nombre);
          const pid = (ctx.idsNuevos && ctx.idsNuevos[clave]) || uid('p_');
          if (ctx.idsNuevos) ctx.idsNuevos[clave] = pid;
          p = ya || { id: pid, kind: 'producto', nombre: String(it.nombre).trim().replace(/^./, c => c.toUpperCase()), unidad: 'unidad', precioVentaCent: null, stockMinimoM: 0, activo: true, creadoEn: op.creadoEn };
          if (!ya) nuevosProductos.push(p);
        }
        const cantM = aMilesimas(it.cantidad);
        let precioCent = aCentavos(it.precioUnitario);
        const subtotalCent = aCentavos(it.subtotal);
        if (precioCent === null && subtotalCent !== null && cantM) precioCent = Math.round(subtotalCent * 1000 / cantM);
        if (precioCent === null && op.tipo === 'venta' && p && p.precioVentaCent != null && ctx.usarPrecioSugerido) precioCent = p.precioVentaCent;
        const etiqueta = it.nombre || (p && p.nombre) || ('producto ' + (i + 1));
        if (!p) faltantes.push(op.tipo === 'venta' ? `No encuentro «${etiqueta}» en tu inventario. ¿Cuál producto es?` : `¿Qué producto es el ${i + 1}?`);
        if (!cantM) faltantes.push(`¿Cuántas unidades de ${etiqueta}?`);
        if (precioCent === null && op.tipo !== 'ajuste') faltantes.push(op.tipo === 'compra' ? `¿A qué costo unitario compraste ${etiqueta}?` : `¿A qué precio vendiste ${etiqueta}?`);
        if (op.tipo === 'ajuste' && cantM > 0 && precioCent === null) faltantes.push(`¿Cuál es el costo unitario de ${etiqueta}?`);
        op.lineas.push({ productoId: p ? p.id : null, nombre: p ? p.nombre : it.nombre, cantM: cantM || 0, precioCent: precioCent });
      });
      op.totalCent = op.lineas.reduce((a, l) => a + importeLinea(l.cantM || 0, l.precioCent || 0), 0);
      const totalDeclarado = aCentavos(b.total);
      if (totalDeclarado !== null && op.lineas.every(l => l.precioCent !== null && l.cantM) && totalDeclarado !== op.totalCent) {
        faltantes.push(`El total indicado (${formatoBs(totalDeclarado)}) no coincide con cantidad × precio (${formatoBs(op.totalCent)}). Corrige el precio o la cantidad.`);
      }
    } else if (op.tipo === 'gasto' || op.tipo === 'cobro') {
      op.totalCent = aCentavos(b.total) || 0;
      if (!op.totalCent) faltantes.push(op.tipo === 'gasto' ? '¿Cuánto gastaste?' : '¿Cuánto te pagaron?');
      if (op.tipo === 'gasto' && !op.categoria) faltantes.push('¿En qué categoría va este gasto?');
      if (op.tipo === 'cobro' && !op.cliente) faltantes.push('¿Qué cliente te pagó?');
    }
    if (op.tipo === 'ajuste' && !op.motivo) faltantes.push('¿Cuál es el motivo del ajuste?');
    if (['compra', 'venta', 'gasto', 'cobro'].includes(op.tipo)) {
      let pagos = (b.pagos || []).filter(p => p && p.metodo).map(p => ({ metodo: p.metodo, montoCent: aCentavos(p.monto), estado: p.metodo === 'qr' ? 'declarado' : undefined }));
      // Con una sola forma de pago, el importe pagado es siempre el total (evita montos viejos tras una corrección)
      if (pagos.length === 1 && op.totalCent) pagos[0].montoCent = op.totalCent;
      else if (pagos.length === 1 && (pagos[0].montoCent === null || pagos[0].montoCent === undefined)) pagos[0].montoCent = op.totalCent;
      if (pagos.length > 1) {
        const sinMonto = pagos.filter(p => p.montoCent === null);
        if (sinMonto.length === 1) { const resto = op.totalCent - pagos.reduce((a, p) => a + (p.montoCent || 0), 0); sinMonto[0].montoCent = resto > 0 ? resto : null; }
      }
      pagos = pagos.map(p => { const q = { metodo: p.metodo, montoCent: p.montoCent }; if (p.metodo === 'qr') q.estado = 'declarado'; return q; });
      op.pagos = pagos;
      if (!pagos.length) faltantes.push(op.tipo === 'venta' ? '¿Cómo te pagaron: efectivo, QR o fiado?' : '¿Pagaste en efectivo o por QR?');
      else if (pagos.some(p => p.montoCent === null)) faltantes.push('¿Cuánto fue en cada forma de pago?');
      else if (sumaPagos(pagos) !== op.totalCent && op.totalCent) faltantes.push(`Los pagos suman ${formatoBs(sumaPagos(pagos))} pero el total es ${formatoBs(op.totalCent)}.`);
      if (pagos.some(p => p.metodo === 'credito') && op.tipo === 'venta' && !op.cliente) faltantes.push('¿A qué cliente le fiaste?');
      if (pagos.some(p => p.metodo === 'credito') && op.tipo !== 'venta') faltantes.push('Las compras y gastos a crédito todavía no están disponibles: indica efectivo o QR.');
    }
    return { op, nuevosProductos, faltantes };
  }

  // ---------- Intérprete local de respaldo (reglas, sin IA) ----------
  const UNIDADES = { cero: 0, un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19, veinte: 20, veintiun: 21, veintiuno: 21, veintiuna: 21, veintidos: 22, veintitres: 23, veinticuatro: 24, veinticinco: 25, veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29, treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90, cien: 100, ciento: 100, doscientos: 200, doscientas: 200, trescientos: 300, trescientas: 300, cuatrocientos: 400, cuatrocientas: 400, quinientos: 500, quinientas: 500, seiscientos: 600, seiscientas: 600, setecientos: 700, setecientas: 700, ochocientos: 800, ochocientas: 800, novecientos: 900, novecientas: 900, media: 0.5, medio: 0.5 };
  function palabrasANumeros(texto) {
    const toks = normalizar(texto).split(' ');
    const out = []; let acc = null, total = 0;
    const flush = () => { if (acc !== null) { out.push(String(total + acc)); acc = null; total = 0; } };
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      if (t in UNIDADES && !(t === 'un' || t === 'una' || t === 'uno') ) { acc = (acc || 0) + UNIDADES[t]; continue; }
      if ((t === 'un' || t === 'una' || t === 'uno')) {
        if (acc !== null) { acc += 1; continue; }
        if (['cada', 'la', 'el', 'lo', 'por'].includes(toks[i - 1])) { out.push(t); continue; }
        const sig = toks[i + 1];
        if (sig === 'mil') { acc = 1; continue; }
        out.push('1'); continue;
      }
      if (t === 'mil') { total += (acc === null ? 1 : acc) * 1000; acc = 0; continue; }
      if (t === 'y' && acc !== null && toks[i + 1] in UNIDADES && acc >= 20 && acc % 10 === 0) continue;
      if (t === 'con' && acc !== null && /^\d+$|^(cincuenta|veinte|treinta|diez|cuarenta|sesenta|setenta|ochenta|noventa)$/.test(toks[i + 1] || '') && toks[i + 2] !== 'en') {
        // "ochenta con cincuenta" -> 80.50
        const sig = toks[i + 1]; const v = /^\d+$/.test(sig) ? +sig : UNIDADES[sig];
        out.push(String(total + acc) + '.' + String(v).padStart(2, '0')); acc = null; total = 0; i++; continue;
      }
      flush(); out.push(t);
    }
    flush();
    // No se unen cifras separadas («a 85, 100 en efectivo» son dos números); «mil quinientos» ya llega como 1500.
    return out.join(' ');
  }

  function detectarTipo(t) {
    if (/\b(compre|compramos|compra|adquiri|me trajeron|recibi mercaderia|reponer|repuse)\b/.test(t)) return 'compra';
    if (/\b(vendi|vendimos|venta|vende|le vendi)\b/.test(t)) return 'venta';
    if (/\b(me pago|me pagaron|cobre|cobro|me cancelo|abono|me abono|pago su deuda|pago lo que debia)\b/.test(t)) return 'cobro';
    if (/\b(gaste|gasto|pague|pagamos|gastos)\b/.test(t)) return 'gasto';
    return null;
  }

  function detectarCategoria(t) {
    const reglas = [
      [/taxi|micro|trufi|pasaje|transporte|gasolina|combustible|flete|envio|mototaxi|delivery/, 'Transporte'],
      [/alquiler|anticretico|puesto|tienda|local/, 'Alquiler'],
      [/luz|agua|internet|electricidad|gas domiciliario/, 'Servicios (luz, agua, internet)'],
      [/credito de celular|recarga|telefono|celular|megas/, 'Teléfono'],
      [/publicidad|anuncio|facebook|afiches|volantes|tiktok/, 'Publicidad'],
      [/bolsa|bolsas|empaque|caja|cajas|etiqueta/, 'Empaques y bolsas'],
      [/sueldo|ayudante|jornal|pago a/, 'Sueldos y ayudantes'],
      [/comision/, 'Comisiones'],
      [/impuesto|tramite|patente|licencia|sin |nit/, 'Impuestos y trámites'],
      [/almuerzo|comida|refresco|desayuno|cena/, 'Alimentación']
    ];
    for (const [re, c] of reglas) if (re.test(t)) return c;
    return null;
  }

  function detectarPagos(t, total) {
    const pagos = [];
    const re = /(\d+(?:[.,]\d+)?)\s*(?:bs|bolivianos)?\s*(?:en|por|con|de)?\s*(efectivo|qr|q r|fiado|credito)/g;
    let m;
    while ((m = re.exec(t))) pagos.push({ metodo: m[2] === 'fiado' || m[2] === 'credito' ? 'credito' : m[2].replace(' ', ''), monto: aCentavos(m[1]) / 100 });
    // un solo importe junto a una forma de pago suele ser el precio, no un pago parcial
    if (pagos.length >= 2) return pagos;
    pagos.length = 0;
    const tieneEf = /\befectivo|\bcash|\ben mano/.test(t), tieneQR = /\bqr\b|\bq r\b|transferencia|simple/.test(t), tieneFiado = /\bfiado|\bfiao|a credito|\bme debe|\bdebe\b|\bfie\b|\bpagara despues|\bpaga despues/.test(t);
    const n = [tieneEf, tieneQR, tieneFiado].filter(Boolean).length;
    if (n === 1) pagos.push({ metodo: tieneEf ? 'efectivo' : tieneQR ? 'qr' : 'credito', monto: total });
    else if (n > 1) { if (tieneEf) pagos.push({ metodo: 'efectivo', monto: null }); if (tieneQR) pagos.push({ metodo: 'qr', monto: null }); if (tieneFiado) pagos.push({ metodo: 'credito', monto: null }); }
    return pagos;
  }

  function interpretarTextoLocal(texto, productos) {
    const original = String(texto || '');
    const t = palabrasANumeros(original);
    const b = { tipo: detectarTipo(t), items: [], total: null, pagos: [], cliente: null, categoria: null, descripcion: null };
    const mCliente = t.match(/^(?:la |el |don |dona |senora |senor )?([a-zñ]+(?: [a-zñ]+)?) (?:me pago|me abono|me cancelo)\b/) ||
      t.match(/\b(?:a|cliente|senora|senor|don|dona|la|el)\s+(?:la |el |don |dona |senora |senor )?([a-zñ]+(?: [a-zñ]+)?)\s+(?:me pago|me abono|me cancelo|fiado|me debe|pago)/) ||
      t.match(/\b(?:fiado a|fie a|le fie a|cliente|de parte de|me pago|me abono|me cancelo|cobre a|para)\s+(?:la |el |don |dona |senora |senor )?([a-zñ]+(?: [a-zñ]+)?)/);
    const NO_NOMBRES = /^(efectivo|qr|bs|bolivianos|en|por|con|y|su|la|el|que|lo|cada|total)\b/;
    if (mCliente && !NO_NOMBRES.test(mCliente[1])) b.cliente = mCliente[1].split(' ').filter(w => !['en', 'por', 'y', 'con', 'que', 'de', 'me', 'le', 'se', 'nos', 'lo'].includes(w)).map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
    const mTotal = t.match(/\b(?:total|en total|todo|son|fueron|fue)\s+(?:de\s+)?(\d+(?:[.,]\d+)?)/);
    if (b.tipo === 'compra' || b.tipo === 'venta') {
      // "3 cafe ganoderma a 85" | "3 cajas de te reishi por 85 cada uno"
      const reItem = /(\d+(?:[.,]\d+)?)\s+(?:unidades?\s+de\s+|cajas?\s+de\s+|frascos?\s+de\s+|sobres?\s+de\s+|paquetes?\s+de\s+|botellas?\s+de\s+)?([a-zñ][a-zñ ]*?)\s+(?:a|en|por|de|cada uno a|a razon de)\s+(\d+(?:[.,]\d+)?)\s*(bs|bolivianos)?\s*(cada un[oa]|c u|la unidad|por unidad|cada|en total|total)?/g;
      let m;
      while ((m = reItem.exec(t))) {
        const nombre = m[2].replace(/\b(de|del|el|la|los|las|unidades?|cajas?|frascos?|sobres?)\b/g, ' ').replace(/\s+/g, ' ').trim();
        if (!nombre) continue;
        const cant = Number(m[1].replace(',', '.'));
        const precio = Number(m[3].replace(',', '.'));
        const esTotal = /total/.test(m[5] || '');
        b.items.push({ nombre, cantidad: cant, precioUnitario: esTotal ? null : precio, subtotal: esTotal ? precio : null });
      }
      if (!b.items.length) {
        const m2 = t.match(/(?:compre|vendi|vendimos|compramos)\s+(\d+(?:[.,]\d+)?)\s+([a-zñ][a-zñ ]*)/);
        if (m2) {
          const nombre = m2[2].split(/\s+(?:en|por|a|al|y|con|que|para)\s+/)[0].replace(/\b(de|del|unidades?|cajas?|frascos?|sobres?)\b/g, ' ').replace(/\s+/g, ' ').trim();
          b.items.push({ nombre, cantidad: Number(m2[1].replace(',', '.')), precioUnitario: null, subtotal: null });
        }
      }
      b.items.forEach(it => { const p = buscarProducto(it.nombre, productos); if (p) { it.productoId = p.id; it.nombre = p.nombre; } });
      if (mTotal) b.total = Number(mTotal[1].replace(',', '.'));
      if (b.items.length === 1 && b.items[0].precioUnitario === null && b.items[0].subtotal === null && b.total !== null) b.items[0].subtotal = b.total;
      const tot = b.items.reduce((a, it) => a + (it.precioUnitario != null ? it.cantidad * it.precioUnitario : (it.subtotal || 0)), 0);
      b.pagos = detectarPagos(t, tot || b.total);
    } else if (b.tipo === 'gasto' || b.tipo === 'cobro') {
      const nums = (t.match(/\d+(?:[.,]\d+)?/g) || []).map(x => Number(x.replace(',', '.')));
      b.total = mTotal ? Number(mTotal[1].replace(',', '.')) : (nums.length ? nums[0] : null);
      if (b.tipo === 'gasto') {
        b.categoria = detectarCategoria(t);
        const d = t.replace(/\b(gaste|gasto|pague|pagamos|en|de|por|bs|bolivianos|efectivo|qr)\b|\d+(?:[.,]\d+)?/g, ' ').replace(/\s+/g, ' ').trim();
        b.descripcion = d ? d[0].toUpperCase() + d.slice(1) : null;
      }
      b.pagos = detectarPagos(t, b.total);
      if (b.tipo === 'cobro') b.pagos = b.pagos.filter(p => p.metodo !== 'credito');
    }
    return b;
  }

  // Corrección por voz sobre un borrador existente (respaldo local)
  function corregirBorradorLocal(b, texto, productos) {
    const t = palabrasANumeros(texto);
    const n = JSON.parse(JSON.stringify(b));
    const num = re => { const m = t.match(re); return m ? Number(m[1].replace(',', '.')) : null; };
    const precio = num(/\b(?:precio|costo|costaba|a|cuesta|vale)\s+(?:es\s+|era\s+|de\s+)?(\d+(?:[.,]\d+)?)/);
    const cant = num(/\b(?:cantidad|son|eran|fueron)\s+(?:es\s+|de\s+)?(\d+(?:[.,]\d+)?)/) ?? num(/(\d+(?:[.,]\d+)?)\s+unidades/);
    const total = num(/\btotal\s+(?:es\s+|era\s+|de\s+)?(\d+(?:[.,]\d+)?)/);
    if (n.items && n.items.length) {
      if (precio !== null) n.items[0].precioUnitario = precio, n.items[0].subtotal = null;
      if (cant !== null) n.items[0].cantidad = cant;
    }
    if (total !== null) n.total = total;
    const tipo = detectarTipo(t); if (tipo && /\b(es|era|fue)\s+(una\s+)?(compra|venta|gasto|cobro)/.test(t)) n.tipo = tipo;
    const pagos = detectarPagos(t, null);
    if (pagos.length) {
      const totalB = n.items && n.items.length ? n.items.reduce((a, it) => a + (it.precioUnitario != null ? it.cantidad * it.precioUnitario : (it.subtotal || 0)), 0) : n.total;
      if (pagos.length === 1) pagos[0].monto = pagos[0].monto ?? totalB;
      n.pagos = pagos;
    }
    const mCli = t.match(/\bcliente\s+(?:es\s+)?([a-zñ]+(?: [a-zñ]+)?)/); if (mCli) n.cliente = mCli[1].replace(/\b\w/g, c => c.toUpperCase());
    const mProd = t.match(/\bproducto\s+(?:es\s+)?([a-zñ][a-zñ ]+)/);
    if (mProd && n.items && n.items[0]) { const p = buscarProducto(mProd[1], productos); n.items[0].nombre = p ? p.nombre : mProd[1]; n.items[0].productoId = p ? p.id : undefined; }
    const cat = detectarCategoria(t); if (cat && n.tipo === 'gasto') n.categoria = cat;
    return n;
  }

  function esConfirmacion(texto) { return /^(si|sí|confirmo|confirmar|correcto|esta bien|ok|okey|dale|guardalo|guarda|registralo|confirmado|si confirmo)\b/.test(normalizar(texto)); }
  function esCancelacion(texto) { return /^(cancela|cancelar|no guardes|borra|olvidalo|anula esto)\b/.test(normalizar(texto)); }
  function esCierre(texto) { return /cierre de hoy|cerrar (la )?caja|cierre del dia|cierre de caja/.test(normalizar(texto)); }

  const MNR = {
    aCentavos, aMilesimas, deMilesimas, formatoBs, formatoCant, importeLinea, uid, fechaLocal, normalizar,
    METODOS, TIPOS, CATEGORIAS_GASTO, calcularEstado, validarOperacion, posibleDuplicado, sumaPagos,
    resumenDia, cerrarCaja, efectivoInicialSugerido, alertasStock, buscarProducto, borradorAOperacion,
    palabrasANumeros, interpretarTextoLocal, corregirBorradorLocal, esConfirmacion, esCancelacion, esCierre, detectarCategoria
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = MNR;
  else root.MNR = MNR;
})(typeof window !== 'undefined' ? window : globalThis);
