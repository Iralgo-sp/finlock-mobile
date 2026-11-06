// Consultas SQL sobre la BD de FinLock cargada con sql.js

function rows(db, sql, params = []) {
  const result = db.exec(sql, params)
  if (!result.length) return []
  const { columns, values } = result[0]
  return values.map(row => Object.fromEntries(columns.map((c, i) => [c, row[i]])))
}

function getNetWorth(db) {
  const r = rows(db, `
    SELECT SUM(s.amount_cents) AS neto
    FROM splits s
    JOIN accounts a ON a.id = s.account_id
    WHERE a.account_class IN ('activo','pasivo') AND a.is_closed = 0
  `)
  return (r[0]?.neto ?? 0) / 100
}

function getCuentas(db) {
  return rows(db, `
    SELECT a.id, a.name, a.account_class, COALESCE(a.currency,'EUR') AS currency,
           COALESCE(SUM(s.amount_cents), 0) AS balance_cents
    FROM accounts a
    INNER JOIN splits s ON s.account_id = a.id
    WHERE a.account_class IN ('activo','pasivo') AND a.is_closed = 0
    GROUP BY a.id
    ORDER BY
      CASE a.account_class WHEN 'activo' THEN 1 WHEN 'pasivo' THEN 2 ELSE 3 END,
      a.name
  `)
}

function getTransacciones(db, accountId, signo = '') {
  let cond = ''
  if (signo === 'gasto')   cond = 'AND s.amount_cents < 0'
  if (signo === 'ingreso') cond = 'AND s.amount_cents > 0'
  return rows(db, `
    SELECT t.postdate,
           COALESCE(p.name, s.payee_hint, t.memo, s.memo, '—') AS concepto,
           s.amount_cents, s.reconcile_flag
    FROM splits s
    JOIN transactions t ON t.id = s.transaction_id
    LEFT JOIN payees p ON p.id = s.payee_id
    WHERE s.account_id = ? ${cond}
    ORDER BY t.postdate DESC, t.id DESC
    LIMIT 300
  `, [accountId])
}

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
