// src/pages/Factura.jsx
import { useParams, Link } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../../firebaseClient";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import "./inventario.css";
import { useTenant } from "../tenant/TenantProvider";

// Pequeño hook de tema (igual al resto)
function useTheme() {
  const [theme, setTheme] = useState(() => localStorage.getItem("theme") || "dark");
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("theme", theme);
  }, [theme]);
  const toggle = () => setTheme((t) => (t === "dark" ? "light" : "dark"));
  return { theme, toggle };
}

export default function Factura() {
  const { id } = useParams();
  const { theme, toggle } = useTheme();
  const { empresa } = useTenant(); // { id, ... } y campos nombre/nit/logoUrl vienen del doc

  const [venta, setVenta] = useState(null);
  const [empresaInfo, setEmpresaInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  // Cargar empresa (nombre/nit/logo)
  useEffect(() => {
    (async () => {
      try {
        if (!empresa?.id) return;
        const esnap = await getDoc(doc(db, "empresas", empresa.id));
        setEmpresaInfo(esnap.exists() ? esnap.data() : {});
      } catch (e) {
        console.error(e);
      }
    })();
  }, [empresa?.id]);

  // Cargar venta: primero intenta en empresas/{empresaId}/ventas/{id}, si no, en ventas/{id}
  useEffect(() => {
    (async () => {
      try {
        setErr(null);
        setLoading(true);

        let vsnap = null;
        if (empresa?.id) {
          vsnap = await getDoc(doc(db, "empresas", empresa.id, "ventas", id));
        }
        if (!vsnap || !vsnap.exists()) {
          // compatibilidad con datos antiguos
          const legacy = await getDoc(doc(db, "ventas", id));
          if (legacy.exists()) vsnap = legacy;
        }

        if (vsnap && vsnap.exists()) {
          setVenta(vsnap.data());
        } else {
          setErr("Venta no encontrada.");
        }
      } catch (e) {
        console.error(e);
        setErr("Error al obtener la venta.");
      } finally {
        setLoading(false);
      }
    })();
  }, [id, empresa?.id]);

  // Normalización de ítems (soporta .items o .productos)
  const items = useMemo(() => {
    if (!venta) return [];
    return (venta.items || venta.productos || []).map((it) => ({
      nombre: it.nombre || "—",
      cantidad: Number(it.cantidad || 0),
      precioUnitario: Number(it.precioUnitario || 0),
    }));
  }, [venta]);

  const total = useMemo(
    () => items.reduce((acc, it) => acc + it.cantidad * it.precioUnitario, 0),
    [items]
  );

  const clienteNombre =
    (venta?.cliente && typeof venta.cliente === "object" ? venta.cliente.nombre : venta?.cliente) ||
    venta?.clienteNombre ||
    "Consumidor final";

  const clienteDocumento =
    (venta?.cliente && typeof venta.cliente === "object" ? venta.cliente.documento : venta?.documento) || "";

  const fecha = useMemo(() => {
    const f = venta?.fecha;
    if (!f) return null;
    if (typeof f?.toDate === "function") return f.toDate(); // Timestamp Firestore
    if (typeof f === "number") return new Date(f);
    if (typeof f === "string") return new Date(f);
    return null;
  }, [venta]);

  const formatear = (n) => (Number.isFinite(n) ? n : 0).toLocaleString();
  const fechaStr = fecha ? fecha.toLocaleString() : "—";

  // Generar PDF a partir de la sección #factura-pdf (no cortado)
  const generarPDF = async () => {
    const nodo = document.getElementById("factura-pdf");
    if (!nodo) return;

    const bg =
      getComputedStyle(document.body).backgroundColor || (theme === "dark" ? "#0f1115" : "#ffffff");

    const canvas = await html2canvas(nodo, {
      backgroundColor: bg,
      useCORS: true,
      scale: 2,
      windowWidth: nodo.scrollWidth,
    });

    const imgData = canvas.toDataURL("image/png");
    const pdf = new jsPDF("p", "mm", "a4");
    const pdfW = pdf.internal.pageSize.getWidth();
    const pdfH = pdf.internal.pageSize.getHeight();

    const imgH = (canvas.height * pdfW) / canvas.width;
    let position = 0;
    let heightLeft = imgH;

    pdf.addImage(imgData, "PNG", 0, position, pdfW, imgH);
    heightLeft -= pdfH;

    while (heightLeft > 0) {
      position = heightLeft - imgH;
      pdf.addPage();
      pdf.addImage(imgData, "PNG", 0, position, pdfW, imgH);
      heightLeft -= pdfH;
    }

    pdf.save(`Factura-${id}.pdf`);
  };

  // Carga/errores
  if (loading) {
    return (
      <div className="inv-root">
        <header className="inv-header">
          <div><h1>Factura</h1></div>
          <div className="header-actions">
            <button className="btn theme-toggle" onClick={toggle}>
              {theme === "dark" ? "☀️ Claro" : "🌙 Oscuro"}
            </button>
            <Link to="/" className="btn">← Inventario</Link>
          </div>
        </header>
        <p className="inv-subtle">Cargando factura…</p>
      </div>
    );
  }

  if (!venta || err) {
    return (
      <div className="inv-root">
        <header className="inv-header">
          <div><h1>Factura</h1></div>
          <div className="header-actions">
            <button className="btn theme-toggle" onClick={toggle}>
              {theme === "dark" ? "☀️ Claro" : "🌙 Oscuro"}
            </button>
            <Link to="/" className="btn">← Inventario</Link>
          </div>
        </header>
        <div className="toast toast-error" style={{ position: "static" }}>
          {err || "No se encontró la venta."}
        </div>
      </div>
    );
  }

  const folio = id.slice(0, 8).toUpperCase();

  return (
    <div className="inv-root">
      {/* Header en app */}
      <header className="inv-header">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {empresaInfo?.logoUrl ? (
            <img
              src={empresaInfo.logoUrl}
              alt="Logo"
              style={{ width: 36, height: 36, borderRadius: 8, objectFit: "cover", border: "1px solid var(--border)" }}
            />
          ) : null}
          <div>
            <h1>{empresaInfo?.nombre || "Factura"}</h1>
            <p className="inv-subtle">
              {empresaInfo?.nit ? `NIT: ${empresaInfo.nit} • ` : ""}
              Comprobante de venta
            </p>
          </div>
        </div>
        <div className="header-actions">
          <button className="btn theme-toggle" onClick={toggle}>
            {theme === "dark" ? "☀️ Claro" : "🌙 Oscuro"}
          </button>
          <Link to="/" className="btn">← Inventario</Link>
          <button className="btn btn-primary" onClick={generarPDF}>Descargar PDF 🧾</button>
        </div>
      </header>

      {/* Vista en pantalla (card) */}
      <section className="inv-grid" style={{ gridTemplateColumns: "1fr" }}>
        <div className="card">
          <div className="card-header">
            <h2>Factura #{folio}</h2>
          </div>
          <div className="card-body">
            {/* Encabezado */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
              <div>
                <div className="inv-subtle" style={{ fontSize: 12 }}>Cliente</div>
                <div style={{ fontWeight: 600 }}>{clienteNombre}</div>
                {clienteDocumento ? <div className="inv-subtle">Doc: {clienteDocumento}</div> : null}
              </div>
              <div>
                <div className="inv-subtle" style={{ fontSize: 12 }}>Fecha</div>
                <div style={{ fontWeight: 600 }}>{fechaStr}</div>
              </div>
            </div>

            {/* Tabla productos */}
            <div style={{ border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
              <div style={{
                display: "grid",
                gridTemplateColumns: "1fr 100px 140px 140px",
                gap: 8,
                padding: "10px 12px",
                background: "var(--card)",
                borderBottom: "1px solid var(--border)",
                fontWeight: 600
              }}>
                <div>Producto</div>
                <div style={{ textAlign: "right" }}>Cant.</div>
                <div style={{ textAlign: "right" }}>P. Unit</div>
                <div style={{ textAlign: "right" }}>Subtotal</div>
              </div>

              {items.map((it, idx) => {
                const sub = it.cantidad * it.precioUnitario;
                return (
                  <div key={idx} style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 100px 140px 140px",
                    gap: 8,
                    padding: "10px 12px",
                    borderBottom: "1px solid var(--border)"
                  }}>
                    <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {it.nombre}
                    </div>
                    <div style={{ textAlign: "right" }}>{formatear(it.cantidad)}</div>
                    <div style={{ textAlign: "right" }}>${formatear(it.precioUnitario)}</div>
                    <div style={{ textAlign: "right" }}>${formatear(sub)}</div>
                  </div>
                );
              })}

              <div style={{
                display: "grid",
                gridTemplateColumns: "1fr 100px 140px 140px",
                gap: 8,
                padding: "12px",
                fontWeight: 700
              }}>
                <div />
                <div />
                <div style={{ textAlign: "right" }}>TOTAL</div>
                <div style={{ textAlign: "right" }}>${formatear(total)}</div>
              </div>
            </div>
          </div>

          <div className="card-footer">
            <button className="btn btn-primary" onClick={generarPDF}>Descargar PDF 🧾</button>
          </div>
        </div>
      </section>

      {/* Versión especial para PDF */}
      <div
        id="factura-pdf"
        style={{
          width: "794px",       // A4 @ 96dpi
          margin: "0 auto",
          padding: "24px",
          background: getComputedStyle(document.body).backgroundColor,
          color: "var(--text)",
          borderRadius: "12px",
        }}
      >
        {/* Encabezado empresa */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
          {empresaInfo?.logoUrl ? (
            <img
              src={empresaInfo.logoUrl}
              alt="Logo"
              style={{ width: 48, height: 48, borderRadius: 8, objectFit: "cover", border: "1px solid var(--border)" }}
            />
          ) : null}
          <div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{empresaInfo?.nombre || "Mi Empresa"}</div>
            {empresaInfo?.nit ? <div className="inv-subtle">NIT: {empresaInfo.nit}</div> : null}
          </div>
          <div style={{ marginLeft: "auto", textAlign: "right" }}>
            <div style={{ fontSize: 18, fontWeight: 700 }}>Factura #{folio}</div>
            <div className="inv-subtle">{fechaStr}</div>
          </div>
        </div>

        {/* Datos cliente */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "12px",
          marginBottom: "12px"
        }}>
          <div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>Cliente</div>
            <div style={{ fontWeight: 600 }}>{clienteNombre}</div>
            {clienteDocumento ? <div className="inv-subtle">Doc: {clienteDocumento}</div> : null}
          </div>
          <div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>Total</div>
            <div style={{ fontWeight: 700 }}>${formatear(total)}</div>
          </div>
        </div>

        {/* Tabla PDF */}
        <div style={{ border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
          <div style={{
            display: "grid",
            gridTemplateColumns: "1fr 100px 140px 140px",
            gap: 8,
            padding: "10px 12px",
            background: "var(--card)",
            borderBottom: "1px solid var(--border)",
            fontWeight: 600
          }}>
            <div>Producto</div>
            <div style={{ textAlign: "right" }}>Cant.</div>
            <div style={{ textAlign: "right" }}>P. Unit</div>
            <div style={{ textAlign: "right" }}>Subtotal</div>
          </div>

          {items.map((it, idx) => {
            const sub = it.cantidad * it.precioUnitario;
            return (
              <div key={idx} style={{
                display: "grid",
                gridTemplateColumns: "1fr 100px 140px 140px",
                gap: 8,
                padding: "10px 12px",
                borderBottom: "1px solid var(--border)"
              }}>
                <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {it.nombre}
                </div>
                <div style={{ textAlign: "right" }}>{formatear(it.cantidad)}</div>
                <div style={{ textAlign: "right" }}>${formatear(it.precioUnitario)}</div>
                <div style={{ textAlign: "right" }}>${formatear(sub)}</div>
              </div>
            );
          })}

          <div style={{
            display: "grid",
            gridTemplateColumns: "1fr 100px 140px 140px",
            gap: 8,
            padding: "12px",
            fontWeight: 700
          }}>
            <div />
            <div />
            <div style={{ textAlign: "right" }}>TOTAL</div>
            <div style={{ textAlign: "right" }}>${formatear(total)}</div>
          </div>
        </div>

        <div style={{ marginTop: 16, fontSize: 12, color: "var(--muted)" }}>
          Gracias por su compra.
        </div>
      </div>
    </div>
  );
}
