# GeoTrail — Aplicación móvil

App de React Native (Expo SDK 58) para compartir tu ubicación con tu
grupo mientras vas de un lugar a otro, a pie o en auto.

Eliges a dónde vas y con qué grupo compartes. Tu grupo ve en vivo por
dónde vas y por dónde deberías ir, y recibe avisos automáticos en el
chat: si te desvías, si se te apaga la ubicación, si tu teléfono deja de
reportar, si te queda poca batería, cuando llegas o si cancelas el
viaje. Sin datos, el botón de emergencia manda un SMS con tu ubicación
(y por satélite, con Entel y un teléfono compatible).

**El servidor está en otro repositorio:**
https://github.com/AurumChains/HikingTrail-

La app ya viene apuntando al servidor desplegado en Render, así que para
probarla **no hace falta levantar nada en tu computador**.

---

## Instalación

### 1. Requisitos

- **Node.js 18 o superior**
- **Expo Go** en tu teléfono — gratis en App Store o Play Store

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

### 3. Elegir servidor (`config.js`)

```js
// ---- USANDO ----
export const API = NUBE;      // https://hikingtrail-api.onrender.com
// export const API = LOCAL;  // tu computador, para programar el backend
```

- **`NUBE`** (por defecto): funciona desde cualquier red, incluso con
  datos móviles. El plan gratis de Render se duerme tras 15 minutos sin
  uso: **la primera petición puede tardar ~50 s**. Después va normal.
- **`LOCAL`**: el backend corriendo en tu computador. El teléfono y el
  computador tienen que estar en **la misma red WiFi**, y la IP de
  `LOCAL` tiene que ser la de tu máquina (`ipconfig` en Windows → *Dirección
  IPv4*). Tu teléfono no puede usar `localhost`: para él, `localhost` es
  él mismo.

### 4. Levantar

```bash
npx expo start
```

Aparece un código QR:

- **iPhone:** apúntalo con la app de **Cámara** normal
- **Android:** escanéalo desde adentro de **Expo Go**

Para probar entre dos teléfonos, crea dos cuentas desde la app. Usa
correos reales: así también puedes probar *¿Olvidaste tu contraseña?*.

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

## Pantallas

Tres pestañas abajo: **Ruta**, **Grupos** y **Ajustes**.

| Pantalla | Qué hace |
|---|---|
| **Login** | Entrar. Enlace a crear cuenta y a *¿Olvidaste tu contraseña?* |
| **Registro** | Crear cuenta (clave de 6 caracteres o más) |
| **Recuperar clave** | Correo → código de 6 dígitos por mail → clave nueva dos veces. Si sales antes de guardar, no cambia nada |
| **Ruta — antes de salir** | Mapa, destino (tocar el mapa, buscar o un lugar guardado), **a pie / en auto**, con qué grupo compartir |
| **Ruta — en curso** | Recorrido en vivo, camino sugerido, pausa, puntos en cola, **cambio de modo sin terminar**, avisos de desvío |
| **Grupos** | Mis grupos, crear, unirse con código |
| **Grupo — chat** | Mensajes, fotos, avisos automáticos de colores, **puntos de interés** con "Recibir punto de interés" |
| **Grupo — miembros** | Quién está en ruta, código de invitación (solo propietarios), **moderación** |
| **Mapa en vivo** (EnVivo) | La ruta de otro miembro: dónde va, por dónde debería ir, si va a pie o en auto |
| **Ajustes** | Alerta de emergencia por SMS, aviso de Starlink, contactos de emergencia, teléfono, lista de avisos automáticos |

### Grupos: quién manda

- **Dueño original** (corona 👑): quien creó el grupo. Siempre sale
  primero y nadie lo puede eliminar ni quitarle el rango. Si se sale,
  hereda la corona otra persona al azar (primero entre los
  propietarios).
- **Propietario**: ve el código de invitación (con su clave), lo
  renueva, comparte puntos de interés y modera. **Mantener pulsado** a
  otro miembro abre: *Promover a propietario* / *Quitar propietario* /
  *Eliminar del grupo* (con confirmación).
- **Miembro**: ve las rutas compartidas con el grupo y el chat.

### Puntos de interés

- **Mantener pulsado el mapa** (antes o durante una ruta) →
  *Mostrar punto de interés* → elegir grupos donde eres propietario y
  escribir el comentario ("Excelente mirador en el cerro").
- En el chat aparece con el botón **Recibir punto de interés**, que lleva
  al mapa y deja el punto en celeste con la inicial de quien lo
  compartió.
- El comentario solo se ve con mucho zoom o al tocar el punto, para no
  tapar el mapa.
- **Mantener pulsado el punto** → *Convertir en permanente* o *Eliminar
  punto*. Los no permanentes se borran solos a las 24 h.

---

## Estructura

