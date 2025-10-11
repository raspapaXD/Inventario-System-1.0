// src/utils/deviceApi.js
import { auth } from "../../firebase";
import { getPersistentDeviceId } from "./deviceId";

const REGISTER_URL   = "https://console.firebase.google.com/u/0/project/tek-inventory/overview";
const UNREGISTER_URL = "https://console.firebase.google.com/u/0/project/tek-inventory/overview";

export async function callRegisterDevice(empresaId) {
  const user = auth.currentUser;
  if (!user) throw new Error("Sin sesión");
  const idToken = await user.getIdToken();
  const deviceId = await getPersistentDeviceId();

  const res = await fetch(REGISTER_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${idToken}`,
    },
    body: JSON.stringify({ empresaId, deviceId }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Error HTTP ${res.status}`);
  }
  return res.json(); // { ok: true, count, limit }
}

export async function callUnregisterDevice(empresaId) {
  const user = auth.currentUser;
  if (!user) throw new Error("Sin sesión");
  const idToken = await user.getIdToken();
  const deviceId = await getPersistentDeviceId();

  const res = await fetch(UNREGISTER_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${idToken}`,
    },
    body: JSON.stringify({ empresaId, deviceId }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Error HTTP ${res.status}`);
  }
  return res.json(); // { ok: true, count }
}

