import { useState, useEffect } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet,
  ActivityIndicator, KeyboardAvoidingView, Platform, SafeAreaView,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as SecureStore from 'expo-secure-store';

const API = 'http://192.168.1.103:3001';
const CLAVE_TOKEN = 'hikingtrail_token';

export default function App() {
  const [correo, setCorreo] = useState('test@example.com');
  const [password, setPassword] = useState('123456');
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState('');
  const [usuario, setUsuario] = useState(null);
  const [revisandoSesion, setRevisandoSesion] = useState(true);

  // Al abrir la app, revisa si quedo una sesion guardada de la vez anterior.
  useEffect(() => {
    revisarSesionGuardada();
  }, []);

  async function revisarSesionGuardada() {
    try {
      const token = await SecureStore.getItemAsync(CLAVE_TOKEN);
      if (!token) return;

      // Hay token, pero puede estar vencido. Se lo preguntamos al backend.
      const respuesta = await fetch(`${API}/api/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (respuesta.ok) {
        const datos = await respuesta.json();
        setUsuario(datos.user);
      } else {
        // Token vencido o invalido: se borra para no arrastrar basura.
        await SecureStore.deleteItemAsync(CLAVE_TOKEN);
      }
    } catch (e) {
      // Sin conexion: se queda en el login, no es un error del usuario.
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

      // El token va al almacen cifrado del iPhone, no a un archivo suelto.
      await SecureStore.setItemAsync(CLAVE_TOKEN, datos.token);
      setUsuario(datos.user);
    } catch (e) {
      setError('No hay conexion con el servidor');
    } finally {
      setCargando(false);
    }
  }

  async function salir() {
    await SecureStore.deleteItemAsync(CLAVE_TOKEN);
    setUsuario(null);
    setPassword('');
  }

  // --- Pantalla 1: revisando si hay sesion guardada ---
  if (revisandoSesion) {
    return (
      <View style={estilos.centrado}>
        <StatusBar style="light" />
        <ActivityIndicator color="#E9A44A" size="large" />
      </View>
    );
  }

  // --- Pantalla 2: ya inicio sesion ---
  if (usuario) {
    return (
      <SafeAreaView style={estilos.pantalla}>
        <StatusBar style="light" />
        <View style={estilos.centrado}>
          <Text style={estilos.saludo}>Hola, {usuario.name}</Text>
          <Text style={estilos.subtexto}>{usuario.email}</Text>

          <Pressable style={estilos.botonSecundario} onPress={salir}>
            <Text style={estilos.textoBotonSecundario}>Cerrar sesión</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  // --- Pantalla 3: el login ---
  return (
    <SafeAreaView style={estilos.pantalla}>
      <StatusBar style="light" />
      <KeyboardAvoidingView
        style={estilos.contenido}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={estilos.cabecera}>
          <Text style={estilos.titulo}>HikingTrail</Text>
          <Text style={estilos.subtitulo}>
            Tu familia sabe dónde estás, aunque tú no tengas señal.
          </Text>
        </View>

        <View style={estilos.formulario}>
          <View style={estilos.campo}>
            <Text style={estilos.etiqueta}>CORREO</Text>
            <TextInput
              style={estilos.input}
              value={correo}
              onChangeText={setCorreo}
              placeholder="tu@correo.cl"
              placeholderTextColor="#4E5651"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
            />
          </View>

          <View style={estilos.campo}>
            <Text style={estilos.etiqueta}>CONTRASEÑA</Text>
            <TextInput
              style={estilos.input}
              value={password}
              onChangeText={setPassword}
              placeholder="••••••••"
              placeholderTextColor="#4E5651"
              secureTextEntry
            />
          </View>

          {error !== '' && <Text style={estilos.error}>{error}</Text>}

          <Pressable
            style={[estilos.boton, cargando && estilos.botonApagado]}
            onPress={entrar}
            disabled={cargando}
          >
            {cargando ? (
              <ActivityIndicator color="#14100A" />
            ) : (
              <Text style={estilos.textoBoton}>Entrar</Text>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const estilos = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: '#0C0E0D' },
  contenido: { flex: 1, justifyContent: 'center', padding: 28 },
  centrado: {
    flex: 1,
    backgroundColor: '#0C0E0D',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  cabecera: { marginBottom: 44 },
  titulo: { color: '#EDEFEC', fontSize: 38, fontWeight: '700', marginBottom: 10 },
  subtitulo: { color: '#8B958F', fontSize: 16, lineHeight: 24 },
  formulario: { gap: 16 },
  campo: { gap: 8 },
  etiqueta: { color: '#6F7973', fontSize: 12, fontWeight: '600', letterSpacing: 0.7 },
  input: {
    height: 54,
    borderWidth: 1,
    borderColor: '#2A312E',
    backgroundColor: '#141816',
    borderRadius: 10,
    paddingHorizontal: 16,
    color: '#EDEFEC',
    fontSize: 16,
  },
  boton: {
    height: 56,
    backgroundColor: '#E9A44A',
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  botonApagado: { opacity: 0.6 },
  textoBoton: { color: '#14100A', fontSize: 17, fontWeight: '600' },
  botonSecundario: {
    height: 50,
    borderWidth: 1,
    borderColor: '#2A312E',
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    marginTop: 24,
  },
  textoBotonSecundario: { color: '#EDEFEC', fontSize: 16, fontWeight: '500' },
  error: { color: '#E2504E', fontSize: 14 },
  saludo: { color: '#EDEFEC', fontSize: 28, fontWeight: '700' },
  subtexto: { color: '#8B958F', fontSize: 15 },
});