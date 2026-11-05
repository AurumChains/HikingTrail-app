import { useState, useEffect, useRef } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet, FlatList, Image, Modal,
  ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { io } from 'socket.io-client';
import { pedir } from '../api';
import { API } from '../config';
import { C, g } from '../estilos';

// Lado mayor de las fotos que se suben. Una foto de celular tiene
// 4000 px o mas y pesa varios MB; a 1280 px se ve bien en cualquier
// pantalla de telefono y pesa ~100-300 KB.
const LADO_MAXIMO = 1280;
const ANCHO_FOTO = 230;

// Fotos ya descargadas, por URL, mientras la app esta abierta. Una
// foto del chat nunca cambia, asi que no hace falta volver a pedirla
// al hacer scroll, al abrirla en grande ni al reabrir el chat.
const fotosEnMemoria = new Map();

/**
 * Descarga una foto del chat con la sesion y la devuelve como data URI.
 *
 * POR QUE NO <Image source={{ uri, headers }}> DIRECTO: asi las fotos
 * salian negras (el recuadro vacio, sin imagen). El servidor las tiene
 * bien guardadas y las entrega bien con el token, pero sin el token
 * responde 401, y el <Image> nativo no siempre manda la cabecera
 * Authorization: depende de la plataforma y de la cache de imagenes. Y
 * cuando falla no avisa, solo queda el fondo oscuro.
 * fetch() manda la cabecera siempre, es lo mismo que usa el resto de
 * la API, y si falla deja ver el motivo.
 */
async function descargarFoto(url, token) {
  if (fotosEnMemoria.has(url)) return fotosEnMemoria.get(url);

  const respuesta = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);

  const blob = await respuesta.blob();
  const dataUri = await new Promise((resolver, rechazar) => {
    const lector = new FileReader();
    lector.onload = () => resolver(lector.result);
    lector.onerror = () => rechazar(lector.error);
    lector.readAsDataURL(blob);
  });

  fotosEnMemoria.set(url, dataUri);
  return dataUri;
}

/**
 * Una foto del chat. Mientras baja muestra un indicador; si falla, un
 * aviso que se puede tocar para reintentar, en vez de un recuadro negro
 * que parece una foto oscura.
 */
function FotoChat({ url, token, style, resizeMode, onPress }) {
  const [uri, setUri] = useState(fotosEnMemoria.get(url) || null);
  const [fallo, setFallo] = useState(false);
  const [intento, setIntento] = useState(0);

  useEffect(() => {
    if (uri) return;
    let vigente = true;
    setFallo(false);
    descargarFoto(url, token)
      .then((d) => { if (vigente) setUri(d); })
      .catch(() => { if (vigente) setFallo(true); });
    return () => { vigente = false; };
  }, [url, intento]);

  if (uri) {
    const imagen = <Image source={{ uri }} style={style} resizeMode={resizeMode} />;
    return onPress ? <Pressable onPress={onPress}>{imagen}</Pressable> : imagen;
  }

  return (
    <Pressable
      style={[style, e.fotoCargando]}
      onPress={fallo ? () => setIntento((n) => n + 1) : undefined}
      disabled={!fallo}
    >
      {fallo
        ? <Text style={e.fotoFallo}>No se pudo cargar la foto.{'\n'}Toca para reintentar.</Text>
        : <ActivityIndicator color={C.acento} />}
    </Pressable>
  );
}

/**
 * Chat de un grupo: historial por HTTP, mensajes nuevos por socket.
 *
 * La lista va INVERTIDA (lo mas nuevo abajo, pegado al teclado) y por
 * eso `mensajes` se guarda del mas nuevo al mas viejo, en el mismo
 * orden en que los entrega el backend.
 */
