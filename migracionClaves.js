import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

/**
 * La app se llamaba HikingTrail y guardaba sus datos con claves
 * 'hikingtrail_*'. Ahora se llama GeoTrail y usa 'geotrail_*'.
 *
 * Cambiar el nombre de la clave sin mover el dato dejaria a todos
 * afuera: sin sesion, sin los puntos GPS que no alcanzaron a subir y
 * sin los contactos de emergencia guardados para usar sin datos. Por
 * eso, al arrancar, se copia cada valor viejo a su clave nueva y se
 * borra el viejo.
 *
 * Es seguro llamarla en cada arranque: si ya no hay nada viejo, no
 * hace nada. Si la clave nueva ya tiene algo, gana la nueva.
 *
 * Se puede borrar este archivo cuando ya nadie tenga instalada una
 * version anterior a GeoTrail.
 */
const SEGURAS = [
  ['hikingtrail_token', 'geotrail_token'],
  ['hikingtrail_huella_clave', 'geotrail_huella_clave'],
];

const NORMALES = [
  ['hikingtrail_usuario', 'geotrail_usuario'],
  ['hikingtrail_cola', 'geotrail_cola'],
  ['hikingtrail_contactos_emergencia', 'geotrail_contactos_emergencia'],
];

export async function migrarClavesAntiguas() {
  for (const [vieja, nueva] of SEGURAS) {
    try {
      const valor = await SecureStore.getItemAsync(vieja);
      if (valor === null) continue;
      if ((await SecureStore.getItemAsync(nueva)) === null) {
        await SecureStore.setItemAsync(nueva, valor);
      }
      await SecureStore.deleteItemAsync(vieja);
    } catch (e) {
      // Si una falla se sigue con las demas: lo peor que pasa es que
      // ese dato se pierde, no que la app no arranque.
    }
  }

  for (const [vieja, nueva] of NORMALES) {
    try {
      const valor = await AsyncStorage.getItem(vieja);
      if (valor === null) continue;
      if ((await AsyncStorage.getItem(nueva)) === null) {
        await AsyncStorage.setItem(nueva, valor);
      }
      await AsyncStorage.removeItem(vieja);
    } catch (e) { /* igual que arriba */ }
  }
}
