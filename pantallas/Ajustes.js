import { useState, useEffect } from 'react';
import {
  View, Text, Pressable, StyleSheet, ScrollView, SafeAreaView, TextInput,
  ActivityIndicator, Modal, KeyboardAvoidingView, Platform,
} from 'react-native';
import * as Location from 'expo-location';
import * as SMS from 'expo-sms';
import { pedir } from '../api';
import { C, g } from '../estilos';
import {
  guardarHuellaClave, verificarClaveLocal, guardarContactosLocal,
  leerContactosLocal, armarMensaje,
} from '../emergencia';

// Cuanto se espera una posicion GPS fresca antes de conformarse con
// la ultima conocida. En una emergencia no se puede esperar para
// siempre a que el GPS "enganche".
const ESPERA_GPS_MS = 15000;

/**
 * Ajustes de la cuenta y de la seguridad.
 *
 * La alerta de emergencia esta pensada para funcionar SIN DATOS: lee
 * los contactos y comprueba la clave en el telefono (ver
 * emergencia.js). El servidor solo se usa para elegir los contactos y
 * guardar el telefono propio, cosas que se hacen con calma y con red.
 */
export default function Ajustes({ token, usuario, onSalir }) {
  // Telefono propio
  const [telefono, setTelefono] = useState('');
  const [telefonoGuardado, setTelefonoGuardado] = useState('');
  const [guardandoTel, setGuardandoTel] = useState(false);
  const [msgTel, setMsgTel] = useState('');

  // Contactos
  const [candidatos, setCandidatos] = useState([]);
  const [locales, setLocales] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [sinConexion, setSinConexion] = useState(false);
  const [guardandoContactos, setGuardandoContactos] = useState(false);
  const [msgContactos, setMsgContactos] = useState('');

  // Alerta
  const [modalAbierto, setModalAbierto] = useState(false);
  const [resultadoAlerta, setResultadoAlerta] = useState(null);

  useEffect(() => {
    cargar();
  }, []);

  async function cargar() {
    setLocales(await leerContactosLocal());

    const [perfil, contactos] = await Promise.all([
      pedir('/api/auth/me', { token }),
      pedir('/api/emergency/contacts', { token }),
    ]);
    setCargando(false);

    if (perfil.ok) {
      setTelefono(perfil.datos.user.phone || '');
      setTelefonoGuardado(perfil.datos.user.phone || '');
    }

    if (contactos.sinRed) {
      setSinConexion(true);
      return;
    }
    setSinConexion(false);

    if (!contactos.ok) {
      setMsgContactos(contactos.datos?.error || 'No se pudieron cargar los contactos');
      return;
    }
    await aplicarCandidatos(contactos.datos.candidatos || []);
  }

  /** Muestra la lista del servidor y la copia al telefono. */
  async function aplicarCandidatos(lista) {
    setCandidatos(lista);
    setLocales(await guardarContactosLocal(lista));
  }

  // ---------------- Telefono propio ----------------

  async function guardarTelefono() {
    setMsgTel('');
    setGuardandoTel(true);
    const { ok, datos, sinRed } = await pedir('/api/auth/me', {
      metodo: 'PATCH', token, cuerpo: { phone: telefono },
    });
    setGuardandoTel(false);

    if (sinRed) return setMsgTel('Sin conexión: no se guardó');
    if (!ok) return setMsgTel(datos?.error || 'No se pudo guardar');

    setTelefono(datos.user.phone || '');
    setTelefonoGuardado(datos.user.phone || '');
    setMsgTel(datos.user.phone ? 'Número guardado' : 'Número borrado');
  }

  // ---------------- Contactos ----------------

  async function alternarContacto(c) {
    if (!c.phone || guardandoContactos) return;

    const elegidos = candidatos.filter((x) => x.elegido).map((x) => x.id);
    const nuevos = c.elegido ? elegidos.filter((id) => id !== c.id) : [...elegidos, c.id];

    setMsgContactos('');
    setGuardandoContactos(true);
    const { ok, datos, sinRed } = await pedir('/api/emergency/contacts', {
      metodo: 'PUT', token, cuerpo: { user_ids: nuevos },
    });
    setGuardandoContactos(false);

    if (sinRed) return setMsgContactos('Sin conexión: no se guardó el cambio');
    if (!ok) return setMsgContactos(datos?.error || 'No se pudo guardar');
    await aplicarCandidatos(datos.candidatos || []);
  }

  // ---------------- Pantalla ----------------

  return (
    <SafeAreaView style={g.pantalla}>
      <ScrollView contentContainerStyle={e.contenido} keyboardShouldPersistTaps="handled">
        <View>
          <Text style={g.titulo}>Ajustes</Text>
          <Text style={g.subtexto}>Tu cuenta y la seguridad de la app</Text>
        </View>

        {/* ---------- Alerta de emergencia ---------- */}
        <View style={e.tarjetaEmergencia}>
          <Text style={e.etiquetaRoja}>ALERTA DE EMERGENCIA</Text>
          <Text style={e.textoEmergencia}>
            Envía un SMS con tu ubicación a tus contactos de emergencia.
            Funciona sin datos móviles: basta con señal para SMS, o cobertura
            satelital si tu compañía la ofrece.
          </Text>
          <Text style={e.pista}>
            {locales.length === 0
              ? 'Aún no tienes contactos de emergencia con teléfono.'
              : `Se enviará a: ${locales.map((x) => x.name).join(', ')}`}
          </Text>

          {resultadoAlerta && (
            <Text style={resultadoAlerta.ok ? g.aviso : g.error}>{resultadoAlerta.texto}</Text>
          )}

          <Pressable
            style={[e.botonEmergencia, locales.length === 0 && g.opaco]}
            disabled={locales.length === 0}
            onPress={() => { setResultadoAlerta(null); setModalAbierto(true); }}
          >
            <Text style={e.textoBotonEmergencia}>Enviar alerta de emergencia</Text>
          </Pressable>
        </View>

        {/* ---------- Contactos de emergencia ---------- */}
        <View style={g.tarjeta}>
          <Text style={g.etiqueta}>CONTACTOS DE EMERGENCIA</Text>
          <Text style={e.pista}>
            Elige entre las personas de tus grupos. Solo se pueden elegir quienes
            registraron su número en sus Ajustes.
          </Text>

          {cargando && <ActivityIndicator color={C.acento} />}

          {sinConexion && (
            <Text style={g.aviso}>
              Sin conexión. Tu lista guardada en el teléfono sigue disponible para
              la alerta, pero no se puede cambiar ahora.
            </Text>
          )}

          {!cargando && !sinConexion && candidatos.length === 0 && (
            <Text style={g.subtexto}>
              Todavía no compartes ningún grupo con otras personas.
            </Text>
          )}

          {candidatos.map((c) => (
            <Pressable
              key={c.id}
              style={[e.contacto, c.elegido && e.contactoElegido, !c.phone && g.opaco]}
              onPress={() => alternarContacto(c)}
              disabled={!c.phone || guardandoContactos}
            >
              <View style={[e.casilla, c.elegido && e.casillaMarcada]}>
                {c.elegido && <Text style={e.check}>✓</Text>}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={e.nombre}>{c.name}</Text>
                <Text style={e.detalle} numberOfLines={1}>
                  {c.phone || 'Sin teléfono registrado'} · {(c.grupos || []).join(', ')}
                </Text>
              </View>
            </Pressable>
          ))}

          {msgContactos !== '' && <Text style={g.error}>{msgContactos}</Text>}
        </View>

        {/* ---------- Mi telefono ---------- */}
        <View style={g.tarjeta}>
          <Text style={g.etiqueta}>MI TELÉFONO</Text>
          <Text style={e.pista}>
            A este número te llegan las alertas de quienes te elijan como contacto.
            Lo pueden ver los miembros de tus grupos.
          </Text>
          <View style={e.filaTelefono}>
            <TextInput
              style={[g.input, { flex: 1 }]}
              value={telefono}
              onChangeText={setTelefono}
              placeholder="+56912345678"
              placeholderTextColor={C.placeholder}
              keyboardType="phone-pad"
              maxLength={20}
            />
            <Pressable
              style={[e.botonGuardar, (guardandoTel || telefono === telefonoGuardado) && g.opaco]}
              disabled={guardandoTel || telefono === telefonoGuardado}
              onPress={guardarTelefono}
            >
              {guardandoTel
                ? <ActivityIndicator color={C.acentoTexto} size="small" />
                : <Text style={e.textoGuardar}>Guardar</Text>}
            </Pressable>
          </View>
          {msgTel !== '' && <Text style={g.aviso}>{msgTel}</Text>}
        </View>

        {/* ---------- Cuenta ---------- */}
        <View style={g.tarjeta}>
          <Text style={g.etiqueta}>CUENTA</Text>
          <View style={e.cuenta}>
            <View style={e.inicial}>
              <Text style={e.inicialTexto}>
                {(usuario.name || '?').charAt(0).toUpperCase()}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={e.nombre}>{usuario.name}</Text>
              {usuario.email ? <Text style={e.detalle}>{usuario.email}</Text> : null}
            </View>
          </View>
        </View>

        {/* ---------- Avisos automaticos ---------- */}
        <View style={g.tarjeta}>
          <Text style={g.etiqueta}>AVISOS AUTOMÁTICOS AL GRUPO</Text>
          <Text style={e.pista}>
            Mientras tienes una ruta compartida con un grupo, el chat de ese
            grupo recibe un aviso cuando:
          </Text>
          <Aviso rojo titulo="Desactivas la ubicación"
            texto="Tu familia sabe que deja de ver tu posición real." />
          <Aviso rojo titulo="Tu teléfono deja de reportar"
            texto="5 minutos sin noticias: sin señal, sin batería, apagado o con la app cerrada." />
          <Aviso titulo="Te queda poca batería"
            texto="Al bajar del 15% sin estar cargando." />
          <Text style={e.pista}>
            Si eliges “Solo yo” al empezar la ruta, no se avisa a nadie.
          </Text>
        </View>

        <Pressable style={g.botonRojo} onPress={onSalir}>
          <Text style={g.textoRojo}>Cerrar sesión</Text>
        </Pressable>
      </ScrollView>

      <ConfirmarAlerta
        visible={modalAbierto}
        token={token}
        usuario={usuario}
        onCerrar={() => setModalAbierto(false)}
        onResultado={(r) => { setModalAbierto(false); setResultadoAlerta(r); }}
      />
    </SafeAreaView>
  );
}

