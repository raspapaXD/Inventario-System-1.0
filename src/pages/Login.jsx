// src/pages/Login.jsx
import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useTenant } from "../tenant/TenantProvider";
import "./inventario.css";

export default function Login() {
  const { login } = useTenant();
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      setError(null);
      setLoading(true);
      await login(email, password);
      navigate("/"); // al inventario
    } catch (err) {
      console.error(err);
      setError("Correo o contraseña inválidos.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="inv-root" style={{ display: "grid", placeItems: "center" }}>
      <div className="card" style={{ maxWidth: 420, width: "100%" }}>
        <div className="card-header">
          <h2>Iniciar sesión</h2>
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
                  type={show ? "text" : "password"}
                  placeholder="********"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  style={{ flex: 1 }}
                />
                <button
                  type="button"
                  className="btn"
                  onClick={() => setShow((s) => !s)}
                >
                  {show ? "Ocultar" : "Mostrar"}
                </button>
              </div>
              <div style={{ marginTop: 8 }}>
                <Link to="/reset" className="inv-subtle">¿Olvidaste tu contraseña?</Link>
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
                {loading ? "Ingresando..." : "Ingresar"}
              </button>
              <Link to="/registro" className="btn">Crear cuenta</Link>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
