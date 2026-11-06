// app.js — controlador principal de FinLock Mobile

// ── Estado ────────────────────────────────────────────────────────────────────
let _SQL        = null   // clase sql.js
let _db         = null   // instancia de BD abierta
let _archivos   = []     // archivos .enc encontrados en Drive
let _archivoId  = null   // id del archivo seleccionado
let _cuentaId   = null   // id de la cuenta activa

// ── Formato ───────────────────────────────────────────────────────────────────
const fmtEUR = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' })
const fmtFecha = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' })

function eur(cents) { return fmtEUR.format(cents / 100) }
function fecha(iso) { return fmtFecha.format(new Date(iso + 'T00:00:00')) }

// ── Navegación ────────────────────────────────────────────────────────────────
function mostrar(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === id))
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

    const sel = document.getElementById('file-selector')
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

    renderHome()
    mostrar('screen-home')
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

// ── Pantalla: Inicio ──────────────────────────────────────────────────────────
function renderHome() {
  const neto     = getNetWorth(_db)
  const cuentas  = getCuentas(_db)
  const activas  = cuentas.filter(c => c.account_class === 'activo')
  const pasivas  = cuentas.filter(c => c.account_class === 'pasivo')

  document.getElementById('networth-value').textContent = eur(neto * 100)
  document.getElementById('networth-value').className =
    'networth-value' + (neto >= 0 ? ' pos' : ' neg')

  const lista = document.getElementById('accounts-list')
  lista.innerHTML = ''

  if (activas.length) {
    lista.insertAdjacentHTML('beforeend', '<div class="grupo-titulo">Activo</div>')
    activas.forEach(c => lista.appendChild(cuentaCard(c)))
  }
  if (pasivas.length) {
    lista.insertAdjacentHTML('beforeend', '<div class="grupo-titulo">Pasivo</div>')
    pasivas.forEach(c => lista.appendChild(cuentaCard(c)))
  }
}

function cuentaCard(cuenta) {
  const div = document.createElement('div')
  div.className = 'cuenta-row'
  const bal = cuenta.balance_cents / 100
  div.innerHTML = `
    <span class="cuenta-nombre">${cuenta.name}</span>
    <span class="cuenta-saldo ${bal >= 0 ? 'pos' : 'neg'}">${eur(cuenta.balance_cents)}</span>
  `
  div.addEventListener('click', () => {
    _cuentaId = cuenta.id
    renderCuenta(cuenta)
    mostrar('screen-cuenta')
  })
  return div
}

// ── Pantalla: Cuenta ──────────────────────────────────────────────────────────
function renderCuenta(cuenta, signo = '') {
  const bal = cuenta.balance_cents / 100
  document.getElementById('screen-cuenta-nombre').textContent  = cuenta.name
  document.getElementById('screen-cuenta-saldo').textContent   = eur(cuenta.balance_cents)
  document.getElementById('screen-cuenta-saldo').className     =
    'cuenta-saldo-header ' + (bal >= 0 ? 'pos' : 'neg')

  const resumen = getResumenMensual(_db, cuenta.id)
  const r = resumen[0] || {}
  document.getElementById('resumen-ingresos').textContent = r.ingresos ? eur(r.ingresos) : '—'
  document.getElementById('resumen-gastos').textContent   = r.gastos   ? eur(r.gastos)   : '—'
  document.getElementById('resumen-num').textContent      =
    r.num_tx ? `${r.num_tx} mov. este mes` : 'Sin movimientos este mes'

  const txs = getTransacciones(_db, cuenta.id, signo)
  const lista = document.getElementById('tx-list')
  lista.innerHTML = ''

  if (!txs.length) {
    lista.innerHTML = '<p class="tx-vacio">Sin movimientos</p>'
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
    const row = document.createElement('div')
    row.className = 'tx-row'
    const amount = tx.amount_cents / 100
    row.innerHTML = `
      <span class="tx-concepto">${tx.concepto}</span>
      <span class="tx-importe ${amount >= 0 ? 'pos' : 'neg'}">${eur(tx.amount_cents)}</span>
    `
    lista.appendChild(row)
  })
}

// Chips de filtro en cuenta
document.querySelectorAll('#tx-filters .chip').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#tx-filters .chip').forEach(b => b.classList.remove('is-active'))
    btn.classList.add('is-active')
    const cuentas = getCuentas(_db)
    const cuenta  = cuentas.find(c => c.id === _cuentaId)
    if (cuenta) renderCuenta(cuenta, btn.dataset.signo)
  })
})

// Volver desde cuenta
document.getElementById('btn-back').addEventListener('click', () => {
  mostrar('screen-home')
  document.querySelectorAll('#tx-filters .chip').forEach((b, i) => {
    b.classList.toggle('is-active', i === 0)
  })
})

// Cerrar sesión / recargar archivo
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

// Pre-cargar sql.js en background
ensureSQL().catch(() => {})
