# HikingTrail — Aplicación móvil

App de React Native (con Expo) para compartir ubicación en tiempo real
durante un desplazamiento a pie.

**El servidor está en otro repositorio, y hay que tenerlo corriendo
para que esta app sirva de algo:**
https://github.com/AurumChains/HikingTrail-

Empieza por el README de ese repositorio: sin base de datos y sin API,
esta app no pasa de la pantalla de login.

---

## Instalación

### 1. Requisitos

- **Node.js 18 o superior**
- **Expo Go** en tu teléfono — gratis en App Store o Play Store
- **El servidor corriendo** (ver el otro repositorio)

### 2. Descargar e instalar

```bash
git clone https://github.com/AurumChains/HikingTrail-app.git
cd HikingTrail-app
npm install
```

> ⚠️ **No pongas el proyecto dentro de OneDrive, Dropbox ni Drive.**
> `node_modules` tiene decenas de miles de archivos y estos servicios
> los bloquean mientras los sincronizan. Eso rompe Metro (el compilador
> de Expo) con errores que parecen fallas de tu código y no lo son.
> Una carpeta normal del disco, tipo `C:\Proyectos\`.

### 3. Apuntar al servidor  ← el paso que todos olvidan

Abre **`config.js`** y pon ahí la dirección de tu servidor:

```js
export const API = 'http://192.168.1.103:3001';
```

**Tu teléfono no puede usar `localhost`.** Para él, `localhost` es él
mismo, no tu computador. Hay que usar la **IP local de tu máquina**:

- **Windows:** `ipconfig` → busca *Dirección IPv4* (algo como `192.168.1.x`)
- **Mac / Linux:** `ifconfig | grep inet`

El teléfono y el computador tienen que estar **en la misma red WiFi**.
Si el teléfono está con datos móviles, no se ven.

> Los routers domésticos reasignan direcciones al reiniciarse. Si un día
> la app dice "sin conexión" pero el navegador del teléfono sí abre
> `http://TU_IP:3001/api/health`, corre `ipconfig` de nuevo y actualiza
> esa línea.

### 4. Levantar

```bash
npx expo start
```

Aparece un código QR:

- **iPhone:** apúntalo con la app de **Cámara** normal
- **Android:** escanéalo desde adentro de **Expo Go**

---

## Trabajar día a día

Al guardar un archivo, la app se actualiza sola en el teléfono
(*Fast Refresh*). Si no toma los cambios:

- Aprieta **`r`** en la terminal de Expo — recarga forzada
- Si sigue raro: `npx expo start -c` — limpia la caché de Metro

**Para instalar librerías usa `npx expo install`, no `npm install`.**
`expo install` elige la versión compatible con el SDK; `npm install`
baja la más reciente y puede romper la app con errores confusos.
Después de instalar una librería nativa, **reinicia Expo**.

---

## Estructura

```
App.js              sesión y cambio de pestaña, nada más
config.js           la dirección del servidor (EL único lugar)
api.js              envoltorio de fetch con token
estilos.js          la paleta y los estilos compartidos
cola.js             cola offline de puntos GPS
pantallas/
  ├── Login.js
  ├── Montanista.js   toda la lógica de rutas y GPS
  └── Familia.js      lista de quién está caminando
```

### `api.js`

Evita repetir la URL, los encabezados y el manejo de errores en cada
llamada:

```js
const { ok, datos, sinRed } = await pedir('/api/routes/start', {
  metodo: 'POST', token, cuerpo: { name: 'Cerro Manquehue' },
});
```

Nunca lanza excepción por un error HTTP: devuelve `ok: false` y quien
llama decide. `sinRed: true` distingue *"el servidor dijo que no"* de
*"no hay internet"*, que son problemas distintos.

### `estilos.js`

La paleta vive en el objeto `C`. Cambiarla ahí cambia toda la app —
es por donde entrará el modo claro.

### `cola.js`

Resuelve el escenario central: **quedarse sin señal**.

Cada punto GPS **se guarda en el disco del teléfono antes de intentar
enviarlo**. Ese orden es todo el truco. Si no hay red, el punto queda a
salvo; se reintenta cada 15 segundos y se vacía antes de terminar la
ruta. Sobrevive incluso a cerrar la app por completo.

---

## Detalles del código que cuestan de descubrir

**`useRef` para el id de ruta y el token.** La función que recibe los
puntos del GPS se queda *congelada* con los valores que existían cuando
se creó. Si leyera `useState` vería el valor viejo, normalmente `null`.
Por eso van en `rutaRef.current` y `tokenRef.current`.

**El punto se dibuja antes de enviarse.** En el callback del GPS primero
se agrega al mapa y después se hace la petición. Así la línea nunca se
congela aunque falle la red.

**Se suelta el GPS al pausar.** Estando quieto la señal "baila" unos
metros, y esa deriva se sumaría como distancia que nunca caminaste: en
una parada de 40 minutos pueden ser cientos de metros. Además ahorra
batería.

**Hay que soltar el GPS al salir de la pantalla.** El `useEffect`
devuelve `soltarGPS()`. Sin eso, el GPS sigue leyendo para siempre.

---

## Limitación importante de Expo Go

Expo Go **no puede leer la ubicación en segundo plano** — con la
pantalla bloqueada y el teléfono en el bolsillo, que es justo el
escenario real de esta app.

No es un problema del código. Hace falta un *development build* con EAS
(gratuito). El código no cambia, solo la forma de ejecutarlo. Está
pendiente.

---

## Cómo trabajamos

**Antes de escribir código, siempre:**

```bash
git pull
```

1. **No editar el mismo archivo al mismo tiempo.** Repartirse por
   pantallas y avisar antes de meter mano en algo del otro.
2. **Cada uno en su rama.** Nunca commitear directo a `main`.
   ```bash
   git switch -c nombre-de-lo-que-haces
   ```
3. **Unir a `main` solo cuando esté probado en un teléfono real.**
4. **Mensajes de commit que digan qué cambió.**

---

## Más documentación

- **`PROGRESO.md`** (en el repositorio del servidor) — la bitácora
  completa del proyecto. **Empieza por ahí.**
- **Boceto de las 12 pantallas** —
  https://claude.ai/code/artifact/004b123e-59a6-41aa-ad05-1f1961e7a9ad
