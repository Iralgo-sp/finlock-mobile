# FinLock Mobile — Configuración

## 1. Google Cloud Console

1. Ve a https://console.cloud.google.com
2. Crea un nuevo proyecto (ej. "FinLock Mobile")
3. En **APIs y servicios → Biblioteca**, busca "Google Drive API" y actívala
4. En **APIs y servicios → Credenciales**, crea credenciales:
   - Tipo: **ID de cliente de OAuth 2.0**
   - Tipo de aplicación: **Aplicación web**
   - Nombre: "FinLock Mobile"
   - Orígenes autorizados:
     - `http://localhost:8080` (para pruebas locales)
     - `https://TU_USUARIO.github.io` (para producción)
5. Copia el **ID de cliente** (termina en `.apps.googleusercontent.com`)

## 2. Configurar la app

Abre `js/config.js` y reemplaza el CLIENT_ID:

```js
const CONFIG = {
  GOOGLE_CLIENT_ID: 'XXXXXXXXX.apps.googleusercontent.com'
}
```

## 3. Probar en local

Necesitas un servidor HTTP (el archivo `file://` no funciona con módulos JS ni OAuth):

```bash
# Con Python:
cd C:\Users\jmqto\Documents\Proyectos\FinLockMobile
python -m http.server 8080

# O con Node:
npx serve -p 8080
```

Abre http://localhost:8080 en el navegador.

## 4. Publicar en GitHub Pages

1. Crea un repositorio nuevo en GitHub (ej. `finlock-mobile`)
2. Inicializa git y sube el código:
   ```bash
   git init
   git add .
   git commit -m "feat: primera versión de FinLock Mobile"
   git remote add origin https://github.com/TU_USUARIO/finlock-mobile.git
   git push -u origin main
   ```
3. En GitHub → Settings → Pages → Source: `main / (root)`
4. URL resultante: `https://TU_USUARIO.github.io/finlock-mobile/`
5. Añade esa URL a los **Orígenes autorizados** en Google Cloud Console

## Notas de seguridad

- La contraseña **nunca sale de tu dispositivo**
- El descifrado ocurre en el navegador con Web Crypto API
- El token de Google Drive dura 1 hora; al expirar se pide de nuevo
- El archivo .enc en Drive no se modifica en ningún momento (solo lectura)
