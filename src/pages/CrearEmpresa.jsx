// src/pages/CrearEmpresa.jsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { db } from "../../firebaseClient.js";
import { useTenant } from "../tenant/TenantProvider";
import { collection, doc, writeBatch, serverTimestamp } from "firebase/firestore";
import "./inventario.css";

async function uploadToImgBB(file, apiKey) {
  const fd = new FormData();
  fd.append("image", file);
  const res = await fetch(`https://api.imgbb.com/1/upload?key=${apiKey}`, {
    method: "POST",
    body: fd,
  });
  const json = await res.json();
  if (!json?.data?.url) throw new Error("No se pudo subir la imagen a imgbb.");
  return json.data.url;
}

export default function CrearEmpresa() {
  const { user } = useTenant();
  const navigate = useNavigate();

  const [nombre, setNombre] = useState("");
  const [nit, setNit] = useState("");
  const [logoUrl, setLogoUrl] = useState("");     // opción 1: pegar URL
  const [logoFile, setLogoFile] = useState(null); // opción 2: subir archivo
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const handleFile = (e) => setLogoFile(e.target.files?.[0] || null);

  const crear = async () => {
    if (!user) return;
    if (!nombre.trim()) { setError("El nombre es obligatorio."); return; }

    try {
      setError(null);
      setBusy(true);

      // 1) Resolver logo:
      let finalLogo = (logoUrl || "").trim();
      if (!finalLogo && logoFile) {
        const KEY = import.meta.env.VITE_IMGBB_KEY;
        if (!KEY) {
          setError("Para adjuntar archivo, configura VITE_IMGBB_KEY en .env.local o pega una URL en el campo del logo.");
          setBusy(false);
          return;
        }
        finalLogo = await uploadToImgBB(logoFile, KEY);
      }

      // 2) Crear empresa + usuario admin en un batch
      const batch = writeBatch(db);
      const empresaRef = doc(collection(db, "empresas"));
      const empresaId = empresaRef.id;

      batch.set(empresaRef, {
        nombre: nombre.trim(),
        nit: nit.trim() || "",
        logoUrl: finalLogo || "",
        createdOn: serverTimestamp(),
        suspended: false,
        devicesCount: 0,
        maxDispositivos: 3,
        ownerUid: user.uid,
        usuarios: { [user.uid]: "admin" },
      });

      batch.set(
        doc(db, "usuarios", user.uid),
        { empresaId, rol: "admin", createdAt: serverTimestamp() },
        { merge: true }
      );

      await batch.commit();

      // 3) Ir directo a la app
      navigate("/", { replace: true });
    } catch (e) {
      console.error(e);
      setError("No se pudo crear la empresa.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="inv-root" style={{ display: "grid", placeItems: "center" }}>
      <div className="card" style={{ maxWidth: 560, width: "100%" }}>
        <div className="card-header">
          <h2>Crear empresa</h2>
        </div>
        <div className="card-body">
          <div className="form-grid">
            <div className="form-field" style={{ gridColumn: "1 / -1" }}>
              <label>Nombre (obligatorio)</label>
              <input value={nombre} onChange={e=>setNombre(e.target.value)} placeholder="Mi empresa" />
            </div>
            <div className="form-field" style={{ gridColumn: "1 / -1" }}>
              <label>NIT (opcional)</label>
              <input value={nit} onChange={e=>setNit(e.target.value)} placeholder="901xxxxx" />
            </div>
            <div className="form-field" style={{ gridColumn: "1 / -1" }}>
              <label>Logo</label>
              <input
                type="text"
                placeholder="URL del logo (opcional)"
                value={logoUrl}
                onChange={e=>setLogoUrl(e.target.value)}
              />
              <div style={{ marginTop: 8 }}>
                <input type="file" accept="image/*" onChange={handleFile} />
              </div>
              <p className="inv-subtle" style={{ marginTop: 6 }}>
                Si adjuntas un archivo y dejas la URL vacía, lo subiremos a imgbb (requiere VITE_IMGBB_KEY).
              </p>
            </div>
          </div>
          {error && <div className="toast toast-error">{error}</div>}
        </div>
        <div className="card-footer">
          <button className="btn btn-primary" onClick={crear} disabled={busy}>
            {busy ? "Creando…" : "Crear empresa"}
          </button>
        </div>
      </div>
    </div>
  );
}
