// Consultas SQL sobre la BD de FinLock cargada con sql.js

function rows(db, sql, params = []) {
  const result = db.exec(sql, params)
  if (!result.length) return []
  const { columns, values } = result[0]
  return values.map(row => Object.fromEntries(columns.map((c, i) => [c, row[i]])))
}

// Para cuentas de inversión (security_id IS NOT NULL) el balance es
// acciones × precio más reciente, NO el coste de compra (amount_cents).
function buildBalanceMap(db) {
  const balMap = {}

  // 1. Saldo base para todas las cuentas (coste para inversiones, saldo real para el resto)
  const br = db.exec('SELECT account_id, SUM(amount_cents) FROM splits GROUP BY account_id')
  if (br.length) for (const [id, bal] of br[0].values) balMap[id] = bal || 0

  // 2. Sobrescribir cuentas de inversión con valor de mercado actual
  try {
    const inv = rows(db, `
      SELECT a.id,
        COALESCE((SELECT SUM(s.shares_micro) FROM splits s WHERE s.account_id = a.id), 0) AS shares_micro,
        (SELECT COALESCE(p.eur_price_micro, p.price_micro)
         FROM prices p WHERE p.security_id = a.security_id
         ORDER BY p.price_date DESC LIMIT 1) AS price_micro
      FROM accounts a
      WHERE a.security_id IS NOT NULL
    `)
    for (const acc of inv) {
      if (acc.price_micro != null && acc.shares_micro) {
        // shares_micro / 1e6 × price_micro / 1e6 = EUR → × 100 = céntimos
        balMap[acc.id] = Math.round((acc.shares_micro / 1e6) * (acc.price_micro / 1e6) * 100)
      } else {
        // Vendidas completamente (0 acciones): valor de mercado = 0
        balMap[acc.id] = 0
      }
    }
  } catch (_) {}

  return balMap
}

function getNetWorth(db) {
  // Cuentas regulares
  const r = rows(db, `
    SELECT SUM(s.amount_cents) AS neto
    FROM splits s
    JOIN accounts a ON a.id = s.account_id
    WHERE a.account_class IN ('activo','pasivo') AND a.is_closed = 0
      AND a.security_id IS NULL
  `)
  let neto = r[0]?.neto ?? 0

  // Cuentas de inversión: acciones × precio actual
  try {
    const inv = rows(db, `
      SELECT
        COALESCE((SELECT SUM(s.shares_micro) FROM splits s WHERE s.account_id = a.id), 0) AS shares_micro,
        (SELECT COALESCE(p.eur_price_micro, p.price_micro)
         FROM prices p WHERE p.security_id = a.security_id
         ORDER BY p.price_date DESC LIMIT 1) AS price_micro
      FROM accounts a
      WHERE a.security_id IS NOT NULL AND a.is_closed = 0
        AND a.account_class IN ('activo','pasivo')
    `)
    for (const acc of inv) {
      if (acc.price_micro != null && acc.shares_micro) {
        neto += Math.round((acc.shares_micro / 1e6) * (acc.price_micro / 1e6) * 100)
      }
    }
  } catch (_) {}

  return neto / 100
}

// Estadísticas de inicio: num cuentas abiertas, num entidades
function getStatsInicio(db) {
  const nc = rows(db, `SELECT COUNT(*) as n FROM accounts WHERE account_class IN ('activo','pasivo') AND is_closed = 0`)[0]?.n || 0
  const ne = rows(db, `SELECT COUNT(DISTINCT institution) as n FROM accounts WHERE institution IS NOT NULL AND institution != ''`)[0]?.n || 0
  return { numCuentas: nc, numEntidades: ne }
}

