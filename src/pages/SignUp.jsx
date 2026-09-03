// src/pages/SignUp.jsx
import { useEffect, useState } from "react";
import { useNavigate, Link, useParams } from "react-router-dom";
import { useTenant } from "../tenant/TenantProvider";
import "./inventario.css";

import { db } from "../../firebaseClient.js";
import { doc, setDoc, collection, serverTimestamp } from "firebase/firestore";
import { sendEmailVerification } from "firebase/auth";

export default function SignUp() {
  const { signup } = useTenant();
  const navigate = useNavigate();
  const { empresaId } = useParams(); // /registro/:empresaId (o undefined en /registro)

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [show1, setShow1] = useState(false);
  const [show2, setShow2] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => { setError(null); }, [email, password, password2]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (password !== password2) {
      setError("Las contraseñas no coinciden.");
      return;
    }
    try {
      setError(null);
      setLoading(true);

      // 1) Crear cuenta
      const cred = await signup(email, password);

      // 2) Enviar correo de verificación
      try {
        await sendEmailVerification(cred.user, {
          url: window.location.origin, // vuelve a tu app
          handleCodeInApp: true,
        });
      } catch (e) {
        console.warn("No se pudo enviar el correo de verificación aún:", e);
      }

      // 3) Si venía invitación con empresaId, agregarlo como miembro y enlazar usuario->empresa
      if (empresaId) {
        const empresaRef = doc(db, "empresas", empresaId);

        // membresía básica
        await setDoc(
          doc(collection(empresaRef, "miembros"), cred.user.uid),
          {
            uid: cred.user.uid,
            email: cred.user.email || "",
            rol: "member",             // owner solo quien crea la empresa
            invitedVia: "link",
            createdAt: serverTimestamp(),
          },
          { merge: true }
        );

        // enlazar usuario con la empresa
        await setDoc(doc(db, "usuarios", cred.user.uid), { empresaId }, { merge: true });
      }

      // 4) Llevar siempre a la pantalla de verificación
      navigate("/verificar");
    } catch (err) {
      console.error(err);
      const msg =
        err?.message?.includes("3 usuarios")
          ? "Esta empresa ya alcanzó el límite de 3 usuarios."
          : "No se pudo registrar la cuenta.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="inv-root" style={{ display: "grid", placeItems: "center" }}>
      <div className="card" style={{ maxWidth: 420, width: "100%" }}>
        <div className="card-header">
          <h2>Crear cuenta {empresaId ? " (invitación)" : ""}</h2>
          {empresaId && (
            <p className="inv-subtle">
              Te unirás a la empresa: <code>{empresaId}</code>
            </p>
          )}
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
                <button type="button" className="btn" onClick={() => setShow1(s => !s)}>
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
                <button type="button" className="btn" onClick={() => setShow2(s => !s)}>
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
              <button type="submit" className="btn btn-primary" disabled={loading}>
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
