// src/pages/VerifyEmail.jsx
import { useState } from "react";
import { Link } from "react-router-dom";
import { useTenant } from "../tenant/TenantProvider";
import { sendEmailVerification } from "firebase/auth";
import "./inventario.css";

export default function VerifyEmail() {
  const { currentUser } = useTenant();
  const [message, setMessage] = useState(null);
  const [loading, setLoading] = useState(false);

  const resendVerification = async () => {
    if (!currentUser) return;
    try {
      setLoading(true);
      await sendEmailVerification(currentUser);
      setMessage("Correo de verificación reenviado ✅. Revisa tu bandeja.");
    } catch (err) {
      console.error(err);
      setMessage("Error al enviar el correo de verificación.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="inv-root" style={{ display: "grid", placeItems: "center" }}>
      <div className="card" style={{ maxWidth: 500, width: "100%" }}>
        <div className="card-header">
          <h2>Verifica tu correo</h2>
        </div>
        <div className="card-body">
          <p>
            Hemos enviado un correo de verificación a:
          </p>
          <p style={{ fontWeight: 600, marginBottom: 16 }}>
            {currentUser?.email}
          </p>
          <p>
            Por favor abre ese correo y haz clic en el enlace para activar tu cuenta.
          </p>

          {message && (
            <div className="toast" style={{ position: "static", marginTop: 12 }}>
              {message}
            </div>
          )}
        </div>
        <div className="card-footer">
          <button
            className="btn btn-primary"
            onClick={resendVerification}
            disabled={loading}
          >
            {loading ? "Enviando..." : "Reenviar correo"}
          </button>
          <Link to="/login" className="btn">
            Volver al login
          </Link>
        </div>
      </div>
    </div>
  );
}
