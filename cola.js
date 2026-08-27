import AsyncStorage from '@react-native-async-storage/async-storage';

const CLAVE = 'hikingtrail_cola';
const TAMANO_LOTE = 100;

// Estado del modulo: hay una sola cola en toda la app.
let cola = [];
let enviando = false;

async function guardar() {
  await AsyncStorage.setItem(CLAVE, JSON.stringify(cola));
}

/** Recupera la cola del disco. Llamar al arrancar la app. */
export async function cargarCola() {
  try {
    const guardado = await AsyncStorage.getItem(CLAVE);
    cola = guardado ? JSON.parse(guardado) : [];
  } catch (e) {
    cola = [];
  }
  return cola.length;
}

export function pendientes() {
  return cola.length;
}

/** Guarda un punto en disco ANTES de intentar enviarlo. */
export async function encolar(punto) {
  cola.push(punto);
  await guardar();
  return cola.length;
}

export async function limpiarCola() {
  cola = [];
  await guardar();
}

/**
 * Intenta enviar el lote mas antiguo.
 * Solo saca de la cola lo que el servidor confirmo haber recibido.
 */
export async function vaciarCola({ api, rutaId, token }) {
  if (enviando) return { enviados: 0, pendientes: cola.length };
  if (cola.length === 0) return { enviados: 0, pendientes: 0 };
  if (!rutaId || !token) return { enviados: 0, pendientes: cola.length };

  // Sin esta bandera, dos vaciados simultaneos (uno del GPS y otro
  // del temporizador) mandarian los mismos puntos dos veces.
  enviando = true;
  const lote = cola.slice(0, TAMANO_LOTE);

  try {
    const respuesta = await fetch(`${api}/api/routes/${rutaId}/locations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ puntos: lote }),
    });

    if (respuesta.ok) {
      const datos = await respuesta.json();
      cola = cola.slice(lote.length);
      await guardar();
      return { enviados: datos.guardados ?? lote.length, pendientes: cola.length };
    }

    // 4xx = el servidor rechaza el lote y siempre lo va a rechazar
    // (ruta terminada, token vencido). Guardarlo para siempre solo
    // taparia la cola, asi que se descarta y se avisa.
    if (respuesta.status >= 400 && respuesta.status < 500) {
      cola = cola.slice(lote.length);
      await guardar();
      return { enviados: 0, pendientes: cola.length, rechazados: lote.length };
    }

    // 5xx = problema pasajero del servidor. Se conserva y se reintenta.
    return { enviados: 0, pendientes: cola.length };

  } catch (e) {
    // Sin senal. Los puntos quedan a salvo en disco.
    return { enviados: 0, pendientes: cola.length, sinSenal: true };
  } finally {
    enviando = false;
  }
}