/**
 * Ventana de confirmacion: nota opcional + contrasena.
 *
 * La contrasena evita que la alerta salga por un toque accidental en
 * el bolsillo o porque otra persona tomo el telefono.
 */
function ConfirmarAlerta({ visible, token, usuario, onCerrar, onResultado }) {
  const [nota, setNota] = useState('');
  const [clave, setClave] = useState('');
  const [error, setError] = useState('');
  const [paso, setPaso] = useState('');   // texto de lo que esta haciendo

  useEffect(() => {
    if (visible) { setNota(''); setClave(''); setError(''); setPaso(''); }
  }, [visible]);

  async function confirmar() {
    if (!clave) return setError('Escribe tu contraseña');
    setError('');

    // 1. Contactos (del telefono: tiene que funcionar sin datos)
    const contactos = await leerContactosLocal();
    if (contactos.length === 0) return setError('No tienes contactos de emergencia con teléfono');

    // 2. Contrasena
    setPaso('Comprobando contraseña…');
    const local = await verificarClaveLocal(clave);
    if (local === false) { setPaso(''); return setError('Contraseña incorrecta'); }

    if (local === null) {
      // No hay huella en el telefono (sesion de antes de esta version).
      // Se pregunta al servidor y, si acierta, se guarda la huella para
      // la proxima vez.
      const { ok, status, sinRed } = await pedir('/api/auth/verify-password', {
        metodo: 'POST', token, cuerpo: { password: clave },
      });
      if (ok) {
        await guardarHuellaClave(clave);
      } else if (!sinRed) {
        setPaso('');
        return setError(status === 401 ? 'Contraseña incorrecta' : 'No se pudo comprobar la contraseña');
      }
      // Sin red y sin huella no hay forma de comprobarla. Se deja
      // pasar: bloquear una alerta de emergencia real es peor que
      // dejar salir una falsa. Pasa una sola vez: al volver a iniciar
      // sesion la huella queda guardada.
    }

    // 3. Ubicacion
    setPaso('Obteniendo tu ubicación…');
    const posicion = await obtenerPosicion();

    // 4. SMS
    setPaso('Abriendo mensajes…');
    if (!(await SMS.isAvailableAsync())) {
      setPaso('');
      return setError('Este teléfono no puede enviar SMS');
    }

    const mensaje = armarMensaje({
      nombre: usuario.name,
      nota,
      posicion: posicion?.coords || null,
      cuando: posicion?.timestamp,
    });

    // La app de mensajes del sistema se abre con todo listo: la persona
    // solo toca "Enviar". Una app no puede mandar SMS sola en iPhone, y
    // en Android exige un permiso que Google Play casi nunca aprueba.
    const { result } = await SMS.sendSMSAsync(contactos.map((c) => c.phone), mensaje);
    setPaso('');

    if (result === 'sent') {
      onResultado({ ok: true, texto: `Alerta enviada a ${contactos.length} contacto(s).` });
    } else if (result === 'cancelled') {
      onResultado({ ok: false, texto: 'La alerta no se envió: se canceló en la app de mensajes.' });
    } else {
      // Android no informa si el SMS salio: solo que se abrio la app.
      onResultado({ ok: true, texto: 'Se abrió la app de mensajes. Revisa que el SMS se haya enviado.' });
    }
  }

  const ocupado = paso !== '';

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCerrar}>
      <KeyboardAvoidingView
        style={e.fondoModal}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={e.modal}>
          <Text style={e.tituloModal}>Enviar alerta de emergencia</Text>
          <Text style={e.pista}>
            Se enviará un SMS con tu ubicación a tus contactos de emergencia.
          </Text>

          <View style={g.campo}>
            <Text style={g.etiqueta}>MENSAJE (OPCIONAL)</Text>
            <TextInput
              style={g.input}
              value={nota}
              onChangeText={setNota}
              placeholder="Me torcí un tobillo, necesito ayuda"
              placeholderTextColor={C.placeholder}
              maxLength={80}
              editable={!ocupado}
            />
          </View>

          <View style={g.campo}>
            <Text style={g.etiqueta}>TU CONTRASEÑA</Text>
            <TextInput
              style={g.input}
              value={clave}
              onChangeText={setClave}
              placeholder="••••••••"
              placeholderTextColor={C.placeholder}
              secureTextEntry
              editable={!ocupado}
            />
          </View>

          {error !== '' && <Text style={g.error}>{error}</Text>}
          {ocupado && (
            <View style={e.filaPaso}>
              <ActivityIndicator color={C.alerta} size="small" />
              <Text style={g.subtexto}>{paso}</Text>
            </View>
          )}

          <Pressable
            style={[e.botonEmergencia, ocupado && g.opaco]}
            disabled={ocupado}
            onPress={confirmar}
          >
            <Text style={e.textoBotonEmergencia}>Enviar alerta</Text>
          </Pressable>
          <Pressable style={g.botonSecundario} disabled={ocupado} onPress={onCerrar}>
            <Text style={g.textoSecundario}>Cancelar</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/**
 * Posicion para el SMS. El GPS funciona sin datos moviles.
 * Primero intenta una lectura fresca; si tarda mucho, usa la ultima
 * conocida; si no hay ninguna, el SMS sale igual, sin coordenadas.
 */
