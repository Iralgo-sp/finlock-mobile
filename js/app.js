// app.js — controlador principal de FinLock Mobile

// ── Estado ────────────────────────────────────────────────────────────────────
let _SQL        = null
let _db         = null
let _archivos   = []
let _archivoId  = null
let _cuentaId   = null
let _cuentaActiva = null
let _periodo      = 'todo'
let _signo        = ''

let _tabActivo    = 'cuentas'
let _presuMes     = (() => {
  const h = new Date()
  return `${h.getFullYear()}-${String(h.getMonth()+1).padStart(2,'0')}`
})()
let _infTab       = 'gastos'
let _infPeriodo   = 'mes'

// ── Formato ───────────────────────────────────────────────────────────────────
const fmtEUR   = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' })
const fmtFecha = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' })
const MESES_ES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
const MESES_LARGO = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']

function eur(cents) {
  if (cents == null) return '—'
  const abs   = Math.abs(Math.round(cents))
  const euros = Math.floor(abs / 100)
  const centi = abs % 100
  const intS  = euros.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  const decS  = centi.toString().padStart(2, '0')
  return (cents < 0 ? '-' : '') + intS + ',' + decS + ' €'
}
function fecha(iso) { return fmtFecha.format(new Date(iso + 'T00:00:00')) }
function esc(str)   { return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') }

function formatMes(mes) {
  const [yy, mm] = mes.split('-')
  return `${MESES_LARGO[parseInt(mm)-1]} ${yy}`
}

function sumarMeses(mes, n) {
  const d = new Date(mes + '-01')
  d.setMonth(d.getMonth() + n)
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`
}

// Calcula desde/hasta (AAAA-MM-DD) a partir de un código de período
function periodoAFechas(periodo) {
  const h  = new Date()
  const yy = h.getFullYear()
  const mm = String(h.getMonth() + 1).padStart(2, '0')
  const dd = String(h.getDate()).padStart(2, '0')
  const hoy = `${yy}-${mm}-${dd}`

  if (periodo === 'mes') {
    return { desde: `${yy}-${mm}-01`, hasta: hoy }
  }
  if (periodo === 'mesant') {
    const d = new Date(yy, h.getMonth() - 1, 1)
    const ultimo = new Date(yy, h.getMonth(), 0)
    const y2 = String(d.getFullYear())
    const m2 = String(d.getMonth() + 1).padStart(2, '0')
    const u2 = String(ultimo.getDate()).padStart(2, '0')
    return { desde: `${y2}-${m2}-01`, hasta: `${y2}-${m2}-${u2}` }
  }
  if (periodo === 'trim') {
    const q = Math.floor(h.getMonth() / 3)
    const desdeM = String(q * 3 + 1).padStart(2, '0')
    return { desde: `${yy}-${desdeM}-01`, hasta: hoy }
  }
  if (periodo === 'anio') {
    return { desde: `${yy}-01-01`, hasta: hoy }
  }
  return { desde: `${yy}-${mm}-01`, hasta: hoy }
}

// ── Navegación ────────────────────────────────────────────────────────────────
function mostrar(id) {
  document.querySelectorAll('.screen').forEach(s => {
    s.classList.toggle('active', s.id === id)
  })
}

function cambiarTab(tab) {
  _tabActivo = tab
  document.querySelectorAll('.tab-panel').forEach(p =>
    p.classList.toggle('active', p.id === `tab-${tab}`)
  )
  document.querySelectorAll('.bnav-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.tab === tab)
  )
  if (_db) renderTab(tab)
}

function renderTab(tab) {
  switch (tab) {
    case 'cuentas':     renderCuentas();     break
    case 'presupuesto': renderPresupuesto(); break
    case 'informes':    renderInformes();    break
    case 'agenda':      renderAgenda();      break
  }
}

// ── sql.js (carga diferida en background) ────────────────────────────────────
async function ensureSQL() {
  if (_SQL) return _SQL
  _SQL = await initSqlJs({
    locateFile: f => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/${f}`
  })
  return _SQL
}

