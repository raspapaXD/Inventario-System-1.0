// src/tenant/TenantProvider.jsx 
import { createContext, useContext, useEffect, useMemo, useState } from "react"; 
import { increment } from "firebase/firestore"; 
import { auth, db } from "../../firebaseClient.js"; 
import { 
  onAuthStateChanged, 
  signInWithEmailAndPassword, 
  signOut, 
  createUserWithEmailAndPassword, 
} from "firebase/auth"; 
import { 
  doc, getDoc, runTransaction, setDoc, onSnapshot 
} from "firebase/firestore"; 
import { getPersistentDeviceId } from "../utils/deviceId"; 

const TenantContext = createContext(); 
export function useTenant() { return useContext(TenantContext); } 

/** 
 * Estructura: 
 * usuarios/{uid} -> { empresaId } 
 * empresas/{empresaId} 
 * empresas/{empresaId}/miembros/{uid} -> { rol: "owner" | "admin" | "member" } 
 */ 
export default function TenantProvider({ children }) { 
  const [user, setUser] = useState(null); 
  const [empresa, setEmpresa] = useState(null); 
  const [role, setRole] = useState("member"); // 👈 rol actual dentro de la empresa 
  const [loading, setLoading] = useState(true); 
  const [deviceError, setDeviceError] = useState(null); 

  const deviceId = useMemo(() => getPersistentDeviceId(), []); 

  const registerCurrentDevice = async (empresaId, u) => { 
  const empresaRef = doc(db, "empresas", empresaId); 
  const deviceRef  = doc(db, "empresas", empresaId, "devices", deviceId); 

  await runTransaction(db, async (tx) => { 
    // 1) Lee SOLO el device primero 
    const deviceSnap = await tx.get(deviceRef); 

    if (deviceSnap.exists()) { 
      // Actualiza lastSeen sin tocar empresa -> evita verify sobre empresa 
      tx.set(deviceRef, { 
        deviceId, 
        uid: u.uid, 
        userEmail: u.email || "", 
        userAgent: navigator.userAgent.slice(0, 150), 
        lastSeen: new Date().toISOString(), 
      }, { merge: true }); 
      return; 
    } 

    // 2) Si NO existe, ahora sí lee empresa y valida cupo 
    const empresaSnap = await tx.get(empresaRef); 
    if (!empresaSnap.exists()) throw new Error("EMPRESA_NO_EXISTE"); 

    const data = empresaSnap.data() || {}; 
    const max = Number(data.maxDispositivos ?? 3); 
    const count = Number(data.devicesCount ?? 0); 
    if (count >= max) throw new Error("DEVICE_LIMIT"); 

    // 3) Crea device y sube contador atómicamente 
    tx.set(deviceRef, { 
      deviceId, 
      uid: u.uid, 
      userEmail: u.email || "", 
      userAgent: navigator.userAgent.slice(0, 150), 
      createdAt: new Date().toISOString(), 
      lastSeen: new Date().toISOString(), 
    }); 

    tx.set(empresaRef, { devicesCount: increment(1) }, { merge: true }); 
  }); 
}; 

  const unlinkCurrentDevice = async (empresaId) => { 
  if (!empresaId) return; 
  const empresaRef = doc(db, "empresas", empresaId); 
  const deviceRef  = doc(db, "empresas", empresaId, "devices", deviceId); 

  await runTransaction(db, async (tx) => { 
    // 1) Lee SOLO el device primero 
    const deviceSnap = await tx.get(deviceRef); 
    if (!deviceSnap.exists()) return; // nada que hacer 

    // 2) Elimina device y decrementa contador atómicamente 
    tx.delete(deviceRef); 
    tx.set(empresaRef, { devicesCount: increment(-1) }, { merge: true }); 
  }); 
}; 

  useEffect(() => { 
    const stopAuth = onAuthStateChanged(auth, (u) => { 
      setUser(u); 
      setDeviceError(null); 
      setEmpresa(null); 
      setRole("member"); 
      setLoading(true); 

      if (!u) { 
        setLoading(false); 
        return; 
      } 

      // Suscripción a usuarios/{uid} para detectar empresaId 
      const userDocRef = doc(db, "usuarios", u.uid); 
      const stopUserDoc = onSnapshot(userDocRef, async (snap) => { 
        try { 
          const empresaId = snap.exists() ? snap.data()?.empresaId : null; 

          if (!empresaId) { 
            setEmpresa(null); 
            setRole("member"); 
            setLoading(false); 
            return; 
          } 

          // Cargar empresa 
          const eSnap = await getDoc(doc(db, "empresas", empresaId)); 
          const eData = eSnap.exists() ? { id: empresaId, ...eSnap.data() } : { id: empresaId }; 
          eData.maxDispositivos = Number(eData.maxDispositivos ?? 3); 
          eData.devicesCount    = Number(eData.devicesCount    ?? 0); 

          // Suscripción al rol del miembro actual 
          const memberRef = doc(db, "empresas", empresaId, "miembros", u.uid); 
          const stopMember = onSnapshot(memberRef, (mSnap) => { 
            const r = mSnap.exists() ? (mSnap.data()?.rol || "member") : "member"; 
            setRole(r); 
          }); 

          try { 
            await registerCurrentDevice(empresaId, u); 
            setEmpresa(eData); 
          } catch (err) { 
            console.error(err); 
            if (String(err.message).includes("DEVICE_LIMIT")) { 
              setDeviceError("Esta empresa alcanzó el límite de dispositivos activos. Pide a un administrador liberar un cupo."); 
            } 
            setEmpresa(eData); 
          } finally { 
            setLoading(false); 
          } 

          // Limpieza de la suscripción de miembro cuando cambie empresa/usuario 
          return () => stopMember(); 
        } catch (e) { 
          console.error("Error cargando empresa:", e); 
          setEmpresa(null); 
          setRole("member"); 
          setLoading(false); 
        } 
      }); 

      return () => stopUserDoc(); 
    }); 

    return () => stopAuth(); 
  }, [deviceId]); 

  const login  = (email, password) => signInWithEmailAndPassword(auth, email, password); 
  const signup = (email, password) => createUserWithEmailAndPassword(auth, email, password); 

  const logout = async () => { 
    try { 
      if (empresa?.id) await unlinkCurrentDevice(empresa.id); 
    } catch (e) { 
      console.warn("No se pudo desvincular el dispositivo al cerrar sesión:", e); 
    } 
    await signOut(auth); 
  }; 

  const isOwner = role === "owner"; 
  const isAdmin = role === "admin"; 
  const canManage = isOwner || isAdmin; 

  const value = { 
    user, 
    empresa, 
    role, 
    isOwner, 
    isAdmin, 
    canManage, 
    loading, 
    login, 
    signup, 
    logout, 
    deviceError, 
    unlinkCurrentDevice, 
    deviceId, 
  }; 

  return ( 
    <TenantContext.Provider value={value}> 
      {!loading && children} 
    </TenantContext.Provider> 
  ); 
} 
