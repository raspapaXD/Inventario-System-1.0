/// src/pages/RegistroVentas.jsx
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { db } from "../../firebaseClient";
import {
  collection, query, where, orderBy, getDocs, limit
} from "firebase/firestore";
import { useTenant } from "../tenant/TenantProvider";
import "./inventario.css";

function useTheme() {
  const [theme, setTheme] = useState(() => localStorage.getItem("theme") || "dark");
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("theme", theme);
  }, [theme]);
  const toggle = () => setTheme(t => (t === "dark" ? "light" : "dark"));
  return { theme, toggle };
}

export default function RegistroVentas() {
  const { theme, toggle } = useTheme();
  const { empresa } = useTenant();

  const [ventas, setVentas] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);

  // Filtros
  const hoyISO = new Date().toISOString().slice(0, 10);
  const [desde, setDesde] = useState(hoyISO);
  const [hasta, setHasta] = useState(hoyISO);
  const [qCliente, setQCliente] = useState("");
  const [agrupado, setAgrupado] = useState(false);
  const [ordenDesc, setOrdenDesc] = useState(true);

  // Rango de fechas
  const rango = useMemo(() => {
    const start = desde ? new Date(`${desde}T00:00:00`) : null;
    const end   = hasta ? new Date(`${hasta}T23:59:59.999`) : null;
    return { start, end };
  }, [desde, hasta]);

  // Normalizador
  const normalizaVenta = (d) => {
    const data = d.data();
    let f = data.fecha;
    if (f?.toDate) f = f.toDate();
    else if (typeof f === "number" || typeof f === "string") f = new Date(f);
    else f = null;

    const items = data.items || data.productos || [];
    const total = Number(
      data.total ??
      items.reduce((acc, it) => acc + Number(it.cantidad||0)*Number(it.precioUnitario||0), 0)
    );

    const clienteNombre =
      (data.cliente && typeof data.cliente === "object" ? data.cliente.nombre : data.cliente) ||
      data.clienteNombre || "Consumidor final";
    const clienteDoc =
      (data.cliente && typeof data.cliente === "object" ? data.cliente.documento : data.documento) || "";

    return {
      id: d.id,
      fecha: f,
      total,
      items,
      clienteNombre,
      clienteDoc
    };
  };

  // Carga con múltiples “plan B”
  useEffect(() => {
    (async () => {
      setCargando(true);
      setError(null);
      setVentas([]);

      if (!empresa?.id) { setCargando(false); return; }

      const subcol = collection(db, "empresas", empresa.id, "ventas");

      // 1) Intento ideal: rango + orderBy (no necesita índice compuesto)
      try {
        const cons = [];
        if (rango.start) cons.push(where("fecha", ">=", rango.start));
        if (rango.end)   cons.push(where("fecha", "<=", rango.end));
        cons.push(orderBy("fecha", ordenDesc ? "desc" : "asc"));
        const qy = query(subcol, ...cons);
        const snap = await getDocs(qy);
        if (!snap.empty) {
          setVentas(snap.docs.map(normalizaVenta));
          setCargando(false);
          return;
        }
      } catch (e) {
        console.error("Q1 (rango+orderBy) falló:", e);
      }

      // 2) Plan B: solo orderBy + limit (evita algunos índices)
      try {
        const qy = query(subcol, orderBy("fecha", ordenDesc ? "desc" : "asc"), limit(200));
        const snap = await getDocs(qy);
        if (!snap.empty) {
          setVentas(snap.docs.map(normalizaVenta));
          setCargando(false);
          return;
        }
      } catch (e) {
        console.error("Q2 (solo orderBy) falló:", e);
      }

      // 3) Plan C: sin orderBy (último recurso)
      try {
        const snap = await getDocs(subcol);
        if (!snap.empty) {
          const list = snap.docs.map(normalizaVenta);
          // ordenamos en memoria
          list.sort((a,b) => (a.fecha?.getTime()||0) - (b.fecha?.getTime()||0));
          if (ordenDesc) list.reverse();
          setVentas(list);
          setCargando(false);
          return;
        }
      } catch (e) {
        console.error("Q3 (sin orderBy) falló:", e);
      }

      // 4) Fallback a colección raíz por si hay ventas antiguas allí
      try {
        const cons = [];
        if (rango.start) cons.push(where("fecha", ">=", rango.start));
        if (rango.end)   cons.push(where("fecha", "<=", rango.end));
        cons.push(orderBy("fecha", ordenDesc ? "desc" : "asc"));
        const qy = query(collection(db, "ventas"), ...cons);
        const snap = await getDocs(qy);
        if (!snap.empty) {
          setVentas(snap.docs.map(normalizaVenta));
          setCargando(false);
          return;
        }
      } catch (e) {
        console.error("Q4 (raíz rango+orderBy) falló:", e);
      }

      setCargando(false);
      // Nota: no marcamos error si simplemente no hay ventas
    })();
  }, [empresa?.id, rango.start, rango.end, ordenDesc]);

  // Filtro por cliente
  const ventasFiltradas = useMemo(() => {
    const t = (qCliente || "").trim().toLowerCase();
    if (!t) return ventas;
    return ventas.filter(v =>
      (v.clienteNombre||"").toLowerCase().includes(t) ||
      (v.clienteDoc||"").toLowerCase().includes(t)
    );
  }, [ventas, qCliente]);

  const conteo = ventasFiltradas.length;
  const suma = ventasFiltradas.reduce((acc, v) => acc + Number(v.total||0), 0);

  const grupos = useMemo(() => {
    if (!agrupado) return null;
    const map = new Map();
    for (const v of ventasFiltradas) {
      const key = `${v.clienteNombre}||${v.clienteDoc||""}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(v);
    }
    for (const arr of map.values()) {
      arr.sort((a,b) => (a.fecha?.getTime()||0) - (b.fecha?.getTime()||0));
      if (ordenDesc) arr.reverse();
    }
    return Array.from(map.entries()).map(([k, arr]) => {
      const [nombre, documento] = k.split("||");
      const totalGrupo = arr.reduce((acc,v)=>acc+Number(v.total||0),0);
      return { nombre, documento, total: totalGrupo, ventas: arr };
    });
  }, [agrupado, ventasFiltradas, ordenDesc]);

  const exportarCSV = () => {
    const rows = [["ID","Fecha","Cliente","Documento","Items","Total"]];
    for (const v of ventasFiltradas) {
      rows.push([
        v.id,
        v.fecha ? v.fecha.toLocaleString() : "",
        v.clienteNombre,
        v.clienteDoc || "",
        String(v.items?.length || 0),
        String(v.total || 0),
      ]);
    }
    const csv = rows.map(r => r.map(x => `"${(x??"").toString().replace(/"/g,'""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ventas_${desde || ""}_${hasta || ""}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="inv-root">
      <header className="inv-header">
        <div>
          <h1>Registro de ventas</h1>
          <p className="inv-subtle">
            {cargando ? "Cargando…" : `Mostrando ${conteo} venta(s) • Total $${suma.toLocaleString()}`}
          </p>
        </div>
        <div className="header-actions">
          <button className="btn theme-toggle" onClick={toggle}>
            {theme === "dark" ? "☀️ Claro" : "🌙 Oscuro"}
          </button>
          <Link to="/" className="btn">← Inventario</Link>
        </div>
      </header>

      <section className="inv-toolbar" style={{ rowGap: 10 }}>
        <div className="form-field">
          <label>Desde</label>
          <input type="date" value={desde} onChange={(e)=>setDesde(e.target.value)} />
        </div>
        <div className="form-field">
          <label>Hasta</label>
          <input type="date" value={hasta} onChange={(e)=>setHasta(e.target.value)} />
        </div>

        <div className="input-with-icon" style={{ maxWidth: 320 }}>
          <span className="icon">👤</span>
          <input
            type="text"
            placeholder="Buscar por cliente o documento…"
            value={qCliente}
            onChange={(e)=>setQCliente(e.target.value)}
          />
        </div>

        <label className="checkbox">
          <input type="checkbox" checked={agrupado} onChange={(e)=>setAgrupado(e.target.checked)} />
          <span>Agrupar por cliente</span>
        </label>

        <label className="checkbox">
          <input type="checkbox" checked={ordenDesc} onChange={(e)=>setOrdenDesc(e.target.checked)} />
          <span>Más recientes primero</span>
        </label>

        <button className="btn" onClick={exportarCSV}>⬇️ Exportar CSV</button>
      </section>

      <section className="inv-grid" style={{ gridTemplateColumns: "1fr" }}>
        <div className="card">
          <div className="card-header"><h2>Ventas</h2></div>
          <div className="card-body">
            {ventasFiltradas.length === 0 && !cargando ? (
              <p className="inv-subtle">No hay ventas en el rango o con ese filtro.</p>
            ) : (
              <>
                {!agrupado ? (
                  <ul className="product-list">
                    {ventasFiltradas.map((v) => (
                      <li className="product-item" key={v.id} style={{ gridTemplateColumns: "1fr auto" }}>
                        <div className="product-info">
                          <div className="product-title-row" style={{ justifyContent:"space-between" }}>
                            <strong>Factura #{v.id.slice(0,8).toUpperCase()}</strong>
                            <span className="inv-subtle">{v.fecha ? v.fecha.toLocaleString() : "—"}</span>
                          </div>
                          <div className="product-meta">
                            <span>Cliente: <b>{v.clienteNombre}</b></span>
                            {v.clienteDoc ? <span>Doc: <b>{v.clienteDoc}</b></span> : null}
                            <span>Ítems: <b>{v.items?.length || 0}</b></span>
                            <span>Total: <b>${Number(v.total||0).toLocaleString()}</b></span>
                          </div>
                        </div>
                        <div className="product-actions">
                          <Link className="btn btn-small" to={`/factura/${v.id}`}>Ver factura</Link>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="category-groups">
                    {grupos?.map((g) => (
                      <div className="category-block" key={`${g.nombre}-${g.documento}`}>
                        <div className="category-title">
                          {g.nombre} {g.documento ? `• ${g.documento}` : ""} — Total: ${g.total.toLocaleString()}
                        </div>
                        <ul className="product-list">
                          {g.ventas.map((v) => (
                            <li className="product-item" key={v.id} style={{ gridTemplateColumns: "1fr auto" }}>
                              <div className="product-info">
                                <div className="product-title-row" style={{ justifyContent:"space-between" }}>
                                  <strong>Factura #{v.id.slice(0,8).toUpperCase()}</strong>
                                  <span className="inv-subtle">{v.fecha ? v.fecha.toLocaleString() : "—"}</span>
                                </div>
                                <div className="product-meta">
                                  <span>Ítems: <b>{v.items?.length || 0}</b></span>
                                  <span>Total: <b>${Number(v.total||0).toLocaleString()}</b></span>
                                </div>
                              </div>
                              <div className="product-actions">
                                <Link className="btn btn-small" to={`/factura/${v.id}`}>Ver factura</Link>
                              </div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