// Lista plana de cuentas para el dashboard de Inicio (como en el desktop)
function getCuentasDashboard(db) {
  const balMap = buildBalanceMap(db)

  const list = rows(db, `
    SELECT a.id, a.name, a.account_class, a.institution, a.type_name,
           COALESCE(a.currency,'EUR') AS currency, a.is_favorite, a.iban, a.number,
           a.security_id
    FROM accounts a
    WHERE a.account_class IN ('activo','pasivo') AND a.is_closed = 0
      AND NOT EXISTS (
        SELECT 1 FROM accounts c WHERE c.parent_id = a.id
          AND c.account_class IN ('activo','pasivo') AND c.is_closed = 0
      )
    ORDER BY a.account_class,
      CASE WHEN a.security_id IS NOT NULL THEN 1 ELSE 0 END,
      CASE WHEN a.institution IS NULL OR a.institution = '' THEN 1 ELSE 0 END,
      COALESCE(a.institution,''),
      a.name
  `).map(c => ({ ...c, balance: balMap[c.id] || 0 }))
   .filter(c => !(c.security_id && (balMap[c.id] || 0) === 0))

  return {
    activo: list.filter(c => c.account_class === 'activo'),
    pasivo: list.filter(c => c.account_class === 'pasivo')
  }
}

// Árbol jerárquico de cuentas para la pestaña Cuentas
function getCuentasArbol(db) {
  const balMap = buildBalanceMap(db)

  const list = rows(db, `
    SELECT a.id, a.name, a.parent_id, a.account_class, COALESCE(a.currency,'EUR') AS currency,
           a.security_id
    FROM accounts a
    WHERE a.account_class IN ('activo','pasivo') AND a.is_closed = 0
    ORDER BY
      CASE a.account_class WHEN 'activo' THEN 1 WHEN 'pasivo' THEN 2 ELSE 3 END,
      a.name
  `).filter(c => !(c.security_id && (balMap[c.id] || 0) === 0))

  const map = {}
  list.forEach(c => {
    map[c.id] = { ...c, balance: balMap[c.id] || 0, children: [], hasMov: c.id in balMap }
  })

  const roots = []
  list.forEach(c => {
    const n = map[c.id]
    if (n.parent_id && map[n.parent_id]) map[n.parent_id].children.push(n)
    else roots.push(n)
  })

  function calcTotal(n) {
    let t = n.balance
    n.children.forEach(c => { t += calcTotal(c) })
    n.balanceTotal = t
    return t
  }
  roots.forEach(calcTotal)
  return roots
}

// Próximas transacciones planificadas
function getPlanificados(db, limit = 10) {
  return rows(db, `
    SELECT s.name, s.amount_cents, s.next_date, s.frequency,
           a.name as cuenta_nombre, a.institution
    FROM scheduled s
    LEFT JOIN accounts a ON a.id = s.account_id
    WHERE s.active = 1 AND s.next_date IS NOT NULL
    ORDER BY s.next_date ASC
    LIMIT ${limit}
  `)
}

