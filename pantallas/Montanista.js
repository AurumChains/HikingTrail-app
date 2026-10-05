import { useState, useEffect, useRef } from 'react';
import {
  View, Text, Pressable, StyleSheet, ScrollView, TextInput,
  ActivityIndicator, SafeAreaView,
} from 'react-native';
import * as Location from 'expo-location';
import MapView, { Polyline, Marker } from 'react-native-maps';
import { pedir } from '../api';
import { API } from '../config';
import { C, g } from '../estilos';
import {
  cargarCola, encolar, vaciarCola, limpiarCola,
  pendientes as contarPendientes,
} from '../cola';

/**
 * La mitad "montañista": elegir destino, empezar ruta, seguir el GPS,
 * pausar, terminar.
 *
 * El mapa es la pantalla, no una consecuencia de haber empezado. Antes
 * de salir se ve a donde se va y por donde; despues se ve por donde se
 * va yendo de verdad. Es la misma vista en dos momentos.
 */
export default function Montanista({ token, usuario, onSalir, onCambioRuta }) {
  const [ruta, setRuta] = useState(null);
  const [ubicacion, setUbicacion] = useState(null);
  const [puntos, setPuntos] = useState([]);
  const [enviados, setEnviados] = useState(0);
  const [pendientes, setPendientes] = useState(0);
  const [sinSenal, setSinSenal] = useState(false);
  const [estadisticas, setEstadisticas] = useState(null);
  const [mensaje, setMensaje] = useState('');

  // Con quien se comparte
  const [grupos, setGrupos] = useState([]);
  const [grupoElegido, setGrupoElegido] = useState(null);

  // A donde se va.
  //
  // `destino` es generico a proposito: { place_id?, name, lat, lon }.
  // Da igual si salio de un lugar guardado, de un toque en el mapa o
  // del buscador; de aqui para abajo el resto del codigo no distingue.
  // Esa indiferencia es la que permitio agregar las tres formas sin
  // tocar el calculo del camino ni el arranque de la ruta.
  const [lugares, setLugares] = useState([]);
  const [destino, setDestino] = useState(null);
  const [caminoPlan, setCaminoPlan] = useState(null);   // lo que sugiere el servicio
  const [infoPlan, setInfoPlan] = useState(null);       // "2,3 km" / "28 min"
  const [calculando, setCalculando] = useState(false);

  // Buscador por nombre
  const [busqueda, setBusqueda] = useState('');
  const [resultados, setResultados] = useState([]);
  const [buscando, setBuscando] = useState(false);
  const [guardando, setGuardando] = useState(false);

  // Permiso y posicion de partida (para centrar el mapa y para que el
  // servidor sepa desde donde calcular el camino).
  const [permiso, setPermiso] = useState('desconocido');
  const [posicionActual, setPosicionActual] = useState(null);

  const [rutaBloqueada, setRutaBloqueada] = useState(null);

  // El panel arranca plegado: lo que la persona quiere el 90% de las
  // veces es ver el mapa y tocar "Empezar". Elegir destino y grupo es
  // la excepcion, no el caso normal, asi que se despliega a proposito.
  const [panelAbierto, setPanelAbierto] = useState(false);

  const [pausada, setPausada] = useState(false);
  const [pausadaDesde, setPausadaDesde] = useState(null);
  const [segundosPausa, setSegundosPausa] = useState(0);
  const [paradas, setParadas] = useState(0);

  // Cajas que el callback del GPS lee actualizadas.
  // Si leyera useState veria el valor congelado del momento en que
  // se creo la funcion (normalmente null).
  const rutaRef = useRef(null);
  const tokenRef = useRef(token);
  const suscripcion = useRef(null);
  const mapaInicio = useRef(null);

  useEffect(() => { tokenRef.current = token; }, [token]);

  useEffect(() => {
    cargarCola().then(setPendientes);
    revisarPermiso();
    return () => soltarGPS();
  }, []);

  // Avisar a App.js si el mapa esta ocupando la pantalla
  useEffect(() => {
    if (onCambioRuta) onCambioRuta(Boolean(ruta));
  }, [ruta]);

  // Grupos y lugares se recargan cada vez que se vuelve a la pantalla
  // de inicio, no solo al abrir la app: si el usuario acaba de crear un
  // grupo en la otra pestana, tiene que aparecer aca sin reiniciar.
  useEffect(() => {
    if (!ruta) {
      cargarGrupos();
      cargarLugares();
    }
  }, [ruta]);

  // ---------------- Permiso y posicion ----------------

  /**
   * Mira el permiso SIN pedirlo.
   *
   * Preguntar apenas se abre la app es la forma mas rapida de que te
   * digan que no: la persona todavia no sabe para que lo quieres. El
   * dialogo del sistema se dispara recien cuando toca "Activar
   * ubicacion", que es cuando ya esta mirando un mapa vacio y entiende
   * por que hace falta.
   */
  async function revisarPermiso() {
    const { status } = await Location.getForegroundPermissionsAsync();
    setPermiso(status);
    if (status === 'granted') ubicarme();
  }

  async function pedirPermiso() {
    const { status } = await Location.requestForegroundPermissionsAsync();
    setPermiso(status);
    if (status === 'granted') ubicarme();
  }

  async function ubicarme() {
    try {
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      setPosicionActual(pos.coords);
    } catch (e) {
      setMensaje('No se pudo obtener tu ubicación');
    }
  }

  // ---------------- Datos de apoyo ----------------

  async function cargarGrupos() {
    const { ok, datos } = await pedir('/api/groups', { token });
    if (!ok) return;

    const lista = datos.grupos || [];
    setGrupos(lista);

    // Si pertenece a un solo grupo, viene marcado: es lo que va a
    // querer el 90% de las veces. Si tiene varios, elige a proposito.
    // En ningun caso se comparte sin que el usuario lo vea en pantalla.
    setGrupoElegido((actual) => {
      if (actual && lista.some((x) => x.id === actual)) return actual;
      return lista.length === 1 ? lista[0].id : null;
    });
  }

  async function cargarLugares() {
    const { ok, datos } = await pedir('/api/places', { token });
    if (ok) setLugares(datos.lugares || []);
  }

  // ---------------- Camino sugerido ----------------

  function quitarDestino() {
    setDestino(null);
    setCaminoPlan(null);
    setInfoPlan(null);
  }

  /**
   * Fija un destino y pide el camino.
   *
   * Recibe siempre la misma forma, venga de donde venga:
   *   { place_id?, name, lat, lon }
   */
  async function fijarDestino(nuevo) {
    // Volver a tocar el mismo lugar guardado lo deselecciona. Sin esto
    // no habria forma de arrepentirse y salir a caminar sin destino.
    if (destino && nuevo.place_id && destino.place_id === nuevo.place_id) {
      return quitarDestino();
    }

    setDestino(nuevo);
    setCaminoPlan(null);
    setInfoPlan(null);
    setMensaje('');
    setResultados([]);

    if (!posicionActual) {
      setMensaje('Necesito tu ubicación para calcular el camino');
      return;
    }

    setCalculando(true);
    const { ok, datos, sinRed } = await pedir('/api/routes/preview', {
      metodo: 'POST', token,
      cuerpo: {
        place_id: nuevo.place_id || null,
        dest_lat: nuevo.place_id ? null : nuevo.lat,
        dest_lon: nuevo.place_id ? null : nuevo.lon,
        dest_name: nuevo.name,
        lat: posicionActual.latitude,
        lon: posicionActual.longitude,
      },
    });
    setCalculando(false);

    if (sinRed) return setMensaje('No hay conexión con el servidor');

    // Que falle el camino NO cancela el destino: se puede salir igual
    // hacia "Casa", solo que sin linea de referencia dibujada.
    if (!ok) return setMensaje(datos?.error || 'No se pudo calcular el camino');

    setCaminoPlan(datos.camino);
    setInfoPlan({
      distancia: datos.distancia_texto,
      duracion: datos.duracion_texto,
    });

    // Encuadrar el mapa para que se vea el camino completo, no solo
    // el punto de partida.
    if (mapaInicio.current && datos.camino.length > 1) {
      mapaInicio.current.fitToCoordinates(datos.camino, {
        edgePadding: { top: 80, right: 60, bottom: 360, left: 60 },
        animated: true,
      });
    }
  }

  /**
   * Tocar el mapa fija el destino ahi.
   *
   * Es la forma mas directa de decir "quiero ir aqui" y no necesita ni
   * tener lugares guardados ni saber como se llama el sitio. Los
   * nombres que ves sobre el mapa (negocios, plazas) los pone Apple
   * Maps y react-native-maps NO entrega esos toques en iPhone: solo
   * llega la coordenada. Por eso el destino se llama "Punto en el
   * mapa" hasta que la persona lo bautice al guardarlo.
   */
  function tocarMapa(evento) {
    const c = evento.nativeEvent.coordinate;
    if (!c) return;
    fijarDestino({ name: 'Punto en el mapa', lat: c.latitude, lon: c.longitude });
  }

  async function buscar() {
    const q = busqueda.trim();
    if (q.length < 3) return setMensaje('Escribe al menos 3 letras');

    setMensaje('');
    setBuscando(true);
    const { ok, datos, sinRed } = await pedir(
      `/api/places/search?q=${encodeURIComponent(q)}` +
      (posicionActual
        ? `&lat=${posicionActual.latitude}&lon=${posicionActual.longitude}`
        : ''),
      { token }
    );
    setBuscando(false);

    if (sinRed) return setMensaje('No hay conexión con el servidor');
    if (!ok) return setMensaje(datos?.error || 'No se pudo buscar');

    setResultados(datos.resultados || []);
    if ((datos.resultados || []).length === 0) {
      setMensaje('No encontré nada con ese nombre');
    }
  }

  /**
   * Guarda el destino actual como lugar, para que la proxima vez sea
   * un boton y no una busqueda. Es como se llena la lista: usandola.
   */
  async function guardarDestino() {
    if (!destino || destino.place_id) return;

    // "Punto en el mapa" se repetiria al segundo guardado y el backend
    // lo rechazaria por el UNIQUE (user_id, name). Se numera para que
    // cada uno sea distinto; la persona puede renombrarlo despues.
    const nombre = destino.name === 'Punto en el mapa'
      ? `Punto ${lugares.length + 1}`
      : destino.name;

    setGuardando(true);
    const { ok, datos } = await pedir('/api/places', {
      metodo: 'POST', token,
      cuerpo: { name: nombre, lat: destino.lat, lon: destino.lon },
    });
    setGuardando(false);

    if (!ok) return setMensaje(datos?.error || 'No se pudo guardar el lugar');

    setDestino({ ...destino, place_id: datos.lugar.id, name: datos.lugar.name });
    setMensaje(`"${datos.lugar.name}" guardado en tus lugares`);
    cargarLugares();
  }

  // ---------------- GPS y cola ----------------

  async function escucharGPS() {
    suscripcion.current = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.High, timeInterval: 4000, distanceInterval: 6 },
      (posicion) => {
        const c = posicion.coords;
        setUbicacion(c);
        // Se dibuja ANTES de enviarlo: la linea no depende de la red.
        setPuntos((previos) => [
          ...previos,
          { latitude: c.latitude, longitude: c.longitude },
        ]);
        encolarYEnviar(c);
      }
    );
  }

  function soltarGPS() {
    if (suscripcion.current) {
      suscripcion.current.remove();
      suscripcion.current = null;
    }
  }

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

  // Reintento periodico mientras haya ruta activa
  useEffect(() => {
    if (!ruta) return;
    const temporizador = setInterval(intentarEnviar, 15000);
    return () => clearInterval(temporizador);
  }, [ruta]);

  // Cronometro de la parada: se recalcula desde la hora de inicio,
  // no sumando de a uno, asi no se desfasa si el celular se duerme.
  useEffect(() => {
    if (!pausada || !pausadaDesde) return;
    const reloj = setInterval(() => {
      setSegundosPausa(Math.floor((Date.now() - pausadaDesde) / 1000));
    }, 1000);
    return () => clearInterval(reloj);
  }, [pausada, pausadaDesde]);

  // ---------------- Acciones de ruta ----------------

  async function empezarRuta() {
    setMensaje('');
    setEstadisticas(null);
    setRutaBloqueada(null);

    if (permiso !== 'granted') {
      setMensaje('Necesito permiso de ubicación para trazar tu ruta.');
      return;
    }

    const { ok, datos, sinRed } = await pedir('/api/routes/start', {
      metodo: 'POST', token,
      cuerpo: {
        group_id: grupoElegido,
        place_id: destino && destino.place_id ? destino.place_id : null,
        dest_lat: destino && !destino.place_id ? destino.lat : null,
        dest_lon: destino && !destino.place_id ? destino.lon : null,
        dest_name: destino ? destino.name : null,
        lat: posicionActual ? posicionActual.latitude : null,
        lon: posicionActual ? posicionActual.longitude : null,
      },
    });

    if (sinRed) return setMensaje('No hay conexión con el servidor');
    if (!ok) {
      // El backend no solo dice "ya tienes una ruta activa": ademas
      // devuelve CUAL es, en datos.route_id. Con ese numero podemos
      // ofrecer cerrarla, en vez de dejar al usuario atrapado.
      if (datos?.route_id) {
        setRutaBloqueada(datos.route_id);
        return setMensaje('Quedó una ruta sin terminar de la vez anterior.');
      }
      return setMensaje(datos?.error || 'No se pudo iniciar la ruta');
    }

    rutaRef.current = datos.ruta.id;
    setRuta(datos.ruta);

    // El servidor devuelve el camino que de verdad guardo. Puede no ser
    // el mismo que se previsualizo (pasaron minutos, te moviste), asi
    // que mandan los suyos. Si viene vacio, se queda el de la vista
    // previa: mejor una referencia aproximada que ninguna.
    if (datos.camino) setCaminoPlan(datos.camino);
    if (datos.aviso) setMensaje(`Sin camino sugerido: ${datos.aviso}`);

    setPuntos([]);
    setEnviados(0);
    await limpiarCola();
    setPendientes(0);
    setSinSenal(false);
    setPausada(false);
    setPausadaDesde(null);
    setParadas(0);
    await escucharGPS();
  }

  async function cerrarRutaVieja() {
    setMensaje('Cerrando la ruta anterior...');

    const { ok, datos } = await pedir(`/api/routes/${rutaBloqueada}/finish`, {
      metodo: 'POST', token,
    });

    if (!ok) {
      return setMensaje(datos?.error || 'No se pudo cerrar la ruta anterior');
    }

    // Encadenar el arranque evita que el usuario tenga que dar dos
    // toques: cierra la vieja y arranca la nueva de una sola vez.
    await empezarRuta();
  }

  async function pausar() {
    setMensaje('');
    await intentarEnviar();

    const { ok, datos, sinRed } = await pedir(
      `/api/routes/${rutaRef.current}/pause`, { metodo: 'POST', token }
    );

    if (sinRed) return setMensaje('Sin conexión: no se pudo pausar');
    if (!ok) return setMensaje(datos?.error || 'No se pudo pausar');

    // Se suelta el GPS durante la parada. Parado, la senal "baila" unos
    // metros y esa deriva se sumaria como distancia que nunca caminaste.
    // Ademas ahorra bateria en una parada larga.
    soltarGPS();
    setPausada(true);
    setPausadaDesde(Date.now());
    setSegundosPausa(0);
  }

  async function reanudar() {
    setMensaje('');
    const { ok, datos, sinRed } = await pedir(
      `/api/routes/${rutaRef.current}/resume`, { metodo: 'POST', token }
    );

    if (sinRed) return setMensaje('Sin conexión: no se pudo reanudar');
    if (!ok) return setMensaje(datos?.error || 'No se pudo reanudar');

    setPausada(false);
    setPausadaDesde(null);
    setParadas((n) => n + 1);
    await escucharGPS();
  }

  async function terminarRuta() {
    const rutaId = rutaRef.current;
    soltarGPS();

    // Vaciar lo pendiente ANTES de cerrar, o las estadisticas
    // saldrian con la ruta a medias.
    for (let i = 0; i < 5 && contarPendientes() > 0; i++) {
      await intentarEnviar();
    }

    const { ok, datos } = await pedir(
      `/api/routes/${rutaId}/finish`, { metodo: 'POST', token }
    );

    if (ok) setEstadisticas(datos.estadisticas);
    else setMensaje(datos?.error || 'No se pudo terminar');

    rutaRef.current = null;
    setRuta(null);
    setPausada(false);
    setPausadaDesde(null);

    // El plan muere con la ruta: la proxima salida elige su destino.
    setCaminoPlan(null);
    setInfoPlan(null);
    setDestino(null);

    // Reubicarse para que el mapa de inicio no quede en el punto de
    // partida de la ruta que acaba de terminar.
    ubicarme();
  }

  function formatoReloj(segundos) {
    const m = Math.floor(segundos / 60);
    const s = segundos % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function coordenadaDe(d) {
    return { latitude: Number(d.lat), longitude: Number(d.lon) };
  }

  /** La linea de abajo de la cabecera, cuando el panel esta plegado. */
  function resumenPlegado() {
    if (infoPlan) return `${infoPlan.distancia} · ${infoPlan.duracion} caminando`;
    if (destino) return 'Sin camino calculado';

    const gr = grupos.find((x) => x.id === grupoElegido);
    return gr ? `${gr.name} te verá` : 'Nadie te verá';
  }

  // ---------------- Pantalla: ruta en curso ----------------

  if (ruta) {
    return (
      <View style={g.pantalla}>
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
            {/* El camino sugerido va PRIMERO para que quede debajo:
                en react-native-maps lo que se declara despues se
                dibuja encima. La linea real tiene que tapar al plan,
                no al reves. */}
            {caminoPlan && caminoPlan.length > 1 && (
              <Polyline
                coordinates={caminoPlan}
                strokeColor={C.apagado}
                strokeWidth={7}
                lineCap="round"
                lineJoin="round"
              />
            )}

            {puntos.length > 1 && (
              <Polyline
                coordinates={puntos}
                strokeColor={C.acento}
                strokeWidth={5}
                lineCap="round"
                lineJoin="round"
              />
            )}
            {puntos.length > 0 && (
              <Marker coordinate={puntos[0]} title="Inicio" pinColor={C.acento} />
            )}
            {destino && (
              <Marker
                coordinate={coordenadaDe(destino)}
                title={destino.name}
                description="Destino"
              />
            )}
          </MapView>
        ) : (
          <View style={g.centrado}>
            <ActivityIndicator color={C.acento} size="large" />
            <Text style={g.subtexto}>Buscando señal GPS…</Text>
          </View>
        )}

        <SafeAreaView style={e.encimaMapa} pointerEvents="box-none">
          <View style={pausada ? e.chipPausa : e.chip}>
            <View style={pausada ? e.puntitoGris : e.puntito} />
            <Text style={pausada ? e.chipTextoPausa : e.chipTexto}>
              {pausada ? 'EN PAUSA' : 'EN CURSO'}
            </Text>
          </View>
        </SafeAreaView>

        <View style={e.panel}>
          <View style={e.agarradera} />
          <Text style={e.nombreRuta}>{ruta.name}</Text>

          <View style={e.grilla}>
            <View style={e.celda}>
              <Text style={g.etiqueta}>PUNTOS</Text>
              <Text style={g.valorGrande}>{puntos.length}</Text>
            </View>
            <View style={e.celda}>
              <Text style={g.etiqueta}>ENVIADOS</Text>
              <Text style={g.valor}>{enviados}</Text>
            </View>
            <View style={e.celda}>
              <Text style={g.etiqueta}>EN COLA</Text>
              <Text style={pendientes > 0 ? g.valorRojo : g.valor}>{pendientes}</Text>
            </View>
          </View>

          {sinSenal && (
            <View style={e.avisoSinSenal}>
              <Text style={e.textoSinSenal}>
                Sin señal · {pendientes} punto{pendientes === 1 ? '' : 's'} guardado
                {pendientes === 1 ? '' : 's'} en el teléfono
              </Text>
            </View>
          )}

          {pausada && (
            <View style={e.tarjetaPausa}>
              <View>
                <Text style={g.etiqueta}>PARADA EN CURSO</Text>
                <Text style={e.reloj}>{formatoReloj(segundosPausa)}</Text>
              </View>
              <Text style={g.subtexto}>{paradas + 1}ª parada</Text>
            </View>
          )}

          {mensaje !== '' && <Text style={g.aviso}>{mensaje}</Text>}

          <View style={e.botonera}>
            <Pressable style={e.botonPrincipal} onPress={pausada ? reanudar : pausar}>
              <Text style={g.textoBoton}>{pausada ? 'Reanudar' : 'Pausar'}</Text>
            </Pressable>
            <Pressable style={e.botonRojoChico} onPress={terminarRuta}>
              <Text style={g.textoRojo}>Terminar</Text>
            </Pressable>
          </View>
        </View>
      </View>
    );
  }

  // ---------------- Pantalla: antes de salir ----------------

  return (
    <View style={g.pantalla}>
      {posicionActual ? (
        <MapView
          ref={mapaInicio}
          style={StyleSheet.absoluteFill}
          mapType="hybrid"
          userInterfaceStyle="dark"
          showsUserLocation
          // Un toque en cualquier parte del mapa fija el destino ahi.
          // Es la unica forma de elegir un sitio que no tiene nombre
          // ni esta guardado: "voy a esa esquina".
          onPress={tocarMapa}
          initialRegion={{
            latitude: posicionActual.latitude,
            longitude: posicionActual.longitude,
            latitudeDelta: 0.012,
            longitudeDelta: 0.012,
          }}
        >
          {caminoPlan && caminoPlan.length > 1 && (
            <Polyline
              coordinates={caminoPlan}
              strokeColor={C.acento}
              strokeWidth={6}
              lineCap="round"
              lineJoin="round"
            />
          )}
          {destino && (
            <Marker
              coordinate={coordenadaDe(destino)}
              title={destino.name}
              description="Destino"
            />
          )}
        </MapView>
      ) : (
        <View style={[StyleSheet.absoluteFill, g.centrado]}>
          <ActivityIndicator color={C.acento} />
          <Text style={g.subtexto}>
            {permiso === 'granted' ? 'Buscando tu ubicación…' : 'Mapa en espera'}
          </Text>
        </View>
      )}

      <SafeAreaView style={e.encimaMapa} pointerEvents="box-none">
        <View style={e.chipSaludo}>
          <Text style={e.chipTextoSaludo}>Hola, {usuario.name}</Text>
        </View>
      </SafeAreaView>

      <View style={panelAbierto ? e.panelInicio : e.panelCompacto}>
        {/* Toda la cabecera es el boton de abrir y cerrar: el area que
            se toca es grande, que es lo que necesita alguien mayor o
            caminando. Una flecha chica como unico blanco seria cruel. */}
        <Pressable onPress={() => setPanelAbierto((v) => !v)}>
          <View style={e.agarradera} />
          <View style={e.filaCabecera}>
            <View style={{ flex: 1 }}>
              <Text style={e.tituloCabecera}>
                {destino ? `Hacia ${destino.name}` : '¿A dónde vas?'}
              </Text>
              <Text style={e.subCabecera}>{resumenPlegado()}</Text>
            </View>
            <Text style={e.flecha}>{panelAbierto ? '⌄' : '⌃'}</Text>
          </View>
        </Pressable>

        {panelAbierto && (
        <ScrollView
          style={e.scrollOpciones}
          contentContainerStyle={e.contenidoPanel}
          showsVerticalScrollIndicator={false}
        >
          {permiso !== 'granted' && (
            <View style={e.tarjetaPermiso}>
              <Text style={g.subtexto}>
                Para trazar tu ruta y compartirla con tu familia necesito acceso
                a tu ubicación.
              </Text>
              <Pressable style={g.boton} onPress={pedirPermiso}>
                <Text style={g.textoBoton}>Activar ubicación</Text>
              </Pressable>
            </View>
          )}

          {estadisticas && (
            <View style={e.tarjetaResumen}>
              <Text style={g.etiqueta}>ÚLTIMA RUTA</Text>
              <View style={g.fila}>
                <Text style={g.dato}>Distancia</Text>
                <Text style={g.valorGrande}>{estadisticas.distancia_metros} m</Text>
              </View>
              <View style={g.fila}>
                <Text style={g.dato}>Caminando</Text>
                <Text style={g.valor}>{estadisticas.tiempo_caminando}</Text>
              </View>
              <View style={g.fila}>
                <Text style={g.dato}>Paradas</Text>
                <Text style={g.valor}>{estadisticas.total_paradas}</Text>
              </View>
            </View>
          )}

          <View style={{ gap: 10 }}>
            <Text style={g.etiqueta}>¿A DÓNDE VAS?</Text>

            <Text style={e.pista}>
              Toca el mapa donde quieras ir, búscalo por nombre, o elige uno de
              tus lugares guardados.
            </Text>

            <View style={e.filaBusqueda}>
              <TextInput
                style={[g.input, { flex: 1 }]}
                value={busqueda}
                onChangeText={setBusqueda}
                placeholder="Líder, Avenida Las Torres 123…"
                placeholderTextColor={C.placeholder}
                returnKeyType="search"
                onSubmitEditing={buscar}
                autoCorrect={false}
              />
              <Pressable style={e.botonBuscar} onPress={buscar} disabled={buscando}>
                {buscando
                  ? <ActivityIndicator color={C.acentoTexto} size="small" />
                  : <Text style={g.textoBoton}>Buscar</Text>}
              </Pressable>
            </View>

            {resultados.length > 0 && (
              <View style={e.listaResultados}>
                {resultados.map((r, i) => (
                  <Pressable
                    key={`${r.lat},${r.lon},${i}`}
                    style={e.resultado}
                    onPress={() => {
                      setBusqueda('');
                      fijarDestino({ name: r.nombre, lat: r.lat, lon: r.lon });
                    }}
                  >
                    <Text style={e.resultadoNombre}>{r.nombre}</Text>
                    {r.etiqueta !== '' && (
                      <Text style={e.resultadoEtiqueta} numberOfLines={1}>
                        {r.etiqueta}
                      </Text>
                    )}
                  </Pressable>
                ))}
              </View>
            )}

            {lugares.length > 0 && (
              <View style={e.opciones}>
                {lugares.map((lu) => {
                  const activo = destino && destino.place_id === lu.id;
                  return (
                    <Pressable
                      key={lu.id}
                      style={activo ? e.opcionActiva : e.opcion}
                      onPress={() => fijarDestino({
                        place_id: lu.id,
                        name: lu.name,
                        lat: Number(lu.lat),
                        lon: Number(lu.lon),
                      })}
                    >
                      <Text style={activo ? e.opcionTextoActivo : e.opcionTexto}>
                        {lu.name}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            )}

            {destino && (
              <View style={e.filaDestino}>
                <Text style={e.destinoTexto} numberOfLines={1}>
                  Destino: {destino.name}
                </Text>
                {!destino.place_id && (
                  <Pressable
                    style={e.botonChico}
                    disabled={guardando}
                    onPress={guardarDestino}
                  >
                    <Text style={e.textoChico}>
                      {guardando ? 'Guardando…' : 'Guardar lugar'}
                    </Text>
                  </Pressable>
                )}
                <Pressable style={e.botonChico} onPress={quitarDestino}>
                  <Text style={e.textoChico}>Quitar</Text>
                </Pressable>
              </View>
            )}
          </View>

          {calculando && (
            <View style={e.filaCalculando}>
              <ActivityIndicator color={C.acento} size="small" />
              <Text style={g.subtexto}>Calculando el camino…</Text>
            </View>
          )}

          {infoPlan && !calculando && (
            <View style={e.tarjetaPlan}>
              <Text style={e.planFuerte}>{infoPlan.distancia}</Text>
              <Text style={g.subtexto}>·</Text>
              <Text style={e.planFuerte}>{infoPlan.duracion}</Text>
              <Text style={g.subtexto}>caminando</Text>
            </View>
          )}

          <View style={{ gap: 10 }}>
            <Text style={g.etiqueta}>COMPARTIR CON</Text>

            {grupos.length === 0 ? (
              <Text style={e.pista}>
                No estás en ningún grupo. Ve a la pestaña Grupos para crear uno
                o unirte con un código. Sin grupo, nadie verá esta ruta.
              </Text>
            ) : (
              <View style={e.opciones}>
                {grupos.map((gr) => (
                  <Pressable
                    key={gr.id}
                    style={grupoElegido === gr.id ? e.opcionActiva : e.opcion}
                    onPress={() => setGrupoElegido(gr.id)}
                  >
                    <Text style={grupoElegido === gr.id ? e.opcionTextoActivo : e.opcionTexto}>
                      {gr.name}
                    </Text>
                  </Pressable>
                ))}

                {/* Nadie: la ruta se guarda igual, pero es privada. */}
                <Pressable
                  style={grupoElegido === null ? e.opcionActiva : e.opcion}
                  onPress={() => setGrupoElegido(null)}
                >
                  <Text style={grupoElegido === null ? e.opcionTextoActivo : e.opcionTexto}>
                    Solo yo
                  </Text>
                </Pressable>
              </View>
            )}
          </View>

          <Pressable style={g.botonSecundario} onPress={onSalir}>
            <Text style={g.textoSecundario}>Cerrar sesión</Text>
          </Pressable>
        </ScrollView>
        )}

        {/* El pie queda FUERA del ScrollView: "Empezar ruta" tiene que
            estar siempre a la vista, abierto o cerrado el panel. Si
            viviera dentro de la lista, con el panel abierto habria que
            hacer scroll para encontrar el boton principal. */}
        <View style={e.piePanel}>
          {mensaje !== '' && <Text style={g.aviso}>{mensaje}</Text>}

          {rutaBloqueada && (
            <Pressable style={g.botonSecundario} onPress={cerrarRutaVieja}>
              <Text style={g.textoSecundario}>Cerrar la ruta anterior y empezar</Text>
            </Pressable>
          )}

          <Pressable
            style={[g.boton, permiso !== 'granted' && g.opaco]}
            disabled={permiso !== 'granted'}
            onPress={empezarRuta}
          >
            <Text style={g.textoBoton}>
              {destino ? `Empezar ruta a ${destino.name}` : 'Empezar ruta'}
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const e = StyleSheet.create({
  pista: { color: C.tenue, fontSize: 13, lineHeight: 19 },

  opciones: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  opcion: {
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999,
    borderWidth: 1, borderColor: C.borde, backgroundColor: C.superficie,
  },
  opcionActiva: {
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999,
    borderWidth: 1, borderColor: C.acento, backgroundColor: 'rgba(233,164,74,0.14)',
  },
  opcionTexto: { color: C.apagado, fontSize: 14, fontWeight: '500' },
  opcionTextoActivo: { color: C.acento, fontSize: 14, fontWeight: '600' },

  encimaMapa: { position: 'absolute', top: 0, left: 0, right: 0, alignItems: 'center' },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    backgroundColor: 'rgba(15,18,17,0.92)', borderWidth: 1, borderColor: '#4A3A1E',
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, marginTop: 8,
  },
  chipPausa: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    backgroundColor: 'rgba(15,18,17,0.92)', borderWidth: 1, borderColor: C.borde,
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, marginTop: 8,
  },
  chipSaludo: {
    backgroundColor: 'rgba(15,18,17,0.92)', borderWidth: 1, borderColor: C.borde,
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, marginTop: 8,
  },
  chipTextoSaludo: { color: C.texto, fontSize: 14, fontWeight: '600' },
  puntito: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.acento },
  puntitoGris: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.apagado },
  chipTexto: { color: C.acento, fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  chipTextoPausa: { color: C.apagado, fontSize: 11, fontWeight: '700', letterSpacing: 1 },

  panel: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: C.panel, borderTopWidth: 1, borderTopColor: C.borde,
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 20, paddingBottom: 34, gap: 16,
  },
  // Abierto se limita al 72% de la pantalla: por debajo de eso el mapa
  // dejaria de verse, y el mapa es justamente el punto.
  panelInicio: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    maxHeight: '72%',
    backgroundColor: C.panel, borderTopWidth: 1, borderTopColor: C.borde,
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingTop: 12,
  },
  // Plegado: solo cabecera y boton. Sin maxHeight, porque el contenido
  // ya es corto y fijarle una altura lo dejaria con un hueco abajo.
  panelCompacto: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: C.panel, borderTopWidth: 1, borderTopColor: C.borde,
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingTop: 12,
  },
  // flexShrink deja que la lista ceda espacio al pie cuando el panel
  // llega a su altura maxima. Sin esto, el boton de empezar se iria
  // fuera de la pantalla con muchos lugares y grupos.
  scrollOpciones: { flexShrink: 1 },
  contenidoPanel: { padding: 20, paddingTop: 8, paddingBottom: 10, gap: 16 },
  piePanel: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 30, gap: 12 },

  filaCabecera: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 20, paddingTop: 10, paddingBottom: 4,
  },
  tituloCabecera: { color: C.texto, fontSize: 18, fontWeight: '700' },
  subCabecera: { color: C.apagado, fontSize: 13, marginTop: 2 },
  flecha: { color: C.tenue, fontSize: 22, fontWeight: '700', paddingHorizontal: 4 },

  agarradera: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: C.borde, alignSelf: 'center',
  },
  nombreRuta: { color: C.texto, fontSize: 20, fontWeight: '700' },
  grilla: { flexDirection: 'row', gap: 12 },
  celda: { flex: 1, gap: 5 },

  tarjetaPermiso: {
    borderWidth: 1, borderColor: '#4A3A1E', backgroundColor: '#15140F',
    borderRadius: 12, padding: 16, gap: 14,
  },
  tarjetaResumen: {
    borderWidth: 1, borderColor: C.borde, backgroundColor: C.superficie,
    borderRadius: 12, padding: 16, gap: 10,
  },
  tarjetaPlan: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1, borderColor: '#4A3A1E', backgroundColor: '#15140F',
    borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14,
  },
  planFuerte: { color: C.acento, fontSize: 18, fontWeight: '700' },
  filaCalculando: { flexDirection: 'row', alignItems: 'center', gap: 10 },

  filaBusqueda: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  botonBuscar: {
    height: 54, paddingHorizontal: 18, borderRadius: 10,
    backgroundColor: C.acento, alignItems: 'center', justifyContent: 'center',
  },
  listaResultados: {
    borderWidth: 1, borderColor: C.borde, backgroundColor: C.superficie,
    borderRadius: 12, overflow: 'hidden',
  },
  resultado: {
    paddingHorizontal: 14, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: C.bordeSuave, gap: 2,
  },
  resultadoNombre: { color: C.texto, fontSize: 15, fontWeight: '600' },
  resultadoEtiqueta: { color: C.tenue, fontSize: 12 },

  filaDestino: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1, borderColor: C.borde, backgroundColor: C.superficie,
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
  },
  destinoTexto: { color: C.texto, fontSize: 14, flex: 1 },
  botonChico: {
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8,
    borderWidth: 1, borderColor: C.borde, backgroundColor: C.superficie2,
  },
  textoChico: { color: C.apagado, fontSize: 13, fontWeight: '600' },

  avisoSinSenal: {
    backgroundColor: C.alertaFondo, borderWidth: 1, borderColor: C.bordeRojo,
    borderRadius: 10, padding: 12,
  },
  textoSinSenal: { color: C.alertaTexto, fontSize: 13 },

  tarjetaPausa: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: C.superficie2, borderWidth: 1, borderColor: C.borde,
    borderRadius: 12, padding: 15,
  },
  reloj: { color: C.texto, fontSize: 26, fontWeight: '600', marginTop: 2 },

  botonera: { flexDirection: 'row', gap: 10 },
  botonPrincipal: {
    flex: 1, height: 56, backgroundColor: C.acento, borderRadius: 11,
    alignItems: 'center', justifyContent: 'center',
  },
  botonRojoChico: {
    width: 132, height: 56, borderWidth: 1, borderColor: C.bordeRojo,
    borderRadius: 11, alignItems: 'center', justifyContent: 'center',
  },
});
