import { useState, useEffect, useRef } from 'react';
import {
  View, Text, Pressable, StyleSheet, ScrollView, TextInput,
  ActivityIndicator, SafeAreaView,
} from 'react-native';
import * as Location from 'expo-location';
import * as Battery from 'expo-battery';
import MapView, { Polyline, Marker } from 'react-native-maps';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { pedir } from '../api';
import { API } from '../config';
import { C, g } from '../estilos';
import {
  cargarCola, encolar, vaciarCola, limpiarCola,
  pendientes as contarPendientes,
} from '../cola';
import {
  MarcadoresInteres, HojaCompartirPunto, HojaPunto, puntoBajoElDedo,
} from './PuntosInteres';

/**
 * La mitad "montañista": elegir destino, empezar ruta, seguir el GPS,
 * pausar, terminar.
 *
 * El mapa es la pantalla, no una consecuencia de haber empezado. Antes
 * de salir se ve a donde se va y por donde; despues se ve por donde se
 * va yendo de verdad. Es la misma vista en dos momentos.
 */
// Metros que hay que alejarse del punto de pausa para que la ruta se
// reanude sola. 60 y no 40: parado, la senal del GPS "baila" entre 10 y
// 20 metros, y en ciudad mas. A 60 metros ya no hay duda de que la
// persona se movio de verdad.
const METROS_PARA_REANUDAR = 60;

// Cada cuanto se le cuenta al servidor como esta el telefono
// (ubicacion activada, bateria). Llega aunque la persona este quieta:
// es lo que le permite al servidor distinguir "no se mueve" de "su
// telefono desaparecio". Si pasan 5 minutos sin noticias, avisa al
// grupo.
const REPORTE_ESTADO_MS = 60 * 1000;

// Como se mueve la persona. El id es el que entiende el servidor
// (active_routes.travel_mode); el icono es el peaton del semaforo y el
// auto, que se entienden sin leer.
const MODOS = [
  { id: 'walking', icono: 'directions-walk', etiqueta: 'A pie', enFrase: 'caminando' },
  { id: 'driving', icono: 'directions-car', etiqueta: 'En auto', enFrase: 'en auto' },
];
const modoInfo = (id) => MODOS.find((m) => m.id === id) || MODOS[0];

// Cada cuantos metros se toma un punto GPS. En auto 15 y no 6: a 50 km/h
// el auto avanza 14 m por segundo, y un punto cada 6 m llenaria la cola
// y la base de puntos que no agregan nada a la linea del mapa.
const METROS_ENTRE_PUNTOS = { walking: 6, driving: 15 };

/**
 * Distancia en metros entre dos coordenadas (formula de Haversine).
 *
 * Se calcula en el telefono y no en el servidor a proposito: durante
 * la pausa no se manda nada a la red, asi que la comprobacion tiene
 * que poder hacerse sin conexion.
 */
