import { StyleSheet } from 'react-native';

/**
 * La paleta, en un solo lugar.
 * Cuando agreguemos el modo claro, se cambia aqui y cambia toda la app.
 */
export const C = {
  fondo: '#0C0E0D',
  mapa: '#101412',
  superficie: '#131715',
  superficie2: '#161A18',
  panel: '#0F1211',
  campo: '#141816',
  borde: '#2A312E',
  bordeSuave: '#1E2422',
  bordeRojo: '#4A2A2A',
  texto: '#EDEFEC',
  apagado: '#8B958F',
  tenue: '#6F7973',
  placeholder: '#4E5651',
  acento: '#E9A44A',
  acentoTexto: '#14100A',
  alerta: '#E2504E',
  alertaFondo: '#1E1413',
  alertaTexto: '#F0A9A7',
};

/** Estilos que se repiten en varias pantallas. */
export const g = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: C.fondo },
  centrado: {
    flex: 1, backgroundColor: C.fondo,
    alignItems: 'center', justifyContent: 'center', gap: 12,
  },

  etiqueta: { color: C.tenue, fontSize: 11, fontWeight: '600', letterSpacing: 0.7 },
  titulo: { color: C.texto, fontSize: 28, fontWeight: '700' },
  subtexto: { color: C.apagado, fontSize: 15 },
  dato: { color: C.apagado, fontSize: 15 },
  valor: { color: C.texto, fontSize: 20, fontWeight: '600' },
  valorGrande: { color: C.acento, fontSize: 24, fontWeight: '700' },
  valorRojo: { color: C.alerta, fontSize: 20, fontWeight: '600' },
  error: { color: C.alerta, fontSize: 14 },
  aviso: { color: C.acento, fontSize: 14 },

  campo: { gap: 8 },
  input: {
    height: 54, borderWidth: 1, borderColor: C.borde, backgroundColor: C.campo,
    borderRadius: 10, paddingHorizontal: 16, color: C.texto, fontSize: 16,
  },

  tarjeta: {
    borderWidth: 1, borderColor: C.borde, backgroundColor: C.superficie,
    borderRadius: 14, padding: 18, gap: 12,
  },
  fila: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },

  boton: {
    height: 56, backgroundColor: C.acento, borderRadius: 11,
    alignItems: 'center', justifyContent: 'center',
  },
  textoBoton: { color: C.acentoTexto, fontSize: 17, fontWeight: '600' },
  botonRojo: {
    height: 56, borderWidth: 1, borderColor: C.bordeRojo, borderRadius: 11,
    alignItems: 'center', justifyContent: 'center',
  },
  textoRojo: { color: C.alerta, fontSize: 17, fontWeight: '600' },
  botonSecundario: {
    height: 50, borderWidth: 1, borderColor: C.borde, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
  },
  textoSecundario: { color: C.texto, fontSize: 16, fontWeight: '500' },
  opaco: { opacity: 0.6 },
});