// Presupuesto efectivo + gastos reales para un mes 'AAAA-MM'
// Lógica: 'solo' para el mes concreto tiene prioridad; si no, el 'desde' más reciente ≤ mes
function getPresupuesto(db, mes) {
  const mesInicio = mes + '-01'
  const d = new Date(mes + '-01')
  d.setMonth(d.getMonth() + 1)
  d.setDate(0)
  const mesFin = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`

  const presup = rows(db, `
    SELECT a.id, a.name, a.account_class,
      COALESCE(
        (SELECT b.amount_cents FROM budget b WHERE b.category_id = a.id AND b.modo = 'solo'  AND b.mes = ?),
        (SELECT b.amount_cents FROM budget b WHERE b.category_id = a.id AND b.modo = 'desde' AND b.mes <= ? ORDER BY b.mes DESC LIMIT 1)
      ) AS budget_cents
    FROM accounts a
    WHERE a.account_class IN ('gasto','ingreso') AND a.is_closed = 0
    ORDER BY a.account_class, a.name
  `, [mes, mes])

  const actuales = {}
  rows(db, `
    SELECT s.account_id, SUM(s.amount_cents) as actual
    FROM splits s
    JOIN transactions t ON t.id = s.transaction_id
    JOIN accounts a ON a.id = s.account_id
    WHERE a.account_class IN ('gasto','ingreso')
      AND t.postdate >= ? AND t.postdate <= ?
    GROUP BY s.account_id
  `, [mesInicio, mesFin]).forEach(r => { actuales[r.account_id] = r.actual })

  return presup
    .filter(p => p.budget_cents !== null)
    .map(p => ({ ...p, actual_cents: actuales[p.id] || 0 }))
}

// Informe de gastos/ingresos por categoría entre dos fechas
function getInformeCategorias(db, desde, hasta) {
  return rows(db, `
    SELECT a.id, a.name, a.account_class,
           SUM(s.amount_cents) as total,
           COUNT(DISTINCT s.transaction_id) as num
    FROM splits s
    JOIN transactions t ON t.id = s.transaction_id
    JOIN accounts a ON a.id = s.account_id
    WHERE a.account_class IN ('gasto','ingreso')
      AND t.postdate >= ? AND t.postdate <= ?
    GROUP BY a.id
    ORDER BY ABS(total) DESC
  `, [desde, hasta])
}

// Informe de gastos por pagador entre dos fechas
function getInformePayees(db, desde, hasta) {
  return rows(db, `
    SELECT COALESCE(p.name, s.payee_hint, '(Sin pagador)') as name,
           SUM(s.amount_cents) as total,
           COUNT(DISTINCT s.transaction_id) as num
    FROM splits s
    JOIN transactions t ON t.id = s.transaction_id
    JOIN accounts a ON a.id = s.account_id
    LEFT JOIN payees p ON p.id = s.payee_id
    WHERE a.account_class IN ('activo','pasivo') AND s.amount_cents < 0
      AND t.postdate >= ? AND t.postdate <= ?
    GROUP BY COALESCE(p.id, s.payee_hint, s.memo, '—')
    ORDER BY total ASC
    LIMIT 50
  `, [desde, hasta])
}

// Evolución patrimonial mensual: saldo acumulado a fin de cada mes
function getEvolucionPatrimonio(db) {
  const mensuales = rows(db, `
    SELECT substr(t.postdate,1,7) as mes, SUM(s.amount_cents) as delta
    FROM splits s
    JOIN transactions t ON t.id = s.transaction_id
    JOIN accounts a ON a.id = s.account_id
    WHERE a.account_class IN ('activo','pasivo') AND a.is_closed = 0
    GROUP BY mes ORDER BY mes
  `)
  let acum = 0
  return mensuales.map(m => {
    acum += m.delta
    return { mes: m.mes, saldo: acum }
  })
}

// Resumen del mes actual para una cuenta
function getResumenMensual(db, accountId) {
  const hoy   = new Date()
  const desde = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-01`
  return rows(db, `
    SELECT
      SUM(CASE WHEN s.amount_cents > 0 THEN s.amount_cents ELSE 0 END) AS ingresos,
      SUM(CASE WHEN s.amount_cents < 0 THEN s.amount_cents ELSE 0 END) AS gastos,
      COUNT(*) AS num_tx
    FROM splits s
    JOIN transactions t ON t.id = s.transaction_id
    WHERE s.account_id = ? AND t.postdate >= ?
  `, [accountId, desde])
}

// Transacciones de una cuenta con filtros de período y signo (incluye categoría)
function getTransacciones(db, accountId, signo = '', periodo = 'mes') {
  let condSigno = ''
  if (signo === 'gasto')   condSigno = 'AND s.amount_cents < 0'
  if (signo === 'ingreso') condSigno = 'AND s.amount_cents > 0'

  let condFecha = ''
  const hoy = new Date()
  const yy  = hoy.getFullYear()
  const mm  = String(hoy.getMonth() + 1).padStart(2, '0')
  if (periodo === 'mes')       condFecha = `AND t.postdate >= '${yy}-${mm}-01'`
  else if (periodo === 'trim') condFecha = `AND t.postdate >= '${yy}-${String(Math.floor(hoy.getMonth()/3)*3+1).padStart(2,'0')}-01'`
  else if (periodo === 'anio') condFecha = `AND t.postdate >= '${yy}-01-01'`

  return rows(db, `
    SELECT t.postdate,
           COALESCE(p.name, s.payee_hint, t.memo, s.memo, '—') AS concepto,
           s.amount_cents, s.reconcile_flag,
           (SELECT cat.name FROM splits s2
            JOIN accounts cat ON cat.id = s2.account_id
            WHERE s2.transaction_id = s.transaction_id
              AND cat.account_class IN ('ingreso','gasto')
            LIMIT 1) AS categoria
    FROM splits s
    JOIN transactions t ON t.id = s.transaction_id
    LEFT JOIN payees p ON p.id = s.payee_id
    WHERE s.account_id = ? ${condSigno} ${condFecha}
    ORDER BY t.postdate DESC, t.id DESC
    LIMIT 500
  `, [accountId])
}
