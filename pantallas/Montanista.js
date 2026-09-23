import { useState, useEffect, useRef } from 'react';
import {
  View, Text, Pressable, StyleSheet, ScrollView, TextInput,
  ActivityIndicator, SafeAreaView,
} from 'react-native';
import * as Location from 'expo-location';
import MapView, { Polyline, Marker } from 'react-native-maps';
import { pedir } from '../api';
import { API } from '../config';
import { C, g } from '../estilos';
import {
  cargarCola, encolar, vaciarCola, limpiarCola,
  pendientes as contarPendientes,
} from '../cola';

/**
 * La mitad "montañista": empezar ruta, seguir el GPS, pausar, terminar.
 * Avisa hacia arriba con onCambioRuta(true/false) para que App.js
 * esconda la barra inferior mientras el mapa esta a pantalla completa.
 */
export default function Montanista({ token, usuario, onSalir, onCambioRuta }) {
  const [ruta, setRuta] = useState(null);
  const [ubicacion, setUbicacion] = useState(null);
  const [puntos, setPuntos] = useState([]);
  const [enviados, setEnviados] = useState(0);
  const [pendientes, setPendientes] = useState(0);
  const [sinSenal, setSinSenal] = useState(false);
  const [estadisticas, setEstadisticas] = useState(null);
  const [mensaje, setMensaje] = useState('');

  // Con quien se va a compartir esta salida, y como se va a llamar.
  const [grupos, setGrupos] = useState([]);
  const [grupoElegido, setGrupoElegido] = useState(null);
  const [nombreRuta, setNombreRuta] = useState('');

  // Si al intentar empezar quedo una ruta abierta de antes, aqui
  // guardamos su id para poder ofrecer cerrarla.
  const [rutaBloqueada, setRutaBloqueada] = useState(null);

  const [pausada, setPausada] = useState(false);
  const [pausadaDesde, setPausadaDesde] = useState(null);
  const [segundosPausa, setSegundosPausa] = useState(0);
  const [paradas, setParadas] = useState(0);

  // Cajas que el callback del GPS lee actualizadas.
  // Si leyera useState veria el valor congelado del momento en que
  // se creo la funcion (normalmente null).
  const rutaRef = useRef(null);
  const tokenRef = useRef(token);
  const suscripcion = useRef(null);

  useEffect(() => { tokenRef.current = token; }, [token]);

  useEffect(() => {
    cargarCola().then(setPendientes);
    return () => soltarGPS();
  }, []);

  // Avisar a App.js si el mapa esta ocupando la pantalla
  useEffect(() => {
    if (onCambioRuta) onCambioRuta(Boolean(ruta));
  }, [ruta]);

  // Los grupos se recargan cada vez que se vuelve a la pantalla de
  // inicio, no solo al abrir la app: si el usuario acaba de crear un
  // grupo en la otra pestana, tiene que aparecer aca sin reiniciar.
  useEffect(() => {
    if (!ruta) cargarGrupos();
  }, [ruta]);

  async function cargarGrupos() {
    const { ok, datos } = await pedir('/api/groups', { token });
    if (!ok) return;

    const lista = datos.grupos || [];
    setGrupos(lista);

    // Si pertenece a un solo grupo, viene marcado: es lo que va a
    // querer el 90% de las veces. Si tiene varios, elige a proposito.
    // En ningun caso se comparte sin que el usuario lo vea en pantalla.
    setGrupoElegido((actual) => {
      if (actual && lista.some((x) => x.id === actual)) return actual;
      return lista.length === 1 ? lista[0].id : null;
    });
  }

  // Reintento periodico mientras haya ruta activa
  useEffect(() => {
    if (!ruta) return;
    const temporizador = setInterval(intentarEnviar, 15000);
    return () => clearInterval(temporizador);
  }, [ruta]);

  // Cronometro de la parada: se recalcula desde la hora de inicio,
  // no sumando de a uno, asi no se desfasa si el celular se duerme.
  useEffect(() => {
    if (!pausada || !pausadaDesde) return;
    const reloj = setInterval(() => {
      setSegundosPausa(Math.floor((Date.now() - pausadaDesde) / 1000));
    }, 1000);
    return () => clearInterval(reloj);
  }, [pausada, pausadaDesde]);

  // ---------------- GPS y cola ----------------

  async function escucharGPS() {
    suscripcion.current = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.High, timeInterval: 4000, distanceInterval: 6 },
      (posicion) => {
        const c = posicion.coords;
        setUbicacion(c);
        // Se dibuja ANTES de enviarlo: la linea no depende de la red.
        setPuntos((previos) => [
          ...previos,
          { latitude: c.latitude, longitude: c.longitude },
        ]);
        encolarYEnviar(c);
      }
    );
  }

  function soltarGPS() {
    if (suscripcion.current) {
      suscripcion.current.remove();
      suscripcion.current = null;
    }
  }

  async function encolarYEnviar(coords) {
    const total = await encolar({
      lat: coords.latitude,
      lon: coords.longitude,
      altitude: coords.altitude,
      accuracy: coords.accuracy,
      speed: coords.speed,
      timestamp: new Date().toISOString(),
    });
    setPendientes(total);
    intentarEnviar();
  }

  async function intentarEnviar() {
    const resultado = await vaciarCola({
      api: API,
      rutaId: rutaRef.current,
      token: tokenRef.current,
    });

    setPendientes(resultado.pendientes);
    if (resultado.enviados > 0) {
      setEnviados((n) => n + resultado.enviados);
      setSinSenal(false);
    }
    if (resultado.sinSenal) setSinSenal(true);
  }

  // ---------------- Acciones de ruta ----------------
  // Si no se borra al empezar el boton de queda pegado en la pantalla.
    async function empezarRuta() {
    setMensaje('');
    setEstadisticas(null);
    setRutaBloqueada(null);

    const permiso = await Location.requestForegroundPermissionsAsync();
    if (permiso.status !== 'granted') {
      setMensaje('Sin permiso de ubicación. Actívalo en Ajustes > HikingTrail.');
      return;
    }

    const { ok, datos, sinRed } = await pedir('/api/routes/start', {
      metodo: 'POST', token,
      cuerpo: {
        name: nombreRuta.trim() || 'Salida sin nombre',
        group_id: grupoElegido,
      },
    });

    if (sinRed) return setMensaje('No hay conexión con el servidor');
    if (!ok) {
      // El backend no solo dice "ya tienes una ruta activa": ademas
      // devuelve CUAL es, en datos.route_id. Se diseno asi desde el
      // principio justo para esto. Con ese numero podemos ofrecer
      // cerrarla, en vez de dejar al usuario atrapado sin salida.
      if (datos?.route_id) {
        setRutaBloqueada(datos.route_id);
        return setMensaje('Quedó una ruta sin terminar de la vez anterior.');
      }
      return setMensaje(datos?.error || 'No se pudo iniciar la ruta');
    }

    rutaRef.current = datos.ruta.id;
    setRuta(datos.ruta);
    setPuntos([]);
    setEnviados(0);
    await limpiarCola();
    setPendientes(0);
    setSinSenal(false);
    setPausada(false);
    setPausadaDesde(null);
    setParadas(0);
    await escucharGPS();
  }

    async function cerrarRutaVieja() {
    setMensaje('Cerrando la ruta anterior...');

    const { ok, datos } = await pedir(`/api/routes/${rutaBloqueada}/finish`, {
      metodo: 'POST', token,
    });

    if (!ok) {
      return setMensaje(datos?.error || 'No se pudo cerrar la ruta anterior');
    }

    // Encadenar el arranque evita que el usuario tenga que dar dos
    // toques: cierra la vieja y arranca la nueva de una sola vez.
    await empezarRuta();
  }

  async function pausar() {
    setMensaje('');
    await intentarEnviar();

    const { ok, datos, sinRed } = await pedir(
      `/api/routes/${rutaRef.current}/pause`, { metodo: 'POST', token }
    );

    if (sinRed) return setMensaje('Sin conexión: no se pudo pausar');
    if (!ok) return setMensaje(datos?.error || 'No se pudo pausar');

    // Se suelta el GPS durante la parada. Parado, la senal "baila" unos
    // metros y esa deriva se sumaria como distancia que nunca caminaste.
    // Ademas ahorra bateria en una parada larga.
    soltarGPS();
    setPausada(true);
    setPausadaDesde(Date.now());
    setSegundosPausa(0);
  }

  async function reanudar() {
    setMensaje('');
    const { ok, datos, sinRed } = await pedir(
      `/api/routes/${rutaRef.current}/resume`, { metodo: 'POST', token }
    );

    if (sinRed) return setMensaje('Sin conexión: no se pudo reanudar');
    if (!ok) return setMensaje(datos?.error || 'No se pudo reanudar');

    setPausada(false);
    setPausadaDesde(null);
    setParadas((n) => n + 1);
    await escucharGPS();
  }

  async function terminarRuta() {
    const rutaId = rutaRef.current;
    soltarGPS();

    // Vaciar lo pendiente ANTES de cerrar, o las estadisticas
    // saldrian con la ruta a medias.
    for (let i = 0; i < 5 && contarPendientes() > 0; i++) {
      await intentarEnviar();
    }

    const { ok, datos } = await pedir(
      `/api/routes/${rutaId}/finish`, { metodo: 'POST', token }
    );

    if (ok) setEstadisticas(datos.estadisticas);
    else setMensaje(datos?.error || 'No se pudo terminar');

    rutaRef.current = null;
    setRuta(null);
    setPausada(false);
    setPausadaDesde(null);
  }

  function formatoReloj(segundos) {
    const m = Math.floor(segundos / 60);
    const s = segundos % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  // ---------------- Pantalla: ruta en curso ----------------

  if (ruta) {
    return (
      <View style={g.pantalla}>
        {ubicacion ? (
          <MapView
            style={StyleSheet.absoluteFill}
            mapType="hybrid"
            userInterfaceStyle="dark"
            showsUserLocation
            followsUserLocation
            initialRegion={{
              latitude: ubicacion.latitude,
              longitude: ubicacion.longitude,
              latitudeDelta: 0.004,
              longitudeDelta: 0.004,
            }}
          >
            {puntos.length > 1 && (
              <Polyline
                coordinates={puntos}
                strokeColor={C.acento}
                strokeWidth={5}
                lineCap="round"
                lineJoin="round"
              />
            )}
            {puntos.length > 0 && (
              <Marker coordinate={puntos[0]} title="Inicio" pinColor={C.acento} />
            )}
          </MapView>
        ) : (
          <View style={g.centrado}>
            <ActivityIndicator color={C.acento} size="large" />
            <Text style={g.subtexto}>Buscando señal GPS…</Text>
          </View>
        )}

        <SafeAreaView style={e.encimaMapa} pointerEvents="box-none">
          <View style={pausada ? e.chipPausa : e.chip}>
            <View style={pausada ? e.puntitoGris : e.puntito} />
            <Text style={pausada ? e.chipTextoPausa : e.chipTexto}>
              {pausada ? 'EN PAUSA' : 'EN CURSO'}
            </Text>
          </View>
        </SafeAreaView>

        <View style={e.panel}>
          <View style={e.agarradera} />
          <Text style={e.nombreRuta}>{ruta.name}</Text>

          <View style={e.grilla}>
            <View style={e.celda}>
              <Text style={g.etiqueta}>PUNTOS</Text>
              <Text style={g.valorGrande}>{puntos.length}</Text>
            </View>
            <View style={e.celda}>
              <Text style={g.etiqueta}>ENVIADOS</Text>
              <Text style={g.valor}>{enviados}</Text>
            </View>
            <View style={e.celda}>
              <Text style={g.etiqueta}>EN COLA</Text>
              <Text style={pendientes > 0 ? g.valorRojo : g.valor}>{pendientes}</Text>
            </View>
          </View>

          {sinSenal && (
            <View style={e.avisoSinSenal}>
              <Text style={e.textoSinSenal}>
                Sin señal · {pendientes} punto{pendientes === 1 ? '' : 's'} guardado
                {pendientes === 1 ? '' : 's'} en el teléfono
              </Text>
            </View>
          )}

          {pausada && (
            <View style={e.tarjetaPausa}>
              <View>
                <Text style={g.etiqueta}>PARADA EN CURSO</Text>
                <Text style={e.reloj}>{formatoReloj(segundosPausa)}</Text>
              </View>
              <Text style={g.subtexto}>{paradas + 1}ª parada</Text>
            </View>
          )}

          {mensaje !== '' && <Text style={g.aviso}>{mensaje}</Text>}

          <View style={e.botonera}>
            <Pressable style={e.botonPrincipal} onPress={pausada ? reanudar : pausar}>
              <Text style={g.textoBoton}>{pausada ? 'Reanudar' : 'Pausar'}</Text>
            </Pressable>
            <Pressable style={e.botonRojoChico} onPress={terminarRuta}>
              <Text style={g.textoRojo}>Terminar</Text>
            </Pressable>
          </View>
        </View>
      </View>
    );
  }

  // ---------------- Pantalla: inicio ----------------

  return (
    <SafeAreaView style={g.pantalla}>
      <ScrollView contentContainerStyle={e.inicio}>
        <View>
          <Text style={g.titulo}>Hola, {usuario.name}</Text>
          <Text style={g.subtexto}>Sin ruta activa</Text>
        </View>

        {estadisticas && (
          <View style={g.tarjeta}>
            <Text style={g.etiqueta}>ÚLTIMA RUTA</Text>
            <View style={g.fila}>
              <Text style={g.dato}>Distancia</Text>
              <Text style={g.valorGrande}>{estadisticas.distancia_metros} m</Text>
            </View>
            <View style={g.fila}>
              <Text style={g.dato}>Tiempo total</Text>
              <Text style={g.valor}>{estadisticas.tiempo_total}</Text>
            </View>
            <View style={g.fila}>
              <Text style={g.dato}>Caminando</Text>
              <Text style={g.valor}>{estadisticas.tiempo_caminando}</Text>
            </View>
            <View style={g.fila}>
              <Text style={g.dato}>Parado</Text>
              <Text style={g.valor}>{estadisticas.tiempo_parado}</Text>
            </View>
            <View style={g.fila}>
              <Text style={g.dato}>Paradas</Text>
              <Text style={g.valor}>{estadisticas.total_paradas}</Text>
            </View>
            <View style={g.fila}>
              <Text style={g.dato}>Puntos guardados</Text>
              <Text style={g.valor}>{estadisticas.total_puntos}</Text>
            </View>
          </View>
        )}

        <View style={g.campo}>
          <Text style={g.etiqueta}>NOMBRE DE LA SALIDA</Text>
          <TextInput
            style={g.input}
            value={nombreRuta}
            onChangeText={setNombreRuta}
            placeholder="Cerro Manquehue"
            placeholderTextColor={C.placeholder}
            maxLength={60}
          />
        </View>

        <View style={{ gap: 10 }}>
          <Text style={g.etiqueta}>COMPARTIR CON</Text>

          {grupos.length === 0 ? (
            <Text style={e.pista}>
              No estás en ningún grupo. Ve a la pestaña Grupos para crear uno
              o unirte con un código. Sin grupo, nadie verá esta ruta.
            </Text>
          ) : (
            <View style={e.opciones}>
              {grupos.map((gr) => (
                <Pressable
                  key={gr.id}
                  style={grupoElegido === gr.id ? e.opcionActiva : e.opcion}
                  onPress={() => setGrupoElegido(gr.id)}
                >
                  <Text style={grupoElegido === gr.id ? e.opcionTextoActivo : e.opcionTexto}>
                    {gr.name}
                  </Text>
                </Pressable>
              ))}

              {/* Nadie: la ruta se guarda igual, pero es privada. */}
              <Pressable
                style={grupoElegido === null ? e.opcionActiva : e.opcion}
                onPress={() => setGrupoElegido(null)}
              >
                <Text style={grupoElegido === null ? e.opcionTextoActivo : e.opcionTexto}>
                  Solo yo
                </Text>
              </Pressable>
            </View>
          )}
        </View>

        {mensaje !== '' && <Text style={g.aviso}>{mensaje}</Text>}

        {rutaBloqueada && (
          <Pressable style={g.botonSecundario} onPress={cerrarRutaVieja}>
            <Text style={g.textoSecundario}>Cerrar la ruta anterior y empezar</Text>
          </Pressable>
        )}

        <Pressable style={g.boton} onPress={empezarRuta}>
          <Text style={g.textoBoton}>Empezar ruta</Text>
        </Pressable>

        <Pressable style={g.botonSecundario} onPress={onSalir}>
          <Text style={g.textoSecundario}>Cerrar sesión</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const e = StyleSheet.create({
  inicio: { padding: 24, paddingTop: 20, gap: 18 },
  pista: { color: C.tenue, fontSize: 13, lineHeight: 19 },

  opciones: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  opcion: {
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999,
    borderWidth: 1, borderColor: C.borde, backgroundColor: C.superficie,
  },
  opcionActiva: {
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999,
    borderWidth: 1, borderColor: C.acento, backgroundColor: 'rgba(233,164,74,0.14)',
  },
  opcionTexto: { color: C.apagado, fontSize: 14, fontWeight: '500' },
  opcionTextoActivo: { color: C.acento, fontSize: 14, fontWeight: '600' },

  encimaMapa: { position: 'absolute', top: 0, left: 0, right: 0, alignItems: 'center' },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    backgroundColor: 'rgba(15,18,17,0.92)', borderWidth: 1, borderColor: '#4A3A1E',
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, marginTop: 8,
  },
  chipPausa: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    backgroundColor: 'rgba(15,18,17,0.92)', borderWidth: 1, borderColor: C.borde,
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, marginTop: 8,
  },
  puntito: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.acento },
  puntitoGris: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.apagado },
  chipTexto: { color: C.acento, fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  chipTextoPausa: { color: C.apagado, fontSize: 11, fontWeight: '700', letterSpacing: 1 },

  panel: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: C.panel, borderTopWidth: 1, borderTopColor: C.borde,
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 20, paddingBottom: 34, gap: 16,
  },
  agarradera: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: C.borde, alignSelf: 'center',
  },
  nombreRuta: { color: C.texto, fontSize: 20, fontWeight: '700' },
  grilla: { flexDirection: 'row', gap: 12 },
  celda: { flex: 1, gap: 5 },

  avisoSinSenal: {
    backgroundColor: C.alertaFondo, borderWidth: 1, borderColor: C.bordeRojo,
    borderRadius: 10, padding: 12,
  },
  textoSinSenal: { color: C.alertaTexto, fontSize: 13 },

  tarjetaPausa: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: C.superficie2, borderWidth: 1, borderColor: C.borde,
    borderRadius: 12, padding: 15,
  },
  reloj: { color: C.texto, fontSize: 26, fontWeight: '600', marginTop: 2 },

  botonera: { flexDirection: 'row', gap: 10 },
  botonPrincipal: {
    flex: 1, height: 56, backgroundColor: C.acento, borderRadius: 11,
    alignItems: 'center', justifyContent: 'center',
  },
  botonRojoChico: {
    width: 132, height: 56, borderWidth: 1, borderColor: C.bordeRojo,
    borderRadius: 11, alignItems: 'center', justifyContent: 'center',
  },
});