// ── Pantalla: Desbloquear ─────────────────────────────────────────────────────
function setStatus(msg, tipo = '') {
  const el = document.getElementById('status-msg')
  el.textContent = msg
  el.className   = 'status-msg' + (tipo ? ` status-${tipo}` : '')
  el.classList.toggle('hidden', !msg)
}

document.getElementById('btn-google').addEventListener('click', async () => {
  if (!CONFIG.GOOGLE_CLIENT_ID || CONFIG.GOOGLE_CLIENT_ID.startsWith('TU_')) {
    setStatus('Configura tu Google Client ID en js/config.js', 'error')
    return
  }
  setStatus('Conectando con Google…')
  try {
    const token = await authorize(CONFIG.GOOGLE_CLIENT_ID)
    setStatus('Buscando archivos .enc en Drive…')
    _archivos = await buscarArchivos(token)

    if (!_archivos.length) {
      setStatus('No se encontraron archivos .enc en tu Google Drive', 'error')
      return
    }

    const sel    = document.getElementById('file-selector')
    const select = document.getElementById('file-select')
    select.innerHTML = _archivos.map(f =>
      `<option value="${f.id}">${f.name}</option>`
    ).join('')
    sel.classList.remove('hidden')
    document.getElementById('password-section').classList.remove('hidden')
    _archivoId = _archivos[0].id
    select.addEventListener('change', () => { _archivoId = select.value })
    setStatus('')
  } catch (e) {
    setStatus('Error al conectar con Google: ' + e.message, 'error')
  }
})

document.getElementById('btn-unlock').addEventListener('click', abrirArchivo)
document.getElementById('input-password').addEventListener('keydown', e => {
  if (e.key === 'Enter') abrirArchivo()
})

async function abrirArchivo() {
  const pwd = document.getElementById('input-password').value.trim()
  if (!pwd) { setStatus('Introduce la contraseña', 'error'); return }
  if (!_archivoId) { setStatus('Selecciona un archivo', 'error'); return }

  document.getElementById('btn-unlock').disabled = true
  try {
    setStatus('Descargando archivo…')
    const bytes = await descargarArchivo(getToken(), _archivoId)

    setStatus('Derivando clave (puede tardar unos segundos)…')
    const dbBytes = await abrirEnc(bytes, pwd)

    setStatus('Abriendo base de datos…')
    const SQL = await ensureSQL()
    _db = new SQL.Database(dbBytes)

    cambiarTab('cuentas')
    mostrar('screen-app')
    setStatus('')
  } catch (e) {
    const msg = e.message?.toLowerCase().includes('decrypt')
      ? 'Contraseña incorrecta'
      : 'Error al abrir: ' + e.message
    setStatus(msg, 'error')
  } finally {
    document.getElementById('btn-unlock').disabled = false
  }
}

