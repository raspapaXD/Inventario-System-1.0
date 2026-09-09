// src/pages/Reportes.jsx
import { useEffect, useState } from "react";
import { db } from "../../firebaseClient.js";
import {
  collection,
  getDocs,
  query,
  where
} from "firebase/firestore";
import { Link } from "react-router-dom";
import { useTenant } from "../tenant/TenantProvider";
import AppMenu from "../components/AppMenu.jsx";
import * as XLSX from "xlsx";
import "./inventario.css";

/* ======================= TEMA ======================= */
function useTheme() {
  const [theme, setTheme] = useState(
    () => localStorage.getItem("theme") || "dark"
  );

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("theme", theme);
  }, [theme]);

  const toggle = () =>
    setTheme(t => (t === "dark" ? "light" : "dark"));

  return { theme, toggle };
}

export default function Reportes() {
  const { theme, toggle } = useTheme();
  const { empresa } = useTenant();

  const hoyISO = new Date().toISOString().slice(0, 10);

  const [desde, setDesde] = useState(hoyISO);
  const [hasta, setHasta] = useState(hoyISO);
  const [movimientos, setMovimientos] = useState([]);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState(null);

  /* =======================
     FILTROS RÁPIDOS
  ======================= */
  const setHoy = () => {
    const hoy = new Date().toISOString().slice(0, 10);

    setDesde(hoy);
    setHasta(hoy);
  };

  const setSemana = () => {
    const hoy = new Date();
    const inicio = new Date(hoy);

    inicio.setDate(
      hoy.getDate() - hoy.getDay()
    );

    setDesde(
      inicio.toISOString().slice(0, 10)
    );

    setHasta(
      hoy.toISOString().slice(0, 10)
    );
  };

  const setMes = () => {
    const hoy = new Date();

    const inicio = new Date(
      hoy.getFullYear(),
      hoy.getMonth(),
      1
    );

    setDesde(
      inicio.toISOString().slice(0, 10)
    );

    setHasta(
      hoy.toISOString().slice(0, 10)
    );
  };

  /* =======================
     CARGAR MOVIMIENTOS
  ======================= */
  useEffect(() => {
    (async () => {
      if (!empresa?.id) return;

      try {
        setCargando(true);
        setError(null);

        const start = new Date(
          `${desde}T00:00:00`
        );

        const end = new Date(
          `${hasta}T23:59:59.999`
        );

        const movCol = collection(
          db,
          "empresas",
          empresa.id,
          "movimientos"
        );

        const qy = query(
          movCol,
          where(
            "fecha",
            ">=",
            start
          ),
          where(
            "fecha",
            "<=",
            end
          )
        );

        const snap = await getDocs(qy);

        const lista =
          snap.docs.map(d => ({
            id: d.id,
            ...d.data()
          }));

        setMovimientos(lista);
      } catch (e) {
        console.error(e);

        setError(
          "No se pudieron cargar los reportes."
        );
      } finally {
        setCargando(false);
      }
    })();
  }, [
    empresa?.id,
    desde,
    hasta
  ]);

  /* =======================
     CÁLCULOS
  ======================= */
  const ingresos =
    movimientos.reduce(
      (acc, m) =>
        acc +
        Number(m.ingreso || 0),
      0
    );

  const costos =
    movimientos.reduce(
      (acc, m) =>
        acc +
        Number(m.costo || 0),
      0
    );

  const utilidad =
    ingresos - costos;

  const margen =
    ingresos > 0
      ? (utilidad / ingresos) * 100
      : 0;

  const ventasCount =
    new Set(
      movimientos
        .filter(
          m => m.tipo === "VENTA"
        )
        .map(
          m => m.ventaId
        )
    ).size;

  /* =======================
     PRODUCTO MÁS VENDIDO
  ======================= */
  const productoMasVendido = (() => {
    const mapa = {};

    movimientos.forEach(m => {
      if (m.tipo !== "VENTA") return;
      if (!m.productoNombre) return;

      mapa[m.productoNombre] =
        (
          mapa[m.productoNombre] ||
          0
        ) +
        Number(m.cantidad || 0);
    });

    const orden =
      Object.entries(mapa)
        .sort(
          (a, b) =>
            b[1] - a[1]
        );

    return orden.length
      ? orden[0][0]
      : "—";
  })();

  /* =======================
     DIAGNÓSTICO
  ======================= */
  const diagnostico = (() => {
    if (ingresos <= 0) {
      return "Aún no hay ventas suficientes para generar un diagnóstico.";
    }

    if (margen > 30) {
      return "Rentabilidad excelente";
    }

    if (margen > 20) {
      return "Rentabilidad saludable";
    }

    if (margen > 10) {
      return "Margen ajustable";
    }

    if (margen > 0) {
      return "Margen bajo";
    }

    return "El negocio está en pérdida";
  })();

  /* =======================
     EXPORTAR EXCEL
  ======================= */
  const exportarExcel = () => {
    const resumen = [
      ["Reporte financiero"],
      [`Desde: ${desde}`],
      [`Hasta: ${hasta}`],
      [],
      ["Ingresos", ingresos],
      ["Costos", costos],
      ["Utilidad", utilidad],
      [
        "Margen %",
        margen.toFixed(2)
      ],
      [
        "Ventas realizadas",
        ventasCount
      ],
      [
        "Producto más vendido",
        productoMasVendido
      ],
      [
        "Diagnóstico",
        diagnostico
      ]
    ];

    const detalle =
      movimientos.map(m => ({
        Tipo: m.tipo || "",
        Producto:
          m.productoNombre || "",
        Cantidad:
          Number(
            m.cantidad || 0
          ),
        Ingreso:
          Number(
            m.ingreso || 0
          ),
        Costo:
          Number(
            m.costo || 0
          ),
        Utilidad:
          Number(
            m.utilidad || 0
          )
      }));

    const wb =
      XLSX.utils.book_new();

    const wsResumen =
      XLSX.utils.aoa_to_sheet(
        resumen
      );

    const wsDetalle =
      XLSX.utils.json_to_sheet(
        detalle
      );

    XLSX.utils.book_append_sheet(
      wb,
      wsResumen,
      "Resumen"
    );

    XLSX.utils.book_append_sheet(
      wb,
      wsDetalle,
      "Detalle"
    );

    XLSX.writeFile(
      wb,
      `reporte_${desde}_${hasta}.xlsx`
    );
  };

  /* =======================
     UI
  ======================= */
  return (
    <div className="inv-root">

      {/* =====================
          HEADER
      ====================== */}
      <header className="inv-header">

        <div>
          <h1>
            📊 Reporte financiero inteligente
          </h1>

          <p className="inv-subtle">
            {cargando
              ? "Cargando..."
              : `Movimientos: ${movimientos.length}`}
          </p>
        </div>

        <div
          className="header-actions"
          style={{
            gap: 8,
            flexWrap: "wrap"
          }}
        >
          <button
            className="btn theme-toggle"
            onClick={toggle}
          >
            {theme === "dark"
              ? "☀️ Claro"
              : "🌙 Oscuro"}
          </button>

          <Link
            to="/"
            className="btn"
          >
            ← Inventario
          </Link>

          <AppMenu />
        </div>

      </header>

      {/* =====================
          FILTROS
      ====================== */}
      <section className="inv-toolbar">

        <button
          className="btn"
          onClick={setHoy}
        >
          Hoy
        </button>

        <button
          className="btn"
          onClick={setSemana}
        >
          Semana
        </button>

        <button
          className="btn"
          onClick={setMes}
        >
          Mes
        </button>

        <div className="form-field">

          <label>
            Desde
          </label>

          <input
            type="date"
            value={desde}
            onChange={e =>
              setDesde(
                e.target.value
              )
            }
          />

        </div>

        <div className="form-field">

          <label>
            Hasta
          </label>

          <input
            type="date"
            value={hasta}
            onChange={e =>
              setHasta(
                e.target.value
              )
            }
          />

        </div>

        <button
          className="btn btn-primary"
          onClick={exportarExcel}
        >
          📥 Descargar Excel
        </button>

      </section>

      {/* =====================
          TARJETAS
      ====================== */}
      <section
        className="inv-grid"
        style={{
          gridTemplateColumns:
            "repeat(auto-fit, minmax(250px, 1fr))"
        }}
      >

        <Card
          titulo="Ingresos"
          valor={ingresos}
          moneda
        />

        <Card
          titulo="Costos"
          valor={costos}
          moneda
        />

        <Card
          titulo="Utilidad"
          valor={utilidad}
          moneda
        />

        <Card
          titulo="Margen %"
          valor={
            margen.toFixed(2) + "%"
          }
        />

        <Card
          titulo="Ventas realizadas"
          valor={ventasCount}
        />

        <Card
          titulo="Producto más vendido"
          valor={productoMasVendido}
        />

      </section>

      {/* =====================
          DIAGNÓSTICO
      ====================== */}
      <div
        className="card"
        style={{
          marginTop: 20
        }}
      >

        <div className="card-header">
          <h2>
            Diagnóstico
          </h2>
        </div>

        <div className="card-body">
          <h3>
            {diagnostico}
          </h3>
        </div>

      </div>

      {error && (
        <div className="toast toast-error">
          {error}
        </div>
      )}

    </div>
  );
}

/* =======================
   CARD
======================= */
function Card({
  titulo,
  valor,
  moneda = false
}) {
  return (
    <div className="card">

      <div className="card-header">
        <h3>
          {titulo}
        </h3>
      </div>

      <div className="card-body">
        <h2>
          {moneda &&
          typeof valor === "number"
            ? `$${valor.toLocaleString(
                "es-CO"
              )}`
            : typeof valor === "number"
            ? valor.toLocaleString(
                "es-CO"
              )
            : valor}
        </h2>
      </div>

    </div>
  );
}