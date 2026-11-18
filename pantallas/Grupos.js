import { useState, useEffect } from 'react';
import {
  View, Text, Pressable, StyleSheet, ScrollView, TextInput,
  ActivityIndicator, SafeAreaView, RefreshControl,
} from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { pedir } from '../api';
import Hoja from './Hoja';
import { verificarClaveLocal } from '../emergencia';
import { C, g } from '../estilos';
import ChatGrupo from './ChatGrupo';
import EnVivo from './EnVivo';

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
export default function Grupos({ token, usuario, onVerPunto }) {
  const [vista, setVista] = useState('lista');
  const [grupos, setGrupos] = useState([]);
  const [detalle, setDetalle] = useState(null);
  // El grupo tal como venia en la lista. Permite mostrar el nombre y
  // abrir el chat al instante, sin esperar a que cargue el detalle.
  const [grupoAbierto, setGrupoAbierto] = useState(null);
  const [pestana, setPestana] = useState('chat');
  // La ruta de un miembro abierta en el mapa en vivo, o null.
  const [rutaEnVivo, setRutaEnVivo] = useState(null);
  const [refrescando, setRefrescando] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [mensaje, setMensaje] = useState('');
  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState(false);

  const [nombreNuevo, setNombreNuevo] = useState('');
  const [codigo, setCodigo] = useState('');

  // Moderacion: el miembro que se mantuvo pulsado (su menu esta
  // abierto), o null. Y si esta abierta la confirmacion de salir.
  const [menuDe, setMenuDe] = useState(null);
  const [confirmandoSalida, setConfirmandoSalida] = useState(false);
  // Error dentro de la hoja abierta: se muestra ahi y no detras, donde
  // la persona no lo veria.
  const [errorHoja, setErrorHoja] = useState('');
  // "Ahora es propietario", "Eliminaste a...": la confirmacion de que
  // la accion se hizo, arriba de la lista de miembros.
  const [avisoDetalle, setAvisoDetalle] = useState('');

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
    setMensaje(`Grupo "${datos.grupo.name}" creado. Entra en él y toca el código para verlo y compartirlo.`);
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
    setAvisoDetalle('');
    setDetalle(null);
    setGrupoAbierto(grupo);
    setRutaEnVivo(null);
    setPestana('chat');
    setVista('detalle');

    const { ok, datos, sinRed } = await pedir(`/api/groups/${grupo.id}`, { token });

    if (sinRed) return setError('No hay conexión con el servidor');
    if (!ok) return setError(datos?.error || 'No se pudo abrir el grupo');

    setDetalle(datos);
  }

  // Vuelve a pedir los miembros sin borrar lo que ya se ve. Sirve para
  // deslizar hacia abajo y al volver del mapa: mientras tanto alguien
  // pudo empezar, pausar o terminar su ruta.
  async function refrescarDetalle() {
    if (!grupoAbierto) return;
    setRefrescando(true);
    const { ok, datos, sinRed } = await pedir(`/api/groups/${grupoAbierto.id}`, { token });
    setRefrescando(false);

    if (sinRed) return setError('No hay conexión con el servidor');
    if (!ok) return setError(datos?.error || 'No se pudo actualizar el grupo');

    setError('');
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
    setErrorHoja('');
    setOcupado(true);
    const { ok, datos, sinRed } = await pedir(`/api/groups/${grupo.id}/leave`, {
      metodo: 'DELETE', token,
    });
    setOcupado(false);

    if (sinRed) return setErrorHoja('No hay conexión con el servidor');
    if (!ok) return setErrorHoja(datos?.error || 'No se pudo salir del grupo');

    setConfirmandoSalida(false);
    setVista('lista');
    // El servidor dice si alguien heredo el grupo o si se elimino.
    setMensaje(datos?.mensaje || 'Saliste del grupo');
    await cargar();
  }

  // ---------------- Moderacion ----------------

  function abrirMenu(m) {
    setErrorHoja('');
    setMenuDe(m);
  }

  async function cambiarRolMiembro(m, rol) {
    setErrorHoja('');
    setOcupado(true);
    const { ok, datos, sinRed } = await pedir(
      `/api/groups/${detalle.grupo.id}/members/${m.id}`,
      { metodo: 'PATCH', token, cuerpo: { rol } }
    );
    setOcupado(false);

    if (sinRed) return setErrorHoja('No hay conexión con el servidor');
    if (!ok) return setErrorHoja(datos?.error || 'No se pudo cambiar el rol');

    setMenuDe(null);
    setAvisoDetalle(rol === 'owner'
      ? `${m.name} ahora es propietario del grupo.`
      : `${m.name} ya no es propietario del grupo.`);
    await refrescarDetalle();
  }

  async function eliminarMiembro(m) {
    setErrorHoja('');
    setOcupado(true);
    const { ok, datos, sinRed } = await pedir(
      `/api/groups/${detalle.grupo.id}/members/${m.id}`,
      { metodo: 'DELETE', token }
    );
    setOcupado(false);

    if (sinRed) return setErrorHoja('No hay conexión con el servidor');
    if (!ok) return setErrorHoja(datos?.error || 'No se pudo eliminar del grupo');

    setMenuDe(null);
    setAvisoDetalle(`Eliminaste a ${m.name} del grupo.`);
    await refrescarDetalle();
    // La lista de grupos muestra cuantas personas hay en cada uno.
    cargar();
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

  // ---------------- Ubicacion de un miembro ----------------

  // El mapa ocupa toda la pantalla, como antes en Familia. Al volver se
  // queda en la pestaña Miembros, que es de donde se vino.
  if (vista === 'detalle' && rutaEnVivo) {
    return (
      <EnVivo
        token={token}
        ruta={rutaEnVivo}
        onVolver={() => { setRutaEnVivo(null); refrescarDetalle(); }}
      />
    );
  }

  // ---------------- Detalle de un grupo ----------------

  if (vista === 'detalle') {
    const total = detalle ? detalle.total_miembros : Number(grupoAbierto?.total_miembros);
    const soyPropietario = detalle?.mi_rol === 'owner';

    return (
      <SafeAreaView style={g.pantalla}>
        <View style={e.cabeceraDetalle}>
          <Pressable onPress={() => { setVista('lista'); setError(''); }} hitSlop={10}>
            <Text style={e.volver}>‹ Grupos</Text>
          </Pressable>

          <View>
            <Text style={e.tituloDetalle} numberOfLines={1}>
              {detalle?.grupo.name || grupoAbierto?.name}
            </Text>
            {Number.isFinite(total) && (
              <Text style={g.subtexto}>
                {total} {total === 1 ? 'persona' : 'personas'}
              </Text>
            )}
          </View>

          <View style={e.pestanas}>
            <Pestana texto="Chat" activa={pestana === 'chat'} onPress={() => setPestana('chat')} />
            <Pestana
              texto="Miembros"
              activa={pestana === 'miembros'}
              onPress={() => setPestana('miembros')}
            />
          </View>
        </View>

        {pestana === 'chat' && grupoAbierto && (
          <ChatGrupo
            token={token}
            usuario={usuario}
            grupoId={grupoAbierto.id}
            onVerPunto={onVerPunto}
          />
        )}

        {pestana === 'miembros' && (
        <ScrollView
          contentContainerStyle={e.contenido}
          refreshControl={
            <RefreshControl
              refreshing={refrescando}
              onRefresh={refrescarDetalle}
              tintColor={C.acento}
            />
          }
        >
          {error !== '' && <Text style={g.error}>{error}</Text>}

          {!detalle ? (
            <ActivityIndicator color={C.acento} />
          ) : (
            <>
              {soyPropietario && detalle.grupo.invite_code ? (
                <CodigoInvitacion
                  key={detalle.grupo.id}
                  codigo={detalle.grupo.invite_code}
                  token={token}
                  ocupado={ocupado}
                  onRenovar={renovarCodigo}
                />
              ) : (
                <View style={g.tarjeta}>
                  <Text style={g.etiqueta}>CÓDIGO DE INVITACIÓN</Text>
                  <Text style={e.pista}>
                    Solo los propietarios del grupo pueden ver el código. Si quieres
                    invitar a alguien, pídeselo a uno de ellos.
                  </Text>
                </View>
              )}

              {avisoDetalle !== '' && <Text style={g.aviso}>{avisoDetalle}</Text>}

              <View style={{ gap: 10 }}>
                <Text style={g.etiqueta}>MIEMBROS</Text>
                {detalle.miembros.map((m) => {
                  const soyYo = m.id === usuario.id;
                  // Al dueno original no lo modera nadie, y nadie se
                  // modera a si mismo (para irse esta "Salir del grupo").
                  const moderable = soyPropietario && !soyYo && !m.es_creador;
                  return (
                    <Miembro
                      key={m.id}
                      miembro={m}
                      soyYo={soyYo}
                      onVerUbicacion={() => setRutaEnVivo(m.ruta)}
                      onMantener={moderable ? () => abrirMenu(m) : undefined}
                    />
                  );
                })}
                <Text style={e.pista}>
                  Toca a quien esté en ruta para ver dónde va. Solo aparecen las
                  rutas que cada uno compartió con este grupo.
                </Text>
                {soyPropietario && (
                  <Text style={e.pista}>
                    Mantén pulsado a un miembro para hacerlo propietario, quitarle
                    ese rango o eliminarlo del grupo.
                  </Text>
                )}
              </View>

              <Pressable
                style={[g.botonRojo, ocupado && g.opaco]}
                disabled={ocupado}
                onPress={() => { setErrorHoja(''); setConfirmandoSalida(true); }}
              >
                <Text style={g.textoRojo}>Salir del grupo</Text>
              </Pressable>
            </>
          )}
        </ScrollView>
        )}

        <MenuMiembro
          miembro={menuDe}
          ocupado={ocupado}
          error={errorHoja}
          onCerrar={() => setMenuDe(null)}
          onCambiarRol={cambiarRolMiembro}
          onEliminar={eliminarMiembro}
        />

        <Hoja visible={confirmandoSalida && Boolean(detalle)} onCerrar={() => setConfirmandoSalida(false)}>
          <Text style={e.hojaTitulo}>¿Salir de {detalle?.grupo.name}?</Text>
          <Text style={e.pista}>{textoSalida(detalle)}</Text>
          {errorHoja !== '' && <Text style={g.error}>{errorHoja}</Text>}
          <Pressable
            style={[e.botonRojoLleno, ocupado && g.opaco]}
            disabled={ocupado}
            onPress={() => salir(detalle.grupo)}
          >
            {ocupado
              ? <ActivityIndicator color="#FFFFFF" />
              : <Text style={e.textoRojoLleno}>Salir del grupo</Text>}
          </Pressable>
          <Pressable style={g.botonSecundario} disabled={ocupado} onPress={() => setConfirmandoSalida(false)}>
            <Text style={g.textoSecundario}>Cancelar</Text>
          </Pressable>
        </Hoja>
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
                  {gr.soy_creador ? ' · eres el dueño' : (gr.role === 'owner' ? ' · eres propietario' : '')}
                </Text>
              </View>
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
 * Una fila de la lista de miembros.
 *
 * Si la persona tiene una ruta compartida con este grupo, la fila se
 * puede tocar y abre su ubicacion en vivo. Si no, es solo informativa:
 * no hay nada que mostrar, y una fila que se ve tocable pero no hace
 * nada confunde. La propia ruta no se abre aqui: para eso esta la
 * pestaña Ruta, que ademas la controla.
 *
 * Mantenerla pulsada (solo si quien mira es propietario y la persona se
 * puede moderar: `onMantener`) abre el menu de moderacion.
 *
 * Corona para el dueno original; "PROPIETARIO" para los demas que
 * tienen ese rango.
 */
function Miembro({ miembro: m, soyYo, onVerUbicacion, onMantener }) {
  const tocable = Boolean(m.ruta) && !soyYo;
  const pausada = m.ruta?.status === 'paused';
  const propietario = m.role === 'owner' && !m.es_creador;

  return (
    <Pressable
      style={({ pressed }) => [e.miembro, tocable && e.miembroTocable, pressed && (tocable || onMantener) && g.opaco]}
      onPress={tocable ? onVerUbicacion : undefined}
      onLongPress={onMantener}
      delayLongPress={450}
      disabled={!tocable && !onMantener}
      accessibilityRole={tocable || onMantener ? 'button' : undefined}
      accessibilityLabel={tocable ? `Ver la ubicación de ${m.name}` : m.name}
      accessibilityHint={onMantener ? 'Mantén pulsado para ver las opciones de moderación' : undefined}
    >
      <View style={[e.inicial, m.es_creador && e.inicialCreador]}>
        <Text style={[e.inicialTexto, m.es_creador && e.inicialTextoCreador]}>
          {(m.name || '?').charAt(0).toUpperCase()}
        </Text>
      </View>
      <View style={{ flex: 1 }}>
        <View style={e.filaNombre}>
          <Text style={[e.nombre, { flexShrink: 1 }]} numberOfLines={1}>
            {m.name}{soyYo ? ' (tú)' : ''}
          </Text>
          {m.es_creador && (
            <MaterialCommunityIcons
              name="crown"
              size={18}
              color={C.acento}
              accessibilityLabel="Dueño del grupo"
            />
          )}
          {propietario && <Text style={e.etiquetaPropietario}>PROPIETARIO</Text>}
        </View>
        <Text style={e.correo} numberOfLines={1}>
          {m.ruta ? m.ruta.name : m.email}
        </Text>
      </View>
      {/* Pausado y en marcha se ven distinto: un punto congelado con
          "EN RUTA" haria creer que esa es la posicion actual. */}
      {m.ruta && (pausada ? (
        <View style={e.chipPausa}>
          <View style={e.puntitoGris} />
          <Text style={e.chipTextoPausa}>EN PAUSA</Text>
        </View>
      ) : (
        <View style={e.chipVivo}>
          <View style={e.puntito} />
          <Text style={e.chipTexto}>EN RUTA</Text>
        </View>
      ))}
      {tocable && <Text style={e.flecha}>›</Text>}
    </Pressable>
  );
}

/** Lo que pasa si sales, dicho antes de salir. */
function textoSalida(detalle) {
  if (!detalle) return '';
  if (!detalle.soy_creador) {
    return 'Dejarás de ver las rutas y el chat del grupo. Para volver necesitarás el código de invitación.';
  }
  if (detalle.total_miembros <= 1) {
    return 'Eres la única persona del grupo: al salir, el grupo y su chat se eliminarán.';
  }
  return 'Eres el dueño del grupo. Al salir, otra persona quedará como dueña, elegida al azar ' +
    'entre los propietarios (o entre los miembros, si no hay otros propietarios).';
}

/**
 * Lo que aparece al mantener pulsado a un miembro: promover o quitar el
 * rango de propietario, y eliminar del grupo.
 *
 * Eliminar pide confirmacion en un segundo paso dentro de la misma
 * hoja; promover y quitar el rango no, porque se deshacen con el mismo
 * menu.
 */
function MenuMiembro({ miembro, ocupado, error, onCerrar, onCambiarRol, onEliminar }) {
  const [confirmando, setConfirmando] = useState(false);

  // Cada vez que se abre para alguien, empieza en las opciones.
  useEffect(() => { setConfirmando(false); }, [miembro?.id]);

  const esPropietario = miembro?.role === 'owner';

  return (
    <Hoja visible={Boolean(miembro)} onCerrar={ocupado ? () => {} : onCerrar}>
      {miembro && !confirmando && (
        <>
          <Text style={e.hojaTitulo}>{miembro.name}</Text>
          <Text style={e.pista}>
            {esPropietario
              ? 'Es propietario: ve el código de invitación y puede moderar el grupo.'
              : 'Es miembro del grupo.'}
          </Text>
          {error !== '' && <Text style={g.error}>{error}</Text>}

          <Pressable
            style={[e.opcionHoja, ocupado && g.opaco]}
            disabled={ocupado}
            onPress={() => onCambiarRol(miembro, esPropietario ? 'member' : 'owner')}
          >
            <MaterialCommunityIcons
              name={esPropietario ? 'account-arrow-down' : 'account-star'}
              size={22}
              color={C.texto}
            />
            <Text style={e.opcionHojaTexto}>
              {esPropietario ? 'Quitar propietario' : 'Promover a propietario'}
            </Text>
            {ocupado && <ActivityIndicator color={C.acento} size="small" />}
          </Pressable>

          <Pressable
            style={[e.opcionHoja, ocupado && g.opaco]}
            disabled={ocupado}
            onPress={() => setConfirmando(true)}
          >
            <MaterialCommunityIcons name="account-remove" size={22} color={C.alerta} />
            <Text style={[e.opcionHojaTexto, { color: C.alerta }]}>Eliminar del grupo</Text>
          </Pressable>

          <Pressable style={g.botonSecundario} disabled={ocupado} onPress={onCerrar}>
            <Text style={g.textoSecundario}>Cancelar</Text>
          </Pressable>
        </>
      )}

      {miembro && confirmando && (
        <>
          <Text style={e.hojaTitulo}>¿Eliminar a {miembro.name} del grupo?</Text>
          <Text style={e.pista}>
            Dejará de ver las rutas y el chat del grupo. Podrá volver solo si alguien
            le pasa el código de invitación.
          </Text>
          {error !== '' && <Text style={g.error}>{error}</Text>}
          <Pressable
            style={[e.botonRojoLleno, ocupado && g.opaco]}
            disabled={ocupado}
            onPress={() => onEliminar(miembro)}
          >
            {ocupado
              ? <ActivityIndicator color="#FFFFFF" />
              : <Text style={e.textoRojoLleno}>Eliminar del grupo</Text>}
          </Pressable>
          <Pressable style={g.botonSecundario} disabled={ocupado} onPress={() => setConfirmando(false)}>
            <Text style={g.textoSecundario}>Volver</Text>
          </Pressable>
        </>
      )}
    </Hoja>
  );
}

/**
 * El codigo de invitacion, tapado hasta que se confirma la contraseña.
 *
 * Quien tiene el codigo entra al grupo y ve las rutas que se comparten
 * en el. Con el telefono desbloqueado en la mano de otra persona (o
 * alguien mirando por encima del hombro) bastaria abrir esta pantalla
 * para llevarselo. Pedir la clave lo evita.
 *
 * Solo lo ven los propietarios del grupo: el servidor ni siquiera se lo
 * manda a los demas miembros.
 *
 * La clave se revisa primero en el telefono, con la huella que se
 * guarda al iniciar sesion: asi funciona aunque no haya datos. Si el
 * telefono no tiene la huella (sesion de una version anterior), se le
 * pregunta al servidor.
 *
 * Al salir del grupo el componente se desmonta y el codigo vuelve a
 * quedar tapado.
 */
function CodigoInvitacion({ codigo, token, ocupado, onRenovar }) {
  const [visible, setVisible] = useState(false);
  const [pidiendoClave, setPidiendoClave] = useState(false);
  const [clave, setClave] = useState('');
  const [verificando, setVerificando] = useState(false);
  const [error, setError] = useState('');

  function cancelar() {
    setPidiendoClave(false);
    setClave('');
    setError('');
  }

  async function confirmar() {
    if (!clave) return setError('Escribe tu contraseña');

    setError('');
    setVerificando(true);

    let correcta = null;
    try {
      correcta = await verificarClaveLocal(clave);
    } catch (e) { /* se pregunta al servidor */ }

    if (correcta === null) {
      const { ok, status, sinRed } = await pedir('/api/auth/verify-password', {
        metodo: 'POST', token, cuerpo: { password: clave },
      });
      if (sinRed) {
        setVerificando(false);
        return setError('No hay conexión para comprobar la contraseña');
      }
      correcta = ok;
      if (!ok && status !== 401) {
        setVerificando(false);
        return setError('No se pudo comprobar la contraseña');
      }
    }

    setVerificando(false);
    if (!correcta) return setError('Contraseña incorrecta');

    setVisible(true);
    cancelar();
  }

  return (
    <View style={e.tarjetaCodigo}>
      <Text style={g.etiqueta}>CÓDIGO DE INVITACIÓN</Text>

      {visible ? (
        <Pressable onPress={() => setVisible(false)} accessibilityLabel="Ocultar el código">
          <Text style={e.codigoGrande} selectable>{codigo}</Text>
          <Text style={e.pista}>Toca el código para volver a ocultarlo.</Text>
        </Pressable>
      ) : (
        <Pressable
          onPress={() => setPidiendoClave(true)}
          disabled={pidiendoClave}
          accessibilityLabel="Mostrar el código, pide tu contraseña"
        >
          <Text style={[e.codigoGrande, e.codigoTapado]}>
            {'•'.repeat(codigo?.length || 6)}
          </Text>
          {!pidiendoClave && (
            <Text style={e.pista}>Toca para verlo. Te pediremos tu contraseña.</Text>
          )}
        </Pressable>
      )}

      {pidiendoClave && !visible && (
        <View style={{ gap: 10 }}>
          <TextInput
            style={g.input}
            value={clave}
            onChangeText={setClave}
            placeholder="Tu contraseña"
            placeholderTextColor={C.placeholder}
            secureTextEntry
            autoFocus
            onSubmitEditing={confirmar}
            returnKeyType="done"
          />
          {error !== '' && <Text style={g.error}>{error}</Text>}
          <View style={e.filaBotones}>
            <Pressable style={[g.botonSecundario, { flex: 1 }]} onPress={cancelar} disabled={verificando}>
              <Text style={g.textoSecundario}>Cancelar</Text>
            </Pressable>
            <Pressable
              style={[g.boton, { flex: 1, height: 50 }, verificando && g.opaco]}
              onPress={confirmar}
              disabled={verificando}
            >
              {verificando
                ? <ActivityIndicator color={C.acentoTexto} />
                : <Text style={g.textoBoton}>Mostrar</Text>}
            </Pressable>
          </View>
        </View>
      )}

      <Text style={e.pista}>
        Quien escriba este código entra al grupo. Pásalo solo a quien
        quieras que vea tus rutas.
      </Text>

      {/* Cambiar el codigo solo con el codigo a la vista: asi el nuevo
          tambien queda protegido por la misma contraseña. Esta tarjeta
          solo la ven propietarios, y todos pueden renovarlo. */}
      {visible && (
        <Pressable
          style={[g.botonSecundario, ocupado && g.opaco]}
          disabled={ocupado}
          onPress={onRenovar}
        >
          <Text style={g.textoSecundario}>Cambiar el código</Text>
        </Pressable>
      )}
    </View>
  );
}

function Pestana({ texto, activa, onPress }) {
  return (
    <Pressable style={activa ? e.pestanaActiva : e.pestana} onPress={onPress}>
      <Text style={activa ? e.pestanaTextoActivo : e.pestanaTexto}>{texto}</Text>
    </Pressable>
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

  cabeceraDetalle: {
    paddingHorizontal: 24, paddingTop: 20, paddingBottom: 12, gap: 14,
    borderBottomWidth: 1, borderBottomColor: C.bordeSuave,
  },
  tituloDetalle: { color: C.texto, fontSize: 24, fontWeight: '700' },
  pestanas: {
    flexDirection: 'row', padding: 4, borderRadius: 12,
    backgroundColor: C.superficie, borderWidth: 1, borderColor: C.borde,
  },
  pestana: { flex: 1, height: 38, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  pestanaActiva: {
    flex: 1, height: 38, borderRadius: 9, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(233,164,74,0.16)',
  },
  pestanaTexto: { color: C.apagado, fontSize: 15, fontWeight: '500' },
  pestanaTextoActivo: { color: C.acento, fontSize: 15, fontWeight: '600' },
  pista: { color: C.tenue, fontSize: 13, lineHeight: 19 },

  tarjetaGrupo: {
    borderWidth: 1, borderColor: C.borde, backgroundColor: C.superficie,
    borderRadius: 14, padding: 18,
  },
  nombre: { color: C.texto, fontSize: 18, fontWeight: '600' },
  correo: { color: C.tenue, fontSize: 13 },

  tarjetaCodigo: {
    borderWidth: 1, borderColor: '#4A3A1E', backgroundColor: '#15140F',
    borderRadius: 14, padding: 18, gap: 12,
  },
  codigoGrande: {
    color: C.acento, fontSize: 34, fontWeight: '700', letterSpacing: 6,
  },
  inputCodigo: { fontSize: 22, fontWeight: '700', letterSpacing: 4 },
  codigoTapado: { color: C.tenue },
  filaBotones: { flexDirection: 'row', gap: 10 },

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
  inicialCreador: { borderColor: C.acento },
  inicialTextoCreador: { color: C.acento },
  filaNombre: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  etiquetaPropietario: {
    color: C.acento, fontSize: 10, fontWeight: '700', letterSpacing: 0.7,
    borderWidth: 1, borderColor: '#4A3A1E', borderRadius: 6,
    paddingHorizontal: 6, paddingVertical: 2,
  },

  // Hojas (menu de miembro y confirmacion de salida)
  hojaTitulo: { color: C.texto, fontSize: 20, fontWeight: '700' },
  opcionHoja: {
    flexDirection: 'row', alignItems: 'center', gap: 12, height: 54,
    paddingHorizontal: 16, borderRadius: 12,
    borderWidth: 1, borderColor: C.borde, backgroundColor: C.superficie,
  },
  opcionHojaTexto: { color: C.texto, fontSize: 16, fontWeight: '600', flex: 1 },
  botonRojoLleno: {
    height: 56, borderRadius: 11, backgroundColor: C.alerta,
    alignItems: 'center', justifyContent: 'center',
  },
  textoRojoLleno: { color: '#FFFFFF', fontSize: 17, fontWeight: '700' },

  chipVivo: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(233,164,74,0.14)',
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999,
  },
  puntito: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.acento },
  chipTexto: { color: C.acento, fontSize: 10, fontWeight: '700', letterSpacing: 0.7 },
  chipPausa: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(139,149,143,0.14)',
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999,
  },
  puntitoGris: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.apagado },
  chipTextoPausa: { color: C.apagado, fontSize: 10, fontWeight: '700', letterSpacing: 0.7 },
  miembroTocable: { borderColor: '#4A3A1E', backgroundColor: '#15140F' },
  flecha: { color: C.acento, fontSize: 24, fontWeight: '300', marginLeft: -2 },
});
