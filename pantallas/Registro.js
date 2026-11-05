import { useState } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet, ScrollView,
  ActivityIndicator, KeyboardAvoidingView, Platform, SafeAreaView,
} from 'react-native';
import { pedir } from '../api';
import { C, g } from '../estilos';

// El backend exige lo mismo (authController.register). Revisarlo aqui
// solo evita el viaje al servidor para un error que ya se sabe.
const LARGO_MINIMO_CLAVE = 6;

/**
 * Crear cuenta. Misma forma que el login, con dos campos mas.
 *
 * Al registrarse el backend ya devuelve el token, asi que la persona
 * entra directo, sin volver a escribir correo y contraseña.
 * Igual que Login, avisa con onEntrar(usuario, token, password).
 */
export default function Registro({ onEntrar, onVolver }) {
  const [nombre, setNombre] = useState('');
  const [correo, setCorreo] = useState('');
  const [password, setPassword] = useState('');
  const [repetir, setRepetir] = useState('');
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState('');

  function validar() {
    if (!nombre.trim()) return 'Escribe tu nombre';
    if (!/^\S+@\S+\.\S+$/.test(correo.trim())) return 'Escribe un correo válido';
    if (password.length < LARGO_MINIMO_CLAVE) {
      return `La contraseña debe tener al menos ${LARGO_MINIMO_CLAVE} caracteres`;
    }
    if (password !== repetir) return 'Las contraseñas no coinciden';
    return '';
  }

  async function crearCuenta() {
    const problema = validar();
    if (problema) return setError(problema);

    setError('');
    setCargando(true);

    const { ok, datos, sinRed } = await pedir('/api/auth/register', {
      metodo: 'POST',
      cuerpo: { name: nombre.trim(), email: correo.trim(), password },
    });

    if (sinRed) { setCargando(false); return setError('No hay conexión con el servidor'); }
    if (!ok) {
      setCargando(false);
      return setError(
        datos?.error === 'El email ya existe'
          ? 'Ya hay una cuenta con ese correo. Vuelve atrás para entrar.'
          : datos?.error || 'No se pudo crear la cuenta'
      );
    }

    await onEntrar(datos.user, datos.token, password);
  }

  return (
    <SafeAreaView style={g.pantalla}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* ScrollView porque con cuatro campos y el teclado abierto,
            en un telefono chico el boton queda tapado. */}
        <ScrollView
          contentContainerStyle={e.contenido}
          keyboardShouldPersistTaps="handled"
        >
          <Pressable onPress={onVolver} disabled={cargando} hitSlop={10}>
            <Text style={e.volver}>‹ Ya tengo cuenta</Text>
          </Pressable>

          <View style={e.cabecera}>
            <Text style={g.titulo}>Crear cuenta</Text>
            <Text style={e.lema}>
              Con tu cuenta podrás compartir tus rutas con tu grupo y recibir
              sus avisos.
            </Text>
          </View>

          <View style={e.formulario}>
            <View style={g.campo}>
              <Text style={g.etiqueta}>NOMBRE</Text>
              <TextInput
                style={g.input}
                value={nombre}
                onChangeText={setNombre}
                placeholder="Como te verán en tus grupos"
                placeholderTextColor={C.placeholder}
                autoCapitalize="words"
                maxLength={60}
              />
            </View>

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
                placeholder={`Mínimo ${LARGO_MINIMO_CLAVE} caracteres`}
                placeholderTextColor={C.placeholder}
                secureTextEntry
              />
            </View>

            <View style={g.campo}>
              <Text style={g.etiqueta}>REPETIR CONTRASEÑA</Text>
              <TextInput
                style={g.input}
                value={repetir}
                onChangeText={setRepetir}
                placeholder="••••••••"
                placeholderTextColor={C.placeholder}
                secureTextEntry
              />
            </View>

            <Text style={e.pista}>
              Esta contraseña también confirma el botón de emergencia, aunque
              no tengas datos. Elige una que recuerdes.
            </Text>

            {error !== '' && <Text style={g.error}>{error}</Text>}

            <Pressable
              style={[g.boton, cargando && g.opaco]}
              onPress={crearCuenta}
              disabled={cargando}
            >
              {cargando
                ? <ActivityIndicator color={C.acentoTexto} />
                : <Text style={g.textoBoton}>Crear cuenta</Text>}
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const e = StyleSheet.create({
  contenido: { flexGrow: 1, justifyContent: 'center', padding: 28, gap: 28 },
  volver: { color: C.acento, fontSize: 16, fontWeight: '500' },
  cabecera: { gap: 10 },
  lema: { color: C.apagado, fontSize: 16, lineHeight: 24 },
  formulario: { gap: 16 },
  pista: { color: C.tenue, fontSize: 13, lineHeight: 19 },
});
