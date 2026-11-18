import { useState, useEffect } from 'react';
import {
  View, Text, Pressable, StyleSheet, TextInput, ActivityIndicator, Dimensions,
} from 'react-native';
import { Marker } from 'react-native-maps';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { pedir } from '../api';
import { C, g } from '../estilos';
import Hoja from './Hoja';

/**
 * Puntos de interes en el mapa de la pestaña Ruta.
 *
 *   - Mantener pulsado el mapa abre "Mostrar punto de interes", para
 *     compartir ese lugar con un comentario en los grupos donde se es
 *     propietario (HojaCompartirPunto).
 *   - Los puntos recibidos se dibujan en azul celeste con la inicial de
 *     quien los compartio (MarcadoresInteres).
 *   - Mantener pulsado un punto (o tocar su globo) abre su menu:
 *     convertir en permanente o eliminar (HojaPunto).
 *
 * Vive aparte de Montanista.js porque funciona igual antes de salir y
 * durante una ruta: Montanista solo le pasa el mapa que este a la vista.
 */

// Con el mapa mas alejado que esto (grados de latitud a lo alto de la
// pantalla), los comentarios no se dibujan: solo el punto celeste. Un
// comentario largo tapa calles justo cuando se esta mirando la ruta. A
// 0.003 la pantalla abarca unos 300 m, casi el zoom maximo de una
// calle: ahi ya se esta mirando el punto a proposito. Tocarlo muestra el
// comentario con cualquier zoom.
export const ZOOM_ETIQUETAS = 0.003;

// Cuanto puede errar el dedo al mantener pulsado un punto, en pixeles.
// MapView no avisa de pulsaciones largas sobre un marcador: llega la
// pulsacion larga del mapa con su coordenada, y se busca si habia un
// punto debajo.
const TOLERANCIA_PX = 32;

/**
 * El punto de interes que quedo debajo del dedo, o null.
 * Compara en pixeles de pantalla y no en metros: un punto se toca igual
 * de facil con el mapa lejos o cerca.
 */
export function puntoBajoElDedo(puntos, coordenada, region) {
  if (!region || !coordenada) return null;
  const { width, height } = Dimensions.get('window');
  let mejor = null;
  let mejorDistancia = TOLERANCIA_PX;
  for (const p of puntos) {
    const dx = ((p.lon - coordenada.longitude) / region.longitudeDelta) * width;
    const dy = ((p.lat - coordenada.latitude) / region.latitudeDelta) * height;
    const distancia = Math.hypot(dx, dy);
    if (distancia <= mejorDistancia) { mejor = p; mejorDistancia = distancia; }
  }
  return mejor;
}

/** "vence en 5 h" para los temporales. */
function venceEn(p) {
  if (p.permanente || !p.vence) return 'Permanente';
  const horas = Math.max(0, Math.round((new Date(p.vence).getTime() - Date.now()) / 3600000));
  return horas < 1 ? 'Temporal: se borra en menos de 1 h' : `Temporal: se borra en ${horas} h`;
}

/**
 * Los puntos, para ir dentro de un <MapView>.
 *
 * @param {number} zoom - latitudeDelta actual del mapa
 * @param {number|null} destacado - id del punto que se acaba de recibir:
 *   muestra su comentario aunque el mapa este lejos
 */
export function MarcadoresInteres({ puntos, zoom, destacado, onAbrir }) {
  const conEtiquetas = zoom !== null && zoom <= ZOOM_ETIQUETAS;

  // flatMap + filter: cada punto aporta uno o dos marcadores (el punto
  // y, si corresponde, su comentario), todos con su propia key.
  return puntos.flatMap((p) => {
    const coordenada = { latitude: p.lat, longitude: p.lon };
    const etiqueta = conEtiquetas || p.id === destacado;
    const inicial = (p.de?.nombre || '?').charAt(0).toUpperCase();

    return [
      <Marker
        key={`p${p.id}`}
        coordinate={coordenada}
        anchor={{ x: 0.5, y: 0.5 }}
        // El globo del sistema muestra el comentario al tocar el punto,
        // con cualquier zoom. Tocar el globo abre el menu del punto.
        title={p.texto}
        description={`De ${p.de?.nombre || 'alguien'} · ${venceEn(p)}`}
        onCalloutPress={() => onAbrir(p)}
      >
        {/* La "marca" de quien lo compartio: su inicial. */}
        <View style={[e.punto, p.permanente && e.puntoPermanente]}>
          <Text style={e.inicial}>{inicial}</Text>
        </View>
      </Marker>,
      // El comentario va en un marcador aparte, colgando debajo del
      // punto (anchor y = 0: la coordenada queda en su borde de arriba).
      // Asi el punto no se corre de lugar cuando aparece o desaparece.
      etiqueta && (
        <Marker
          key={`e${p.id}`}
          coordinate={coordenada}
          anchor={{ x: 0.5, y: 0 }}
          onPress={() => onAbrir(p)}
        >
          <View style={e.etiqueta}>
            <Text style={e.textoEtiqueta} numberOfLines={3}>{p.texto}</Text>
          </View>
        </Marker>
      ),
    ].filter(Boolean);
  });
}

