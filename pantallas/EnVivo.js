import { useState, useEffect, useRef } from 'react';
import {
  View, Text, Pressable, StyleSheet, ActivityIndicator, SafeAreaView,
} from 'react-native';
import MapView, { Polyline, Marker, Circle } from 'react-native-maps';
import { io } from 'socket.io-client';
import { pedir } from '../api';
import { API } from '../config';
import { C, g } from '../estilos';

/**
 * La pantalla del familiar: ve el recorrido de otra persona moverse
 * en vivo.
 *
 * Combina dos fuentes:
 *   - HTTP  -> el historial completo al abrir, y las estadisticas
 *   - Socket -> cada punto nuevo, empujado por el servidor
 *
 * Es de SOLO LECTURA. El backend rechaza con 404 cualquier intento
 * de pausar o terminar la ruta de otra persona.
 */
export default function EnVivo({ token, ruta, onVolver }) {
  const [puntos, setPuntos] = useState([]);
  const [estadisticas, setEstadisticas] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [conexion, setConexion] = useState('conectando');
  const [error, setError] = useState('');
  const [ultimaSenal, setUltimaSenal] = useState(null);
  const [segundosSinSenal, setSegundosSinSenal] = useState(0);

  const socketRef = useRef(null);
  const mapaRef = useRef(null);

  // 1. Traer el recorrido que ya existe
  useEffect(() => {
    cargarRuta();
  }, []);

  // 2. Abrir el canal en vivo
  useEffect(() => {
    conectarSocket();
    return () => desconectar();
  }, []);

  // 3. Refrescar estadisticas cada 30s. El socket trae la posicion,
  //    pero la distancia y los tiempos los calcula PostGIS.
  useEffect(() => {
    const t = setInterval(cargarRuta, 30000);
    return () => clearInterval(t);
  }, []);

  // 4. Contador de "hace cuanto" que no llega un punto.
  //    En una app de seguridad este numero es lo mas importante
  //    de la pantalla.
  useEffect(() => {
    if (!ultimaSenal) return;
    const t = setInterval(() => {
      setSegundosSinSenal(Math.floor((Date.now() - ultimaSenal) / 1000));
    }, 1000);
    return () => clearInterval(t);
  }, [ultimaSenal]);

  async function cargarRuta() {
    const { ok, datos, sinRed } = await pedir(`/api/routes/${ruta.id}`, { token });
    setCargando(false);

    if (sinRed) return setError('No hay conexión con el servidor');
    if (!ok) return setError(datos?.error || 'No se pudo cargar la ruta');

    setError('');
    setEstadisticas(datos.estadisticas);

    const coords = (datos.puntos || []).map((p) => ({
      latitude: Number(p.lat),
      longitude: Number(p.lon),
    }));
    setPuntos(coords);

    const ultimo = datos.puntos?.[datos.puntos.length - 1];
    if (ultimo) setUltimaSenal(new Date(ultimo.timestamp).getTime());
  }

  function conectarSocket() {
    // El token viaja en `auth`, NO como cabecera. Es distinto a HTTP
    // y es el error mas facil de cometer aqui.
    const socket = io(API, {
      auth: { token },
      transports: ['websocket'],
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      // Pedir permiso para entrar a la sala de esta ruta.
      // El servidor verifica que haya conexion aceptada antes de dejar pasar.
      socket.emit('seguir_ruta', String(ruta.id), (respuesta) => {
        if (respuesta?.ok) setConexion('en_vivo');
        else {
          setConexion('sin_permiso');
          setError(respuesta?.error || 'Sin permiso para ver esta ruta');
        }
      });
    });

    socket.on('connect_error', () => setConexion('error'));
    socket.on('disconnect', () => setConexion('desconectado'));

    // Aqui llega cada punto nuevo, sin que nadie lo pida
    socket.on('nueva_ubicacion', (punto) => {
      const coord = {
        latitude: Number(punto.lat),
        longitude: Number(punto.lon),
      };
      setPuntos((previos) => [...previos, coord]);
      setUltimaSenal(Date.now());
      setSegundosSinSenal(0);

      // Mover la camara para seguir a la persona
      mapaRef.current?.animateCamera({ center: coord }, { duration: 800 });
    });
  }

  function desconectar() {
    if (socketRef.current) {
      socketRef.current.emit('dejar_ruta', String(ruta.id));
      socketRef.current.disconnect();
      socketRef.current = null;
    }
  }

  function formatoEspera(s) {
    if (s < 60) return `hace ${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `hace ${m}m`;
    return `hace ${Math.floor(m / 60)}h ${m % 60}m`;
  }

  const alerta = segundosSinSenal > 300;
  const posicionActual = puntos[puntos.length - 1];

  if (cargando) {
    return (
      <View style={g.centrado}>
        <ActivityIndicator color={C.acento} size="large" />
        <Text style={g.subtexto}>Cargando el recorrido…</Text>
      </View>
    );
  }

  return (
    <View style={g.pantalla}>
      {posicionActual ? (
        <MapView
          ref={mapaRef}
          style={StyleSheet.absoluteFill}
          mapType="hybrid"
          userInterfaceStyle="dark"
          initialRegion={{
            latitude: posicionActual.latitude,
            longitude: posicionActual.longitude,
            latitudeDelta: 0.006,
            longitudeDelta: 0.006,
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

          <Marker coordinate={puntos[0]} title="Inicio" pinColor={C.acento} />

          {/* Cuando se pierde la senal, el circulo de busqueda de 100 m */}
          {alerta && (
            <Circle
              center={posicionActual}
              radius={100}
              strokeColor={C.alerta}
              fillColor="rgba(226,80,78,0.15)"
              strokeWidth={2}
            />
          )}

          <Marker
            coordinate={posicionActual}
            title={ruta.montanista}
            description={formatoEspera(segundosSinSenal)}
            pinColor={alerta ? C.alerta : C.acento}
          />
        </MapView>
      ) : (
        <View style={g.centrado}>
          <Text style={g.subtexto}>Todavía no hay puntos registrados.</Text>
        </View>
      )}

      <SafeAreaView style={e.encima} pointerEvents="box-none">
        <View style={e.barraSuperior}>
          <Pressable style={e.volver} onPress={onVolver} hitSlop={10}>
            <Text style={e.flecha}>‹</Text>
          </Pressable>

          <View style={{ flex: 1 }}>
            <Text style={e.nombre}>{ruta.montanista}</Text>
            <Text style={e.subnombre}>{ruta.name}</Text>
          </View>

          <View style={conexion === 'en_vivo' && !alerta ? e.chipVivo : e.chipMal}>
            <View style={conexion === 'en_vivo' && !alerta ? e.punto : e.puntoMal} />
            <Text style={conexion === 'en_vivo' && !alerta ? e.chipTexto : e.chipTextoMal}>
              {conexion === 'en_vivo' ? (alerta ? 'SIN SEÑAL' : 'EN VIVO') : 'CONECTANDO'}
            </Text>
          </View>
        </View>
      </SafeAreaView>

      <View style={e.panel}>
        <View style={e.agarradera} />

        {alerta && (
          <View style={e.alertaCaja}>
            <Text style={e.alertaTitulo}>Sin señal de {ruta.montanista}</Text>
            <Text style={e.alertaTexto}>
              Última ubicación {formatoEspera(segundosSinSenal)}. El círculo rojo
              marca 100 metros a la redonda.
            </Text>
          </View>
        )}

        {error !== '' && <Text style={g.error}>{error}</Text>}

        {estadisticas && (
          <View style={e.grilla}>
            <View style={e.celda}>
              <Text style={g.etiqueta}>RECORRIDO</Text>
              <Text style={g.valorGrande}>{estadisticas.distancia_metros} m</Text>
            </View>
            <View style={e.celda}>
              <Text style={g.etiqueta}>EN RUTA</Text>
              <Text style={g.valor}>{estadisticas.tiempo_total}</Text>
            </View>
            <View style={e.celda}>
              <Text style={g.etiqueta}>ÚLTIMA SEÑAL</Text>
              <Text style={alerta ? g.valorRojo : g.valor}>
                {formatoEspera(segundosSinSenal)}
              </Text>
            </View>
          </View>
        )}

        <View style={e.nota}>
          <Text style={e.notaTexto}>
            Estás viendo su ruta. Solo {ruta.montanista} puede pausarla o terminarla.
          </Text>
        </View>
      </View>
    </View>
  );
}

const e = StyleSheet.create({
  encima: { position: 'absolute', top: 0, left: 0, right: 0 },
  barraSuperior: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 10,
    backgroundColor: 'rgba(12,14,13,0.86)',
  },
  volver: {
    width: 38, height: 38, borderRadius: 10,
    borderWidth: 1, borderColor: C.borde,
    alignItems: 'center', justifyContent: 'center',
  },
  flecha: { color: C.texto, fontSize: 26, lineHeight: 30, marginTop: -3 },
  nombre: { color: C.texto, fontSize: 18, fontWeight: '700' },
  subnombre: { color: C.apagado, fontSize: 13 },

  chipVivo: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(233,164,74,0.16)', borderWidth: 1,
    borderColor: '#4A3A1E', paddingHorizontal: 11, paddingVertical: 6,
    borderRadius: 999,
  },
  chipMal: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(226,80,78,0.16)', borderWidth: 1,
    borderColor: C.bordeRojo, paddingHorizontal: 11, paddingVertical: 6,
    borderRadius: 999,
  },
  punto: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.acento },
  puntoMal: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.alerta },
  chipTexto: { color: C.acento, fontSize: 10, fontWeight: '700', letterSpacing: 0.7 },
  chipTextoMal: { color: C.alerta, fontSize: 10, fontWeight: '700', letterSpacing: 0.7 },

  panel: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: C.panel, borderTopWidth: 1, borderTopColor: C.borde,
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 20, paddingBottom: 24, gap: 14,
  },
  agarradera: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: C.borde, alignSelf: 'center',
  },
  grilla: { flexDirection: 'row', gap: 12 },
  celda: { flex: 1, gap: 5 },

  alertaCaja: {
    backgroundColor: C.alertaFondo, borderWidth: 1, borderColor: C.bordeRojo,
    borderRadius: 11, padding: 14, gap: 5,
  },
  alertaTitulo: { color: C.alertaTexto, fontSize: 15, fontWeight: '700' },
  alertaTexto: { color: '#B58A88', fontSize: 13, lineHeight: 18 },

  nota: {
    backgroundColor: C.campo, borderWidth: 1, borderColor: C.bordeSuave,
    borderRadius: 10, padding: 12,
  },
  notaTexto: { color: C.apagado, fontSize: 13, lineHeight: 18 },
});
