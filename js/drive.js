// Google Drive: autorización OAuth2 + búsqueda y descarga del .enc

let _token = null

function getToken() { return _token }

function authorize(clientId) {
  return new Promise((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: 'https://www.googleapis.com/auth/drive.readonly',
      callback: resp => {
        if (resp.error) { reject(new Error(resp.error_description || resp.error)); return }
        _token = resp.access_token
        resolve(resp.access_token)
      },
      error_callback: err => reject(new Error(String(err)))
    })
    client.requestAccessToken()
  })
}

async function buscarArchivos(token) {
  const q = encodeURIComponent("name contains '.enc' and trashed = false and mimeType != 'application/vnd.google-apps.folder'")
  const r = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,modifiedTime,size)&orderBy=modifiedTime+desc&pageSize=20`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  if (!r.ok) throw new Error(`Drive API error: ${r.status}`)
  const data = await r.json()
  return data.files || []
}

async function descargarArchivo(token, fileId) {
  const r = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  if (!r.ok) throw new Error(`Error descargando archivo: ${r.status}`)
  return new Uint8Array(await r.arrayBuffer())
}
