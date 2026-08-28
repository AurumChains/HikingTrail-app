import { useState, useEffect } from 'react';
import {
  View, Text, Pressable, StyleSheet, ScrollView,
  ActivityIndicator, SafeAreaView, RefreshControl,
} from 'react-native';
import { pedir } from '../api';
import { C, g } from '../estilos';

/**
 * La mitad "familiar": quien de los mios esta caminando ahora.
 * Por ahora solo lista. El mapa en vivo con Socket.io viene despues.
 */
export default function Familia({ token }) {
  const [rutas, setRutas] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [mensaje, setMensaje] = useState('');

  useEffect(() => {
    cargar();
  }, []);

  async function cargar() {
    setMensaje('');
    const { ok, datos, sinRed } = await pedir('/api/routes/following', { token });
    setCargando(false);

    if (sinRed) return setMensaje('No hay conexión con el servidor');
    if (!ok) return setMensaje(datos?.error || 'No se pudieron cargar las rutas');

    setRutas(datos.rutas || []);
  }

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
          <RefreshControl
            refreshing={false}
            onRefresh={cargar}
            tintColor={C.acento}
          />
        }
      >
        <View>
          <Text style={g.titulo}>Siguiendo</Text>
          <Text style={g.subtexto}>Quién está caminando ahora</Text>
        </View>

        {mensaje !== '' && <Text style={g.error}>{mensaje}</Text>}

        {rutas.length === 0 && mensaje === '' && (
          <View style={g.tarjeta}>
            <Text style={g.subtexto}>
              Nadie de tus contactos tiene una ruta activa en este momento.
            </Text>
            <Text style={e.pista}>
              Desliza hacia abajo para actualizar.
            </Text>
          </View>
        )}

        {rutas.map((r) => (
          <View key={r.id} style={e.tarjetaActiva}>
            <View style={g.fila}>
              <View style={{ flex: 1 }}>
                <Text style={e.nombre}>{r.montanista}</Text>
                <Text style={g.subtexto}>{r.name}</Text>
              </View>
              <View style={e.chipVivo}>
                <View style={e.puntito} />
                <Text style={e.chipTexto}>EN VIVO</Text>
              </View>
            </View>

            <View style={g.fila}>
              <Text style={g.dato}>Puntos registrados</Text>
              <Text style={g.valorGrande}>{r.total_puntos}</Text>
            </View>

            <Pressable style={[g.boton, e.botonDeshabilitado]} disabled>
              <Text style={g.textoBoton}>Ver en el mapa (pronto)</Text>
            </Pressable>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const e = StyleSheet.create({
  contenido: { padding: 24, paddingTop: 20, gap: 18 },
  pista: { color: C.tenue, fontSize: 13 },
  tarjetaActiva: {
    borderWidth: 1, borderColor: '#4A3A1E', backgroundColor: '#15140F',
    borderRadius: 14, padding: 18, gap: 14,
  },
  nombre: { color: C.texto, fontSize: 18, fontWeight: '600' },
  chipVivo: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(233,164,74,0.14)',
    paddingHorizontal: 11, paddingVertical: 6, borderRadius: 999,
  },
  puntito: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.acento },
  chipTexto: { color: C.acento, fontSize: 11, fontWeight: '700', letterSpacing: 0.7 },
  botonDeshabilitado: { opacity: 0.45 },
});
