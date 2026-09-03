// src/components/CompanyProfileCard.jsx
import { useState } from "react";
import { useTenant } from "../tenant/TenantProvider";
import { db } from "../../firebaseClient.js";
import { doc, setDoc } from "firebase/firestore";
import { uploadToImgBB } from "../services/imgbb";

export default function CompanyProfileCard() {
  const { empresa, canManage } = useTenant();
  const [nombre, setNombre] = useState(empresa?.nombre || "");
  const [nit, setNit] = useState(empresa?.nit || "");
  const [logoPreview, setLogoPreview] = useState(empresa?.logoUrl || "");
  const [logoFile, setLogoFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  if (!empresa?.id) return null;

  const nitEsValido = (v) => !v || /^[0-9\-]{5,20}$/.test(v.trim());

  const onFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!/^image\/(png|jpeg|jpg|webp)$/i.test(f.type)) {
      setMsg("El logo debe ser PNG/JPG/WEBP.");
      return;
    }
    if (f.size > 2 * 1024 * 1024) {
      setMsg("El logo no puede superar 2 MB.");
      return;
    }
    setMsg("");
    setLogoFile(f);
    setLogoPreview(URL.createObjectURL(f));
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!canManage) return;
    if (!nombre.trim()) { setMsg("El nombre es obligatorio."); return; }
    if (!nitEsValido(nit)) { setMsg("NIT inválido. Solo números y guion."); return; }

    try {
      setSaving(true);
      setMsg("");

      let logoUrl = empresa?.logoUrl || "";
      if (logoFile) {
        try { logoUrl = await uploadToImgBB(logoFile); } catch (e) { console.warn("Logo ImgBB:", e); }
      }

      await setDoc(doc(db, "empresas", empresa.id), {
        nombre: nombre.trim(),
        nit: nit.trim() || null,
        logoUrl: logoUrl || null,
      }, { merge: true });

      setMsg("Guardado ✅");
    } catch (e) {
      console.error(e);
      setMsg("No se pudo guardar. Intenta de nuevo.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card">
      <div className="card-header"><h2>Perfil de la empresa</h2></div>
      <div className="card-body">
        <form onSubmit={handleSave} className="form-grid">
          <div className="form-field" style={{ gridColumn: "1 / -1" }}>
            <label>Nombre</label>
            <input
              type="text"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Nombre de la empresa"
              disabled={!canManage}
              required
            />
          </div>

          <div className="form-field" style={{ gridColumn: "1 / -1" }}>
            <label>NIT</label>
            <input
              type="text"
              value={nit}
              onChange={(e) => setNit(e.target.value)}
              placeholder="900123456-7"
              disabled={!canManage}
            />
          </div>

          <div className="form-field" style={{ gridColumn: "1 / -1" }}>
            <label>Logo</label>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={onFile}
              disabled={!canManage}
            />
            {logoPreview && (
              <div style={{ marginTop: 8 }}>
                <img src={logoPreview} alt="Logo" style={{ maxHeight: 80, borderRadius: 8 }} />
              </div>
            )}
            <small className="inv-subtle">PNG/JPG/WEBP hasta 2 MB.</small>
          </div>

          {!!msg && (
            <div className="toast" style={{ position: "static" }}>{msg}</div>
          )}

          <div className="card-footer">
            <button className="btn btn-primary" type="submit" disabled={!canManage || saving}>
              {saving ? "Guardando..." : "Guardar cambios"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