// ── PESTAÑA: CUENTAS ──────────────────────────────────────────────────────────
function renderCuentas() {
  const neto = getNetWorth(_db) * 100
  const { activo, pasivo } = getCuentasDashboard(_db)

  const lista = document.getElementById('accounts-list')
  lista.innerHTML = ''

  // Patrimonio neto al inicio
  lista.insertAdjacentHTML('beforeend', `
    <div class="networth-card">
      <span class="networth-label">Patrimonio neto</span>
      <span class="networth-value ${neto >= 0 ? 'pos' : 'neg'}">${eur(neto)}</span>
    </div>
  `)

  const renderSeccion = (titulo, items) => {
    if (!items.length) return
    const regular = items.filter(i => !i.isBroker)
    const brokers  = items.filter(i =>  i.isBroker)
    const total    = items.reduce((s, i) => s + i.balance, 0)

    lista.insertAdjacentHTML('beforeend', `<div class="grupo-titulo">${titulo}</div>`)

    // Cuentas regulares agrupadas por entidad
    let lastInst = Symbol()
    regular.forEach(i => {
      const inst = i.institution || ''
      if (inst !== lastInst) {
        if (inst) lista.insertAdjacentHTML('beforeend', `<div class="inst-sep">${esc(inst)}</div>`)
        lastInst = inst
      }
      const div = document.createElement('div')
      div.className = 'cuenta-row'
      div.innerHTML = `
        <span class="cuenta-nombre">${esc(i.name)}</span>
        <span class="cuenta-saldo ${i.balance >= 0 ? 'pos' : 'neg'}">${eur(i.balance)}</span>
      `
      div.addEventListener('click', () => abrirCuenta(i))
      lista.appendChild(div)
    })

    // Cuentas de inversión (broker) como filas colapsables
    brokers.forEach(broker => {
      const brokerRow = document.createElement('div')
      brokerRow.className = 'cuenta-row cuenta-row--broker'
      brokerRow.innerHTML = `
        <span class="broker-chevron"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg></span>
        <span class="cuenta-nombre">${esc(broker.name)}</span>
        <span class="cuenta-saldo ${broker.balance >= 0 ? 'pos' : 'neg'}">${eur(broker.balance)}</span>
      `
      const posWrap = document.createElement('div')
      posWrap.className = 'broker-positions'

      broker.positions.forEach(pos => {
        const posRow = document.createElement('div')
        posRow.className = 'cuenta-row cuenta-row--position'
        posRow.innerHTML = `
          <span class="cuenta-nombre cuenta-nombre--pos">${esc(pos.name)}</span>
          <span class="cuenta-saldo ${pos.balance >= 0 ? 'pos' : 'neg'}">${eur(pos.balance)}</span>
        `
        posRow.addEventListener('click', () => abrirCuenta(pos))
        posWrap.appendChild(posRow)
      })

      brokerRow.addEventListener('click', () => {
        const open = brokerRow.classList.toggle('is-open')
        posWrap.classList.toggle('is-open', open)
      })

      lista.appendChild(brokerRow)
      lista.appendChild(posWrap)
    })

    lista.insertAdjacentHTML('beforeend', `
      <div class="grupo-total">
        <span>Total ${titulo}</span>
        <span class="cuenta-saldo ${total >= 0 ? 'pos' : 'neg'}">${eur(total)}</span>
      </div>
    `)
  }

  renderSeccion('Activo', activo)
  renderSeccion('Pasivo', pasivo)
}

function abrirCuenta(cuenta) {
  _cuentaId     = cuenta.id
  _cuentaActiva = cuenta
  _periodo      = 'mes'
  _signo        = ''
  renderCuenta(cuenta)
  mostrar('screen-cuenta')
}

// ── PESTAÑA: PRESUPUESTO ──────────────────────────────────────────────────────
function renderPresupuesto() {
  document.getElementById('presu-mes-label').textContent = formatMes(_presuMes)

  const data   = getPresupuesto(_db, _presuMes)
  const el     = document.getElementById('presu-list')

  if (!data.length) {
    el.innerHTML = '<p class="tx-vacio">Sin datos de presupuesto para este mes.<br>Configura el presupuesto en la app de escritorio.</p>'
    return
  }

  const gastos   = data.filter(p => p.account_class === 'gasto')
  const ingresos = data.filter(p => p.account_class === 'ingreso')

  const renderSeccion = (titulo, items, esGasto) => {
    if (!items.length) return ''

    const totalBudget = items.reduce((s, p) => s + (p.budget_cents || 0), 0)
    const totalActual = items.reduce((s, p) => s + Math.abs(p.actual_cents), 0)

    const filas = items.map(p => {
      const actual = Math.abs(p.actual_cents)
      const budget = p.budget_cents || 0
      const pct = budget > 0 ? Math.min(110, Math.round(actual / budget * 100)) : (actual > 0 ? 100 : 0)
      const fillClass = pct >= 100 ? 'over' : (pct >= 80 ? 'warning' : '')

      return `
        <div class="presu-row">
          <div class="presu-row-header">
            <span class="presu-categoria">${esc(p.name)}</span>
            <span class="presu-importes">
              <span class="actual ${esGasto && actual > budget && budget > 0 ? 'neg' : ''}">${eur(actual)}</span>
              ${budget ? ` / ${eur(budget)}` : ''}
            </span>
          </div>
          ${budget > 0 ? `
            <div class="presu-progress">
              <div class="presu-progress-fill ${fillClass}" style="width:${pct}%"></div>
            </div>` : ''}
        </div>
      `
    }).join('')

    return `
      <div class="dash-section-title">${titulo}</div>
      ${filas}
      <div class="dash-grupo-total">
        <span>Total</span>
        <span>${eur(totalActual)}${totalBudget ? ` / ${eur(totalBudget)}` : ''}</span>
      </div>
    `
  }

  el.innerHTML = renderSeccion('Gastos', gastos, true) + renderSeccion('Ingresos', ingresos, false)
}