export default function ChatGrupo({ token, usuario, grupoId }) {
  const [mensajes, setMensajes] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [cargandoMas, setCargandoMas] = useState(false);
  const [hayMas, setHayMas] = useState(false);
  const [error, setError] = useState('');

  const [texto, setTexto] = useState('');
  const [fotoPendiente, setFotoPendiente] = useState(null);
  const [preparandoFoto, setPreparandoFoto] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [fotoAbierta, setFotoAbierta] = useState(null);

  const socketRef = useRef(null);

  useEffect(() => {
    cargar();
    conectarSocket();
    return () => desconectar();
  }, [grupoId]);

  /**
   * Junta mensajes nuevos con los que ya hay, sin repetir.
   *
   * Un mismo mensaje puede llegar dos veces: quien lo envia lo recibe
   * en la respuesta del POST y tambien por el socket. Y al reconectar
   * se vuelve a pedir la ultima pagina. El id decide.
   */
  function juntar(nuevos) {
    setMensajes((actuales) => {
      const porId = new Map(actuales.map((m) => [m.id, m]));
      for (const m of nuevos) porId.set(m.id, m);
      return [...porId.values()].sort((a, b) => b.id - a.id);
    });
  }

  async function cargar() {
    const { ok, datos, sinRed } = await pedir(`/api/groups/${grupoId}/messages`, { token });
    setCargando(false);

    if (sinRed) return setError('No hay conexión con el servidor');
    if (!ok) return setError(datos?.error || 'No se pudo cargar el chat');

    setError('');
    juntar(datos.mensajes || []);
    setHayMas(Boolean(datos.hay_mas));
  }

  async function cargarAnteriores() {
    if (!hayMas || cargandoMas || mensajes.length === 0) return;

    setCargandoMas(true);
    const masViejo = mensajes[mensajes.length - 1].id;
    const { ok, datos } = await pedir(
      `/api/groups/${grupoId}/messages?antes_de=${masViejo}`, { token }
    );
    setCargandoMas(false);

    if (!ok) return;
    juntar(datos.mensajes || []);
    setHayMas(Boolean(datos.hay_mas));
  }

  function conectarSocket() {
    const socket = io(API, { auth: { token }, transports: ['websocket'] });
    socketRef.current = socket;

    // 'connect' se dispara tambien al RECONECTAR. Se vuelve a entrar a
    // la sala y se pide la ultima pagina: lo que llego mientras no
    // habia conexion no se pierde.
    socket.on('connect', () => {
      socket.emit('unirse_grupo', String(grupoId), (r) => {
        if (r && !r.ok) setError(r.error || 'No se pudo abrir el chat');
      });
      cargar();
    });

    socket.on('nuevo_mensaje', (m) => {
      if (String(m.group_id) === String(grupoId)) juntar([m]);
    });
  }

  function desconectar() {
    if (socketRef.current) {
      socketRef.current.emit('dejar_grupo', String(grupoId));
      socketRef.current.disconnect();
      socketRef.current = null;
    }
  }

  // ---------------- Fotos ----------------

  async function elegirFoto(origen) {
    setError('');

    let resultado;
    if (origen === 'camara') {
      const permiso = await ImagePicker.requestCameraPermissionsAsync();
      if (!permiso.granted) return setError('Necesito permiso para usar la cámara');
      resultado = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 });
    } else {
      // La galeria del sistema no pide permiso: la persona elige una
      // foto y la app solo recibe esa, no acceso a todo el carrete.
      resultado = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
    }

    if (resultado.canceled || !resultado.assets?.length) return;

    setPreparandoFoto(true);
    try {
      setFotoPendiente(await comprimir(resultado.assets[0]));
    } catch (e) {
      setError('No se pudo preparar la foto');
    } finally {
      setPreparandoFoto(false);
    }
  }

  /** Achica y recomprime la foto antes de subirla. */
  async function comprimir(foto) {
    const contexto = ImageManipulator.manipulate(foto.uri);

    if (Math.max(foto.width, foto.height) > LADO_MAXIMO) {
      contexto.resize(
        foto.width >= foto.height ? { width: LADO_MAXIMO } : { height: LADO_MAXIMO }
      );
    }

    const imagen = await contexto.renderAsync();
    const guardada = await imagen.saveAsync({
      compress: 0.6,
      format: SaveFormat.JPEG,
      base64: true,
    });

    return {
      uri: guardada.uri,
      base64: guardada.base64,
      width: guardada.width,
      height: guardada.height,
    };
  }

  // ---------------- Enviar ----------------

  async function enviar() {
    const limpio = texto.trim();
    if ((!limpio && !fotoPendiente) || enviando) return;

    setError('');
    setEnviando(true);

    const { ok, datos, sinRed } = await pedir(`/api/groups/${grupoId}/messages`, {
      metodo: 'POST',
      token,
      cuerpo: {
        texto: limpio || undefined,
        imagen: fotoPendiente
          ? {
              base64: fotoPendiente.base64,
              mime: 'image/jpeg',
              width: fotoPendiente.width,
              height: fotoPendiente.height,
            }
          : undefined,
      },
    });

    setEnviando(false);

    // Si falla, el texto y la foto se quedan donde estaban: perder lo
    // que la persona escribio por un corte de red seria peor que el
    // error mismo.
    if (sinRed) return setError('Sin conexión: el mensaje no se envió');
    if (!ok) return setError(datos?.error || 'No se pudo enviar el mensaje');

    setTexto('');
    setFotoPendiente(null);
    juntar([datos.mensaje]);
  }

  // ---------------- Pantalla ----------------

  // La imagen pide sesion, igual que el resto de la API: el token va
  // en la cabecera (ver descargarFoto), no en la URL, para que no
  // quede en ningun log.
  function urlImagen(imagen) {
    return `${API}${imagen.url}`;
  }

  function renderMensaje({ item: m, index }) {
    if (m.tipo === 'alerta') return <Aviso mensaje={m} />;

    const mio = m.user_id === usuario.id;

    // El nombre del autor solo se repite cuando cambia quien habla,
    // como en cualquier chat. La lista esta invertida: el mensaje
    // "anterior" en pantalla es el siguiente del arreglo. Un aviso en
    // medio corta la seguidilla, asi que despues se repite el nombre.
    const anterior = mensajes[index + 1];
    const mostrarAutor = !mio &&
      (!anterior || anterior.tipo === 'alerta' || anterior.user_id !== m.user_id);

    const alto = m.imagen?.width && m.imagen?.height
      ? Math.round((ANCHO_FOTO * m.imagen.height) / m.imagen.width)
      : ANCHO_FOTO;

    return (
      <View style={[e.fila, mio ? e.filaMia : e.filaOtra]}>
        <View style={[e.burbuja, mio ? e.burbujaMia : e.burbujaOtra]}>
          {mostrarAutor && <Text style={e.autor}>{m.autor}</Text>}

          {m.imagen && (
            <FotoChat
              url={urlImagen(m.imagen)}
              token={token}
              style={[e.foto, { height: Math.min(alto, 320) }]}
              resizeMode="cover"
              onPress={() => setFotoAbierta(m.imagen)}
            />
          )}

          {m.texto ? (
            <Text style={mio ? e.textoMio : e.textoOtro}>{m.texto}</Text>
          ) : null}

          <Text style={mio ? e.horaMia : e.hora}>{formatoHora(m.created_at)}</Text>
        </View>
      </View>
    );
  }

  if (cargando) {
    return (
      <View style={e.centro}>
        <ActivityIndicator color={C.acento} />
      </View>
    );
  }

  const puedeEnviar = (texto.trim() !== '' || fotoPendiente) && !enviando && !preparandoFoto;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <FlatList
        data={mensajes}
        keyExtractor={(m) => String(m.id)}
        renderItem={renderMensaje}
        inverted
        contentContainerStyle={e.lista}
        onEndReached={cargarAnteriores}
        onEndReachedThreshold={0.3}
        keyboardShouldPersistTaps="handled"
        ListFooterComponent={
          cargandoMas ? <ActivityIndicator color={C.acento} style={{ margin: 12 }} /> : null
        }
        // En una lista invertida el "vacio" tambien sale de cabeza:
        // se endereza con el mismo truco.
        ListEmptyComponent={
          <View style={[e.vacio, { transform: [{ scaleY: -1 }] }]}>
            <Text style={g.subtexto}>Todavía no hay mensajes.</Text>
            <Text style={e.pista}>Escribe el primero o comparte una foto.</Text>
          </View>
        }
      />

      {error !== '' && <Text style={[g.error, e.error]}>{error}</Text>}

      {(fotoPendiente || preparandoFoto) && (
        <View style={e.previa}>
          {preparandoFoto ? (
            <ActivityIndicator color={C.acento} />
          ) : (
            <Image source={{ uri: fotoPendiente.uri }} style={e.previaFoto} />
          )}
          <Text style={[g.subtexto, { flex: 1 }]}>
            {preparandoFoto ? 'Preparando foto…' : 'Foto lista para enviar'}
          </Text>
          {!preparandoFoto && (
            <Pressable onPress={() => setFotoPendiente(null)} hitSlop={10}>
              <Text style={e.quitar}>Quitar</Text>
            </Pressable>
          )}
        </View>
      )}

      <View style={e.barraEscribir}>
        <Pressable
          style={e.botonIcono}
          onPress={() => elegirFoto('galeria')}
          disabled={enviando || preparandoFoto}
          accessibilityLabel="Elegir foto de la galería"
        >
          <Text style={e.icono}>🖼</Text>
        </Pressable>
        <Pressable
          style={e.botonIcono}
          onPress={() => elegirFoto('camara')}
          disabled={enviando || preparandoFoto}
          accessibilityLabel="Tomar foto"
        >
          <Text style={e.icono}>📷</Text>
        </Pressable>

        <TextInput
          style={e.input}
          value={texto}
          onChangeText={setTexto}
          placeholder="Escribe un mensaje"
          placeholderTextColor={C.placeholder}
          multiline
          maxLength={2000}
        />

        <Pressable
          style={[e.botonEnviar, !puedeEnviar && g.opaco]}
          onPress={enviar}
          disabled={!puedeEnviar}
        >
          {enviando
            ? <ActivityIndicator color={C.acentoTexto} size="small" />
            : <Text style={e.textoEnviar}>Enviar</Text>}
        </Pressable>
      </View>

      {/* Foto a pantalla completa. Tocar en cualquier parte la cierra. */}
      <Modal
        visible={Boolean(fotoAbierta)}
        transparent
        animationType="fade"
        onRequestClose={() => setFotoAbierta(null)}
      >
        <Pressable style={e.visor} onPress={() => setFotoAbierta(null)}>
          {fotoAbierta && (
            <FotoChat
              url={urlImagen(fotoAbierta)}
              token={token}
              style={e.visorFoto}
              resizeMode="contain"
            />
          )}
        </Pressable>
      </Modal>
    </KeyboardAvoidingView>
  );
}

