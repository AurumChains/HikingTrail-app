import { API } from './config';

/**
 * Envoltorio de fetch para hablar con el backend.
 *
 * Antes cada llamada repetia la URL, las cabeceras, el JSON.stringify
 * y el manejo de errores. Ahora se escribe asi:
 *
 *   const { ok, datos } = await pedir('/api/routes/start', {
 *     metodo: 'POST', token, cuerpo: { name: 'Cerro' },
 *   });
 *
 * Nunca lanza excepcion por un error HTTP: devuelve `ok: false` y
 * quien llama decide que hacer. Si no hay red, devuelve `sinRed: true`.
 */
export async function pedir(ruta, { metodo = 'GET', token, cuerpo } = {}) {
  const opciones = { method: metodo, headers: {} };

  if (token) {
    opciones.headers.Authorization = `Bearer ${token}`;
  }
  if (cuerpo !== undefined) {
    opciones.headers['Content-Type'] = 'application/json';
    opciones.body = JSON.stringify(cuerpo);
  }

  try {
    const respuesta = await fetch(`${API}${ruta}`, opciones);

    let datos = null;
    try {
      datos = await respuesta.json();
    } catch (e) {
      // Respuesta sin cuerpo JSON: no es un problema.
    }

    return { ok: respuesta.ok, status: respuesta.status, datos };
  } catch (e) {
    return { ok: false, status: 0, datos: null, sinRed: true };
  }
}
