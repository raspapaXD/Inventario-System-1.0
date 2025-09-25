import { useEffect, useState, useRef } from "react";
import { db } from "../../firebase";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import "./inventario.css";

function dataURLtoFile(dataUrl, filename) {
  const arr = dataUrl.split(","), mime = arr[0].match(/:(.*?);/)[1], bstr = atob(arr[1]);
  let n = bstr.length; const u8 = new Uint8Array(n); while(n--) u8[n] = bstr.charCodeAt(n);
  return new File([u8], filename, { type: mime });
}
async function comprimirImagen(file, { maxWidth=800, maxHeight=800, quality=0.8, outputType="image/jpeg" } = {}) {
  const img = await new Promise((res, rej) => {
    const u = URL.createObjectURL(file); const im = new Image();
    im.onload = () => { URL.revokeObjectURL(u); res(im); }; im.onerror = rej; im.src = u;
  });
  const ratio = Math.min(maxWidth/img.width, maxHeight/img.height, 1);
  const w = Math.round(img.width*ratio), h = Math.round(img.height*ratio);
  const canvas = document.createElement("canvas"); canvas.width=w; canvas.height=h; const ctx=canvas.getContext("2d");
  ctx.drawImage(img,0,0,w,h); const dataUrl = canvas.toDataURL(outputType, quality);
  const base = file.name.replace(/\.[^/.]+$/, ""); return dataURLtoFile(dataUrl, `${base}.jpg`);
}
function subirImagenAImgBB(file){
  const fd=new FormData(); fd.append("image", file);
  return fetch("https://api.imgbb.com/1/upload?key=46bbab2f0ec657f928ab05ac5d78c37b",{method:"POST", body:fd})
    .then(r=>r.json()).then(j=>j?.data?.url);
}

export default function Configuracion() {
  const [datos, setDatos] = useState({ nombre: "", nit: "", logoUrl: "" });
  const [logoFile, setLogoFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState("");

  const fileRef = useRef(null);

  useEffect(() => {
    (async () => {
      const snap = await getDoc(doc(db, "empresas", "empresa"));
      if (snap.exists()) setDatos(snap.data());
    })();
  }, []);

  const onChange = (e) => setDatos({ ...datos, [e.target.name]: e.target.value });
  const onPick = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setLogoFile(f);
    setPreview(URL.createObjectURL(f));
  };

  const guardar = async () => {
    try {
      setGuardando(true); setMsg("");
      let url = datos.logoUrl || "";
      if (logoFile) {
        const comp = await comprimirImagen(logoFile);
        const sub = await subirImagenAImgBB(comp);
        if (sub) url = sub;
      }
      await setDoc(doc(db, "empresas", "empresa"), {
        nombre: (datos.nombre || "").trim(),
        nit: (datos.nit || "").trim(),
        logoUrl: url || "",
        actualizadoEn: serverTimestamp()
      }, { merge: true });
      setDatos((d) => ({ ...d, logoUrl: url }));
      setMsg("✅ Configuración guardada");
    } catch (e) {
      console.error(e);
      setMsg("❌ No se pudo guardar");
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="inv-root">
      <header className="inv-header">
        <div>
          <h1>Configuración de la empresa</h1>
          <p className="inv-subtle">Logo, nombre y NIT para usar en toda la app y facturas</p>
        </div>
      </header>

      <section className="inv-grid" style={{ gridTemplateColumns: "1fr" }}>
        <div className="card">
          <div className="card-header"><h2>Datos de empresa</h2></div>
          <div className="card-body">
            <div className="form-grid">
              <div className="form-field">
                <label>Nombre de la empresa</label>
                <input name="nombre" value={datos.nombre} onChange={onChange} placeholder="Ej: Minimercado Ordex" />
              </div>
              <div className="form-field">
                <label>NIT</label>
                <input name="nit" value={datos.nit} onChange={onChange} placeholder="Ej: 900.123.456-7" />
              </div>
            </div>

            <div className="image-actions" style={{ marginTop: 8 }}>
              <button className="btn" onClick={() => fileRef.current?.click()}>🖼️ Subir logo</button>
              <input ref={fileRef} type="file" accept="image/*" onChange={onPick} style={{ display: "none" }} />
            </div>

            { (preview || datos.logoUrl) && (
              <div className="preview-row">
                <img className="preview-img" src={preview || datos.logoUrl} alt="Logo" />
              </div>
            )}

            {msg && <div style={{ marginTop: 10 }} className={`toast ${msg.startsWith("❌") ? "toast-error":""}`} >{msg}</div>}
          </div>
          <div className="card-footer">
            <button className="btn btn-primary" onClick={guardar} disabled={guardando}>
              {guardando ? "Guardando..." : "Guardar cambios"}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
