import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import * as Cellular from 'expo-cellular';

/**
 * Lo que la app guarda en el telefono para funcionar SIN DATOS
 * MOVILES, que es justamente cuando mas se necesita.
 *
 * Sin conexion la app no puede preguntarle nada al servidor. Por eso
 * se guardan de antemano:
 *
 *   - La lista de contactos de emergencia (nombre y numero), copiada
 *     cada vez que se carga o se cambia en Ajustes. Es lo unico que
 *     necesita la alerta: ya no pide contrasena (ver ConfirmarAlerta en
 *     pantallas/Ajustes.js).
 *   - Una HUELLA de la contrasena, calculada al iniciar sesion. Nunca
 *     la contrasena misma. La usa el codigo de invitacion de los grupos
 *     (pantallas/Grupos.js), que se destapa con la clave.
 *
 * El SMS lo manda la app de mensajes del telefono, y si no hay red
 * terrestre pero si cobertura satelital (Entel + Starlink), sale por
 * satelite sin que la app tenga que hacer nada distinto.
 */

const CLAVE_CONTACTOS = 'geotrail_contactos_emergencia';
const CLAVE_HUELLA = 'geotrail_huella_clave';

// ---------------- Huella de la contrasena ----------------

async function calcularHuella(sal, password) {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${sal}:${password}`);
}

/**
 * Se llama al iniciar sesion, que es el unico momento en que la app
 * tiene la contrasena en la mano.
 *
 * La sal aleatoria hace que la misma contrasena deje huellas
 * distintas en telefonos distintos: quien saque el dato del telefono
 * no puede compararlo contra una tabla de huellas ya calculadas.
 */
export async function guardarHuellaClave(password) {
  const bytes = Crypto.getRandomBytes(16);
  const sal = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  const huella = await calcularHuella(sal, password);
  await SecureStore.setItemAsync(CLAVE_HUELLA, JSON.stringify({ sal, huella }));
}

/**
 * @returns {Promise<boolean|null>} true/false si se pudo comprobar en
 *   el telefono; null si no hay huella guardada (sesion iniciada antes
 *   de esta version). En ese caso hay que preguntarle al servidor.
 */
export async function verificarClaveLocal(password) {
  const guardado = await SecureStore.getItemAsync(CLAVE_HUELLA);
  if (!guardado) return null;
  const { sal, huella } = JSON.parse(guardado);
  return (await calcularHuella(sal, password)) === huella;
}

// ---------------- Contactos ----------------

/** Guarda en el telefono solo lo que hace falta para mandar el SMS. */
export async function guardarContactosLocal(candidatos) {
  const elegidos = candidatos
    .filter((c) => c.elegido && c.phone)
    .map((c) => ({ id: c.id, name: c.name, phone: c.phone }));
  await AsyncStorage.setItem(CLAVE_CONTACTOS, JSON.stringify(elegidos));
  return elegidos;
}

export async function leerContactosLocal() {
  try {
    const guardado = await AsyncStorage.getItem(CLAVE_CONTACTOS);
    return guardado ? JSON.parse(guardado) : [];
  } catch (e) {
    return [];
  }
}

/** Al cerrar sesion: el proximo que entre en este telefono es otra persona. */
export async function borrarDatosEmergencia() {
  await AsyncStorage.removeItem(CLAVE_CONTACTOS);
  await SecureStore.deleteItemAsync(CLAVE_HUELLA);
}

// ---------------- SMS por satelite ----------------

// Entel Chile: pais 730, red 01 o 10. Es la compañia chilena que ofrece
// SMS por satelite (Starlink) en telefonos compatibles.
const PAIS_CHILE = '730';
const REDES_ENTEL = ['01', '10'];

/**
 * ¿La alerta podria salir por satelite si no hay señal?
 *
 * Mira la compañia del chip. Devuelve:
 *   'entel'        tiene Entel
 *   'otra'         tiene otra compañia (la alerta depende de la señal)
 *   'desconocida'  no se pudo saber: en iPhone el sistema no le dice a
 *                  ninguna app cual es la compañia, y en Android pasa
 *                  sin chip o en modo avion
 *
 * Solo sabe la compañia, no el modelo del telefono: con Entel, el SMS
 * por satelite funciona solo en los modelos que Entel habilita. Por eso
 * el texto de Ajustes dice "si tu telefono es compatible".
 *
 * Nunca lanza: si algo falla, 'desconocida'.
 */
export async function estadoSatelital() {
  try {
    const [pais, red, nombre] = await Promise.all([
      Cellular.getMobileCountryCodeAsync(),
      Cellular.getMobileNetworkCodeAsync(),
      Cellular.getCarrierNameAsync(),
    ]);

    if (pais === PAIS_CHILE && REDES_ENTEL.includes(red)) return 'entel';
    if (nombre && /entel/i.test(nombre)) return 'entel';
    if (pais || red || nombre) return 'otra';
    return 'desconocida';
  } catch (e) {
    return 'desconocida';
  }
}

// ---------------- El mensaje ----------------

/**
 * Arma el texto del SMS.
 *
 * Va SIN tildes ni emojis a proposito. Un SMS con solo caracteres
 * basicos admite 160 por parte; con una sola "á" o un emoji el
 * telefono cambia de codificacion y baja a 70. Por satelite cada
 * parte cuenta, y un mensaje cortado en cuatro trozos puede llegar
 * desordenado o incompleto.
 *
 * @param {object|null} posicion - coords de expo-location, o null
 */
export function armarMensaje({ nombre, nota, posicion, cuando }) {
  const partes = [`SOS GeoTrail: ${sinTildes(nombre)} envio una alerta de emergencia.`];

  if (nota && nota.trim()) partes.push(`"${sinTildes(nota.trim())}"`);

  if (posicion) {
    const lat = posicion.latitude.toFixed(5);
    const lon = posicion.longitude.toFixed(5);
    const precision = posicion.accuracy ? ` +-${Math.round(posicion.accuracy)}m` : '';
    partes.push(`Ubicacion (${hora(cuando)}${precision}): ${lat},${lon}`);
    partes.push(`https://maps.google.com/?q=${lat},${lon}`);
  } else {
    partes.push('Ubicacion no disponible.');
  }

  return partes.join(' ');
}

function sinTildes(texto) {
  // NFD separa "á" en "a" + tilde suelta; el rango quita las tildes.
  return String(texto).normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function hora(fecha) {
  const d = fecha ? new Date(fecha) : new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
