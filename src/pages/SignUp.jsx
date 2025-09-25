// src/pages/SignUp.jsx
import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useTenant } from "../tenant/TenantProvider";
import "./inventario.css";

export default function SignUp() {
  const { signup } = useTenant();
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [show1, setShow1] = useState(false);
  const [show2, setShow2] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (password !== password2) {
      setError("Las contraseñas no coinciden.");
      return;
    }

    if (password.length < 6) {
      setError("La contraseña debe tener al menos 6 caracteres.");
      return;
    }

    try {
      setError(null);
      setLoading(true);
      await signup(email, password);
      navigate("/verificar"); // mejor ir a verificar
    } catch (err) {
      console.error(err);
      let msg = "No se pudo registrar la cuenta.";
      if (err?.code) {
        switch (err.code) {
          case "auth/weak-password":
            msg = "La contraseña es muy corta. Debe tener al menos 6 caracteres.";
            break;
          case "auth/email-already-in-use":
            msg = "Ese correo ya está registrado. Intenta iniciar sesión.";
            break;
          case "auth/invalid-email":
            msg = "El correo no es válido.";
            break;
          case "auth/network-request-failed":
            msg = "Problema de red. Revisa tu conexión.";
            break;
          case "auth/operation-not-allowed":
            msg = "El método Email/Password no está habilitado en Firebase.";
            break;
          default:
            msg = `Error: ${err.code}`;
        }
      }
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="inv-root" style={{ display: "grid", placeItems: "center" }}>
      <div className="card" style={{ maxWidth: 420, width: "100%" }}>
        <div className="card-header">
          <h2>Crear cuenta</h2>
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
                autoComplete="username"
              />
            </div>

            <div className="form-field" style={{ gridColumn: "1 / -1" }}>
              <label>Contraseña</label>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  type={show1 ? "text" : "password"}
                  placeholder="********"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="new-password"
                  style={{ flex: 1 }}
                />
                <button
                  type="button"
                  className="btn"
                  onClick={() => setShow1((s) => !s)}
                >
                  {show1 ? "Ocultar" : "Mostrar"}
                </button>
              </div>
            </div>

            <div className="form-field" style={{ gridColumn: "1 / -1" }}>
              <label>Repite la contraseña</label>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  type={show2 ? "text" : "password"}
                  placeholder="********"
                  value={password2}
                  onChange={(e) => setPassword2(e.target.value)}
                  required
                  autoComplete="new-password"
                  style={{ flex: 1 }}
                />
                <button
                  type="button"
                  className="btn"
                  onClick={() => setShow2((s) => !s)}
                >
                  {show2 ? "Ocultar" : "Mostrar"}
                </button>
              </div>
            </div>

            {error && (
              <div className="toast toast-error" style={{ position: "static" }}>
                {error}
              </div>
            )}

            <div className="card-footer" style={{ gridColumn: "1 / -1" }}>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={loading}
              >
                {loading ? "Registrando..." : "Crear cuenta"}
              </button>
              <Link to="/login" className="btn">Ya tengo cuenta</Link>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
