import { useEffect, useState } from "react";
import { auth, db } from "../../firebaseClient";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { useNavigate } from "react-router-dom";
import "./inventario.css";

export default function VerifyEmail() {
  const [user, setUser] = useState(null);
  const navigate = useNavigate();

  useEffect(()=>{
    const unsub = onAuthStateChanged(auth, (u)=> setUser(u));
    return ()=>unsub();
  },[]);

  const continuar = async () => {
    await auth.currentUser?.reload();
    const u = auth.currentUser;
    if (!u) return;

    if (!u.emailVerified) return; // se queda en la página hasta verificar

    // Revisar si ya tiene empresa
    const snap = await getDoc(doc(db, "usuarios", u.uid));
    const empresaId = snap.exists() ? snap.data()?.empresaId : null;

    if (!empresaId) {
      navigate("/crear-empresa", { replace: true });
    } else {
      navigate("/", { replace: true });
    }
  };

  return (
    <div className="inv-root" style={{ display:"grid", placeItems:"center" }}>
      <div className="card" style={{ maxWidth: 520, width:"100%" }}>
        <div className="card-header"><h2>Verifica tu correo</h2></div>
        <div className="card-body">
          <p className="inv-subtle">
            Hemos enviado un correo de verificación. Abre ese correo y haz clic en el enlace.
          </p>
          <div className="card-footer">
            <button className="btn btn-primary" onClick={continuar}>Ya verifiqué</button>
            <button className="btn" onClick={()=>navigate("/login")}>Volver al login</button>
          </div>
        </div>
      </div>
    </div>
  );
}
