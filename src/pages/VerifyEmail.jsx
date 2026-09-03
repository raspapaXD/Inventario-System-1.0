import { useEffect, useState } from "react";
import { auth } from "../../firebaseClient.js";
import { sendEmailVerification, reload } from "firebase/auth";
import "./inventario.css";

export default function VerifyEmail() {
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    setMsg("Te enviamos un correo de verificación. Revisa tu bandeja de entrada y spam.");
  }, []);

  const handleResend = async () => {
    if (!auth.currentUser) return;
    try {
      setSending(true);
      setMsg("");
      await sendEmailVerification(auth.currentUser, {
        url: window.location.origin,
        handleCodeInApp: true,
      });
      setMsg("Enviado nuevamente. Revisa tu correo.");
    } catch (e) {
      console.error(e);
      setMsg("No se pudo reenviar. Intenta de nuevo en un momento.");
    } finally {
      setSending(false);
    }
  };

  const handleCheck = async () => {
    try {
      await reload(auth.currentUser);
      if (auth.currentUser?.emailVerified) {
        window.location.href = "/"; // TenantProvider te lleva a onboarding si no tienes empresa
      } else {
        setMsg("Aún no aparece verificado. Dale 10–20 segundos y vuelve a probar.");
      }
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="inv-root" style={{ display: "grid", placeItems: "center" }}>
      <div className="card" style={{ maxWidth: 520, width: "100%" }}>
        <div className="card-header">
          <h2>Verifica tu correo</h2>
          <p className="inv-subtle">{msg}</p>
        </div>
        <div className="card-body" style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-primary" onClick={handleResend} disabled={sending}>
            {sending ? "Enviando..." : "Reenviar correo"}
          </button>
          <button className="btn" onClick={handleCheck}>Ya verifiqué</button>
        </div>
      </div>
    </div>
  );
}
