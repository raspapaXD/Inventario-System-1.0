import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { db } from "../../firebase";
import { doc, getDoc, collection, query, where, getDocs } from "firebase/firestore";
import "./inventario.css";

export default function ClienteDetalle(){
  const { id } = useParams(); // id del cliente (documento normalizado)
  const [cliente, setCliente] = useState(null);
  const [ventas, setVentas] = useState([]);
  const [error, setError] = useState(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        setError(null);
        setCargando(true);

        // 1) Traer cliente
        const cSnap = await getDoc(doc(db, "clientes", id));
        if (cSnap.exists()) setCliente({ id, ...cSnap.data() });

        // 2) Traer ventas por referencia (SIN orderBy para evitar índice compuesto)
        const qy = query(
          collection(db, "ventas"),
          where("clienteId", "==", `clientes/${id}`)
        );
        const vSnap = await getDocs(qy);

        // 3) Normalizar y ORDENAR en memoria por fecha DESC
        const lista = vSnap.docs.map(d => {
          const data = d.data();

          // Normaliza fecha a Date para ordenar
          let fechaJS = null;
          const f = data.fecha;
          if (f?.toDate) fechaJS = f.toDate();           // Timestamp Firestore
          else if (typeof f === "number") fechaJS = new Date(f);
          else if (typeof f === "string") fechaJS = new Date(f);

          return { id: d.id, ...data, __fechaJS: fechaJS };
        });

        lista.sort((a, b) => {
          const ta = a.__fechaJS ? a.__fechaJS.getTime() : 0;
          const tb = b.__fechaJS ? b.__fechaJS.getTime() : 0;
          return tb - ta; // más recientes primero
        });

        setVentas(lista);
      } catch (e) {
        console.error(e);
        setError("No se pudieron cargar las ventas de este cliente.");
      } finally {
        setCargando(false);
      }
    })();
  }, [id]);

  const totalCompras = useMemo(
    () => ventas.reduce((acc, v) => acc + Number(v.total || 0), 0),
    [ventas]
  );

  const fmtFecha = (f) => {
    if (!f) return "—";
    if (typeof f?.toDate === "function") return f.toDate().toLocaleString();
    if (typeof f === "number") return new Date(f).toLocaleString();
    if (typeof f === "string") return new Date(f).toLocaleString();
    return "—";
  };

  return (
    <div className="inv-root">
      <header className="inv-header">
        <div>
          <h1>{cliente?.nombre || "Cliente"}</h1>
          <p className="inv-subtle">Documento: {cliente?.documento || "—"}</p>
        </div>
        <div className="header-actions">
          <Link className="btn" to="/clientes">← Volver a clientes</Link>
          <Link className="btn" to="/">🏠 Inventario</Link>
        </div>
      </header>

      <section className="inv-grid" style={{ gridTemplateColumns:"1fr" }}>
        <div className="card">
          <div className="card-header">
            <h2>Historial de compras</h2>
          </div>
          <div className="card-body">
            <div className="product-item" style={{ background:"transparent" }}>
              <div className="product-info" style={{ gridColumn:"1 / -1" }}>
                <div className="product-title-row" style={{ justifyContent:"space-between" }}>
                  <strong>Total de compras: ${totalCompras.toLocaleString()}</strong>
                  <span className="inv-subtle">
                    {cargando ? "Cargando…" : `${ventas.length} venta(s)`}
                  </span>
                </div>
              </div>
            </div>

            {error && (
              <div className="toast toast-error" style={{ position: "static", marginBottom: 12 }}>
                {error}
              </div>
            )}

            {!cargando && ventas.length === 0 ? (
              <p className="inv-subtle">Este cliente aún no tiene compras registradas.</p>
            ) : (
              <ul className="product-list">
                {ventas.map(v => (
                  <li className="product-item" key={v.id} style={{ gridTemplateColumns:"1fr auto" }}>
                    <div className="product-info">
                      <div className="product-title-row">
                        <strong>Factura #{v.id.slice(0,8).toUpperCase()}</strong>
                      </div>
                      <div className="product-meta">
                        <span>Fecha: <b>{fmtFecha(v.fecha)}</b></span>
                        <span>Total: <b>${Number(v.total||0).toLocaleString()}</b></span>
                        <span>Ítems: <b>{(v.items||v.productos||[]).length}</b></span>
                      </div>
                    </div>
                    <div className="product-actions">
                      <Link className="btn btn-small" to={`/factura/${v.id}`}>Ver factura</Link>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