function distanciaMetros(a, b) {
  const R = 6371000;
  const aLat = (a.latitude * Math.PI) / 180;
  const bLat = (b.latitude * Math.PI) / 180;
  const dLat = bLat - aLat;
  const dLon = ((b.longitude - a.longitude) * Math.PI) / 180;

  const h = Math.sin(dLat / 2) ** 2 +
            Math.cos(aLat) * Math.cos(bLat) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export default function Montanista({
  token, usuario, visible = true, onCambioRuta, puntoEnfocado = null,
}) {
  const [ruta, setRuta] = useState(null);
  const [ubicacion, setUbicacion] = useState(null);
  const [puntos, setPuntos] = useState([]);
  const [enviados, setEnviados] = useState(0);
  const [pendientes, setPendientes] = useState(0);
  const [sinSenal, setSinSenal] = useState(false);
  const [ubicacionApagada, setUbicacionApagada] = useState(false);

  // Lo ultimo que dijo el servidor sobre el desvio: { fuera_de_ruta, desvio_m }
  const [desvio, setDesvio] = useState(null);
  // Texto del aviso "te trazamos un camino nuevo", o null. Se muestra
  // unos segundos y se va solo.
  const [avisoNuevoCamino, setAvisoNuevoCamino] = useState(null);
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
  const [infoPlan, setInfoPlan] = useState(null);       // { distancia, duracion, modo }
  const [calculando, setCalculando] = useState(false);

  // A pie o en auto. Se elige antes de salir y se puede cambiar durante
  // la ruta. Queda elegido para la proxima salida: quien va en auto al
  // trabajo no tiene que tocarlo todos los dias.
  const [modo, setModo] = useState('walking');
  const [cambiandoModo, setCambiandoModo] = useState(false);

  // Puntos de interes recibidos (ver PuntosInteres.js)
  const [puntosInteres, setPuntosInteres] = useState([]);
  // latitudeDelta del mapa a la vista: decide si se ven los comentarios.
  const [zoom, setZoom] = useState(null);
  // Donde se mantuvo pulsado el mapa para compartir un punto, o null.
  const [coordCompartir, setCoordCompartir] = useState(null);
  // El punto cuyo menu esta abierto, o null.
  const [puntoAbierto, setPuntoAbierto] = useState(null);
  // El punto recien recibido desde el chat: muestra su comentario aunque
  // el mapa este lejos, por unos segundos.
  const [destacado, setDestacado] = useState(null);
  // Durante la ruta el mapa sigue a la persona. Al ir a ver un punto se
  // suelta, o el mapa volveria a la persona al instante.
  const [seguirme, setSeguirme] = useState(true);

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
  // El modo que lee escucharGPS al arrancar el GPS. Es un ref por lo
  // mismo que rutaRef: se usa justo despues de cambiarlo, antes de que
  // React vuelva a dibujar.
  const modoRef = useRef('walking');
  // Numero del ultimo pedido de camino. Si se toca "A pie" y "En auto"
  // seguido, las respuestas pueden llegar al reves; solo vale la ultima.
  const pedidoCamino = useRef(0);
  const mapaRuta = useRef(null);
  // La region a la vista, para saber si una pulsacion larga cayo sobre
  // un punto de interes (puntoBajoElDedo).
  const regionRef = useRef(null);
  // El ultimo pedido de "ver este punto" ya atendido.
  const enfocadoRef = useRef(null);
  // Cuando fue la ultima pulsacion larga (ver tocarMapa).
  const ultimaPulsacionLarga = useRef(0);

  // Vigilancia durante la pausa: donde se pauso, y el watcher de
  // baja precision que comprueba si la persona empezo a moverse.
  const anclaPausa = useRef(null);
  const vigilancia = useRef(null);

  useEffect(() => { tokenRef.current = token; }, [token]);

  useEffect(() => {
    cargarCola().then(setPendientes);
    revisarPermiso();
    retomarRutaActiva();
    return () => { soltarGPS(); soltarVigilancia(); };
  }, []);

  // Avisar a App.js si el mapa esta ocupando la pantalla
  useEffect(() => {
    if (onCambioRuta) onCambioRuta(Boolean(ruta));
  }, [ruta]);

  // Grupos y lugares se recargan cada vez que se vuelve a la pantalla
  // de inicio, no solo al abrir la app: si el usuario acaba de crear un
  // grupo en la otra pestana, tiene que aparecer aca sin reiniciar.
  // Esta pantalla ya no se desmonta al cambiar de pestana (App.js solo
  // la oculta), asi que "volver a ella" se detecta con `visible`.
  useEffect(() => {
    if (!ruta && visible) {
      cargarGrupos();
      cargarLugares();
    }
  }, [ruta, visible]);

  // Los puntos de interes, en las dos pantallas. Al volver a la pestaña
  // pudo haber recibido uno nuevo desde el chat.
  useEffect(() => {
    if (visible) cargarPuntos();
  }, [visible]);

  // El chat pidio mostrar un punto ("Recibir punto de interes").
  useEffect(() => {
    if (!visible || !puntoEnfocado || enfocadoRef.current === puntoEnfocado.pedido) return;
    enfocadoRef.current = puntoEnfocado.pedido;
    enfocarPunto(puntoEnfocado);
  }, [puntoEnfocado, visible]);

  useEffect(() => {
    if (destacado === null) return;
    const t = setTimeout(() => setDestacado(null), 20000);
    return () => clearTimeout(t);
  }, [destacado]);

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

  // ---------------- Puntos de interes ----------------

  async function cargarPuntos() {
    const { ok, datos } = await pedir('/api/points', { token });
    if (ok) setPuntosInteres(datos.puntos || []);
  }

  /** Lleva el mapa a la vista hasta un punto recien recibido. */
  async function enfocarPunto(p) {
    await cargarPuntos();
    setDestacado(p.id);

    const mapa = rutaRef.current ? mapaRuta.current : mapaInicio.current;
    if (!mapa) {
      return setMensaje('Punto guardado en tu mapa. Aparecerá cuando el mapa tenga tu ubicación.');
    }
    if (rutaRef.current) setSeguirme(false);

    // Un instante para que la pestaña termine de mostrarse: un mapa que
    // se anima estando oculto no se mueve.
    setTimeout(() => {
      mapa.animateToRegion(
        { latitude: p.lat, longitude: p.lon, latitudeDelta: 0.0025, longitudeDelta: 0.0025 },
        700
      );
    }, 350);
  }

  function cambioRegion(region) {
    regionRef.current = region;
    setZoom(region.latitudeDelta);
  }

  /**
   * Mantener pulsado el mapa. Si cayo sobre un punto de interes, abre su
   * menu; si no, ofrece compartir ese lugar.
   */
  function mantenerMapa(evento) {
    ultimaPulsacionLarga.current = Date.now();
    const c = evento.nativeEvent.coordinate;
    if (!c) return;

    const p = puntoBajoElDedo(puntosInteres, c, regionRef.current);
    if (p) return setPuntoAbierto(p);

    // Los grupos (y en cuales es propietario) pueden haber cambiado,
    // sobre todo durante una ruta, que no los recarga.
    cargarGrupos();
    setCoordCompartir({ latitude: c.latitude, longitude: c.longitude });
  }

  function cambioPunto({ eliminado, punto }) {
    if (eliminado) setPuntosInteres((l) => l.filter((x) => x.id !== eliminado));
    if (punto) setPuntosInteres((l) => l.map((x) => (x.id === punto.id ? punto : x)));
    setPuntoAbierto(null);
    setMensaje(eliminado ? 'Punto eliminado de tu mapa.' : 'El punto quedó permanente en tu mapa.');
  }

  function volverAMi() {
    setSeguirme(true);
    if (ubicacion && mapaRuta.current) {
      mapaRuta.current.animateToRegion({
        latitude: ubicacion.latitude, longitude: ubicacion.longitude,
        latitudeDelta: 0.004, longitudeDelta: 0.004,
      }, 600);
    }
  }

  // Las mismas dos hojas en las dos pantallas (antes de salir y en ruta).
  const hojasInteres = (
    <>
      <HojaCompartirPunto
        coordenada={coordCompartir}
        grupos={grupos}
        token={token}
        onCerrar={() => setCoordCompartir(null)}
        onCompartido={(texto) => { setCoordCompartir(null); setMensaje(texto); }}
      />
      <HojaPunto
        punto={puntoAbierto}
        token={token}
        onCerrar={() => setPuntoAbierto(null)}
        onCambio={cambioPunto}
      />
    </>
  );

  // ---------------- Camino sugerido ----------------

  function quitarDestino() {
    // Un camino que todavia venia en camino ya no tiene destino al que
    // pertenecer: se descarta al llegar.
    pedidoCamino.current++;
    setCalculando(false);
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
    setResultados([]);
    await pedirCamino(nuevo, modo);
  }

  /**
   * Antes de salir: cambiar entre a pie y en auto vuelve a pedir el
   * camino, porque no es el mismo (en auto no se cruza una plaza, a pie
   * no se toma la autopista).
   */
  function elegirModo(nuevo) {
    if (nuevo === modo) return;
    setModo(nuevo);
    modoRef.current = nuevo;
    if (destino) pedirCamino(destino, nuevo);
  }

  /** Pide al servidor el camino hasta `dest` en el modo indicado. */
  async function pedirCamino(dest, modoCamino) {
    setCaminoPlan(null);
    setInfoPlan(null);
    setMensaje('');

    if (!posicionActual) {
      setMensaje('Necesito tu ubicación para calcular el camino');
      return;
    }

    const numero = ++pedidoCamino.current;
    setCalculando(true);
    const { ok, datos, sinRed } = await pedir('/api/routes/preview', {
      metodo: 'POST', token,
      cuerpo: {
        place_id: dest.place_id || null,
        dest_lat: dest.place_id ? null : dest.lat,
        dest_lon: dest.place_id ? null : dest.lon,
        dest_name: dest.name,
        lat: posicionActual.latitude,
        lon: posicionActual.longitude,
        modo: modoCamino,
      },
    });

    // Mientras esperaba, la persona pidio otro camino (otro destino u
    // otro modo): esta respuesta ya no es la que esta mirando.
    if (numero !== pedidoCamino.current) return;
    setCalculando(false);

    if (sinRed) return setMensaje('No hay conexión con el servidor');

    // Que falle el camino NO cancela el destino: se puede salir igual
    // hacia "Casa", solo que sin linea de referencia dibujada.
    if (!ok) return setMensaje(datos?.error || 'No se pudo calcular el camino');

    setCaminoPlan(datos.camino);
    setInfoPlan({
      distancia: datos.distancia_texto,
      duracion: datos.duracion_texto,
      modo: modoCamino,
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
    // Tocar un marcador (un punto de interes, para leer su comentario)
    // en iPhone tambien llega como toque del mapa: no es "voy ahi".
    if (evento.nativeEvent.action === 'marker-press') return;
    // Y el final de una pulsacion larga puede llegar como toque: esa
    // pulsacion ya abrio la hoja de puntos de interes.
    if (Date.now() - ultimaPulsacionLarga.current < 1000) return;

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
      {
        accuracy: Location.Accuracy.High,
        timeInterval: 4000,
        distanceInterval: METROS_ENTRE_PUNTOS[modoRef.current] || METROS_ENTRE_PUNTOS.walking,
      },
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

  /**
   * GPS en "modo vigilancia" mientras la ruta esta pausada.
   *
   * Precision baja y solo despierta cada 50 metros: NO graba la ruta,
   * solo comprueba si la persona volvio a caminar. Gasta poca bateria
   * justamente porque casi nunca se dispara.
   *
   * Existe porque pausar y olvidarse es un fallo real y peligroso: el
   * familiar se queda mirando un punto congelado creyendo que es la
   * posicion actual.
   */
  async function vigilarMovimiento() {
    vigilancia.current = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.Balanced, timeInterval: 20000, distanceInterval: 50 },
      (posicion) => {
        const ancla = anclaPausa.current;
        if (!ancla) return;

        const c = posicion.coords;
        const metros = distanciaMetros(ancla, c);

        if (metros >= METROS_PARA_REANUDAR) {
          soltarVigilancia();
          reanudar(true);
        }
      }
    );
  }

  function soltarVigilancia() {
    if (vigilancia.current) {
      vigilancia.current.remove();
      vigilancia.current = null;
    }
    anclaPausa.current = null;
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

    // Solo se pisa cuando el servidor dijo algo. Si el envio fallo, se
    // conserva el ultimo estado conocido en vez de borrarlo: quedarse
    // sin aviso por un problema de red seria lo peor que podria pasar.
    if (resultado.desvio) setDesvio(resultado.desvio);

    // Se alejo mas de 100 m y el servidor le trazo un camino nuevo
    // desde donde esta, hacia el mismo destino. Se reemplaza la linea
    // del mapa; los puntos, la distancia y el tiempo siguen igual,
    // porque es la misma ruta.
    if (resultado.desvio?.recalculado && resultado.desvio.camino?.length > 1) {
      setCaminoPlan(resultado.desvio.camino);
      setAvisoNuevoCamino(
        `Te alejaste ${resultado.desvio.desvio_m} m del camino. Te trazamos uno nuevo ` +
        `desde aquí (${resultado.desvio.distancia_texto}). Tu grupo recibió un aviso.`
      );
    }
  }

  useEffect(() => {
    if (!avisoNuevoCamino) return;
    const t = setTimeout(() => setAvisoNuevoCamino(null), 12000);
    return () => clearTimeout(t);
  }, [avisoNuevoCamino]);

  // Reintento periodico mientras haya ruta activa
  useEffect(() => {
    if (!ruta) return;
    const temporizador = setInterval(intentarEnviar, 15000);
    return () => clearInterval(temporizador);
  }, [ruta]);

  // Reporte de estado mientras haya ruta, pausada o no. En pausa
  // tambien importa: una bateria que se agota o una ubicacion apagada
  // son noticia aunque la persona este detenida a proposito.
  useEffect(() => {
    if (!ruta) return;
    reportarEstado();
    const temporizador = setInterval(reportarEstado, REPORTE_ESTADO_MS);
    return () => clearInterval(temporizador);
  }, [ruta]);

  /**
   * Le cuenta al servidor como esta el telefono. El servidor decide si
   * eso amerita un aviso en el chat del grupo; la app solo informa.
   *
   * Nunca lanza error: si algo falla (sin red, sin sensor de bateria),
   * se intenta de nuevo en el proximo minuto.
   */
  async function reportarEstado() {
    const rutaId = rutaRef.current;
    if (!rutaId) return;

    let ubicacionActiva = null;
    try {
      ubicacionActiva = await Location.hasServicesEnabledAsync();
      setUbicacionApagada(!ubicacionActiva);
    } catch (e) { /* sin dato: el servidor no cambia nada */ }

    let bateria = null;
    let cargando = false;
    try {
      const energia = await Battery.getPowerStateAsync();
      // -1 = el sistema no sabe (emuladores). Mejor no mandar nada
      // que mandar un 0% inventado y disparar un aviso falso.
      if (energia.batteryLevel >= 0) bateria = energia.batteryLevel;
      cargando = energia.batteryState === Battery.BatteryState.CHARGING ||
                 energia.batteryState === Battery.BatteryState.FULL;
    } catch (e) { /* sin dato */ }

    await pedir(`/api/routes/${rutaId}/status`, {
      metodo: 'POST',
      token: tokenRef.current,
      cuerpo: { ubicacion_activa: ubicacionActiva, bateria, cargando },
    });
  }

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
        modo,
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
    const modoGuardado = datos.ruta.travel_mode || modo;
    modoRef.current = modoGuardado;
    setModo(modoGuardado);
    setRuta(datos.ruta);

    // El servidor devuelve el camino que de verdad guardo. Puede no ser
    // el mismo que se previsualizo (pasaron minutos, te moviste), asi
    // que mandan los suyos. Si viene vacio, se queda el de la vista
    // previa: mejor una referencia aproximada que ninguna.
    if (datos.camino) setCaminoPlan(datos.camino);
    if (datos.aviso) setMensaje(`Sin camino sugerido: ${datos.aviso}`);

    setPuntos([]);
    setEnviados(0);
    setDesvio(null);
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

  /**
   * Al abrir la app: si quedo una ruta en curso, se retoma tal cual.
   *
   * Pasa cuando la persona cierra la app, el sistema la mata para
   * liberar memoria o el telefono se reinicia. Sin esto, la ruta seguia
   * abierta en el servidor (el grupo la veia "en ruta") pero aqui se
   * volvia a la pantalla de inicio, sin GPS: el peor de los dos mundos.
   *
   * Se recupera todo desde el servidor: los puntos ya enviados (la
   * linea recorrida), el camino sugerido, el destino y si estaba en
   * pausa. Los puntos que no alcanzaron a subir siguen en la cola del
   * disco y se envian solos, porque la cola ya conoce esta ruta.
   */
  async function retomarRutaActiva() {
    const activa = await pedir('/api/routes/active', { token });
    if (!activa.ok || !activa.datos?.route_id) return;

    const { ok, datos } = await pedir(`/api/routes/${activa.datos.route_id}`, { token });
    if (!ok || !datos?.ruta?.is_active) return;

    // Si mientras tanto la persona ya empezo otra cosa, no se pisa.
    if (rutaRef.current) return;

    const recorridos = (datos.puntos || []).map((p) => ({
      latitude: Number(p.lat),
      longitude: Number(p.lon),
    }));

    rutaRef.current = datos.ruta.id;
    // El modo con el que iba: decide cada cuantos metros se toma un
    // punto al volver a encender el GPS mas abajo.
    const modoGuardado = datos.ruta.travel_mode || 'walking';
    modoRef.current = modoGuardado;
    setModo(modoGuardado);
    setPuntos(recorridos);
    setEnviados(recorridos.length);
    setCaminoPlan(datos.camino || null);
    setDestino(datos.destino || null);
    if (datos.plan) {
      setInfoPlan({
        distancia: datos.plan.distancia_texto,
        duracion: datos.plan.duracion_texto,
        modo: modoGuardado,
      });
    }
    setDesvio(null);
    setEstadisticas(null);
    setParadas((datos.paradas || []).filter((p) => p.end_time).length);

    // El mapa de la ruta se dibuja recien cuando hay `ubicacion`. Con la
    // ultima posicion conocida aparece al tiro, sin esperar al GPS (y en
    // pausa, que no hay GPS de alta precision, es la unica que habra).
    const ultimo = recorridos[recorridos.length - 1];
    if (ultimo) setUbicacion(ultimo);

    setRuta(datos.ruta);

    const { status } = await Location.getForegroundPermissionsAsync();
    if (status !== 'granted') {
      setMensaje('Tu ruta sigue en curso, pero necesito permiso de ubicación para seguir trazándola.');
      return;
    }

    if (datos.ruta.status === 'paused') {
      // La parada abierta dice desde cuando esta en pausa.
      const abierta = (datos.paradas || []).find((p) => !p.end_time);
      setPausada(true);
      setPausadaDesde(abierta ? new Date(abierta.start_time).getTime() : Date.now());
      if (ultimo) {
        anclaPausa.current = ultimo;
        await vigilarMovimiento();
      }
      setMensaje('Retomamos tu ruta. Sigue en pausa.');
    } else {
      await escucharGPS();
      setMensaje('Retomamos tu ruta donde la dejaste.');
    }
  }

  async function pausar() {
    setMensaje('');
    await intentarEnviar();

    const { ok, datos, sinRed } = await pedir(
      `/api/routes/${rutaRef.current}/pause`, { metodo: 'POST', token }
    );

    if (sinRed) return setMensaje('Sin conexión: no se pudo pausar');
    if (!ok) return setMensaje(datos?.error || 'No se pudo pausar');

    // Se suelta el GPS de alta precision durante la parada. Parado, la
    // senal "baila" unos metros y esa deriva se sumaria como distancia
    // que nunca caminaste. Ademas ahorra bateria en una parada larga.
    soltarGPS();
    setPausada(true);
    setPausadaDesde(Date.now());
    setSegundosPausa(0);

    // Pero no se queda ciego: se ancla el punto de pausa y se vigila
    // con bajo consumo por si la persona empieza a caminar otra vez.
    if (ubicacion) {
      anclaPausa.current = {
        latitude: ubicacion.latitude,
        longitude: ubicacion.longitude,
      };
      await vigilarMovimiento();
    }
  }

  /**
   * @param {boolean} automatico - true si lo dispara la vigilancia
   *   porque la persona se movio, false si toco el boton.
   */
  async function reanudar(automatico = false) {
    setMensaje('');
    soltarVigilancia();

    const { ok, datos, sinRed } = await pedir(
      `/api/routes/${rutaRef.current}/resume`, { metodo: 'POST', token }
    );

    if (sinRed) return setMensaje('Sin conexión: no se pudo reanudar');
    if (!ok) return setMensaje(datos?.error || 'No se pudo reanudar');

    setPausada(false);
    setPausadaDesde(null);
    setParadas((n) => n + 1);

    // Se avisa SIEMPRE que fue automatico. Volver a compartir la
    // ubicacion sin decirlo seria exactamente lo que esta app no hace.
    if (automatico) {
      setMensaje('Se reanudó la ruta porque empezaste a moverte.');
    }

    await escucharGPS();
  }

  /**
   * Cambiar de a pie a auto (o al reves) sin terminar la ruta.
   *
   * El servidor guarda el modo, traza el camino de nuevo en el modo
   * nuevo desde donde esta la persona y avisa al grupo. Aqui se cambia
   * el camino del mapa y cada cuantos metros se toma un punto.
   *
   * Sin conexion no se cambia: el modo decide el desvio en el servidor,
   * y si el telefono creyera ir en auto mientras el servidor sigue en
   * "a pie", los avisos no coincidirian con lo que se ve en pantalla.
   */
  async function cambiarModoEnRuta(nuevo) {
    if (nuevo === modo || cambiandoModo) return;

    setMensaje('');
    setCambiandoModo(true);
    const { ok, datos, sinRed } = await pedir(`/api/routes/${rutaRef.current}/mode`, {
      metodo: 'POST', token,
      cuerpo: {
        modo: nuevo,
        lat: ubicacion ? ubicacion.latitude : undefined,
        lon: ubicacion ? ubicacion.longitude : undefined,
      },
    });
    setCambiandoModo(false);

    if (sinRed) return setMensaje('Sin conexión: no se pudo cambiar el modo de transporte');
    if (!ok) return setMensaje(datos?.error || 'No se pudo cambiar el modo de transporte');

    modoRef.current = datos.modo;
    setModo(datos.modo);
    setDesvio(null);
    setAvisoNuevoCamino(null);

    if (datos.camino && datos.camino.length > 1) {
      setCaminoPlan(datos.camino);
      setInfoPlan({
        distancia: datos.distancia_texto,
        duracion: datos.duracion_texto,
        modo: datos.modo,
      });
    }

    // El GPS se vuelve a encender con la distancia entre puntos del modo
    // nuevo. En pausa no hay GPS de alta precision: lo tomara al
    // reanudar, porque escucharGPS lee modoRef.
    if (!pausada) {
      soltarGPS();
      await escucharGPS();
    }

    const frase = datos.modo === 'driving' ? 'Ahora vas en auto.' : 'Ahora vas a pie.';
    setMensaje(
      datos.aviso ||
      (ruta?.group_id ? `${frase} Tu grupo recibió un aviso.` : frase)
    );
  }

  async function terminarRuta() {
    const rutaId = rutaRef.current;
    // Donde termina: el servidor la compara con el destino para avisar
    // al grupo si llego o si cancelo el viaje (y donde).
    const final = ubicacion
      ? { lat: ubicacion.latitude, lon: ubicacion.longitude }
      : undefined;
    soltarGPS();
    soltarVigilancia();

    // Vaciar lo pendiente ANTES de cerrar, o las estadisticas
    // saldrian con la ruta a medias.
    for (let i = 0; i < 5 && contarPendientes() > 0; i++) {
      await intentarEnviar();
    }

    const { ok, datos } = await pedir(
      `/api/routes/${rutaId}/finish`, { metodo: 'POST', token, cuerpo: final }
    );

    if (ok) setEstadisticas({ ...datos.estadisticas, resultado: datos.resultado });
    else setMensaje(datos?.error || 'No se pudo terminar');

    rutaRef.current = null;
    setRuta(null);
    setUbicacionApagada(false);
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
    if (infoPlan) {
      return `${infoPlan.distancia} · ${infoPlan.duracion} ${modoInfo(infoPlan.modo).enFrase}`;
    }
    if (destino) return 'Sin camino calculado';

    const gr = grupos.find((x) => x.id === grupoElegido);
    const quien = gr ? `${gr.name} te verá` : 'Nadie te verá';
    return `${quien} · ${modoInfo(modo).etiqueta.toLowerCase()}`;
  }

  // ---------------- Pantalla: ruta en curso ----------------

  if (ruta) {
    return (
      <View style={g.pantalla}>
        {ubicacion ? (
          <MapView
            ref={mapaRuta}
            style={StyleSheet.absoluteFill}
            mapType="hybrid"
            userInterfaceStyle="dark"
            showsUserLocation
            followsUserLocation={seguirme}
            onLongPress={mantenerMapa}
            onRegionChangeComplete={cambioRegion}
            // Arrastrar el mapa a mano tambien suelta el seguimiento: si
            // no, en iPhone volveria a la persona apenas se suelta.
            onPanDrag={() => { if (seguirme) setSeguirme(false); }}
            initialRegion={{
              latitude: ubicacion.latitude,
              longitude: ubicacion.longitude,
              latitudeDelta: 0.004,
              longitudeDelta: 0.004,
            }}
          >
            {/* El camino sugerido va PRIMERO para que quede debajo:
                en react-native-maps lo que se declara despues se
                dibuja encima. Lo recorrido, apagado, tapa el tramo del
                plan que ya se camino; lo que falta queda brillante. */}
            {caminoPlan && caminoPlan.length > 1 && (
              <Polyline
                coordinates={caminoPlan}
                strokeColor={C.ruta}
                strokeWidth={6}
                lineCap="round"
                lineJoin="round"
              />
            )}

            {puntos.length > 1 && (
              <Polyline
                coordinates={puntos}
                strokeColor={C.rutaRecorrida}
                strokeWidth={7}
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
            <MarcadoresInteres
              puntos={puntosInteres}
              zoom={zoom}
              destacado={destacado}
              onAbrir={setPuntoAbierto}
            />
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

          {/* Quien camina se entera ANTES que su familia. No es un
              castigo por salirse: muchas veces el desvio es voluntario
              (una calle cortada) y basta con saber que el aviso salio. */}
          {desvio?.fuera_de_ruta && !pausada && (
            <View style={e.chipDesvio}>
              <Text style={e.chipTextoDesvio}>
                FUERA DEL CAMINO · {desvio.desvio_m} m
              </Text>
            </View>
          )}

          {avisoNuevoCamino && !pausada && (
            <Pressable style={e.cajaNuevoCamino} onPress={() => setAvisoNuevoCamino(null)}>
              <Text style={e.tituloNuevoCamino}>NUEVO CAMINO</Text>
              <Text style={e.textoNuevoCamino}>{avisoNuevoCamino}</Text>
            </Pressable>
          )}

          {!seguirme && (
            <Pressable style={e.chipVolver} onPress={volverAMi}>
              <MaterialIcons name="my-location" size={16} color={C.acento} />
              <Text style={e.chipTextoVolver}>Volver a mi ubicación</Text>
            </Pressable>
          )}
        </SafeAreaView>

        <View style={e.panel}>
          <View style={e.agarradera} />
          <View style={e.filaNombre}>
            <Text style={[e.nombreRuta, { flex: 1 }]} numberOfLines={2}>{ruta.name}</Text>
            {/* Se cambia sin terminar la ruta: bajarse del auto y seguir
                a pie es la misma salida, y el grupo la sigue viendo igual. */}
            <SelectorModo
              compacto
              modo={modo}
              ocupado={cambiandoModo}
              onCambiar={cambiarModoEnRuta}
            />
          </View>

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

          {ubicacionApagada && (
            <View style={e.avisoSinSenal}>
              <Text style={e.textoSinSenal}>
                La ubicación del teléfono está desactivada.
                {ruta.group_id ? ' Tu grupo fue avisado.' : ''} Actívala para seguir compartiendo tu ruta.
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
            {/* La flecha es obligatoria: sin ella, onPress le pasaria el
                evento del toque como primer argumento y reanudar() lo
                interpretaria como automatico = true. */}
            <Pressable style={e.botonPrincipal} onPress={() => (pausada ? reanudar() : pausar())}>
              <Text style={g.textoBoton}>{pausada ? 'Reanudar' : 'Pausar'}</Text>
            </Pressable>
            <Pressable style={e.botonRojoChico} onPress={terminarRuta}>
              <Text style={g.textoRojo}>Terminar</Text>
            </Pressable>
          </View>
        </View>

        {hojasInteres}
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
          // Mantener pulsado: compartir un punto de interes, o abrir el
          // menu de uno que ya esta en el mapa.
          onLongPress={mantenerMapa}
          onRegionChangeComplete={cambioRegion}
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
              strokeColor={C.ruta}
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
          <MarcadoresInteres
            puntos={puntosInteres}
            zoom={zoom}
            destacado={destacado}
            onAbrir={setPuntoAbierto}
          />
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
              {estadisticas.resultado === 'llego' && (
                <Text style={e.resultadoLlego}>Llegaste a tu destino</Text>
              )}
              {estadisticas.resultado === 'cancelado' && (
                <Text style={e.resultadoCancelado}>Terminaste antes de llegar al destino</Text>
              )}
              <View style={g.fila}>
                <Text style={g.dato}>Distancia</Text>
                <Text style={g.valorGrande}>{estadisticas.distancia_metros} m</Text>
              </View>
              <View style={g.fila}>
                {/* "En movimiento" y no "Caminando": pudo ir en auto. */}
                <Text style={g.dato}>En movimiento</Text>
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

          {/* Debajo de los lugares guardados: primero a donde, despues
              como. El modo cambia el camino, asi que se ve el camino
              nuevo apenas se toca. */}
          <View style={{ gap: 10 }}>
            <Text style={g.etiqueta}>¿CÓMO VAS?</Text>
            <SelectorModo modo={modo} onCambiar={elegirModo} />
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
              <Text style={g.subtexto}>{modoInfo(infoPlan.modo).enFrase}</Text>
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

      {hojasInteres}
    </View>
  );
}

/**
 * A pie / en auto. Dos botones, uno marcado.
 *
 * Grande (con texto) antes de salir, donde hay espacio y se elige con
 * calma. Compacto (solo iconos) durante la ruta, junto al nombre: ahi
 * el panel ya esta lleno y los dos dibujos se entienden solos.
 */
function SelectorModo({ modo, onCambiar, compacto = false, ocupado = false }) {
  return (
    <View style={compacto ? e.modoCompacto : e.modoFila} accessibilityRole="radiogroup">
      {MODOS.map((op) => {
        const activo = modo === op.id;
        return (
          <Pressable
            key={op.id}
            style={[
              compacto ? e.modoBotonChico : e.modoBoton,
              activo && e.modoBotonActivo,
              ocupado && !activo && g.opaco,
            ]}
            onPress={() => onCambiar(op.id)}
            disabled={ocupado}
            hitSlop={compacto ? 4 : 0}
            accessibilityRole="radio"
            accessibilityState={{ selected: activo, busy: ocupado }}
            accessibilityLabel={op.etiqueta}
          >
            {ocupado && !activo ? (
              <ActivityIndicator color={C.apagado} size="small" />
            ) : (
              <MaterialIcons
                name={op.icono}
                size={compacto ? 24 : 26}
                color={activo ? C.acento : C.apagado}
              />
            )}
            {!compacto && (
              <Text style={activo ? e.opcionTextoActivo : e.opcionTexto}>{op.etiqueta}</Text>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

const e = StyleSheet.create({
  pista: { color: C.tenue, fontSize: 13, lineHeight: 19 },

  // Selector a pie / en auto
  modoFila: { flexDirection: 'row', gap: 10 },
  modoBoton: {
    flex: 1, height: 54, flexDirection: 'row', gap: 8,
    alignItems: 'center', justifyContent: 'center',
    borderRadius: 12, borderWidth: 1, borderColor: C.borde, backgroundColor: C.superficie,
  },
  modoCompacto: {
    flexDirection: 'row', padding: 3, gap: 3, borderRadius: 12,
    borderWidth: 1, borderColor: C.borde, backgroundColor: C.superficie,
  },
  modoBotonChico: {
    width: 46, height: 40, borderRadius: 9,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'transparent',
  },
  modoBotonActivo: { borderColor: C.acento, backgroundColor: 'rgba(233,164,74,0.14)' },
  filaNombre: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  resultadoLlego: { color: C.exito, fontSize: 15, fontWeight: '600' },
  resultadoCancelado: { color: C.acento, fontSize: 15, fontWeight: '600' },

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
  chipDesvio: {
    backgroundColor: 'rgba(30,20,19,0.95)', borderWidth: 1, borderColor: C.bordeRojo,
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, marginTop: 8,
  },
  chipTextoDesvio: { color: C.alertaTexto, fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  chipVolver: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(15,18,17,0.92)', borderWidth: 1, borderColor: '#4A3A1E',
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, marginTop: 8,
  },
  chipTextoVolver: { color: C.acento, fontSize: 13, fontWeight: '600' },
  // Amarillo, como el aviso que le llega al grupo: es informacion, no
  // una alarma.
  cajaNuevoCamino: {
    backgroundColor: 'rgba(30,26,16,0.96)', borderWidth: 1, borderColor: C.acento,
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10,
    marginTop: 8, marginHorizontal: 16, gap: 4, maxWidth: 420,
  },
  tituloNuevoCamino: { color: C.acento, fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  textoNuevoCamino: { color: C.texto, fontSize: 14, lineHeight: 19 },

  panel: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: C.panel, borderTopWidth: 1, borderTopColor: C.borde,
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 20, gap: 16,
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
