// src/utils/deviceId.js

// Genera o recupera un ID persistente único para este dispositivo
export function getPersistentDeviceId() {
  const KEY = "ordexa_device_id";
  let id = localStorage.getItem(KEY);

  if (!id) {
    // Si el navegador soporta UUID nativo
    if (crypto?.randomUUID) {
      id = crypto.randomUUID();
    } else {
      // Fallback si no soporta randomUUID
      id = `${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
    }
    localStorage.setItem(KEY, id);
  }

  return id;
}
