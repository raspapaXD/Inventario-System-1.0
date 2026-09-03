// src/pages/RegistroVentas.jsx
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { db } from "../../firebaseClient";
import {
  collection,
  query,
  where,
  orderBy,
  getDocs,
  limit
} from "firebase/firestore";
import { useTenant } from "../tenant/TenantProvider";
import "./inventario.css";

/* =======================
   Tema
======================= */
function useTheme() {
  const [theme, setTheme] = useState(() => localStorage.getItem("theme") || "dark");
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("theme", theme);
  }, [theme]);
  return { theme, toggle: () => setTheme(t => (t === "dark" ? "light" : "dark")) };
}

/* =======================
   Página
======================= */
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

  /* =======================
     Rango de fechas
  ======================= */
  const rango = useMemo(() => {
    return {
      start: desde ? new Date(`${desde}T00:00:00`) : null,
      end: hasta ? new Date(`${hasta}T23:59:59.999`) : null
    };
  }, [desde, hasta]);

  /* =======================
     Normalizador de ventas
  ======================= */
  const normalizarVenta = (doc) => {
    const data = doc.data();

    let fecha = data.fecha;
    if (fecha?.toDate) fecha = fecha.toDate();
    else if (fecha) fecha = new Date(fecha);
    else fecha = null;

    const items = data.items || [];
    const total = Number(
      data.total ??
      items.reduce(
        (acc, it) =>
          acc + Number(it.cantidad || 0) * Number(it.precioUnitario || 0),
        0
      )
    );

    return {
      id: doc.id,
      fecha,
      total,
      items,
      clienteNombre: data.cliente?.nombre || "Consumidor final",
      clienteDoc: data.cliente?.documento || ""
    };
  };

  /* =======================
     Cargar ventas
  ======================= */
  useEffect(() => {
    (async () => {
      if (!empresa?.id) return;

      setCargando(true);
      setError(null);

      const ventasRef = collection(db, "empresas", empresa.id, "ventas");

      try {
        const filtros = [];
        if (rango.start) filtros.push(where("fecha", ">=", rango.start));
        if (rango.end) filtros.push(where("fecha", "<=", rango.end));
        filtros.push(orderBy("fecha", ordenDesc ? "desc" : "asc"));

        const q = query(ventasRef, ...filtros);
        const snap = await getDocs(q);

        setVentas(snap.docs.map(normalizarVenta));
      } catch (e) {
        console.error(e);
        setError("No se pudieron cargar las ventas.");
      } finally {
        setCargando(false);
      }
    })();
  }, [empresa?.id, rango.start, rango.end, ordenDesc]);

  /* =======================
     Filtros en memoria
  ======================= */
  const ventasFiltradas = useMemo(() => {
    const t = qCliente.trim().toLowerCase();
    if (!t) return ventas;

    return ventas.filter(v =>
      v.clienteNombre.toLowerCase().includes(t) ||
      (v.clienteDoc || "").toLowerCase().includes(t)
    );
  }, [ventas, qCliente]);

  const totalVentas = ventasFiltradas.reduce((acc, v) => acc + v.total, 0);

  /* =======================
     Exportar CSV
  ======================= */
  const exportarCSV = () => {
    const rows = [["ID", "Fecha", "Cliente", "Documento", "Items", "Total"]];

    ventasFiltradas.forEach(v => {
      rows.push([
        v.id,
        v.fecha?.toLocaleString() || "",
        v.clienteNombre,
        v.clienteDoc,
        v.items.length,
        v.total
      ]);
    });

    const csv = rows.map(r => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `ventas_${desde}_${hasta}.csv`;
    a.click();

    URL.revokeObjectURL(url);
  };

  /* =======================
     Render
  ======================= */
  return (
    <div className="inv-root">
      <header className="inv-header">
        <div>
          <h1>Registro de ventas</h1>
          <p className="inv-subtle">
            {cargando
              ? "Cargando…"
              : `${ventasFiltradas.length} ventas • Total $${totalVentas.toLocaleString()}`}
          </p>
        </div>
        <div className="header-actions">
          <button className="btn theme-toggle" onClick={toggle}>
            {theme === "dark" ? "☀️ Claro" : "🌙 Oscuro"}
          </button>
          <Link to="/" className="btn">← Inventario</Link>
        </div>
      </header>

      <section className="inv-toolbar">
        <input type="date" value={desde} onChange={e => setDesde(e.target.value)} />
        <input type="date" value={hasta} onChange={e => setHasta(e.target.value)} />
        <input
          placeholder="Buscar cliente…"
          value={qCliente}
          onChange={e => setQCliente(e.target.value)}
        />
        <button className="btn" onClick={exportarCSV}>⬇️ Exportar CSV</button>
      </section>

      <section className="inv-grid" style={{ gridTemplateColumns: "1fr" }}>
        <div className="card">
          <div className="card-body">
            {ventasFiltradas.map(v => (
              <div key={v.id} className="product-item">
                <strong>Factura #{v.id.slice(0, 8)}</strong>
                <div className="inv-subtle">
                  {v.fecha?.toLocaleString()} — {v.clienteNombre}
                </div>
                <div>Total: ${v.total.toLocaleString()}</div>
                <Link className="btn btn-small" to={`/factura/${v.id}`}>
                  Ver factura
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
