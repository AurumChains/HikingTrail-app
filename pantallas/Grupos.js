import { useState, useEffect } from 'react';
import {
  View, Text, Pressable, StyleSheet, ScrollView, TextInput,
  ActivityIndicator, SafeAreaView, RefreshControl,
} from 'react-native';
import { pedir } from '../api';
import { C, g } from '../estilos';

/**
 * Grupos: con quien comparte sus rutas el montanista.
 *
 * Un grupo es una lista de personas con un codigo de invitacion.
 * El codigo resuelve el arranque en frio: la primera vez la persona
 * invitada todavia no tiene la app, asi que no hay a donde mandarle
 * una notificacion. Se le pasa el codigo por el medio que sea
 * (WhatsApp, dictado por telefono, escrito en un papel) y de ahi en
 * adelante todo ocurre dentro de la aplicacion.
 *
 * No usa libreria de navegacion: el estado `vista` decide que se ve.
 * Con cuatro pantallas es mas simple asi, y una dependencia menos.
 */
export default function Grupos({ token, usuario }) {
  const [vista, setVista] = useState('lista');
  const [grupos, setGrupos] = useState([]);
  const [detalle, setDetalle] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [mensaje, setMensaje] = useState('');
  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState(false);

  const [nombreNuevo, setNombreNuevo] = useState('');
  const [codigo, setCodigo] = useState('');

  useEffect(() => {
    cargar();
  }, []);

  async function cargar() {
    setError('');
    const { ok, datos, sinRed } = await pedir('/api/groups', { token });
    setCargando(false);

    if (sinRed) return setError('No hay conexión con el servidor');
    if (!ok) return setError(datos?.error || 'No se pudieron cargar los grupos');

    setGrupos(datos.grupos || []);
  }

  async function crear() {
    if (!nombreNuevo.trim()) return setError('Ponle un nombre al grupo');

    setError('');
    setOcupado(true);
    const { ok, datos, sinRed } = await pedir('/api/groups', {
      metodo: 'POST', token, cuerpo: { name: nombreNuevo.trim() },
    });
    setOcupado(false);

    if (sinRed) return setError('No hay conexión con el servidor');
    if (!ok) return setError(datos?.error || 'No se pudo crear el grupo');

    setNombreNuevo('');
    setVista('lista');
    setMensaje(`Grupo "${datos.grupo.name}" creado. Comparte el código ${datos.grupo.invite_code}.`);
    await cargar();
  }

  async function unirse() {
    if (!codigo.trim()) return setError('Escribe el código que te pasaron');

    setError('');
    setOcupado(true);
    const { ok, datos, sinRed } = await pedir('/api/groups/join', {
      metodo: 'POST', token, cuerpo: { codigo },
    });
    setOcupado(false);

    if (sinRed) return setError('No hay conexión con el servidor');
    if (!ok) return setError(datos?.error || 'No se pudo unir al grupo');

    setCodigo('');
    setVista('lista');
    setMensaje(datos.mensaje);
    await cargar();
  }

  async function abrirDetalle(grupo) {
    setError('');
    setDetalle(null);
    setVista('detalle');

    const { ok, datos, sinRed } = await pedir(`/api/groups/${grupo.id}`, { token });

    if (sinRed) return setError('No hay conexión con el servidor');
    if (!ok) return setError(datos?.error || 'No se pudo abrir el grupo');

    setDetalle(datos);
  }

  async function renovarCodigo() {
    setError('');
    setOcupado(true);
    const { ok, datos, sinRed } = await pedir(`/api/groups/${detalle.grupo.id}/code`, {
      metodo: 'POST', token,
    });
    setOcupado(false);

    if (sinRed) return setError('No hay conexión con el servidor');
    if (!ok) return setError(datos?.error || 'No se pudo renovar el código');

    setDetalle({ ...detalle, grupo: { ...detalle.grupo, invite_code: datos.grupo.invite_code } });
    await cargar();
  }

  async function salir(grupo) {
    setError('');
    setOcupado(true);
    const { ok, datos, sinRed } = await pedir(`/api/groups/${grupo.id}/leave`, {
      metodo: 'DELETE', token,
    });
    setOcupado(false);

    if (sinRed) return setError('No hay conexión con el servidor');
    if (!ok) return setError(datos?.error || 'No se pudo salir del grupo');

    setVista('lista');
    setMensaje('Saliste del grupo');
    await cargar();
  }

  // ---------------- Crear ----------------

  if (vista === 'crear') {
    return (
      <Formulario
        titulo="Crear grupo"
        bajada="Tú serás el dueño. Podrás invitar gente con un código y quitarla cuando quieras."
        etiqueta="NOMBRE DEL GRUPO"
        valor={nombreNuevo}
        onCambio={setNombreNuevo}
        marcador="Familia Pérez"
        textoBoton="Crear grupo"
        ocupado={ocupado}
        error={error}
        onAceptar={crear}
        onVolver={() => { setVista('lista'); setError(''); }}
      />
    );
  }

  // ---------------- Unirse ----------------

  if (vista === 'unirse') {
    return (
      <Formulario
        titulo="Unirme a un grupo"
        bajada="Escribe el código de 6 caracteres que te pasó la persona que creó el grupo."
        etiqueta="CÓDIGO DE INVITACIÓN"
        valor={codigo}
        onCambio={setCodigo}
        marcador="ABC234"
        codigo
        textoBoton="Unirme"
        ocupado={ocupado}
        error={error}
        onAceptar={unirse}
        onVolver={() => { setVista('lista'); setError(''); }}
      />
    );
  }

  // ---------------- Detalle de un grupo ----------------

  if (vista === 'detalle') {
    return (
      <SafeAreaView style={g.pantalla}>
        <ScrollView contentContainerStyle={e.contenido}>
          <Pressable onPress={() => { setVista('lista'); setError(''); }}>
            <Text style={e.volver}>‹ Grupos</Text>
          </Pressable>

          {error !== '' && <Text style={g.error}>{error}</Text>}

          {!detalle ? (
            <ActivityIndicator color={C.acento} />
          ) : (
            <>
              <View>
                <Text style={g.titulo}>{detalle.grupo.name}</Text>
                <Text style={g.subtexto}>
                  {detalle.total_miembros}{' '}
                  {detalle.total_miembros === 1 ? 'persona' : 'personas'}
                </Text>
              </View>

              <View style={e.tarjetaCodigo}>
                <Text style={g.etiqueta}>CÓDIGO DE INVITACIÓN</Text>
                <Text style={e.codigoGrande}>{detalle.grupo.invite_code}</Text>
                <Text style={e.pista}>
                  Quien escriba este código entra al grupo. Pásalo solo a quien
                  quieras que vea tus rutas.
                </Text>
                {detalle.mi_rol === 'owner' && (
                  <Pressable
                    style={[g.botonSecundario, ocupado && g.opaco]}
                    disabled={ocupado}
                    onPress={renovarCodigo}
                  >
                    <Text style={g.textoSecundario}>Cambiar el código</Text>
                  </Pressable>
                )}
              </View>

              <View style={{ gap: 10 }}>
                <Text style={g.etiqueta}>MIEMBROS</Text>
                {detalle.miembros.map((m) => (
                  <View key={m.id} style={e.miembro}>
                    <View style={e.inicial}>
                      <Text style={e.inicialTexto}>
                        {(m.name || '?').charAt(0).toUpperCase()}
                      </Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={e.nombre}>
                        {m.name}{m.id === usuario.id ? ' (tú)' : ''}
                      </Text>
                      <Text style={e.correo}>{m.email}</Text>
                    </View>
                    {m.caminando_ahora && (
                      <View style={e.chipVivo}>
                        <View style={e.puntito} />
                        <Text style={e.chipTexto}>EN RUTA</Text>
                      </View>
                    )}
                    {m.role === 'owner' && !m.caminando_ahora && (
                      <Text style={e.rol}>DUEÑO</Text>
                    )}
                  </View>
                ))}
              </View>

              {detalle.mi_rol !== 'owner' && (
                <Pressable
                  style={[g.botonRojo, ocupado && g.opaco]}
                  disabled={ocupado}
                  onPress={() => salir(detalle.grupo)}
                >
                  <Text style={g.textoRojo}>Salir del grupo</Text>
                </Pressable>
              )}
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ---------------- Lista ----------------

  if (cargando) {
    return (
      <View style={g.centrado}>
        <ActivityIndicator color={C.acento} size="large" />
      </View>
    );
  }

  return (
    <SafeAreaView style={g.pantalla}>
      <ScrollView
        contentContainerStyle={e.contenido}
        refreshControl={
          <RefreshControl refreshing={false} onRefresh={cargar} tintColor={C.acento} />
        }
      >
        <View>
          <Text style={g.titulo}>Grupos</Text>
          <Text style={g.subtexto}>Con quién puedes compartir tus rutas</Text>
        </View>

        {mensaje !== '' && <Text style={g.aviso}>{mensaje}</Text>}
        {error !== '' && <Text style={g.error}>{error}</Text>}

        {grupos.length === 0 && error === '' && (
          <View style={g.tarjeta}>
            <Text style={g.subtexto}>
              Todavía no estás en ningún grupo. Crea uno para tu familia, o únete
              con el código que te hayan pasado.
            </Text>
          </View>
        )}

        {grupos.map((gr) => (
          <Pressable key={gr.id} style={e.tarjetaGrupo} onPress={() => abrirDetalle(gr)}>
            <View style={g.fila}>
              <View style={{ flex: 1 }}>
                <Text style={e.nombre}>{gr.name}</Text>
                <Text style={g.subtexto}>
                  {gr.total_miembros}{' '}
                  {Number(gr.total_miembros) === 1 ? 'persona' : 'personas'}
                  {gr.role === 'owner' ? ' · eres el dueño' : ''}
                </Text>
              </View>
              <Text style={e.codigoChico}>{gr.invite_code}</Text>
            </View>
          </Pressable>
        ))}

        <Pressable style={g.boton} onPress={() => { setVista('crear'); setMensaje(''); }}>
          <Text style={g.textoBoton}>Crear grupo</Text>
        </Pressable>

        <Pressable style={g.botonSecundario} onPress={() => { setVista('unirse'); setMensaje(''); }}>
          <Text style={g.textoSecundario}>Unirme con un código</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

/**
 * Crear y unirse son la misma pantalla: un titulo, un campo y un boton.
 * Escribirla una vez evita que las dos se vayan pareciendo cada vez
 * menos a medida que se tocan por separado.
 */
function Formulario({
  titulo, bajada, etiqueta, valor, onCambio, marcador, codigo,
  textoBoton, ocupado, error, onAceptar, onVolver,
}) {
  return (
    <SafeAreaView style={g.pantalla}>
      <ScrollView contentContainerStyle={e.contenido}>
        <Pressable onPress={onVolver}>
          <Text style={e.volver}>‹ Grupos</Text>
        </Pressable>

        <View>
          <Text style={g.titulo}>{titulo}</Text>
          <Text style={g.subtexto}>{bajada}</Text>
        </View>

        <View style={g.campo}>
          <Text style={g.etiqueta}>{etiqueta}</Text>
          <TextInput
            style={[g.input, codigo && e.inputCodigo]}
            value={valor}
            onChangeText={onCambio}
            placeholder={marcador}
            placeholderTextColor={C.placeholder}
            // El codigo no tiene minusculas ni acentos: apagar el
            // autocorrector evita que iOS lo "arregle" a una palabra.
            autoCapitalize={codigo ? 'characters' : 'sentences'}
            autoCorrect={false}
            maxLength={codigo ? 8 : 40}
          />
        </View>

        {error !== '' && <Text style={g.error}>{error}</Text>}

        <Pressable
          style={[g.boton, ocupado && g.opaco]}
          disabled={ocupado}
          onPress={onAceptar}
        >
          <Text style={g.textoBoton}>{ocupado ? 'Espera...' : textoBoton}</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const e = StyleSheet.create({
  contenido: { padding: 24, paddingTop: 20, gap: 18 },
  volver: { color: C.acento, fontSize: 16, fontWeight: '500' },
  pista: { color: C.tenue, fontSize: 13, lineHeight: 19 },

  tarjetaGrupo: {
    borderWidth: 1, borderColor: C.borde, backgroundColor: C.superficie,
    borderRadius: 14, padding: 18,
  },
  nombre: { color: C.texto, fontSize: 18, fontWeight: '600' },
  correo: { color: C.tenue, fontSize: 13 },

  codigoChico: {
    color: C.acento, fontSize: 15, fontWeight: '700', letterSpacing: 1.5,
  },
  tarjetaCodigo: {
    borderWidth: 1, borderColor: '#4A3A1E', backgroundColor: '#15140F',
    borderRadius: 14, padding: 18, gap: 12,
  },
  codigoGrande: {
    color: C.acento, fontSize: 34, fontWeight: '700', letterSpacing: 6,
  },
  inputCodigo: { fontSize: 22, fontWeight: '700', letterSpacing: 4 },

  miembro: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderWidth: 1, borderColor: C.bordeSuave, backgroundColor: C.superficie,
    borderRadius: 12, padding: 14,
  },
  inicial: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: C.superficie2, borderWidth: 1, borderColor: C.borde,
    alignItems: 'center', justifyContent: 'center',
  },
  inicialTexto: { color: C.apagado, fontSize: 16, fontWeight: '600' },
  rol: { color: C.tenue, fontSize: 11, fontWeight: '700', letterSpacing: 0.7 },

  chipVivo: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(233,164,74,0.14)',
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999,
  },
  puntito: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.acento },
  chipTexto: { color: C.acento, fontSize: 10, fontWeight: '700', letterSpacing: 0.7 },
});
