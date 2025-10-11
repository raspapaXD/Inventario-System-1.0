// src/tenant/TenantProvider.jsx
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { auth, db } from "../../firebaseClient.js";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  createUserWithEmailAndPassword,
} from "firebase/auth";
import {
  doc, getDoc, runTransaction, setDoc, deleteDoc
} from "firebase/firestore";
import { getPersistentDeviceId } from "../utils/deviceId";

const TenantContext = createContext();
export function useTenant() { return useContext(TenantContext); }

/**
 * Estructura usada en Firestore:
 * empresas/{empresaId} {
 *   maxDispositivos: number (default 3),
 *   devicesCount: number (contador)
 * }
 * empresas/{empresaId}/devices/{deviceId} {
 *   deviceId, uid, userEmail, userAgent, createdAt, lastSeen
 * }
 *
 * Usuarios por empresa: como ya tienes, mediante /usuarios/{uid} -> empresaId
 */

export default function TenantProvider({ children }) {
  const [user, setUser] = useState(null);
  const [empresa, setEmpresa] = useState(null);
  const [loading, setLoading] = useState(true);
  const [deviceError, setDeviceError] = useState(null); // para mostrar bloqueos por límite

  const deviceId = useMemo(() => getPersistentDeviceId(), []);

  // --- Helpers Firestore
  const getEmpresaIdForUser = async (uid) => {
    const snap = await getDoc(doc(db, "usuarios", uid));
    if (!snap.exists()) return null;
    const data = snap.data();
    return data?.empresaId || null;
  };

  // Registra el dispositivo con transacción y contador
  const registerCurrentDevice = async (empresaId, u) => {
    const empresaRef = doc(db, "empresas", empresaId);
    const deviceRef  = doc(db, "empresas", empresaId, "devices", deviceId);

    await runTransaction(db, async (tx) => {
      const [empresaSnap, deviceSnap] = await Promise.all([
        tx.get(empresaRef),
        tx.get(deviceRef),
      ]);

      if (!empresaSnap.exists()) {
        throw new Error("EMPRESA_NO_EXISTE");
      }

      const empresaData = empresaSnap.data() || {};
      const max = Number(empresaData.maxDispositivos ?? 3);
      const count = Number(empresaData.devicesCount ?? 0);

      // Si este device ya está, solo actualiza lastSeen y listo (no consume cupo)
      if (deviceSnap.exists()) {
        tx.set(deviceRef, {
          deviceId,
          uid: u.uid,
          userEmail: u.email || "",
          userAgent: navigator.userAgent.slice(0, 150),
          lastSeen: new Date().toISOString(),
        }, { merge: true });
        return;
      }

      // Si no existe, verifica cupo
      if (count >= max) {
        throw new Error("DEVICE_LIMIT");
      }

      // Crea device + incrementa contador
      tx.set(deviceRef, {
        deviceId,
        uid: u.uid,
        userEmail: u.email || "",
        userAgent: navigator.userAgent.slice(0, 150),
        createdAt: new Date().toISOString(),
        lastSeen: new Date().toISOString(),
      });
      tx.set(empresaRef, { devicesCount: count + 1 }, { merge: true });
    });
  };

  // Desvincular este dispositivo (para botón de Configuración o al cerrar sesión)
  const unlinkCurrentDevice = async (empresaId) => {
    if (!empresaId) return;
    const empresaRef = doc(db, "empresas", empresaId);
    const deviceRef  = doc(db, "empresas", empresaId, "devices", deviceId);

    await runTransaction(db, async (tx) => {
      const [empresaSnap, deviceSnap] = await Promise.all([
        tx.get(empresaRef),
        tx.get(deviceRef),
      ]);
      if (!empresaSnap.exists()) return;

      const data = empresaSnap.data() || {};
      const count = Number(data.devicesCount ?? 0);

      if (deviceSnap.exists()) {
        tx.delete(deviceRef);
        tx.set(empresaRef, { devicesCount: Math.max(0, count - 1) }, { merge: true });
      }
    });
  };

  // --- Auth watcher
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      setDeviceError(null);

      if (u) {
        const empresaId = await getEmpresaIdForUser(u.uid);
        if (!empresaId) {
          setEmpresa(null);
          setLoading(false);
          return;
        }
        // Carga empresa
        const eSnap = await getDoc(doc(db, "empresas", empresaId));
        const eData = eSnap.exists() ? { id: empresaId, ...eSnap.data() } : { id: empresaId };

        // Asegura defaults
        eData.maxDispositivos = Number(eData.maxDispositivos ?? 3);
        eData.devicesCount = Number(eData.devicesCount ?? 0);

        try {
          await registerCurrentDevice(empresaId, u);
          setEmpresa(eData);
        } catch (err) {
          console.error(err);
          if (String(err.message).includes("DEVICE_LIMIT")) {
            setDeviceError("Esta empresa alcanzó el límite de dispositivos activos. Pide a un administrador liberar un cupo.");
            // Puedes cerrar sesión si quieres bloquear totalmente:
            // await signOut(auth);
          }
          setEmpresa(eData); // mantenemos empresa para mostrar el mensaje en UI
        }
      } else {
        setEmpresa(null);
      }
      setLoading(false);
    });

    return () => unsub();
  }, [deviceId]);

  // --- API expuesta
  const login  = (email, password) => signInWithEmailAndPassword(auth, email, password);
  const signup = (email, password) => createUserWithEmailAndPassword(auth, email, password);

  const logout = async () => {
    try {
      if (empresa?.id) {
        await unlinkCurrentDevice(empresa.id);
      }
    } catch (e) {
      console.warn("No se pudo desvincular el dispositivo al cerrar sesión:", e);
    }
    await signOut(auth);
  };

  const value = {
    user,
    empresa,
    loading,
    login,
    signup,
    logout,
    deviceError,              // <- para mostrar mensaje si se superó el límite
    unlinkCurrentDevice,      // <- para botón en Configuración
    deviceId,                 // info útil
  };

  return (
    <TenantContext.Provider value={value}>
      {!loading && children}
    </TenantContext.Provider>
  );
}

