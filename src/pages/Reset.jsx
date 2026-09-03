// src/pages/Reset.jsx
import { useState } from "react";
import { Link } from "react-router-dom";
import { sendPasswordResetEmail } from "firebase/auth";
import { auth } from "../../firebaseClient.js";
import "./inventario.css";

export default function Reset() {
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState("");

  const onSubmit = async (e) => {
    e.preventDefault();
    try {
      setSending(true);
      setMsg("");
      await sendPasswordResetEmail(auth, email);
      setMsg("Te enviamos un correo para restablecer tu contraseña. Revisa tu bandeja y spam.");
    } catch (e) {
      console.error(e);
      setMsg("No pudimos enviar el correo. Verifica el email.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="inv-root" style={{ display: "grid", placeItems: "center" }}>
      <div className="card" style={{ maxWidth: 420, width: "100%" }}>
        <div className="card-header">
          <h2>Restablecer contraseña</h2>
          <p className="inv-subtle">Ingresa tu correo y te enviaremos un enlace.</p>
        </div>
        <div className="card-body">
          <form onSubmit={onSubmit} className="form-grid">
            <div className="form-field" style={{ gridColumn: "1 / -1" }}>
              <label>Email</label>
              <input
                type="email"
                placeholder="tu@correo.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="username"
              />
            </div>

            {!!msg && (
              <div className="toast" style={{ position: "static" }}>
                {msg}
              </div>
            )}

            <div className="card-footer" style={{ gridColumn: "1 / -1" }}>
              <button className="btn btn-primary" type="submit" disabled={sending}>
                {sending ? "Enviando..." : "Enviar enlace"}
              </button>
              <Link to="/login" className="btn">Volver a iniciar sesión</Link>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
