import { useState, useEffect } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { pedir } from './api';
import { borrarDatosEmergencia, guardarHuellaClave } from './emergencia';
import { CLAVE_TOKEN } from './config';
import { migrarClavesAntiguas } from './migracionClaves';
import { C, g } from './estilos';
import Login from './pantallas/Login';
import Registro from './pantallas/Registro';
import Montanista from './pantallas/Montanista';
import Grupos from './pantallas/Grupos';
import Ajustes from './pantallas/Ajustes';

/**
 * La puerta de entrada de la app. Solo hace tres cosas:
 *   1. Averiguar si hay sesion guardada
 *   2. Mostrar el login (o el registro) o la app
 *   3. Cambiar entre las tres pestañas
 *
 * Toda la logica de rutas y GPS vive en pantallas/Montanista.js
 */
// Copia del usuario para poder abrir la app sin conexion.
const CLAVE_USUARIO = 'geotrail_usuario';

export default function App() {
  const [usuario, setUsuario] = useState(null);
  const [token, setToken] = useState(null);
  const [revisando, setRevisando] = useState(true);
  const [modo, setModo] = useState('montanista');
  const [rutaActiva, setRutaActiva] = useState(false);
  // Sin sesion: 'login' o 'registro'.
  const [entrada, setEntrada] = useState('login');

  useEffect(() => {
    revisarSesionGuardada();
  }, []);

  async function revisarSesionGuardada() {
    try {
      // Antes que nada: mover los datos guardados con el nombre viejo
      // de la app. Tiene que ir antes de leer el token y antes de que
      // Montanista cargue la cola de puntos.
      await migrarClavesAntiguas();

      const guardado = await SecureStore.getItemAsync(CLAVE_TOKEN);
      if (!guardado) return;

      // Hay token, pero puede estar vencido. Se lo preguntamos al backend.
      const { ok, status, datos, sinRed } = await pedir('/api/auth/me', { token: guardado });

      if (ok) {
        setToken(guardado);
        setUsuario(datos.user);
        await AsyncStorage.setItem(CLAVE_USUARIO, JSON.stringify(datos.user));
        return;
      }

      // SIN CONEXION NO SE CIERRA LA SESION. Abrir la app en el cerro
      // sin datos y encontrarse con el login seria dejar a la persona
      // sin el boton de emergencia justo cuando lo necesita. Se entra
      // con el usuario que quedo guardado la ultima vez.
      if (sinRed || status >= 500) {
        const usuarioGuardado = await AsyncStorage.getItem(CLAVE_USUARIO);
        if (usuarioGuardado) {
          setToken(guardado);
          setUsuario(JSON.parse(usuarioGuardado));
        }
        return;
      }

      // El servidor respondio y rechazo el token: ese si esta vencido.
      await SecureStore.deleteItemAsync(CLAVE_TOKEN);
    } finally {
      setRevisando(false);
    }
  }

  // Login y registro terminan igual, asi que la sesion se guarda aqui
  // y no en cada pantalla: una sola copia que mantener.
  async function entrar(u, t, password) {
    // El token va al almacen cifrado del telefono, no a un archivo suelto.
    await SecureStore.setItemAsync(CLAVE_TOKEN, t);

    // Huella de la clave para confirmar la alerta de emergencia sin
    // datos. Si fallara, la entrada sigue igual: la alerta tiene un
    // respaldo que pregunta al servidor.
    try {
      await guardarHuellaClave(password);
    } catch (e) { /* no bloquea la entrada */ }

    setEntrada('login');
    setUsuario(u);
    setToken(t);
    await AsyncStorage.setItem(CLAVE_USUARIO, JSON.stringify(u));
  }

  async function salir() {
    await SecureStore.deleteItemAsync(CLAVE_TOKEN);
    await AsyncStorage.removeItem(CLAVE_USUARIO);
    // El siguiente que entre en este telefono puede ser otra persona:
    // no debe heredar los contactos ni la huella de la clave.
    await borrarDatosEmergencia();
    setToken(null);
    setUsuario(null);
    setModo('montanista');
  }

  if (revisando) {
    return (
      <View style={g.centrado}>
        <StatusBar style="light" />
        <ActivityIndicator color={C.acento} size="large" />
      </View>
    );
  }

  if (!usuario) {
    return (
      <>
        <StatusBar style="light" />
        {entrada === 'registro'
          ? <Registro onEntrar={entrar} onVolver={() => setEntrada('login')} />
          : <Login onEntrar={entrar} onIrARegistro={() => setEntrada('registro')} />}
      </>
    );
  }

  return (
    <View style={g.pantalla}>
      <StatusBar style="light" />

      <View style={{ flex: 1 }}>
        {/* Ruta NUNCA se desmonta: solo se oculta. Desmontarla al
            cambiar de pestana soltaria el GPS, cortaria el envio de
            puntos y el reporte de estado, y perderia la ruta en curso.
            Con una ruta activa la persona tiene que poder mirar el
            chat del grupo sin dejar de compartir su ubicacion. */}
        <View style={[{ flex: 1 }, modo !== 'montanista' && e.oculto]}>
          <Montanista
            token={token}
            usuario={usuario}
            visible={modo === 'montanista'}
            onCambioRuta={setRutaActiva}
          />
        </View>
        {modo === 'grupos' && <Grupos token={token} usuario={usuario} />}
        {modo === 'ajustes' && <Ajustes token={token} usuario={usuario} onSalir={salir} />}
      </View>

      <View style={e.barra}>
          <Pestana
            texto="Ruta"
            activa={modo === 'montanista'}
            enCurso={rutaActiva}
            onPress={() => setModo('montanista')}
          />
          <Pestana
            texto="Grupos"
            activa={modo === 'grupos'}
            onPress={() => setModo('grupos')}
          />
          <Pestana
            texto="Ajustes"
            activa={modo === 'ajustes'}
            onPress={() => setModo('ajustes')}
          />
      </View>
    </View>
  );
}

/**
 * @param {boolean} enCurso - muestra un punto junto al texto. Con una
 *   ruta activa y otra pestana abierta, recuerda que se sigue
 *   compartiendo la ubicacion.
 */
function Pestana({ texto, activa, enCurso, onPress }) {
  return (
    <Pressable style={e.pestana} onPress={onPress}>
      <View style={e.filaPestana}>
        {enCurso && <View style={e.puntoEnCurso} />}
        <Text style={activa ? e.textoActivo : e.textoInactivo}>{texto}</Text>
      </View>
    </Pressable>
  );
}

const e = StyleSheet.create({
  barra: {
    flexDirection: 'row',
    borderTopWidth: 1, borderTopColor: C.bordeSuave,
    backgroundColor: C.panel,
    paddingTop: 10, paddingBottom: 28,
  },
  pestana: {
    flex: 1, height: 44,
    alignItems: 'center', justifyContent: 'center',
  },
  textoActivo: { color: C.acento, fontSize: 14, fontWeight: '600' },
  textoInactivo: { color: C.tenue, fontSize: 14, fontWeight: '500' },
  filaPestana: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  puntoEnCurso: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.acento },
  oculto: { display: 'none' },
});