/**
 * Mantener pulsado el mapa: primero el aviso "Mostrar punto de
 * interes", despues a que grupos y con que comentario.
 *
 * @param {{latitude, longitude}|null} coordenada - null = cerrada
 * @param {Array} grupos - los grupos de la persona (con su role)
 */
export function HojaCompartirPunto({ coordenada, grupos, token, onCerrar, onCompartido }) {
  const [paso, setPaso] = useState('opcion');   // 'opcion' | 'formulario'
  const [elegidos, setElegidos] = useState([]);
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');

  // Solo los grupos donde es propietario: el servidor rechaza el resto.
  const propios = grupos.filter((gr) => gr.role === 'owner');

  // Cada pulsacion empieza de cero. Con un solo grupo, viene marcado.
  useEffect(() => {
    if (!coordenada) return;
    setPaso('opcion');
    setTexto('');
    setError('');
    setElegidos(propios.length === 1 ? [propios[0].id] : []);
  }, [coordenada]);

  function alternar(id) {
    setElegidos((a) => (a.includes(id) ? a.filter((x) => x !== id) : [...a, id]));
  }

  async function enviar() {
    const limpio = texto.trim();
    if (elegidos.length === 0) return setError('Elige al menos un grupo');
    if (!limpio) return setError('Escribe qué hay en este punto');

    setError('');
    setEnviando(true);
    const fallidos = [];
    for (const id of elegidos) {
      const { ok, sinRed } = await pedir(`/api/groups/${id}/points`, {
        metodo: 'POST', token,
        cuerpo: { lat: coordenada.latitude, lon: coordenada.longitude, texto: limpio },
      });
      if (!ok || sinRed) fallidos.push(id);
    }
    setEnviando(false);

    const nombre = (id) => propios.find((gr) => gr.id === id)?.name || 'un grupo';
    if (fallidos.length === elegidos.length) {
      return setError('No se pudo compartir el punto. Revisa tu conexión.');
    }
    if (fallidos.length > 0) {
      // Los que salieron, salieron: se dice cuales no para no reenviar
      // el punto dos veces a los que si.
      setElegidos(fallidos);
      return setError(`No llegó a: ${fallidos.map(nombre).join(', ')}. Toca Enviar para reintentar.`);
    }

    onCompartido(`Punto compartido en ${elegidos.map(nombre).join(', ')}.`);
  }

  return (
    <Hoja visible={Boolean(coordenada)} onCerrar={enviando ? () => {} : onCerrar}>
      {paso === 'opcion' && (
        <>
          <Pressable style={e.opcion} onPress={() => setPaso('formulario')}>
            <MaterialIcons name="add-location-alt" size={22} color={C.interes} />
            <Text style={[e.textoOpcion, { color: C.interes }]}>Mostrar punto de interés</Text>
          </Pressable>
          <Pressable style={g.botonSecundario} onPress={onCerrar}>
            <Text style={g.textoSecundario}>Cancelar</Text>
          </Pressable>
        </>
      )}

      {paso === 'formulario' && (
        <>
          <Text style={e.titulo}>Punto de interés</Text>

          {propios.length === 0 ? (
            <>
              <Text style={e.pista}>
                Solo puedes compartir puntos en los grupos donde eres propietario,
                y todavía no lo eres en ninguno.
              </Text>
              <Pressable style={g.botonSecundario} onPress={onCerrar}>
                <Text style={g.textoSecundario}>Cerrar</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={g.etiqueta}>COMPARTIR EN</Text>
              <View style={e.grupos}>
                {propios.map((gr) => {
                  const activo = elegidos.includes(gr.id);
                  return (
                    <Pressable
                      key={gr.id}
                      style={activo ? e.grupoActivo : e.grupo}
                      onPress={() => alternar(gr.id)}
                      disabled={enviando}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: activo }}
                    >
                      <Text style={activo ? e.textoGrupoActivo : e.textoGrupo}>{gr.name}</Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={g.etiqueta}>¿QUÉ HAY AQUÍ?</Text>
              <TextInput
                style={g.input}
                value={texto}
                onChangeText={setTexto}
                placeholder="Excelente mirador en el cerro"
                placeholderTextColor={C.placeholder}
                maxLength={140}
                editable={!enviando}
                autoFocus
                returnKeyType="send"
                onSubmitEditing={enviar}
              />

              {error !== '' && <Text style={g.error}>{error}</Text>}

              <Pressable
                style={[e.botonCeleste, enviando && g.opaco]}
                onPress={enviar}
                disabled={enviando}
              >
                {enviando
                  ? <ActivityIndicator color={C.fondo} />
                  : <Text style={e.textoBotonCeleste}>Enviar al grupo</Text>}
              </Pressable>
              <Pressable style={g.botonSecundario} onPress={onCerrar} disabled={enviando}>
                <Text style={g.textoSecundario}>Cancelar</Text>
              </Pressable>
            </>
          )}
        </>
      )}
    </Hoja>
  );
}

/**
 * El menu de un punto recibido: convertir en permanente, eliminar.
 * Eliminar no pide confirmacion: borra solo la copia de esta persona, y
 * el punto sigue en el chat para volver a recibirlo.
 *
 * @param {object|null} punto - null = cerrada
 */
export function HojaPunto({ punto, token, onCerrar, onCambio }) {
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { setError(''); }, [punto?.id]);

  async function accion(metodo, cuerpo) {
    setError('');
    setOcupado(true);
    const { ok, datos, sinRed } = await pedir(`/api/points/${punto.id}`, { metodo, token, cuerpo });
    setOcupado(false);
    if (sinRed) return setError('No hay conexión con el servidor');
    if (!ok) return setError(datos?.error || 'No se pudo cambiar el punto');
    onCambio(metodo === 'DELETE' ? { eliminado: punto.id } : { punto: datos.punto });
  }

  return (
    <Hoja visible={Boolean(punto)} onCerrar={ocupado ? () => {} : onCerrar}>
      {punto && (
        <>
          <Text style={e.titulo}>{punto.texto}</Text>
          <Text style={e.pista}>
            Compartido por {punto.de?.nombre || 'alguien'}. {venceEn(punto)}.
          </Text>
          {error !== '' && <Text style={g.error}>{error}</Text>}

          {!punto.permanente && (
            <Pressable
              style={[e.opcion, ocupado && g.opaco]}
              disabled={ocupado}
              onPress={() => accion('PATCH', { permanente: true })}
            >
              <MaterialIcons name="push-pin" size={22} color={C.texto} />
              <Text style={e.textoOpcion}>Convertir en permanente</Text>
              {ocupado && <ActivityIndicator color={C.interes} size="small" />}
            </Pressable>
          )}

          <Pressable
            style={[e.opcion, ocupado && g.opaco]}
            disabled={ocupado}
            onPress={() => accion('DELETE')}
          >
            <MaterialIcons name="delete-outline" size={22} color={C.alerta} />
            <Text style={[e.textoOpcion, { color: C.alerta }]}>Eliminar punto</Text>
          </Pressable>

          <Pressable style={g.botonSecundario} disabled={ocupado} onPress={onCerrar}>
            <Text style={g.textoSecundario}>Cancelar</Text>
          </Pressable>
        </>
      )}
    </Hoja>
  );
}

const e = StyleSheet.create({
  punto: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: C.interes, borderWidth: 2, borderColor: '#FFFFFF',
    alignItems: 'center', justifyContent: 'center',
  },
  // Permanente: borde oscuro, para distinguirlo de un vistazo de los
  // que se van a borrar solos.
  puntoPermanente: { borderColor: C.fondo, borderWidth: 3 },
  inicial: { color: C.fondo, fontSize: 13, fontWeight: '800' },
  etiqueta: {
    marginTop: 18, maxWidth: 180,
    backgroundColor: 'rgba(14,26,33,0.94)', borderWidth: 1, borderColor: C.interes,
    borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4,
  },
  textoEtiqueta: { color: C.interesTexto, fontSize: 12, fontWeight: '600', textAlign: 'center' },

  titulo: { color: C.texto, fontSize: 20, fontWeight: '700' },
  pista: { color: C.tenue, fontSize: 13, lineHeight: 19 },
  opcion: {
    flexDirection: 'row', alignItems: 'center', gap: 12, height: 54,
    paddingHorizontal: 16, borderRadius: 12,
    borderWidth: 1, borderColor: C.borde, backgroundColor: C.superficie,
  },
  textoOpcion: { color: C.texto, fontSize: 16, fontWeight: '600', flex: 1 },
  grupos: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  grupo: {
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999,
    borderWidth: 1, borderColor: C.borde, backgroundColor: C.superficie,
  },
  grupoActivo: {
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999,
    borderWidth: 1, borderColor: C.interes, backgroundColor: 'rgba(90,200,250,0.14)',
  },
  textoGrupo: { color: C.apagado, fontSize: 14, fontWeight: '500' },
  textoGrupoActivo: { color: C.interes, fontSize: 14, fontWeight: '600' },
  botonCeleste: {
    height: 56, borderRadius: 11, backgroundColor: C.interes,
    alignItems: 'center', justifyContent: 'center',
  },
  textoBotonCeleste: { color: C.fondo, fontSize: 17, fontWeight: '700' },
});
