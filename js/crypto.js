// Descifrado del .enc en el navegador — misma lógica que crypto.js de FinLock
// Formato: [ salt 16 B ][ IV 12 B ][ AES-GCM(gzip(SQLite)) ]

const SALT_LEN = 16
const IV_LEN   = 12
const ITERS    = 310_000

async function deriveKey(password, salt) {
  const enc = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, hash: 'SHA-256', iterations: ITERS },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false, ['decrypt']
  )
}

async function gunzip(data) {
  const ds     = new DecompressionStream('gzip')
  const writer = ds.writable.getWriter()
  const reader = ds.readable.getReader()
  writer.write(data)
  writer.close()
  const chunks = []
  let total = 0
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    chunks.push(value)
    total += value.length
  }
  const out = new Uint8Array(total)
  let off = 0
  for (const c of chunks) { out.set(c, off); off += c.length }
  return out
}

async function abrirEnc(fileBytes, password) {
  const salt       = fileBytes.slice(0, SALT_LEN)
  const iv         = fileBytes.slice(SALT_LEN, SALT_LEN + IV_LEN)
  const ciphertext = fileBytes.slice(SALT_LEN + IV_LEN)
  const key        = await deriveKey(password, salt)
  const plaintext  = new Uint8Array(
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext)
  )
  return gunzip(plaintext)
}
