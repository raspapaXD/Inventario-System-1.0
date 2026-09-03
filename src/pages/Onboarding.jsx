// src/pages/Onboarding.jsx
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useTenant } from "../tenant/TenantProvider";
import { db } from "../../firebaseClient.js";
import {
  doc, setDoc, serverTimestamp, collection,
} from "firebase/firestore";
import { uploadToImgBB } from "../services/imgbb";
import "./inventario.css";

export default function Onboarding() {
  const { user, empresa } = useTenant();   // 👈 también leemos empresa
  const navigate = useNavigate();

  const [nombre, setNombre] = useState("");
  const [nit, setNit] = useState("");
  const [moneda, setMoneda] = useState("COP");
  const [logoFile, setLogoFile] = useState(null);
  const [preview, setPreview] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  if (!user) return null;

  // Cuando el Provider detecte que YA hay empresa, salimos del onboarding
  useEffect(() => {
    if (empresa?.id) navigate("/");
  }, [empresa, navigate]);

  // Validación sencilla para NIT: dígitos (con o sin guion)
  const nitEsValido = (v) => /^[0-9\-]{5,20}$/.test(v.trim());

  const handleFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!/^image\/(png|jpeg|jpg|webp)$/i.test(f.type)) {
      setError("El logo debe ser PNG/JPG/WEBP.");
      return;
    }
    if (f.size > 2 * 1024 * 1024) {
      setError("El logo no puede superar 2 MB.");
      return;
    }
    setError(null);
    setLogoFile(f);
    setPreview(URL.createObjectURL(f));
  };

  const handleCrearEmpresa = async (e) => {
    e.preventDefault();
    if (!nombre.trim()) return setError("Escribe el nombre de tu empresa.");
    if (nit && !nitEsValido(nit)) return setError("NIT inválido. Usa solo números y guion.");

    try {
      setError(null);
      setLoading(true);

      // 1) Subir logo si viene (ImgBB)
      let logoUrl = "";
      if (logoFile) {
        try {
          logoUrl = await uploadToImgBB(logoFile);
        } catch (err) {
          console.warn("Fallo subiendo logo a ImgBB:", err);
          // No bloqueamos por el logo
        }
      }

      // 2) Crear empresa
      const empresaId = crypto.randomUUID();
      const empresaRef = doc(db, "empresas", empresaId);

      await setDoc(empresaRef, {
        nombre: nombre.trim(),
        nit: nit.trim() || null,
        moneda,
        logoUrl: logoUrl || null,
        ownerId: user.uid,
        maxDispositivos: 3,
        devicesCount: 0,
        createdAt: serverTimestamp(),
      });

      // 3) Registrar como OWNER
      await setDoc(doc(collection(empresaRef, "miembros"), user.uid), {
        uid: user.uid,
        email: user.email || "",
        rol: "owner",
        createdAt: serverTimestamp(),
      });

      // 4) Enlazar usuario a empresa (el TenantProvider lo detecta por onSnapshot)
      await setDoc(doc(db, "usuarios", user.uid), { empresaId }, { merge: true });

      // 👇 Ya NO navegamos aquí. El useEffect de arriba te llevará a "/" cuando el provider cargue la empresa.
    } catch (err) {
      console.error(err);
      setError("No se pudo crear la empresa. Intenta de nuevo.");
    } finally {
      setLoading(false);
    }
  };

  const handleUnirmeCodigo = () => {
    alert("Pronto podrás unirte con un código de invitación. Por ahora, crea tu empresa ✨");
  };

  return (
    <div className="inv-root" style={{ display: "grid", placeItems: "center" }}>
      <div className="card" style={{ maxWidth: 620, width: "100%" }}>
        <div className="card-header">
          <h2>¡Bienvenido/a!</h2>
          <p className="inv-subtle">Para empezar, crea tu empresa o únete a una existente.</p>
        </div>

        <div className="card-body">
          <div className="grid" style={{ gap: 16 }}>
            {/* Crear empresa */}
            <div className="card" style={{ border: "1px solid var(--border)" }}>
              <div className="card-header">
                <h3>Crear mi empresa</h3>
              </div>
              <div className="card-body">
                <form onSubmit={handleCrearEmpresa} className="form-grid">
                  <div className="form-field" style={{ gridColumn: "1 / -1" }}>
                    <label>Nombre de la empresa</label>
                    <input
                      type="text"
                      placeholder="Ej: Minimarket La 30"
                      value={nombre}
                      onChange={(e) => setNombre(e.target.value)}
                      required
                    />
                  </div>

                  <div className="form-field" style={{ gridColumn: "1 / -1" }}>
                    <label>NIT (opcional)</label>
                    <input
                      type="text"
                      placeholder="Ej: 900123456-7"
                      value={nit}
                      onChange={(e) => setNit(e.target.value)}
                    />
                    <small className="inv-subtle">
                      Solo números y guion. Puedes editarlo luego en Configuración.
                    </small>
                  </div>

                  <div className="form-field" style={{ gridColumn: "1 / -1" }}>
                    <label>Moneda</label>
                    <select value={moneda} onChange={(e) => setMoneda(e.target.value)}>
                      <option value="COP">COP (Colombia)</option>
                      <option value="USD">USD (Estados Unidos)</option>
                      <option value="EUR">EUR (Europa)</option>
                    </select>
                  </div>

                  <div className="form-field" style={{ gridColumn: "1 / -1" }}>
                    <label>Logo (opcional)</label>
                    <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleFile} />
                    {preview && (
                      <div style={{ marginTop: 8 }}>
                        <img src={preview} alt="preview" style={{ maxHeight: 80, borderRadius: 8 }} />
                      </div>
                    )}
                    <small className="inv-subtle">PNG/JPG/WEBP hasta 2 MB.</small>
                  </div>

                  {error && (
                    <div className="toast toast-error" style={{ position: "static" }}>
                      {error}
                    </div>
                  )}

                  <div className="card-footer">
                    <button type="submit" className="btn btn-primary" disabled={loading}>
                      {loading ? "Creando..." : "Crear y entrar"}
                    </button>
                  </div>
                </form>
              </div>
            </div>

            {/* Unirme a una existente (placeholder por ahora) */}
            <div className="card" style={{ border: "1px solid var(--border)" }}>
              <div className="card-header">
                <h3>Unirme a una empresa</h3>
              </div>
              <div className="card-body">
                <p className="inv-subtle">
                  Si tienes un código de invitación, pronto podrás usarlo aquí.
                </p>
              </div>
              <div className="card-footer">
                <button className="btn" onClick={handleUnirmeCodigo} disabled>
                  Próximamente
                </button>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
