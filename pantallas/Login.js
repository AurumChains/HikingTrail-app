import { useState } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet,
  ActivityIndicator, KeyboardAvoidingView, Platform, SafeAreaView,
} from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { pedir } from '../api';
import { CLAVE_TOKEN } from '../config';
import { C, g } from '../estilos';

/**
 * Pantalla de entrada.
 * Cuando el login sale bien avisa hacia arriba con onEntrar(usuario, token).
 * No decide que pasa despues: eso lo maneja App.js.
 */
export default function Login({ onEntrar }) {
  const [correo, setCorreo] = useState('test@example.com');
  const [password, setPassword] = useState('123456');
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState('');

  async function entrar() {
    setError('');
    setCargando(true);

    const { ok, datos, sinRed } = await pedir('/api/auth/login', {
      metodo: 'POST',
      cuerpo: { email: correo.trim(), password },
    });

    setCargando(false);

    if (sinRed) return setError('No hay conexión con el servidor');
    if (!ok) return setError(datos?.error || 'No se pudo entrar');

    // El token va al almacen cifrado del telefono, no a un archivo suelto.
    await SecureStore.setItemAsync(CLAVE_TOKEN, datos.token);
    onEntrar(datos.user, datos.token);
  }

  return (
    <SafeAreaView style={g.pantalla}>
      <KeyboardAvoidingView
        style={e.contenido}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={e.cabecera}>
          <Text style={e.marca}>HikingTrail</Text>
          <Text style={e.lema}>
            Tu familia sabe dónde estás, aunque tú no tengas señal.
          </Text>
        </View>

        <View style={e.formulario}>
          <View style={g.campo}>
            <Text style={g.etiqueta}>CORREO</Text>
            <TextInput
              style={g.input}
              value={correo}
              onChangeText={setCorreo}
              placeholder="tu@correo.cl"
              placeholderTextColor={C.placeholder}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
            />
          </View>

          <View style={g.campo}>
            <Text style={g.etiqueta}>CONTRASEÑA</Text>
            <TextInput
              style={g.input}
              value={password}
              onChangeText={setPassword}
              placeholder="••••••••"
              placeholderTextColor={C.placeholder}
              secureTextEntry
            />
          </View>

          {error !== '' && <Text style={g.error}>{error}</Text>}

          <Pressable
            style={[g.boton, cargando && g.opaco]}
            onPress={entrar}
            disabled={cargando}
          >
            {cargando
              ? <ActivityIndicator color={C.acentoTexto} />
              : <Text style={g.textoBoton}>Entrar</Text>}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const e = StyleSheet.create({
  contenido: { flex: 1, justifyContent: 'center', padding: 28 },
  cabecera: { marginBottom: 44 },
  marca: { color: C.texto, fontSize: 38, fontWeight: '700', marginBottom: 10 },
  lema: { color: C.apagado, fontSize: 16, lineHeight: 24 },
  formulario: { gap: 16 },
});
