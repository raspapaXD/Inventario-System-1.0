// src/pages/Historial.jsx
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { db } from "../../firebaseClient.js";
import { useTenant } from "../tenant/TenantProvider";
import {
  collection, getDocs, query, orderBy, limit, startAfter, where
} from "firebase/firestore";
import "./inventario.css";

export default function Historial() {
  const { empresa } = useTenant();

  const ventasCol = useMemo(() => {
    if (!empresa?.id) return null;
    return collection(db, "empresas", empresa.id, "ventas");
  }, [empresa?.id]);

  const [ventas, setVentas] = useState([]);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState(null);
  const [ultimoDoc, setUltimoDoc] = useState(null);
  const [hayMas, setHayMas] = useState(true);

  // Filtro simple por texto (cliente.nombre / cliente.documento)
  const [qStr, setQStr] = useState("");

  const pageSize = 20;

  const fmtFecha = (f) => {
    if (!f) return "—";
    if (typeof f?.toDate === "function") return f.toDate().toLocaleString();
    if (typeof f === "number") return new Date(f).toLocaleString();
    if (typeof f === "string") return new Date(f).toLocaleString();
    return "—";
  };

  const cargarPrimeraPagina = async () => {
    if (!ventasCol) return;
    try {
      setCargando(true);
      setError(null);
      const qy = query(ventasCol, orderBy("fecha", "desc"), limit(pageSize));
      const snap = await getDocs(qy);

      const lista = snap.docs.map(d => ({ id: d.id, ...d.data(), _doc: d }));
      setVentas(lista);
      setUltimoDoc(snap.docs[snap.docs.length - 1] || null);
      setHayMas(snap.docs.length === pageSize);
    } catch (e) {
      console.error(e);
      setError("No se pudieron cargar las ventas.");
    } finally {
      setCargando(false);
    }
  };

  const cargarMas = async () => {
    if (!ventasCol || !ultimoDoc) return;
    try {
      setCargando(true);
      setError(null);
      const qy = query(ventasCol, orderBy("fecha", "desc"), startAfter(ultimoDoc), limit(pageSize));
      const snap = await getDocs(qy);
      const lista = snap.docs.map(d => ({ id: d.id, ...d.data(), _doc: d }));
      setVentas(v => [...v, ...lista]);
      setUltimoDoc(snap.docs[snap.docs.length - 1] || null);
      setHayMas(snap.docs.length === pageSize);
    } catch (e) {
      console.error(e);
      setError("No se pudieron cargar más ventas.");
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => {
    cargarPrimeraPagina();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ventasCol]);

  const filtradas = useMemo(() => {
    const t = qStr.trim().toLowerCase();
    if (!t) return ventas;
    return ventas.filter(v => {
      const nombre = (v.cliente?.nombre || "").toLowerCase();
      const doc = (v.cliente?.documento || "").toLowerCase();
      return nombre.includes(t) || doc.includes(t);
    });
  }, [ventas, qStr]);

  if (!empresa?.id) {
    return (
      <div className="inv-root">
        <header className="inv-header"><h1>Cargando empresa…</h1></header>
      </div>
    );
  }

  return (
    <div className="inv-root">
      <header className="inv-header">
        <div>
          <h1>Historial de ventas</h1>
          <p className="inv-subtle">
            Empresa: {empresa?.nombre || empresa?.id} — Registros: {filtradas.length}
            {cargando ? " • Cargando..." : ""}
          </p>
        </div>
        <div className="header-actions">
          <Link className="btn" to="/">← Inventario</Link>
        </div>
      </header>

      <section className="inv-toolbar">
        <div className="input-with-icon" style={{ maxWidth: 420 }}>
          <span className="icon">🔎</span>
          <input
            placeholder="Buscar por cliente (nombre o documento)…"
            value={qStr}
            onChange={(e)=>setQStr(e.target.value)}
          />
        </div>
      </section>

      <section className="inv-grid" style={{ gridTemplateColumns: "1fr" }}>
        <div className="card">
          <div className="card-header"><h2>Ventas</h2></div>
          <div className="card-body">
            {error && (
              <div className="toast toast-error" style={{ position: "static", marginBottom: 12 }}>
                {error}
              </div>
            )}

            {filtradas.length === 0 && !cargando ? (
              <p className="inv-subtle">No hay ventas registradas.</p>
            ) : (
              <ul className="product-list">
                {filtradas.map(v => (
                  <li className="product-item" key={v.id} style={{ gridTemplateColumns:"1fr auto" }}>
                    <div className="product-info">
                      <div className="product-title-row">
                        <strong>Factura #{v.id.slice(0,8).toUpperCase()}</strong>
                      </div>
                      <div className="product-meta">
                        <span>Fecha: <b>{fmtFecha(v.fecha)}</b></span>
                        <span>Total: <b>${Number(v.total||0).toLocaleString()}</b></span>
                        <span>Ítems: <b>{(v.items||[]).length}</b></span>
                        <span>Cliente: <b>{v.cliente?.nombre || "-"}</b></span>
                        <span>Documento: <b>{v.cliente?.documento || "-"}</b></span>
                      </div>
                    </div>
                    <div className="product-actions">
                      <Link className="btn btn-small" to={`/factura/${v.id}`}>Ver factura</Link>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {hayMas && (
              <div style={{ marginTop: 12 }}>
                <button className="btn" onClick={cargarMas} disabled={cargando}>
                  {cargando ? "Cargando..." : "Cargar más"}
                </button>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
