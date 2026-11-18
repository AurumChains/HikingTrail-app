import {
  View, Pressable, StyleSheet, Modal, KeyboardAvoidingView, Platform,
} from 'react-native';
import { C } from '../estilos';

/**
 * Hoja que sube desde abajo, sobre un fondo oscuro. Tocar el fondo la
 * cierra, igual que "Cancelar".
 *
 * La usan el menu de moderacion de Grupos y los puntos de interes del
 * mapa. Sube con el teclado: varias llevan un campo de texto, y sin esto
 * el teclado taparia el boton de enviar.
 */
export default function Hoja({ visible, onCerrar, children }) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCerrar}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable style={e.fondo} onPress={onCerrar}>
          {/* Pressable vacio para que tocar DENTRO de la hoja no la cierre. */}
          <Pressable style={e.hoja} onPress={() => {}}>
            <View style={e.agarradera} />
            {children}
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const e = StyleSheet.create({
  fondo: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'flex-end' },
  hoja: {
    backgroundColor: C.panel, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    borderTopWidth: 1, borderColor: C.borde,
    padding: 20, paddingBottom: 36, gap: 12,
  },
  agarradera: {
    width: 40, height: 4, borderRadius: 2, backgroundColor: C.borde, alignSelf: 'center',
  },
});