async function obtenerPosicion() {
  try {
    let { status } = await Location.getForegroundPermissionsAsync();
    if (status !== 'granted') {
      ({ status } = await Location.requestForegroundPermissionsAsync());
    }
    if (status !== 'granted') return null;

    const fresca = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
      new Promise((resolver) => setTimeout(() => resolver(null), ESPERA_GPS_MS)),
    ]);
    if (fresca) return fresca;

    return await Location.getLastKnownPositionAsync();
  } catch (e) {
    return null;
  }
}

function Aviso({ rojo, titulo, texto }) {
  return (
    <View style={e.aviso}>
      <View style={[e.punto, { backgroundColor: rojo ? C.alerta : C.acento }]} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={e.avisoTitulo}>{titulo}</Text>
        <Text style={e.pista}>{texto}</Text>
      </View>
    </View>
  );
}

const e = StyleSheet.create({
  contenido: { padding: 24, paddingTop: 20, gap: 18 },
  pista: { color: C.tenue, fontSize: 13, lineHeight: 19 },
  nombre: { color: C.texto, fontSize: 16, fontWeight: '600' },
  detalle: { color: C.tenue, fontSize: 13 },

  // Emergencia
  tarjetaEmergencia: {
    borderWidth: 1, borderColor: C.alerta, backgroundColor: C.alertaFondo,
    borderRadius: 14, padding: 18, gap: 12,
  },
  etiquetaRoja: { color: C.alerta, fontSize: 11, fontWeight: '700', letterSpacing: 0.7 },
  textoEmergencia: { color: C.alertaTexto, fontSize: 15, lineHeight: 21 },
  botonEmergencia: {
    height: 58, borderRadius: 12, backgroundColor: C.alerta,
    alignItems: 'center', justifyContent: 'center',
  },
  textoBotonEmergencia: { color: '#FFFFFF', fontSize: 17, fontWeight: '700' },

  // Contactos
  contacto: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderWidth: 1, borderColor: C.bordeSuave, backgroundColor: C.superficie2,
    borderRadius: 12, padding: 12,
  },
  contactoElegido: { borderColor: C.alerta },
  casilla: {
    width: 26, height: 26, borderRadius: 7, borderWidth: 2, borderColor: C.borde,
    alignItems: 'center', justifyContent: 'center',
  },
  casillaMarcada: { backgroundColor: C.alerta, borderColor: C.alerta },
  check: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },

  // Telefono
  filaTelefono: { flexDirection: 'row', gap: 8 },
  botonGuardar: {
    height: 54, paddingHorizontal: 16, borderRadius: 10, backgroundColor: C.acento,
    alignItems: 'center', justifyContent: 'center',
  },
  textoGuardar: { color: C.acentoTexto, fontSize: 15, fontWeight: '600' },

  // Cuenta
  cuenta: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  inicial: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: C.superficie2, borderWidth: 1, borderColor: C.borde,
    alignItems: 'center', justifyContent: 'center',
  },
  inicialTexto: { color: C.acento, fontSize: 20, fontWeight: '700' },

  // Avisos
  aviso: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  punto: { width: 10, height: 10, borderRadius: 5, marginTop: 5 },
  avisoTitulo: { color: C.texto, fontSize: 15, fontWeight: '600' },

  // Modal
  fondoModal: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'center', padding: 20,
  },
  modal: {
    backgroundColor: C.panel, borderRadius: 16, borderWidth: 1, borderColor: C.alerta,
    padding: 20, gap: 14,
  },
  tituloModal: { color: C.texto, fontSize: 20, fontWeight: '700' },
  filaPaso: { flexDirection: 'row', alignItems: 'center', gap: 10 },
});
