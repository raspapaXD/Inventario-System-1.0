// src/tenant/TenantProvider.jsx
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { auth, db } from "../../firebaseClient.js";
import {
  onAuthStateChanged, signInWithEmailAndPassword, signOut, createUserWithEmailAndPassword,
} from "firebase/auth";
import { doc, getDoc, runTransaction } from "firebase/firestore";
import { getPersistentDeviceId } from "../utils/deviceId";

const TenantContext = createContext();
export const useTenant = () => useContext(TenantContext);

export default function TenantProvider({ children }) {
  const [user, setUser] = useState(null);
  const [empresa, setEmpresa] = useState(null);
  const [loading, setLoading] = useState(true);
  const [deviceError, setDeviceError] = useState(null);
  const deviceId = useMemo(() => getPersistentDeviceId(), []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      setEmpresa(null);
      setDeviceError(null);

      if (!u) { setLoading(false); return; }

      try {
        // 1) Lee /usuarios/{uid}
        const uRef = doc(db, "usuarios", u.uid);
        let uSnap;
        try {
          uSnap = await getDoc(uRef);
        } catch (e) {
          console.error("[TP] read usuarios error:", e);
          throw e;
        }

        if (!uSnap.exists()) { setLoading(false); return; }

        const { empresaId } = uSnap.data() || {};
        if (!empresaId) { setLoading(false); return; }

        // 2) Lee /empresas/{empresaId}
        const eRef = doc(db, "empresas", empresaId);
        let eSnap;
        try {
          eSnap = await getDoc(eRef);
        } catch (e) {
          console.error("[TP] read empresa error:", e);
          throw e;
        }
        if (!eSnap.exists()) { setLoading(false); return; }

        const eData = { id: empresaId, ...eSnap.data() };

        // 3) (Opcional) registrar dispositivo
        try {
          await runTransaction(db, async (tx) => {
            const es = await tx.get(eRef);
            if (!es.exists()) return;

            const max = Number(es.data().maxDispositivos ?? 3);
            const count = Number(es.data().devicesCount ?? 0);

            const dRef = doc(db, "empresas", empresaId, "devices", deviceId);
            const ds = await tx.get(dRef);

            if (!ds.exists()) {
              if (count >= max) throw new Error("DEVICE_LIMIT");
              tx.set(dRef, {
                deviceId, uid: u.uid, userEmail: u.email || "",
                userAgent: navigator.userAgent.slice(0,150),
                createdAt: new Date().toISOString(),
                lastSeen: new Date().toISOString(),
              });
              tx.set(eRef, { devicesCount: count + 1 }, { merge: true });
            } else {
              tx.set(dRef, { lastSeen: new Date().toISOString() }, { merge: true });
            }
          });
        } catch (e) {
          if (String(e.message).includes("DEVICE_LIMIT")) {
            setDeviceError("Límite de dispositivos alcanzado.");
          } else {
            console.warn("[TP] device tx warn:", e);
          }
        }

        setEmpresa(eData);
      } catch (e) {
        console.error("[TenantProvider] init error:", e); // <- justo el que ves
      } finally {
        setLoading(false);
      }
    });

    return () => unsub();
  }, [deviceId]);

  const login  = (email, password) => signInWithEmailAndPassword(auth, email, password);
  const signup = (email, password) => createUserWithEmailAndPassword(auth, email, password);
  const logout = async () => { await signOut(auth); };

  return (
    <TenantContext.Provider value={{ user, empresa, loading, login, signup, logout, deviceError }}>
      {!loading && children}
    </TenantContext.Provider>
  );
}
