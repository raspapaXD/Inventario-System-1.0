// src/pages/Importar.jsx
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { db } from "../../firebaseClient";
import { collection, getDocs, addDoc, writeBatch, doc } from "firebase/firestore";
import { useTenant } from "../tenant/TenantProvider";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import "./inventario.css";

// Tema (reuso)
function useTheme() {
  const [theme, setTheme] = useState(() => localStorage.getItem("theme") || "dark");
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("theme", theme);
  }, [theme]);
  const toggle = () => setTheme(t => (t === "dark" ? "light" : "dark"));
  return { theme, toggle };
}

const REQUIRED_FIELDS = ["nombre", "cantidad", "precioUnitario"];
const OPTIONAL_FIELDS = ["minimo", "costoUnitario", "categoria", "imagen"];

const SUGGESTIONS = {
  nombre: ["nombre", "producto", "item", "descripcion", "descripción"],
  cantidad: ["cantidad", "stock", "existencias", "cant"],
  precioUnitario: ["precio", "precio_venta", "precio unitario", "venta"],
  minimo: ["minimo", "mínimo", "stock_minimo", "stock mínimo"],
  costoUnitario: ["costo", "costo_unitario", "coste", "compra"],
  categoria: ["categoria", "categoría", "rubro", "grupo"],
  imagen: ["imagen", "url_imagen", "image", "image_url", "foto"]
};

function normalize(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim();
}

function autoGuess(field, headers) {
  const cands = (SUGGESTIONS[field] || []).map(normalize);
  for (const h of headers) {
    const hn = normalize(h);
    if (cands.includes(hn)) return h;
    // match “contains”
    if (cands.some(c => hn.includes(c))) return h;
  }
  return "";
}

