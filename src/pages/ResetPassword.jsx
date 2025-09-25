// src/pages/ResetPassword.jsx
import { useState } from "react";
import { Link } from "react-router-dom";
import { sendPasswordResetEmail } from "firebase/auth";
import { auth } from "../../firebase";
import "./inventario.css";

export default function ResetPassword() {
  const [email, setEmail] = useState("");
  const [ok, setOk] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErr(null);
    setOk(false);
    try {
      setLoading(true);
      await sendPasswordResetEmail(auth, email);
      setOk(true);
    } catch (error) {
      console.error(error);
      setErr("No se pudo enviar el correo de restablecimiento.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="inv-root" style={{ display: "grid", placeItems: "center" }}>
      <div className="card" style={{ maxWidth: 420, width: "100%" }}>
        <div className="card-header">
          <h2>Restablecer contraseña</h2>
        </div>
        <div className="card-body">
          <form onSubmit={handleSubmit} className="form-grid">
            <div className="form-field" style={{ gridColumn: "1 / -1" }}>
              <label>Email</label>
              <input
                type="email"
                placeholder="tu@correo.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            {ok && (
              <div className="toast" style={{ position: "static" }}>
                Te enviamos un correo con el enlace para crear una nueva contraseña. Revisa tu bandeja.
              </div>
            )}
            {err && (
              <div className="toast toast-error" style={{ position: "static" }}>
                {err}
              </div>
            )}

            <div className="card-footer" style={{ gridColumn: "1 / -1" }}>
              <button className="btn btn-primary" type="submit" disabled={loading}>
                {loading ? "Enviando..." : "Enviar enlace"}
              </button>
              <Link className="btn" to="/login">Volver a Iniciar sesión</Link>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