// ── PESTAÑA: INFORMES ─────────────────────────────────────────────────────────
function renderInformes() {
  if (!_db) return
  const { desde, hasta } = periodoAFechas(_infPeriodo)

  if (_infTab === 'gastos') {
    const data = getInformeCategorias(_db, desde, hasta).filter(r => r.account_class === 'gasto')
    renderInformeLista(data, 'gasto')
  } else if (_infTab === 'ingresos') {
    const data = getInformeCategorias(_db, desde, hasta).filter(r => r.account_class === 'ingreso')
    renderInformeLista(data, 'ingreso')
  } else if (_infTab === 'pagadores') {
    const data = getInformePayees(_db, desde, hasta)
    renderInformePayees(data)
  } else if (_infTab === 'patrimonio') {
    renderInformePatrimonio()
  }
}

function renderInformeLista(data, tipo) {
  const el = document.getElementById('inf-content')
  if (!data.length) {
    el.innerHTML = '<p class="tx-vacio">Sin datos para este período</p>'
    return
  }

  const totalAbs = data.reduce((s, r) => s + Math.abs(r.total), 0)
  const cls = tipo === 'gasto' ? 'neg' : 'pos'

  el.innerHTML = data.map(r => {
    const pct = totalAbs > 0 ? Math.round(Math.abs(r.total) / totalAbs * 100) : 0
    return `
      <div class="inf-row">
        <div class="inf-row-name">${esc(r.name)}</div>
        <span class="inf-row-num">${r.num}</span>
        <span class="inf-row-pct">${pct}%</span>
        <span class="inf-row-amount ${cls}">${eur(Math.abs(r.total))}</span>
      </div>
    `
  }).join('') + `
    <div class="dash-grupo-total">
      <span>Total</span>
      <span class="${cls}">${eur(totalAbs)}</span>
    </div>
  `
}

function renderInformePayees(data) {
  const el = document.getElementById('inf-content')
  if (!data.length) {
    el.innerHTML = '<p class="tx-vacio">Sin pagadores para este período</p>'
    return
  }

  const totalAbs = data.reduce((s, r) => s + Math.abs(r.total), 0)

  el.innerHTML = data.map(r => {
    const pct = totalAbs > 0 ? Math.round(Math.abs(r.total) / totalAbs * 100) : 0
    return `
      <div class="inf-row">
        <div class="inf-row-name">${esc(r.name)}</div>
        <span class="inf-row-num">${r.num}</span>
        <span class="inf-row-pct">${pct}%</span>
        <span class="inf-row-amount neg">${eur(Math.abs(r.total))}</span>
      </div>
    `
  }).join('') + `
    <div class="dash-grupo-total">
      <span>Total</span>
      <span class="neg">${eur(totalAbs)}</span>
    </div>
  `
}