// Titulo corto de cada aviso. El detalle viene en el texto que arma
// el servidor; esto es lo que se lee de un vistazo.
const TITULOS_AVISO = {
  location_off: 'Ubicación desactivada',
  location_on: 'Ubicación reactivada',
  no_reports: 'Sin reportes del teléfono',
  reports_back: 'El teléfono volvió a reportar',
  battery_low: 'Batería baja',
  off_route: 'Desvío del camino',
};

/**
 * Aviso automatico de seguridad. No es una burbuja: va centrado y a
 * todo el ancho, en rojo o amarillo, para que nunca se confunda con
 * algo que escribio una persona.
 */
function Aviso({ mensaje }) {
  const rojo = mensaje.alerta?.nivel === 'rojo';
  const titulo = TITULOS_AVISO[mensaje.alerta?.tipo] || 'Aviso de seguridad';

  return (
    <View style={[e.aviso, rojo ? e.avisoRojo : e.avisoAmarillo]}>
      <Text style={[e.avisoTitulo, rojo ? e.avisoTituloRojo : e.avisoTituloAmarillo]}>
        ⚠ {titulo.toUpperCase()}
      </Text>
      <Text style={rojo ? e.avisoTextoRojo : e.avisoTextoAmarillo}>{mensaje.texto}</Text>
      <Text style={e.avisoHora}>{formatoHora(mensaje.created_at)}</Text>
    </View>
  );
}

