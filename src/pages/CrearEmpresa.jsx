// src/pages/CrearEmpresa.jsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { db } from "../../firebaseClient.js";
import { useTenant } from "../tenant/TenantProvider";
import {
  collection,
  doc,
  writeBatch,
  serverTimestamp,
} from "firebase/firestore";
import "./inventario.css";

/** Subida opcional a imgbb (SIN Firebase Storage). */
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
  const [logoUrl, setLogoUrl] = useState("");      // Pegar URL manual
  const [logoFile, setLogoFile] = useState(null);  // O subir archivo
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState(null);

  const handleLogoFile = (e) => {
    const f = e.target.files?.[0] || null;
    setLogoFile(f);
  };

  const crear = async () => {
    if (!user) return;
    if (!nombre.trim()) { setError("El nombre es obligatorio."); return; }

    try {
      setError(null);
      setCargando(true);

      // 1) Si sube archivo, súbelo a imgbb; si pegó URL, úsala.
      let finalLogoUrl = (logoUrl || "").trim();
      if (!finalLogoUrl && logoFile) {
        // PON tu API key de imgbb aquí (o usa import.meta.env.VITE_IMGBB_KEY)
        const KEY = import.meta.env.VITE_IMGBB_KEY || "46bbab2f0ec657f928ab05ac5d78c37bMG_BB";
        finalLogoUrl = await uploadToImgBB(logoFile, KEY);
      }

      // 2) Crea empresa (ID auto) + set usuarios/{uid}
      const batch = writeBatch(db);
      const empresaRef = doc(collection(db, "empresas"));
      const empresaId = empresaRef.id;

      const empresaData = {
        nombre: nombre.trim(),
        nit: nit.trim() || "",
        logoUrl: finalLogoUrl || "",
        createdOn: serverTimestamp(),
        suspended: false,
        devicesCount: 0,
        maxDispositivos: 3,
        ownerUid: user.uid,
        usuarios: { [user.uid]: "admin" },  // mapa simple de permisos
      };

      batch.set(empresaRef, empresaData);

      const userRef = doc(db, "usuarios", user.uid);
      batch.set(userRef, {
        empresaId: empresaId,
        rol: "admin",
        createdAt: serverTimestamp(),
      }, { merge: true });

      await batch.commit();

      // 3) Ir directo a la app
      navigate("/", { replace: true });
    } catch (e) {
      console.error(e);
      setError("No se pudo crear la empresa.");
    } finally {
      setCargando(false);
    }
  };

  return (
    <div className="inv-root" style={{ display: "grid", placeItems: "center" }}>
      <div className="card" style={{ maxWidth: 560, width: "100%" }}>
        <div className="card-header">
          <h2>Crear empresa</h2>
          <p className="inv-subtle">Solo lo verás una vez.</p>
        </div>

        <div className="card-body">
          <div className="form-grid">
            <div className="form-field" style={{ gridColumn: "1 / -1" }}>
              <label>Nombre (obligatorio)</label>
              <input
                value={nombre}
                onChange={e => setNombre(e.target.value)}
                placeholder="Mi empresa"
              />
            </div>

            <div className="form-field" style={{ gridColumn: "1 / -1" }}>
              <label>NIT (opcional)</label>
              <input
                value={nit}
                onChange={e => setNit(e.target.value)}
                placeholder="901xxxxx"
              />
            </div>

            <div className="form-field" style={{ gridColumn: "1 / -1" }}>
              <label>Logo (elige una opción)</label>
              <input
                type="text"
                placeholder="URL del logo (opcional)"
                value={logoUrl}
                onChange={e => setLogoUrl(e.target.value)}
              />
              <div style={{ marginTop: 8 }}>
                <input type="file" accept="image/*" onChange={handleLogoFile} />
              </div>
              <p className="inv-subtle" style={{ marginTop: 6 }}>
                Si adjuntas un archivo y dejas la URL vacía, lo subiremos a imgbb.
              </p>
            </div>
          </div>

          {error && <div className="toast toast-error" style={{ marginTop: 12 }}>{error}</div>}
        </div>

        <div className="card-footer">
          <button className="btn btn-primary" onClick={crear} disabled={cargando}>
            {cargando ? "Creando…" : "Crear empresa"}
          </button>
        </div>
      </div>
    </div>
  );
}
