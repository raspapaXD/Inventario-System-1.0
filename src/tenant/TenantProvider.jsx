// src/tenant/TenantProvider.jsx
import { createContext, useContext, useEffect, useState } from "react";
import { auth, db } from "../../firebase";

// Auth
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  createUserWithEmailAndPassword,
  sendEmailVerification,
} from "firebase/auth";

// Firestore
import {
  doc,
  getDoc,
  setDoc,
  addDoc,
  collection,
  serverTimestamp,
} from "firebase/firestore";

const TenantContext = createContext();
export function useTenant() {
  return useContext(TenantContext);
}

// Helper: crea una empresa por defecto y vincula el usuario
async function ensureEmpresaParaUsuario(db, uid) {
  // 1) Crear empresa
  const empRef = await addDoc(collection(db, "empresas"), {
    nombre: "Mi Empresa",
    nit: "",
    logoUrl: "",
    usuarios: [uid],
    creadoEn: serverTimestamp(),
  });
  // 2) Mapear usuario -> empresa
  await setDoc(doc(db, "usuarios", uid), {
    empresaId: empRef.id,
    rol: "admin",
    createdAt: serverTimestamp(),
  });
  return empRef.id;
}

export default function TenantProvider({ children }) {
  const [user, setUser] = useState(null);
  const [empresa, setEmpresa] = useState(null);
  const [loading, setLoading] = useState(true);

  // Observa la sesión y garantiza que el usuario tenga empresa asignada
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);

      if (!u) {
        setEmpresa(null);
        setLoading(false);
        return;
      }

      try {
        // Busca el documento usuarios/{uid}
        const uSnap = await getDoc(doc(db, "usuarios", u.uid));
        let empresaId = uSnap.exists() ? uSnap.data()?.empresaId : null;

        // Fallback: si no hay empresa, la creamos una sola vez
        if (!empresaId) {
          empresaId = await ensureEmpresaParaUsuario(db, u.uid);
        }

        // Cargar datos de la empresa
        const eSnap = await getDoc(doc(db, "empresas", empresaId));
        setEmpresa(eSnap.exists() ? { id: empresaId, ...eSnap.data() } : null);
      } catch (e) {
        console.error("Error cargando/creando empresa:", e);
        setEmpresa(null);
      }

      setLoading(false);
    });

    return () => unsub();
  }, []);

  // ---------- APIs expuestas ----------
  const login = (email, password) =>
    signInWithEmailAndPassword(auth, email, password);

  // Registro: crea usuario, envía verificación y crea empresa por defecto
  const signup = async (email, password) => {
    // 1) Crear usuario
    const { user } = await createUserWithEmailAndPassword(auth, email, password);

    // 2) Enviar verificación (opcional, recomendado)
    try {
      auth.languageCode = "es";
      await sendEmailVerification(user, {
        url: `${window.location.origin}/login`, // destino al confirmar
        handleCodeInApp: false,
      });
    } catch (e) {
      console.warn("No se pudo enviar verificación:", e);
    }

    // 3) Crear empresa por defecto y mapear usuario
    await ensureEmpresaParaUsuario(db, user.uid);

    return user;
  };

  const logout = () => signOut(auth);

  const value = {
    user,
    currentUser: user, // alias
    empresa,
    login,
    signup,
    logout,
    loading,
  };

  return (
    <TenantContext.Provider value={value}>
      {!loading && children}
    </TenantContext.Provider>
  );
}