function renderInformePatrimonio() {
  const el   = document.getElementById('inf-content')
  const data = getEvolucionPatrimonio(_db)

  if (!data.length) {
    el.innerHTML = '<p class="tx-vacio">Sin datos de evolución patrimonial</p>'
    return
  }

  // Mostrar los últimos 36 meses, más reciente primero
  const ultimos = data.slice(-36).reverse()

  el.innerHTML = `
    <div class="inf-row" style="font-weight:600;color:var(--text-muted);font-size:12px;letter-spacing:.04em;text-transform:uppercase;padding:8px 16px;background:var(--bg);">
      <span class="inf-row-name">Mes</span>
      <span class="inf-row-pct" style="min-width:80px;text-align:right">Variación</span>
      <span class="inf-row-amount" style="font-family:var(--font-sans)">Patrimonio</span>
    </div>
  ` + ultimos.map((m, i) => {
    const prev  = i < ultimos.length - 1 ? ultimos[i+1].saldo : 0
    const delta = m.saldo - prev
    const [yy, mm] = m.mes.split('-')
    const label = `${MESES_ES[parseInt(mm)-1]} ${yy}`
    const deltaStr = delta === 0 ? '—' : (delta > 0 ? '+' : '') + eur(delta)
    return `
      <div class="patrimonio-row">
        <span class="patrimonio-mes">${label}</span>
        <span class="patrimonio-delta ${delta > 0 ? 'pos' : delta < 0 ? 'neg' : ''}">${deltaStr}</span>
        <span class="patrimonio-saldo ${m.saldo >= 0 ? 'pos' : 'neg'}">${eur(m.saldo)}</span>
      </div>
    `
  }).join('')
}

// ── PESTAÑA: AGENDA ───────────────────────────────────────────────────────────
function renderAgenda() {
  const el     = document.getElementById('agenda-list')
  const planes = getPlanificados(_db, 20)

  if (!planes.length) {
    el.innerHTML = '<p class="tx-vacio">Sin pagos planificados activos</p>'
    return
  }

  let lastMes = ''
  el.innerHTML = planes.map(p => {
    const [yy, mm, dd] = p.next_date.split('-')
    const mes = `${MESES_LARGO[parseInt(mm)-1]} ${yy}`
    let header = ''
    if (mes !== lastMes) { lastMes = mes; header = `<div class="agenda-mes-sep">${mes}</div>` }
    const cuenta = [p.institution, p.cuenta_nombre].filter(Boolean).join(' · ')
    return header + `
      <div class="agenda-row">
        <span class="agenda-fecha">${dd}/${mm}</span>
        <div class="agenda-info">
          <div class="agenda-nombre">${esc(p.name)}</div>
          ${cuenta ? `<div class="agenda-cuenta">${esc(cuenta)}</div>` : ''}
        </div>
        <span class="agenda-importe ${p.amount_cents >= 0 ? 'pos' : 'neg'}">${eur(p.amount_cents)}</span>
      </div>
    `
  }).join('')
}

// ── PANTALLA: CUENTA ──────────────────────────────────────────────────────────
function renderCuenta(cuenta) {
  const bal = cuenta.balance
  document.getElementById('screen-cuenta-nombre').textContent = cuenta.name
  document.getElementById('screen-cuenta-saldo').textContent  = eur(cuenta.balance)
  document.getElementById('screen-cuenta-saldo').className    =
    'cuenta-saldo-header ' + (bal >= 0 ? 'pos' : 'neg')

  // Resumen del mes actual (siempre muestra el mes en curso, independiente del filtro)
  const resumen = getResumenMensual(_db, cuenta.id || _cuentaId)
  const r = resumen[0] || {}
  document.getElementById('resumen-ingresos').textContent = r.ingresos ? eur(r.ingresos) : '—'
  document.getElementById('resumen-gastos').textContent   = r.gastos   ? eur(r.gastos)   : '—'
  document.getElementById('resumen-num').textContent      =
    r.num_tx ? `${r.num_tx} mov. este mes` : 'Sin movimientos este mes'

  // Transacciones con filtros
  const txs   = getTransacciones(_db, cuenta.id || _cuentaId, _signo, _periodo)
  const lista = document.getElementById('tx-list')
  lista.innerHTML = ''

  if (!txs.length) {
    lista.innerHTML = '<p class="tx-vacio">Sin movimientos en este período</p>'
    return
  }

  let lastDate = ''
  txs.forEach(tx => {
    if (tx.postdate !== lastDate) {
      lastDate = tx.postdate
      const sep = document.createElement('div')
      sep.className   = 'tx-date-sep'
      sep.textContent = fecha(tx.postdate)
      lista.appendChild(sep)
    }
    const row    = document.createElement('div')
    row.className = 'tx-row'
    const amount  = tx.amount_cents

    const reconcileClass =
      tx.reconcile_flag === 2 ? 'cleared' :
      tx.reconcile_flag === 1 ? 'pending' : ''

    row.innerHTML = `
      <div class="tx-info">
        <span class="tx-concepto">${esc(tx.concepto)}</span>
        ${tx.categoria ? `<span class="tx-categoria">${esc(tx.categoria)}</span>` : ''}
      </div>
      <span class="tx-importe ${amount >= 0 ? 'pos' : 'neg'}">${eur(amount)}</span>
      ${reconcileClass ? `<span class="tx-reconcile ${reconcileClass}" title="${reconcileClass === 'cleared' ? 'Conciliado' : 'Pendiente'}"></span>` : '<span class="tx-reconcile"></span>'}
    `
    lista.appendChild(row)
  })
}

