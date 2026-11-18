// ==========================================================
// A que servidor le habla la app
//
// Para cambiar de uno a otro, mueve el comentario de la linea
// USANDO. Solo una debe quedar activa.
// ==========================================================

// Servidor desplegado. Funciona desde cualquier red, incluso con
// datos moviles, y es el que se usa para mostrar la app.
// Ojo: el plan gratuito de Render duerme tras 15 min sin uso, asi
// que la primera peticion puede tardar unos 50 segundos.
// La direccion conserva el nombre viejo (HikingTrail) porque es el
// nombre del servicio en Render: cambiarlo ahi cambia la URL.
const NUBE = 'https://hikingtrail-api.onrender.com';

// Servidor en tu computador. Responde al instante, ideal para
// programar. Exige que el celular este en la MISMA red WiFi, y hay
// que actualizar la IP cuando el router la cambia (ipconfig).
const LOCAL = 'http://192.168.1.3:3001';

// ---- USANDO ----
export const API = NUBE;
// export const API = LOCAL;

export const CLAVE_TOKEN = 'geotrail_token';

// Largo minimo de una contraseña. El backend exige lo mismo
// (src/utils/password.js); revisarlo en la app solo evita el viaje al
// servidor para un error que ya se sabe. Lo usan el registro y la
// recuperacion de clave.
export const LARGO_MINIMO_CLAVE = 6;
