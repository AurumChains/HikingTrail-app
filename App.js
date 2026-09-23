import { useState, useEffect } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as SecureStore from 'expo-secure-store';

import { pedir } from './api';
import { CLAVE_TOKEN } from './config';
import { C, g } from './estilos';
import Login from './pantallas/Login';
import Montanista from './pantallas/Montanista';
import Familia from './pantallas/Familia';
import Grupos from './pantallas/Grupos';

/**
 * La puerta de entrada de la app. Solo hace tres cosas:
 *   1. Averiguar si hay sesion guardada
 *   2. Mostrar el login o la app
 *   3. Cambiar entre las tres pestañas
 *
 * Toda la logica de rutas y GPS vive en pantallas/Montanista.js
 */
export default function App() {
  const [usuario, setUsuario] = useState(null);
  const [token, setToken] = useState(null);
  const [revisando, setRevisando] = useState(true);
  const [modo, setModo] = useState('montanista');
  const [rutaActiva, setRutaActiva] = useState(false);

  useEffect(() => {
    revisarSesionGuardada();
  }, []);

  async function revisarSesionGuardada() {
    try {
      const guardado = await SecureStore.getItemAsync(CLAVE_TOKEN);
      if (!guardado) return;

      // Hay token, pero puede estar vencido. Se lo preguntamos al backend.
      const { ok, datos } = await pedir('/api/auth/me', { token: guardado });

      if (ok) {
        setToken(guardado);
        setUsuario(datos.user);
      } else {
        await SecureStore.deleteItemAsync(CLAVE_TOKEN);
      }
    } finally {
      setRevisando(false);
    }
  }

  async function salir() {
    await SecureStore.deleteItemAsync(CLAVE_TOKEN);
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
        <Login onEntrar={(u, t) => { setUsuario(u); setToken(t); }} />
      </>
    );
  }

  return (
    <View style={g.pantalla}>
      <StatusBar style="light" />

      <View style={{ flex: 1 }}>
        {modo === 'montanista' && (
          <Montanista
            token={token}
            usuario={usuario}
            onSalir={salir}
            onCambioRuta={setRutaActiva}
          />
        )}
        {modo === 'familia' && <Familia token={token} usuario={usuario} />}
        {modo === 'grupos' && <Grupos token={token} usuario={usuario} />}
      </View>

      {/* La barra se esconde mientras el mapa esta a pantalla completa */}
      {!rutaActiva && (
        <View style={e.barra}>
          <Pestana
            texto="Ruta"
            activa={modo === 'montanista'}
            onPress={() => setModo('montanista')}
          />
          <Pestana
            texto="Familia"
            activa={modo === 'familia'}
            onPress={() => setModo('familia')}
          />
          <Pestana
            texto="Grupos"
            activa={modo === 'grupos'}
            onPress={() => setModo('grupos')}
          />
        </View>
      )}
    </View>
  );
}

function Pestana({ texto, activa, onPress }) {
  return (
    <Pressable style={e.pestana} onPress={onPress}>
      <Text style={activa ? e.textoActivo : e.textoInactivo}>{texto}</Text>
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
});
