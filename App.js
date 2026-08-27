import { useState, useEffect, useRef } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet, ScrollView,
  ActivityIndicator, KeyboardAvoidingView, Platform, SafeAreaView,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as SecureStore from 'expo-secure-store';
import * as Location from 'expo-location';
import MapView, { Polyline, Marker } from 'react-native-maps';
import { cargarCola, encolar, vaciarCola, limpiarCola, pendientes as contarPendientes } from './cola';

const API = 'http://192.168.1.103:3001';
const CLAVE_TOKEN = 'hikingtrail_token';

export default function App() {
  const [correo, setCorreo] = useState('test@example.com');
  const [password, setPassword] = useState('123456');
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState('');
  const [usuario, setUsuario] = useState(null);
  const [revisandoSesion, setRevisandoSesion] = useState(true);

  const [ruta, setRuta] = useState(null);
  const [ubicacion, setUbicacion] = useState(null);
  const [puntos, setPuntos] = useState([]);
  const [enviados, setEnviados] = useState(0);
  const [pendientes, setPendientes] = useState(0);
  const [sinSenal, setSinSenal] = useState(false);
  const [estadisticas, setEstadisticas] = useState(null);
  const [mensaje, setMensaje] = useState('');

  const rutaRef = useRef(null);
  const tokenRef = useRef(null);
  const suscripcion = useRef(null);

    useEffect(() => {
    revisarSesionGuardada();
    // Puntos que quedaron sin enviar la ultima vez que se uso la app
    cargarCola().then(setPendientes);
    return () => soltarGPS();
  }, []);

  // Reintento periodico mientras haya una ruta activa
  useEffect(() => {
    if (!ruta) return;
    const temporizador = setInterval(intentarEnviar, 15000);
    return () => clearInterval(temporizador);
  }, [ruta]);

  async function revisarSesionGuardada() {
    try {
      const token = await SecureStore.getItemAsync(CLAVE_TOKEN);
      if (!token) return;
      const respuesta = await fetch(`${API}/api/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (respuesta.ok) {
        const datos = await respuesta.json();
        tokenRef.current = token;
        setUsuario(datos.user);
      } else {
        await SecureStore.deleteItemAsync(CLAVE_TOKEN);
      }
    } catch (err) {
    } finally {
      setRevisandoSesion(false);
    }
  }

  async function entrar() {
    setError('');
    setCargando(true);
    try {
      const respuesta = await fetch(`${API}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: correo.trim(), password }),
      });
      const datos = await respuesta.json();
      if (!respuesta.ok) {
        setError(datos.error || 'No se pudo entrar');
        return;
      }
      await SecureStore.setItemAsync(CLAVE_TOKEN, datos.token);
      tokenRef.current = datos.token;
      setUsuario(datos.user);
    } catch (err) {
      setError('No hay conexión con el servidor');
    } finally {
      setCargando(false);
    }
  }

  async function salir() {
    soltarGPS();
    await SecureStore.deleteItemAsync(CLAVE_TOKEN);
    tokenRef.current = null;
    rutaRef.current = null;
    setRuta(null);
    setUsuario(null);
    setPassword('');
  }

  async function empezarRuta() {
    setMensaje('');
    setEstadisticas(null);

    const permiso = await Location.requestForegroundPermissionsAsync();
    if (permiso.status !== 'granted') {
      setMensaje('Sin permiso de ubicación. Actívalo en Ajustes > HikingTrail.');
      return;
    }

    try {
      const respuesta = await fetch(`${API}/api/routes/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokenRef.current}`,
        },
        body: JSON.stringify({ name: 'Salida de prueba' }),
      });
      const datos = await respuesta.json();

      if (!respuesta.ok) {
        setMensaje(datos.error || 'No se pudo iniciar la ruta');
        return;
      }

      rutaRef.current = datos.ruta.id;
      setRuta(datos.ruta);
      setPuntos([]);
      setEnviados(0);
      await limpiarCola();
      setPendientes(0);
      setSinSenal(false);
      await escucharGPS();
    } catch (err) {
      setMensaje('No hay conexión con el servidor');
    }
  }


  async function escucharGPS() {
    suscripcion.current = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.High, timeInterval: 4000, distanceInterval: 6 },
      (posicion) => {
        const c = posicion.coords;
        setUbicacion(c);
        // El punto se agrega al dibujo apenas llega, sin esperar al servidor:
        // la linea nunca se congela aunque falle la red.
        setPuntos((previos) => [
          ...previos,
          { latitude: c.latitude, longitude: c.longitude },
        ]);
        encolarYEnviar(c);
      }
    );
  }

    // El punto se guarda en disco PRIMERO. Recien despues se intenta enviar.
  // Ese orden es todo: si la app se cierra o no hay señal, el punto ya
  // está a salvo.
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

  async function terminarRuta() {
    const rutaId = rutaRef.current;
    soltarGPS();

    // Vaciar lo pendiente ANTES de cerrar: si quedan puntos sin enviar,
    // las estadisticas saldrian con la ruta a medias.
    for (let i = 0; i < 5 && contarPendientes() > 0; i++) {
      await intentarEnviar();
    }

    try {
      const respuesta = await fetch(`${API}/api/routes/${rutaId}/finish`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenRef.current}` },
      });
      const datos = await respuesta.json();
      if (respuesta.ok) setEstadisticas(datos.estadisticas);
      else setMensaje(datos.error || 'No se pudo terminar');
    } catch (err) {
      setMensaje('No hay conexión con el servidor');
    }
    rutaRef.current = null;
    setRuta(null);
  }

  function soltarGPS() {
    if (suscripcion.current) {
      suscripcion.current.remove();
      suscripcion.current = null;
    }
  }

  // ---------------- Pantallas ----------------

  if (revisandoSesion) {
    return (
      <View style={e.centrado}>
        <StatusBar style="light" />
        <ActivityIndicator color="#E9A44A" size="large" />
      </View>
    );
  }

  if (!usuario) {
    return (
      <SafeAreaView style={e.pantalla}>
        <StatusBar style="light" />
        <KeyboardAvoidingView
          style={e.contenido}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={e.cabecera}>
            <Text style={e.titulo}>HikingTrail</Text>
            <Text style={e.subtitulo}>
              Tu familia sabe dónde estás, aunque tú no tengas señal.
            </Text>
          </View>
          <View style={e.formulario}>
            <View style={e.campo}>
              <Text style={e.etiqueta}>CORREO</Text>
              <TextInput
                style={e.input} value={correo} onChangeText={setCorreo}
                autoCapitalize="none" autoCorrect={false} keyboardType="email-address"
              />
            </View>
            <View style={e.campo}>
              <Text style={e.etiqueta}>CONTRASEÑA</Text>
              <TextInput
                style={e.input} value={password} onChangeText={setPassword} secureTextEntry
              />
            </View>
            {error !== '' && <Text style={e.error}>{error}</Text>}
            <Pressable style={[e.boton, cargando && e.opaco]} onPress={entrar} disabled={cargando}>
              {cargando ? <ActivityIndicator color="#14100A" /> : <Text style={e.textoBoton}>Entrar</Text>}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  // --- RUTA EN CURSO: el mapa ---
  if (ruta) {
    return (
      <View style={e.pantalla}>
        <StatusBar style="light" />

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
                strokeColor="#E9A44A"
                strokeWidth={5}
                lineCap="round"
                lineJoin="round"
              />
            )}
            {puntos.length > 0 && (
              <Marker coordinate={puntos[0]} title="Inicio" pinColor="#E9A44A" />
            )}
          </MapView>
        ) : (
          <View style={e.centrado}>
            <ActivityIndicator color="#E9A44A" size="large" />
            <Text style={e.subtexto}>Buscando señal GPS…</Text>
          </View>
        )}

        <SafeAreaView style={e.encimaMapa} pointerEvents="box-none">
          <View style={e.chip}>
            <View style={e.puntito} />
            <Text style={e.chipTexto}>EN CURSO</Text>
          </View>
        </SafeAreaView>

        <View style={e.panel}>
          <View style={e.agarradera} />
          <Text style={e.nombreRuta}>{ruta.name}</Text>

          <View style={e.grilla}>
            <View style={e.celda}>
              <Text style={e.etiqueta}>PUNTOS</Text>
              <Text style={e.valorGrande}>{puntos.length}</Text>
            </View>
            <View style={e.celda}>
              <Text style={e.etiqueta}>ENVIADOS</Text>
              <Text style={e.valor}>{enviados}</Text>
            </View>
            <View style={e.celda}>
              <Text style={e.etiqueta}>EN COLA</Text>
              <Text style={pendientes > 0 ? e.valorRojo : e.valor}>{pendientes}</Text>
            </View>
          </View>

          {sinSenal && (
            <View style={e.avisoSinSenal}>
              <Text style={e.textoSinSenal}>
                Sin señal · {pendientes} punto{pendientes === 1 ? '' : 's'} guardado{pendientes === 1 ? '' : 's'} en el teléfono
              </Text>
            </View>
          )}

          <Pressable style={e.botonRojo} onPress={terminarRuta}>
            <Text style={e.textoRojo}>Terminar ruta</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // --- INICIO ---
  return (
    <SafeAreaView style={e.pantalla}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={e.inicio}>
        <View>
          <Text style={e.saludo}>Hola, {usuario.name}</Text>
          <Text style={e.subtexto}>Sin ruta activa</Text>
        </View>

        {estadisticas && (
          <View style={e.tarjeta}>
            <Text style={e.etiqueta}>ÚLTIMA RUTA</Text>
            <View style={e.fila}>
              <Text style={e.dato}>Distancia</Text>
              <Text style={e.valorGrande}>{estadisticas.distancia_metros} m</Text>
            </View>
            <View style={e.fila}>
              <Text style={e.dato}>Tiempo total</Text>
              <Text style={e.valor}>{estadisticas.tiempo_total}</Text>
            </View>
            <View style={e.fila}>
              <Text style={e.dato}>Caminando</Text>
              <Text style={e.valor}>{estadisticas.tiempo_caminando}</Text>
            </View>
            <View style={e.fila}>
              <Text style={e.dato}>Puntos guardados</Text>
              <Text style={e.valor}>{estadisticas.total_puntos}</Text>
            </View>
          </View>
        )}

        {mensaje !== '' && <Text style={e.aviso}>{mensaje}</Text>}

        <Pressable style={e.boton} onPress={empezarRuta}>
          <Text style={e.textoBoton}>Empezar ruta</Text>
        </Pressable>

        <Pressable style={e.botonSecundario} onPress={salir}>
          <Text style={e.textoSecundario}>Cerrar sesión</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const e = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: '#0C0E0D' },
  contenido: { flex: 1, justifyContent: 'center', padding: 28 },
  inicio: { padding: 24, paddingTop: 20, gap: 18 },
  centrado: { flex: 1, backgroundColor: '#0C0E0D', alignItems: 'center', justifyContent: 'center', gap: 12 },
  cabecera: { marginBottom: 44 },
  titulo: { color: '#EDEFEC', fontSize: 38, fontWeight: '700', marginBottom: 10 },
  subtitulo: { color: '#8B958F', fontSize: 16, lineHeight: 24 },
  formulario: { gap: 16 },
  campo: { gap: 8 },
  etiqueta: { color: '#6F7973', fontSize: 11, fontWeight: '600', letterSpacing: 0.7 },
  input: {
    height: 54, borderWidth: 1, borderColor: '#2A312E', backgroundColor: '#141816',
    borderRadius: 10, paddingHorizontal: 16, color: '#EDEFEC', fontSize: 16,
  },
  encimaMapa: { position: 'absolute', top: 0, left: 0, right: 0, alignItems: 'center' },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    backgroundColor: 'rgba(15,18,17,0.92)', borderWidth: 1, borderColor: '#4A3A1E',
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, marginTop: 8,
  },
  puntito: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#E9A44A' },
  chipTexto: { color: '#E9A44A', fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  panel: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: '#0F1211', borderTopWidth: 1, borderTopColor: '#2A312E',
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 20, paddingBottom: 34, gap: 16,
  },
  agarradera: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#2A312E', alignSelf: 'center' },
  nombreRuta: { color: '#EDEFEC', fontSize: 20, fontWeight: '700' },
  grilla: { flexDirection: 'row', gap: 12 },
  celda: { flex: 1, gap: 5 },
  tarjeta: {
    borderWidth: 1, borderColor: '#2A312E', backgroundColor: '#131715',
    borderRadius: 14, padding: 18, gap: 12,
  },
  fila: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  dato: { color: '#8B958F', fontSize: 15 },
  valor: { color: '#EDEFEC', fontSize: 20, fontWeight: '600' },
  valorChico: { color: '#EDEFEC', fontSize: 14, fontWeight: '600' },
  valorGrande: { color: '#E9A44A', fontSize: 24, fontWeight: '700' },
  valorRojo: { color: '#E2504E', fontSize: 20, fontWeight: '600' },
  boton: { height: 56, backgroundColor: '#E9A44A', borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  botonRojo: { height: 56, borderWidth: 1, borderColor: '#4A2A2A', borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  opaco: { opacity: 0.6 },
  textoBoton: { color: '#14100A', fontSize: 17, fontWeight: '600' },
  textoRojo: { color: '#E2504E', fontSize: 17, fontWeight: '600' },
  botonSecundario: { height: 50, borderWidth: 1, borderColor: '#2A312E', borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  textoSecundario: { color: '#EDEFEC', fontSize: 16, fontWeight: '500' },
  avisoSinSenal: {
    backgroundColor: '#1E1413', borderWidth: 1, borderColor: '#4A2A2A',
    borderRadius: 10, padding: 12,
  },
  textoSinSenal: { color: '#F0A9A7', fontSize: 13 },
  error: { color: '#E2504E', fontSize: 14 },
  aviso: { color: '#E9A44A', fontSize: 14 },
  saludo: { color: '#EDEFEC', fontSize: 28, fontWeight: '700' },
  subtexto: { color: '#8B958F', fontSize: 15 },
});
 
MapView