```
App.js              sesión, login/registro/recuperar, pestañas
config.js           a qué servidor se habla (NUBE / LOCAL) y la regla de la clave
api.js              envoltorio de fetch con token
estilos.js          la paleta y los estilos compartidos
cola.js             cola offline de puntos GPS
emergencia.js       contactos y huella de la clave en el teléfono, SMS, Starlink
migracionClaves.js  mueve datos guardados con el nombre viejo de la app
pantallas/
  ├── Login.js
  ├── Registro.js
  ├── RecuperarClave.js
  ├── Montanista.js     la pestaña Ruta: destino, modo, GPS, pausa, fin
  ├── PuntosInteres.js  marcadores celestes y sus hojas (compartir, menú)
  ├── Grupos.js         lista, detalle, miembros y moderación
  ├── ChatGrupo.js      chat, avisos y puntos de interés
  ├── EnVivo.js         la ruta de otro miembro en vivo
  ├── Ajustes.js
  └── Hoja.js           la hoja que sube desde abajo (menús y confirmaciones)
```

Iconos: `@expo/vector-icons` (MaterialIcons y MaterialCommunityIcons).

### `api.js`

Evita repetir la URL, los encabezados y el manejo de errores en cada
llamada:

```js
const { ok, datos, sinRed } = await pedir('/api/routes/start', {
  metodo: 'POST', token, cuerpo: { modo: 'driving', group_id: 3 },
});
```

Nunca lanza excepción por un error HTTP: devuelve `ok: false` y quien
llama decide. `sinRed: true` distingue *"el servidor dijo que no"* de
*"no hay internet"*, que son problemas distintos.

### `estilos.js`

La paleta vive en el objeto `C`. Los colores tienen significado y se
repiten en toda la app:

| Color | Uso |
|---|---|
| ámbar `acento` | acción principal, avisos amarillos |
| rojo `alerta` | emergencia, avisos rojos |
| verde `exito` | avisos verdes (llegó, cambió de transporte) |
| verde neón `ruta` | el camino sugerido en el mapa |
| celeste `interes` | puntos de interés |

### `cola.js`

Resuelve el escenario central: **quedarse sin señal**.

Cada punto GPS **se guarda en el disco del teléfono antes de intentar
enviarlo**. Ese orden es todo el truco. Si no hay red, el punto queda a
salvo; se reintenta cada 15 segundos y se vacía antes de terminar la
ruta. Sobrevive incluso a cerrar la app por completo.

### `emergencia.js`

Todo lo que la alerta de emergencia necesita **sin datos**: la lista de
contactos guardada en el teléfono y el armado del SMS (sin tildes, para
que quepa en menos partes). La alerta **no pide contraseña**: en una
emergencia puede no haber cómo escribirla.

`estadoSatelital()` mira la compañía del chip para el aviso bajo el
botón: Entel (Chile 730, redes 01 y 10) ofrece SMS por satélite
(Starlink) en teléfonos compatibles. **En iPhone no se puede saber la
compañía**: el sistema no se la entrega a ninguna app, así que ahí sale
el mensaje genérico.

---

## Detalles del código que cuestan de descubrir

**`useRef` para el id de ruta, el token y el modo.** La función que
recibe los puntos del GPS se queda *congelada* con los valores que
existían cuando se creó. Si leyera `useState` vería el valor viejo. Por
eso van en `rutaRef`, `tokenRef` y `modoRef`.

**El punto se dibuja antes de enviarse.** En el callback del GPS primero
se agrega al mapa y después se hace la petición. Así la línea nunca se
congela aunque falle la red.

**El GPS depende del modo.** Un punto cada 6 m a pie y cada 15 m en
auto. Al cambiar de modo en plena ruta se suelta y se vuelve a encender
con la distancia nueva.

**Se suelta el GPS al pausar.** Estando quieto la señal "baila" unos
metros, y esa deriva se sumaría como distancia que nunca recorriste.
Queda un GPS de bajo consumo que reanuda solo si te alejas 60 m.

**La pestaña Ruta nunca se desmonta.** `App.js` solo la oculta al cambiar
de pestaña. Desmontarla soltaría el GPS y cortaría la ruta en curso.

**Pulsación larga sobre un punto de interés.** `react-native-maps` no
avisa pulsaciones largas sobre un marcador: llega la del mapa con su
coordenada, y `puntoBajoElDedo()` busca si había un punto a menos de
32 px.

---

## Limitación importante de Expo Go

Expo Go **no puede leer la ubicación en segundo plano** — con la
pantalla bloqueada y el teléfono en el bolsillo, que es justo el
escenario real de esta app.

No es un problema del código. Hace falta un *development build* con EAS
(gratuito). El código no cambia, solo la forma de ejecutarlo. En ese
build, Android pide el permiso `READ_PHONE_STATE` (ya está en
`app.json`) para leer la compañía del chip.

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
4. **Si un cambio de la app necesita algo nuevo del servidor**, se suben
   juntos (y la base va primero, ver el README del servidor).
5. **Mensajes de commit que digan qué cambió.**

---

## Más documentación

- **README del servidor** — endpoints, avisos automáticos, base de datos
  y despliegue: https://github.com/AurumChains/HikingTrail-
- **`PROGRESO.md`** (en el repositorio del servidor) — bitácora
  histórica del proyecto.
- **Boceto original de las pantallas** —
  https://claude.ai/code/artifact/004b123e-59a6-41aa-ad05-1f1961e7a9ad