// ── Event listeners ───────────────────────────────────────────────────────────

// Navegación inferior
document.querySelectorAll('.bnav-btn').forEach(btn => {
  btn.addEventListener('click', () => cambiarTab(btn.dataset.tab))
})

// Presupuesto: mes anterior / siguiente
document.getElementById('btn-presu-prev').addEventListener('click', () => {
  _presuMes = sumarMeses(_presuMes, -1)
  renderPresupuesto()
})
document.getElementById('btn-presu-next').addEventListener('click', () => {
  _presuMes = sumarMeses(_presuMes, +1)
  renderPresupuesto()
})

// Informes: período
document.querySelectorAll('#inf-periodo-filters .chip').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#inf-periodo-filters .chip').forEach(b => b.classList.remove('is-active'))
    btn.classList.add('is-active')
    _infPeriodo = btn.dataset.infPeriodo
    renderInformes()
  })
})

// Informes: sub-pestaña
document.querySelectorAll('.inf-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.inf-tab').forEach(b => b.classList.remove('active'))
    btn.classList.add('active')
    _infTab = btn.dataset.infTab
    renderInformes()
  })
})

// Cuenta: filtro de período
document.querySelectorAll('#periodo-filters .chip').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#periodo-filters .chip').forEach(b => b.classList.remove('is-active'))
    btn.classList.add('is-active')
    _periodo = btn.dataset.periodo
    if (_cuentaActiva) renderCuenta(_cuentaActiva)
  })
})

// Cuenta: filtro de signo
document.querySelectorAll('#tx-filters .chip').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#tx-filters .chip').forEach(b => b.classList.remove('is-active'))
    btn.classList.add('is-active')
    _signo = btn.dataset.signo
    if (_cuentaActiva) renderCuenta(_cuentaActiva)
  })
})

// Volver desde cuenta
document.getElementById('btn-back').addEventListener('click', () => {
  mostrar('screen-app')
  _periodo = 'todo'
  _signo   = ''
  document.querySelectorAll('#periodo-filters .chip').forEach(b => b.classList.toggle('is-active', b.dataset.periodo === 'todo'))
  document.querySelectorAll('#tx-filters .chip').forEach((b, i) => b.classList.toggle('is-active', i === 0))
})

// Cerrar sesión
document.getElementById('btn-cerrar').addEventListener('click', () => {
  if (_db) { _db.close(); _db = null }
  document.getElementById('input-password').value = ''
  document.getElementById('password-section').classList.add('hidden')
  document.getElementById('file-selector').classList.add('hidden')
  setStatus('')
  mostrar('screen-unlock')
})

// ── PWA: registrar service worker ─────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {})
}

// Pantalla inicial
mostrar('screen-unlock')
cambiarTab('inicio')   // activa los estilos del tab inicial sin renderizar
ensureSQL().catch(() => {})
