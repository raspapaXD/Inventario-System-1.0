import { useEffect, useMemo, useState } from "react";
import { db } from "../../firebaseClient";
import { collection, getDocs, doc, getDoc, query, orderBy, where } from "firebase/firestore";
import { Link } from "react-router-dom";
import "./inventario.css";

export default function Clientes() {
  const [clientes, setClientes] = useState([]);
  const [ventas, setVentas] = useState([]); // opcional si quieres métricas globales
  const [qStr, setQStr] = useState("");

  useEffect(() => {
    (async () => {
      const cs = await getDocs(collection(db, "clientes"));
      setClientes(cs.docs.map(d=>({ id:d.id, ...d.data() })));
    })();
  }, []);

  const filtrados = useMemo(() => {
    const t = qStr.trim().toLowerCase();
    if (!t) return clientes;
    return clientes.filter(c =>
      (c.nombre||"").toLowerCase().includes(t) ||
      (c.documento||"").toLowerCase().includes(t)
    );
  }, [clientes, qStr]);

  return (
    <div className="inv-root">
      <header className="inv-header">
        <div>
          <h1>Clientes</h1>
          <p className="inv-subtle">Consulta y gestiona clientes y su historial de compras</p>
        </div>
        <div className="header-actions">
          <Link className="btn" to="/">← Inventario</Link>
        </div>
      </header>

      <section className="inv-toolbar">
        <div className="input-with-icon" style={{ maxWidth: 420 }}>
          <span className="icon">🔎</span>
          <input
            placeholder="Buscar por nombre o documento…"
            value={qStr}
            onChange={(e)=>setQStr(e.target.value)}
          />
        </div>
      </section>

      <section className="inv-grid" style={{ gridTemplateColumns:"1fr" }}>
        <div className="card">
          <div className="card-header"><h2>Listado</h2></div>
          <div className="card-body">
            {filtrados.length === 0 ? (
              <p className="inv-subtle">Sin clientes coincidentes.</p>
            ) : (
              <ul className="product-list">
                {filtrados.map(c => (
                  <li className="product-item" key={c.id} style={{ gridTemplateColumns:"1fr auto" }}>
                    <div className="product-info">
                      <div className="product-title-row">
                        <strong>{c.nombre}</strong>
                      </div>
                      <div className="product-meta">
                        <span>Documento: <b>{c.documento || "—"}</b></span>
                        <span>ID: <b>{c.id}</b></span>
                      </div>
                    </div>
                    <div className="product-actions">
                      <Link className="btn btn-small" to={`/clientes/${c.id}`}>Ver historial</Link>
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