export default function Importar() {
  const { theme, toggle } = useTheme();
  const { empresa } = useTenant();

  const [file, setFile] = useState(null);
  const [rawRows, setRawRows] = useState([]); // Objetos con columnas crudas
  const [headers, setHeaders] = useState([]);
  const [mapping, setMapping] = useState({
    nombre: "",
    cantidad: "",
    precioUnitario: "",
    minimo: "",
    costoUnitario: "",
    categoria: "",
    imagen: ""
  });
  const [error, setError] = useState(null);
  const [step, setStep] = useState("upload"); // upload | map | preview | importing | done
  const [importStats, setImportStats] = useState({ total: 0, ok: 0, fail: 0 });
  const [creating, setCreating] = useState(false);

  // 1) Cargar archivo y parsear
  const onFile = async (e) => {
    setError(null);
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);

    const ext = (f.name.split(".").pop() || "").toLowerCase();

    try {
      let rows = [];
      if (ext === "csv") {
        rows = await parseCSV(f);
      } else if (ext === "xlsx" || ext === "xls") {
        rows = await parseXLSX(f);
      } else {
        throw new Error("Formato no soportado. Usa .csv, .xlsx o .xls");
      }

      if (!rows.length) {
        throw new Error("El archivo no contiene filas.");
      }

      // Determinar headers
      const hdrs = Object.keys(rows[0] || {});
      setHeaders(hdrs);

      // Autodetectar mapeo
      setMapping({
        nombre: autoGuess("nombre", hdrs),
        cantidad: autoGuess("cantidad", hdrs),
        precioUnitario: autoGuess("precioUnitario", hdrs),
        minimo: autoGuess("minimo", hdrs),
        costoUnitario: autoGuess("costoUnitario", hdrs),
        categoria: autoGuess("categoria", hdrs),
        imagen: autoGuess("imagen", hdrs)
      });

      setRawRows(rows);
      setStep("map");
    } catch (e2) {
      console.error(e2);
      setError(e2.message || "No se pudo leer el archivo.");
      setFile(null);
      setRawRows([]);
      setHeaders([]);
    }
  };

  // Helpers parse
  const parseCSV = (file) => {
    return new Promise((resolve, reject) => {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (res) => resolve(res.data),
        error: (err) => reject(err)
      });
    });
  };
  const parseXLSX = async (file) => {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json(ws, { defval: "" });
  };

  // 2) Validación de mapeo
  const canContinue = useMemo(() => {
    if (!headers.length) return false;
    for (const req of REQUIRED_FIELDS) {
      const col = mapping[req];
      if (!col || !headers.includes(col)) return false;
    }
    return true;
  }, [headers, mapping]);

  // 3) Construir filas normalizadas para previsualizar
  const previewRows = useMemo(() => {
    if (!rawRows.length || !headers.length) return [];
    return rawRows.map((r, idx) => {
      const nombre = getVal(r, mapping.nombre);
      const cantidad = toInt(getVal(r, mapping.cantidad));
      const precioUnitario = toFloat(getVal(r, mapping.precioUnitario));
      const minimo = mapping.minimo ? toInt(getVal(r, mapping.minimo)) : 0;
      const costoUnitario = mapping.costoUnitario ? toFloat(getVal(r, mapping.costoUnitario)) : 0;
      const categoria = mapping.categoria ? String(getVal(r, mapping.categoria) || "").trim() : "";
      const imagen = mapping.imagen ? String(getVal(r, mapping.imagen) || "").trim() : "";

      return {
        __row: idx + 1,
        nombre,
        nombreLower: normalize(nombre),
        cantidad,
        minimo,
        precioUnitario,
        costoUnitario,
        categoriaNombre: categoria || null,
        imagen: imagen || null,
        valid:
          nombre && isFinite(cantidad) && isFinite(precioUnitario) && cantidad >= 0 && precioUnitario >= 0
      };
    });
  }, [rawRows, headers, mapping]);

  const invalidCount = useMemo(() => previewRows.filter(r => !r.valid).length, [previewRows]);

  // 4) Importar (categorías + productos) en lotes
  const startImport = async () => {
    try {
      if (!empresa?.id) {
        setError("No hay empresa activa.");
        return;
      }
      if (!previewRows.length) {
        setError("No hay filas para importar.");
        return;
      }
      setCreating(true);
      setStep("importing");
      setImportStats({ total: previewRows.length, ok: 0, fail: 0 });

      // 4.1 Cargar categorías existentes
      const catCol = collection(db, "empresas", empresa.id, "categorias");
      const catSnap = await getDocs(catCol);
      const catMapByLower = new Map(); // nombreLower -> {id, nombre}
      catSnap.docs.forEach(d => {
        const data = d.data();
        const lower = normalize(data.nombre || "");
        if (lower) catMapByLower.set(lower, { id: d.id, nombre: data.nombre });
      });

      // 4.2 Reunir categorías nuevas requeridas
      const missing = new Set();
      for (const r of previewRows) {
        const cn = r.categoriaNombre ? normalize(r.categoriaNombre) : "";
        if (cn && !catMapByLower.has(cn)) missing.add(cn);
      }

      // 4.3 Crear categorías faltantes
      for (const lower of missing) {
        const nombre = rawRows.find(rr => normalize(getVal(rr, mapping.categoria)) === lower)?.[mapping.categoria] || lower;
        const ref = await addDoc(catCol, { nombre, nombreLower: normalize(nombre), creadoEn: new Date().toISOString() });
        catMapByLower.set(lower, { id: ref.id, nombre });
      }

      // 4.4 Insertar productos por lotes
      const prodCol = collection(db, "empresas", empresa.id, "productos");
      const CHUNK = 400; // writeBatch máx 500 ops (dejamos margen)
      let ok = 0, fail = 0;

      for (let i = 0; i < previewRows.length; i += CHUNK) {
        const chunk = previewRows.slice(i, i + CHUNK);
        const batch = writeBatch(db);

        for (const r of chunk) {
          try {
            if (!r.valid) { fail++; continue; }

            let categoriaId = "";
            let categoriaNombre = null;
            if (r.categoriaNombre) {
              const info = catMapByLower.get(normalize(r.categoriaNombre));
              if (info) { categoriaId = info.id; categoriaNombre = info.nombre; }
            }

            const docRef = doc(prodCol); // autogen id
            batch.set(docRef, {
              nombre: r.nombre,
              nombreLower: r.nombreLower,
              cantidad: Number(r.cantidad) || 0,
              minimo: Number(r.minimo) || 0,
              precioUnitario: Number(r.precioUnitario) || 0,
              costoUnitario: Number(r.costoUnitario) || 0,
              imagen: r.imagen || null,
              categoriaId,
              categoriaNombre
            });
            ok++;
          } catch {
            fail++;
          }
        }

        await batch.commit();
        setImportStats({ total: previewRows.length, ok, fail });
      }

      setCreating(false);
      setStep("done");
    } catch (e) {
      console.error(e);
      setError("No se pudo completar la importación.");
      setCreating(false);
      setStep("map");
    }
  };

  // Render
  return (
    <div className="inv-root">
      {/* Header */}
      <header className="inv-header">
        <div>
          <h1>Importar productos (Excel/CSV)</h1>
          <p className="inv-subtle">
            1) Sube archivo • 2) Mapea columnas • 3) Revisa • 4) Importa
          </p>
        </div>
        <div className="header-actions">
          <button className="btn theme-toggle" onClick={toggle}>
            {theme === "dark" ? "☀️ Claro" : "🌙 Oscuro"}
          </button>
          <Link to="/" className="btn">← Inventario</Link>
        </div>
      </header>

      {/* Paso: subir */}
      {step === "upload" && (
        <section className="inv-grid" style={{ gridTemplateColumns: "1fr" }}>
          <div className="card">
            <div className="card-header"><h2>Subir archivo</h2></div>
            <div className="card-body">
              <p>Formatos soportados: <b>.csv</b>, <b>.xlsx</b>, <b>.xls</b></p>
              <input type="file" accept=".csv,.xlsx,.xls" onChange={onFile} />
              {error && <div className="toast toast-error" style={{ position:"static", marginTop:12 }}>{error}</div>}
            </div>
          </div>
        </section>
      )}

      {/* Paso: mapear */}
      {step === "map" && (
        <section className="inv-grid" style={{ gridTemplateColumns: "1fr" }}>
          <div className="card">
            <div className="card-header"><h2>Mapear columnas</h2></div>
            <div className="card-body">
              <p className="inv-subtle">Selecciona a qué columna de tu archivo corresponde cada campo.</p>

              <div className="form-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
                {[...REQUIRED_FIELDS, ...OPTIONAL_FIELDS].map((field) => (
                  <div key={field} className="form-field">
                    <label>
                      {field}
                      {REQUIRED_FIELDS.includes(field) ? " *" : ""}
                    </label>
                    <select
                      value={mapping[field]}
                      onChange={(e)=>setMapping(m => ({...m, [field]: e.target.value}))}
                    >
                      <option value="">— Sin asignar —</option>
                      {headers.map(h => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </div>
                ))}
              </div>

              {!canContinue && (
                <div className="toast toast-error" style={{ position:"static", marginTop:12 }}>
                  Campos requeridos sin asignar: {REQUIRED_FIELDS.filter(f => !mapping[f]).join(", ")}
                </div>
              )}

              <div className="card-footer" style={{ justifyContent: "space-between" }}>
                <span className="inv-subtle">Filas detectadas: <b>{rawRows.length}</b></span>
                <div>
                  <button className="btn" onClick={() => { setFile(null); setRawRows([]); setHeaders([]); setStep("upload"); }}>
                    ← Cambiar archivo
                  </button>
                  <button className="btn btn-primary" onClick={() => setStep("preview")} disabled={!canContinue}>
                    Siguiente: Previsualizar
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Paso: previsualizar */}
      {step === "preview" && (
        <section className="inv-grid" style={{ gridTemplateColumns: "1fr" }}>
          <div className="card">
            <div className="card-header"><h2>Previsualización</h2></div>
            <div className="card-body">
              <p className="inv-subtle">
                Mostrando un resumen de las primeras filas. Filas inválidas: <b>{invalidCount}</b>
              </p>

              <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: 12 }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th style={th}>#</th>
                      <th style={th}>Nombre</th>
                      <th style={th}>Cantidad</th>
                      <th style={th}>Mínimo</th>
                      <th style={th}>Precio</th>
                      <th style={th}>Costo</th>
                      <th style={th}>Categoría</th>
                      <th style={th}>Imagen</th>
                      <th style={th}>OK</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.slice(0, 25).map((r) => (
                      <tr key={r.__row} style={{ borderTop: "1px solid var(--border)" }}>
                        <td style={td}>{r.__row}</td>
                        <td style={td}>{r.nombre}</td>
                        <td style={tdRight}>{r.cantidad}</td>
                        <td style={tdRight}>{r.minimo}</td>
                        <td style={tdRight}>{r.precioUnitario}</td>
                        <td style={tdRight}>{r.costoUnitario}</td>
                        <td style={td}>{r.categoriaNombre || "—"}</td>
                        <td style={td}>{r.imagen ? "URL" : "—"}</td>
                        <td style={td}>{r.valid ? "✅" : "❌"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {invalidCount > 0 && (
                <div className="toast toast-error" style={{ position:"static", marginTop:12 }}>
                  Hay filas inválidas (nombre/cantidad/precio requeridos y numéricos). Serán ignoradas.
                </div>
              )}
            </div>
            <div className="card-footer" style={{ justifyContent: "space-between" }}>
              <button className="btn" onClick={() => setStep("map")}>← Volver</button>
              <button className="btn btn-primary" onClick={startImport}>Importar ahora</button>
            </div>
          </div>
        </section>
      )}

      {/* Paso: importando */}
      {step === "importing" && (
        <section className="inv-grid" style={{ gridTemplateColumns: "1fr" }}>
          <div className="card">
            <div className="card-header"><h2>Importando…</h2></div>
            <div className="card-body">
              <p className="inv-subtle">No cierres esta pestaña.</p>
              <p>Total: <b>{importStats.total}</b> • OK: <b>{importStats.ok}</b> • Fallidos: <b>{importStats.fail}</b></p>
              {creating && <p>Creando categorías/faltantes y cargando lotes…</p>}
              {error && <div className="toast toast-error" style={{ position:"static", marginTop:12 }}>{error}</div>}
            </div>
          </div>
        </section>
      )}

      {/* Paso: terminado */}
      {step === "done" && (
        <section className="inv-grid" style={{ gridTemplateColumns: "1fr" }}>
          <div className="card">
            <div className="card-header"><h2>¡Importación completa!</h2></div>
            <div className="card-body">
              <p>Total: <b>{importStats.total}</b></p>
              <p>OK: <b>{importStats.ok}</b></p>
              <p>Fallidos: <b>{importStats.fail}</b></p>
              <div className="card-footer" style={{ padding: 0, marginTop: 12 }}>
                <Link to="/" className="btn">← Ir al Inventario</Link>
                <button className="btn" onClick={() => { setFile(null); setRawRows([]); setHeaders([]); setMapping({nombre:"",cantidad:"",precioUnitario:"",minimo:"",costoUnitario:"",categoria:"",imagen:""}); setError(null); setImportStats({total:0,ok:0,fail:0}); setStep("upload"); }}>
                  Importar otro archivo
                </button>
              </div>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

// ===== helpers render
const th = { textAlign: "left", padding: "10px 12px", borderBottom: "1px solid var(--border)", background: "var(--card)" };
const td = { padding: "8px 12px" };
const tdRight = { ...td, textAlign: "right" };

function getVal(row, col) {
  if (!col) return "";
  return row[col];
}
function toInt(v) {
  const n = parseInt(String(v).replace(/[^0-9-]/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
}
function toFloat(v) {
  const s = String(v).replace(/[^0-9,.\-]/g, "").replace(",", ".");
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}
