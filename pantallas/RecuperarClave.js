import { useState, useEffect } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet, ScrollView,
  ActivityIndicator, KeyboardAvoidingView, Platform, SafeAreaView,
} from 'react-native';
import { pedir } from '../api';
import { LARGO_MINIMO_CLAVE } from '../config';
import { C, g } from '../estilos';

/**
 * Recuperar la clave, en dos pantallas:
 *
 *   1. Correo y codigo (misma pantalla). Se escribe el correo, el
 *      servidor manda un codigo de 6 digitos por mail y aparece el campo
 *      para escribirlo.
 *   2. Clave nueva, dos veces. Se abre solo si el codigo era correcto.
 *
 * Nada cambia hasta el ultimo boton. Si la persona se sale antes (en
 * cualquiera de las dos pantallas), su clave queda como estaba y el
 * codigo ya no sirve: tendra que pedir otro.
 *
 * Al terminar avisa con onListo(mensaje) y App.js vuelve al login.
 */
export default function RecuperarClave({ correoInicial = '', onVolver, onListo }) {
  const [paso, setPaso] = useState('correo');   // 'correo' | 'codigo' | 'nueva'
  const [correo, setCorreo] = useState(correoInicial);
  const [codigo, setCodigo] = useState('');
  const [permiso, setPermiso] = useState(null);  // reset_token del servidor
  const [clave, setClave] = useState('');
  const [repetir, setRepetir] = useState('');
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  // Segundos que faltan para poder pedir otro codigo.
  const [espera, setEspera] = useState(0);

  useEffect(() => {
    if (espera <= 0) return;
    const t = setTimeout(() => setEspera((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [espera]);

  async function pedirCodigo() {
    if (!/^\S+@\S+\.\S+$/.test(correo.trim())) return setError('Escribe un correo válido');

    setError('');
    setAviso('');
    setCargando(true);
    const { ok, status, datos, sinRed } = await pedir('/api/auth/recover/request', {
      metodo: 'POST', cuerpo: { email: correo.trim() },
    });
    setCargando(false);

    if (sinRed) return setError('No hay conexión con el servidor');
    if (status === 429 && datos?.espera_s) {
      // Ya hay un codigo en camino: se puede escribir ese.
      setEspera(datos.espera_s);
      setPaso('codigo');
      return setError(datos.error);
    }
    if (!ok) return setError(datos?.error || 'No se pudo enviar el código');

    setCodigo('');
    setPaso('codigo');
    setEspera(60);
    setAviso(datos.mensaje || 'Te enviamos un código a tu correo.');
  }

  async function comprobarCodigo() {
    const limpio = codigo.replace(/\D/g, '');
    if (limpio.length !== 6) return setError('El código tiene 6 dígitos');

    setError('');
    setCargando(true);
    const { ok, datos, sinRed } = await pedir('/api/auth/recover/verify', {
      metodo: 'POST', cuerpo: { email: correo.trim(), codigo: limpio },
    });
    setCargando(false);

    if (sinRed) return setError('No hay conexión con el servidor');
    if (!ok) return setError(datos?.error || 'No se pudo comprobar el código');

    setPermiso(datos.reset_token);
    setAviso('');
    setPaso('nueva');
  }

  async function guardarClave() {
    if (clave.length < LARGO_MINIMO_CLAVE) {
      return setError(`La contraseña debe tener al menos ${LARGO_MINIMO_CLAVE} caracteres`);
    }
    if (clave !== repetir) return setError('Las contraseñas no coinciden');

    setError('');
    setCargando(true);
    const { ok, datos, sinRed } = await pedir('/api/auth/recover/reset', {
      metodo: 'POST', cuerpo: { reset_token: permiso, password: clave },
    });
    setCargando(false);

    if (sinRed) return setError('No hay conexión con el servidor');
    if (!ok) return setError(datos?.error || 'No se pudo cambiar la contraseña');

    onListo(datos.mensaje || 'Contraseña actualizada. Ya puedes entrar con la nueva.');
  }

  // ---------------- Pantalla 2: clave nueva ----------------

  if (paso === 'nueva') {
    return (
      <Marco
        volver="‹ Cancelar"
        onVolver={onVolver}
        cargando={cargando}
        titulo="Nueva contraseña"
        bajada={`Para ${correo.trim()}. Si sales ahora, tu contraseña queda como estaba.`}
      >
        <View style={g.campo}>
          <Text style={g.etiqueta}>NUEVA CONTRASEÑA</Text>
          <TextInput
            style={g.input}
            value={clave}
            onChangeText={setClave}
            placeholder={`Mínimo ${LARGO_MINIMO_CLAVE} caracteres`}
            placeholderTextColor={C.placeholder}
            secureTextEntry
            autoFocus
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
            onSubmitEditing={guardarClave}
            returnKeyType="done"
          />
        </View>

        {error !== '' && <Text style={g.error}>{error}</Text>}

        <Boton texto="Guardar contraseña" cargando={cargando} onPress={guardarClave} />
      </Marco>
    );
  }

  // ---------------- Pantalla 1: correo y codigo ----------------

  return (
    <Marco
      volver="‹ Volver a entrar"
      onVolver={onVolver}
      cargando={cargando}
      titulo="Recuperar contraseña"
      bajada="Escribe el correo de tu cuenta y te enviaremos un código de 6 dígitos."
    >
      <View style={g.campo}>
        <Text style={g.etiqueta}>CORREO</Text>
        <TextInput
          style={[g.input, paso === 'codigo' && g.opaco]}
          value={correo}
          onChangeText={setCorreo}
          placeholder="tu@correo.cl"
          placeholderTextColor={C.placeholder}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          // Con el codigo ya pedido, el correo queda fijo: el codigo es
          // de ESA cuenta. Para cambiarlo esta "Usar otro correo".
          editable={paso === 'correo' && !cargando}
          onSubmitEditing={pedirCodigo}
          returnKeyType="send"
        />
      </View>

      {paso === 'correo' && (
        <>
          {error !== '' && <Text style={g.error}>{error}</Text>}
          <Boton texto="Enviar código" cargando={cargando} onPress={pedirCodigo} />
        </>
      )}

      {paso === 'codigo' && (
        <>
          {aviso !== '' && <Text style={g.aviso}>{aviso}</Text>}

          <View style={g.campo}>
            <Text style={g.etiqueta}>CÓDIGO DE CONFIRMACIÓN</Text>
            <TextInput
              style={[g.input, e.inputCodigo]}
              value={codigo}
              onChangeText={(t) => setCodigo(t.replace(/\D/g, '').slice(0, 6))}
              placeholder="000000"
              placeholderTextColor={C.placeholder}
              keyboardType="number-pad"
              // iOS ofrece el codigo que llego por correo encima del teclado.
              textContentType="oneTimeCode"
              autoComplete="one-time-code"
              maxLength={6}
              autoFocus
              onSubmitEditing={comprobarCodigo}
            />
          </View>

          {error !== '' && <Text style={g.error}>{error}</Text>}

          <Boton texto="Confirmar código" cargando={cargando} onPress={comprobarCodigo} />

          <View style={e.filaEnlaces}>
            <Pressable
              onPress={pedirCodigo}
              disabled={cargando || espera > 0}
              hitSlop={8}
            >
              <Text style={espera > 0 ? e.enlaceApagado : e.enlace}>
                {espera > 0 ? `Reenviar en ${espera} s` : 'Reenviar código'}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => { setPaso('correo'); setError(''); setAviso(''); setCodigo(''); }}
              disabled={cargando}
              hitSlop={8}
            >
              <Text style={e.enlace}>Usar otro correo</Text>
            </Pressable>
          </View>

          <Text style={e.pista}>
            Si no lo ves, revisa la carpeta de spam. El código vence en 10 minutos.
          </Text>
        </>
      )}
    </Marco>
  );
}

/** Lo que comparten las dos pantallas: volver, titulo y el formulario. */
function Marco({ volver, onVolver, cargando, titulo, bajada, children }) {
  return (
    <SafeAreaView style={g.pantalla}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={e.contenido} keyboardShouldPersistTaps="handled">
          <Pressable onPress={onVolver} disabled={cargando} hitSlop={10}>
            <Text style={e.volver}>{volver}</Text>
          </Pressable>

          <View style={e.cabecera}>
            <Text style={g.titulo}>{titulo}</Text>
            <Text style={e.lema}>{bajada}</Text>
          </View>

          <View style={e.formulario}>{children}</View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Boton({ texto, cargando, onPress }) {
  return (
    <Pressable style={[g.boton, cargando && g.opaco]} onPress={onPress} disabled={cargando}>
      {cargando
        ? <ActivityIndicator color={C.acentoTexto} />
        : <Text style={g.textoBoton}>{texto}</Text>}
    </Pressable>
  );
}

const e = StyleSheet.create({
  contenido: { flexGrow: 1, justifyContent: 'center', padding: 28, gap: 28 },
  volver: { color: C.acento, fontSize: 16, fontWeight: '500' },
  cabecera: { gap: 10 },
  lema: { color: C.apagado, fontSize: 16, lineHeight: 24 },
  formulario: { gap: 16 },
  inputCodigo: { fontSize: 26, fontWeight: '700', letterSpacing: 10, textAlign: 'center' },
  filaEnlaces: { flexDirection: 'row', justifyContent: 'space-between' },
  enlace: { color: C.acento, fontSize: 15, fontWeight: '600' },
  enlaceApagado: { color: C.tenue, fontSize: 15 },
  pista: { color: C.tenue, fontSize: 13, lineHeight: 19 },
});