function formatoHora(fecha) {
  const d = new Date(fecha);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');

  const hoy = new Date();
  const esHoy = d.toDateString() === hoy.toDateString();
  if (esHoy) return `${hh}:${mm}`;

  const dia = String(d.getDate()).padStart(2, '0');
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  return `${dia}/${mes} ${hh}:${mm}`;
}

const e = StyleSheet.create({
  centro: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  lista: { paddingHorizontal: 14, paddingVertical: 12, gap: 6, flexGrow: 1 },
  vacio: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6, padding: 24 },
  pista: { color: C.tenue, fontSize: 13 },
  error: { paddingHorizontal: 16, paddingBottom: 6 },

  fila: { flexDirection: 'row' },
  filaMia: { justifyContent: 'flex-end' },
  filaOtra: { justifyContent: 'flex-start' },

  burbuja: { maxWidth: '82%', borderRadius: 14, padding: 10, gap: 4 },
  burbujaMia: { backgroundColor: C.acento, borderBottomRightRadius: 4 },
  burbujaOtra: {
    backgroundColor: C.superficie, borderWidth: 1, borderColor: C.borde,
    borderBottomLeftRadius: 4,
  },

  autor: { color: C.acento, fontSize: 13, fontWeight: '600' },
  textoMio: { color: C.acentoTexto, fontSize: 16, lineHeight: 21 },
  textoOtro: { color: C.texto, fontSize: 16, lineHeight: 21 },
  hora: { color: C.tenue, fontSize: 11, alignSelf: 'flex-end' },
  horaMia: { color: 'rgba(20,16,10,0.6)', fontSize: 11, alignSelf: 'flex-end' },

  foto: { width: ANCHO_FOTO, borderRadius: 10, backgroundColor: C.superficie2 },
  fotoCargando: { alignItems: 'center', justifyContent: 'center', padding: 12 },
  fotoFallo: { color: C.apagado, fontSize: 13, textAlign: 'center', lineHeight: 19 },

  aviso: {
    alignSelf: 'stretch', marginVertical: 4, marginHorizontal: 8,
    borderWidth: 1, borderRadius: 12, padding: 12, gap: 4,
  },
  avisoRojo: { backgroundColor: C.alertaFondo, borderColor: C.alerta },
  avisoAmarillo: { backgroundColor: '#1E1A10', borderColor: C.acento },
  avisoTitulo: { fontSize: 12, fontWeight: '700', letterSpacing: 0.8 },
  avisoTituloRojo: { color: C.alerta },
  avisoTituloAmarillo: { color: C.acento },
  avisoTextoRojo: { color: C.alertaTexto, fontSize: 15, lineHeight: 20 },
  avisoTextoAmarillo: { color: '#F2CE96', fontSize: 15, lineHeight: 20 },
  avisoHora: { color: C.tenue, fontSize: 11, alignSelf: 'flex-end' },

  previa: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 14, paddingVertical: 8,
    borderTopWidth: 1, borderTopColor: C.bordeSuave, backgroundColor: C.panel,
  },
  previaFoto: { width: 48, height: 48, borderRadius: 8 },
  quitar: { color: C.alerta, fontSize: 14, fontWeight: '600' },

  barraEscribir: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 6,
    paddingHorizontal: 10, paddingVertical: 8,
    borderTopWidth: 1, borderTopColor: C.bordeSuave, backgroundColor: C.panel,
  },
  botonIcono: { width: 40, height: 44, alignItems: 'center', justifyContent: 'center' },
  icono: { fontSize: 22 },
  input: {
    flex: 1, minHeight: 44, maxHeight: 120,
    borderWidth: 1, borderColor: C.borde, backgroundColor: C.campo,
    borderRadius: 22, paddingHorizontal: 16, paddingTop: 11, paddingBottom: 11,
    color: C.texto, fontSize: 16,
  },
  botonEnviar: {
    height: 44, paddingHorizontal: 16, borderRadius: 22,
    backgroundColor: C.acento, alignItems: 'center', justifyContent: 'center',
  },
  textoEnviar: { color: C.acentoTexto, fontSize: 15, fontWeight: '600' },

  visor: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.95)',
    alignItems: 'center', justifyContent: 'center',
  },
  visorFoto: { width: '100%', height: '80%' },
});
