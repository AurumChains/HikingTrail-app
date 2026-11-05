import { useState } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet,
  ActivityIndicator, KeyboardAvoidingView, Platform, SafeAreaView,
} from 'react-native';
import { pedir } from '../api';
import { C, g } from '../estilos';

/**
 * Pantalla de entrada.
 * Cuando el login sale bien avisa hacia arriba con
 * onEntrar(usuario, token, password). No decide que pasa despues ni
 * guarda la sesion: eso lo maneja App.js, igual que para el registro.
 */
export default function Login({ onEntrar, onIrARegistro }) {
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

    if (sinRed) { setCargando(false); return setError('No hay conexión con el servidor'); }
    if (!ok) { setCargando(false); return setError(datos?.error || 'No se pudo entrar'); }

    await onEntrar(datos.user, datos.token, password);
  }

  return (
    <SafeAreaView style={g.pantalla}>
      <KeyboardAvoidingView
        style={e.contenido}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={e.cabecera}>
          <Text style={e.marca}>GeoTrail</Text>
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

          <Pressable style={e.enlace} onPress={onIrARegistro} disabled={cargando} hitSlop={8}>
            <Text style={e.enlaceTexto}>
              ¿No tienes cuenta? <Text style={e.enlaceAcento}>Crear una</Text>
            </Text>
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
  enlace: { alignItems: 'center', paddingVertical: 8 },
  enlaceTexto: { color: C.apagado, fontSize: 15 },
  enlaceAcento: { color: C.acento, fontWeight: '600' },
});
