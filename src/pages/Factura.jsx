// src/pages/Factura.jsx
import { useParams, Link } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../../firebase";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import "./inventario.css";

// Hook de tema (único)
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

  const [empresa, setEmpresa] = useState(null);
  const [venta, setVenta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  // Cargar empresa (logo/nombre/NIT)
  useEffect(() => {
    (async () => {
      try {
        const snap = await getDoc(doc(db, "empresas", "empresa"));
        if (snap.exists()) setEmpresa(snap.data());
      } catch {}
    })();
  }, []);

  // Cargar venta
  useEffect(() => {
    (async () => {
      try {
        setErr(null);
        const snap = await getDoc(doc(db, "ventas", id));
        if (snap.exists()) setVenta(snap.data());
        else setErr("Venta no encontrada.");
      } catch (e) {
        console.error(e);
        setErr("Error al obtener la venta.");
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  // Normaliza items (soporta venta.items y venta.productos)
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
    venta?.clienteNombre || "Consumidor final";

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

  const formatear = (n) => (Number.isFinite(n) ? n : 0).toLocaleString(undefined, { minimumFractionDigits: 0 });
  const fechaStr = fecha ? fecha.toLocaleString() : "—";

  // Generar PDF desde el "paper" especial (no se corta)
  const generarPDF = async () => {
    const nodo = document.getElementById("factura-pdf");
    if (!nodo) return;

    const bg = getComputedStyle(document.body).backgroundColor || (theme === "dark" ? "#0f1115" : "#ffffff");

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

  if (loading) {
    return (
      <div className="inv-root">
        <header className="inv-header">
          <div style={{ display:"flex", alignItems:"center", gap:12 }}>
            {empresa?.logoUrl ? (
              <img src={empresa.logoUrl} alt="Logo" style={{ width:36, height:36, borderRadius:8, objectFit:"cover", border:"1px solid var(--border)" }} />
            ) : null}
            <div>
              <h1>{empresa?.nombre || "Factura"}</h1>
              {empresa?.nit && <p className="inv-subtle">NIT: {empresa.nit}</p>}
            </div>
          </div>
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
          <div style={{ display:"flex", alignItems:"center", gap:12 }}>
            {empresa?.logoUrl ? (
              <img src={empresa.logoUrl} alt="Logo" style={{ width:36, height:36, borderRadius:8, objectFit:"cover", border:"1px solid var(--border)" }} />
            ) : null}
            <div>
              <h1>{empresa?.nombre || "Factura"}</h1>
              {empresa?.nit && <p className="inv-subtle">NIT: {empresa.nit}</p>}
            </div>
          </div>
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

  return (
    <div className="inv-root">
      {/* Header pantalla */}
      <header className="inv-header">
        <div style={{ display:"flex", alignItems:"center", gap:12 }}>
          {empresa?.logoUrl ? (
            <img
              src={empresa.logoUrl}
              alt="Logo"
              style={{ width:36, height:36, borderRadius:8, objectFit:"cover", border:"1px solid var(--border)" }}
            />
          ) : null}
          <div>
            <h1>{empresa?.nombre || "Factura"}</h1>
            <p className="inv-subtle">{empresa?.nit ? `NIT: ${empresa.nit}` : "Comprobante de venta y detalle de productos"}</p>
          </div>
        </div>
        <div className="header-actions">
          <button className="btn theme-toggle" onClick={toggle}>
            {theme === "dark" ? "☀️ Claro" : "🌙 Oscuro"}
          </button>
          <Link to="/" className="btn">← Inventario</Link>
        </div>
      </header>

      {/* Vista en pantalla (card) */}
      <section className="inv-grid" style={{ gridTemplateColumns: "1fr" }}>
        <div className="card">
          <div className="card-header">
            <h2>Factura #{id.slice(0, 8).toUpperCase()}</h2>
          </div>
          <div className="card-body">
            <div className="form-grid">
              <div className="form-field">
                <label>Cliente</label>
                <input value={clienteNombre} readOnly />
              </div>
              <div className="form-field">
                <label>Documento</label>
                <input value={clienteDocumento || "—"} readOnly />
              </div>
            </div>

            <div className="form-grid" style={{ marginTop: 8 }}>
              <div className="form-field">
                <label>Fecha</label>
                <input value={fechaStr} readOnly />
              </div>
              <div className="form-field">
                <label>Total</label>
                <input value={`$ ${formatear(total)}`} readOnly />
              </div>
            </div>

            <div style={{ marginTop: 16 }}>
              <div className="product-item" style={{ background: "transparent" }}>
                <div className="product-info" style={{ gridColumn: "1 / -1" }}>
                  <div className="product-title-row" style={{ justifyContent: "space-between" }}>
                    <strong>Productos vendidos</strong>
                    <span className="inv-subtle">{items.length} ítem(s)</span>
                  </div>
                </div>
              </div>

              <div style={{
                border: "1px solid var(--border)",
                borderRadius: 12,
                overflow: "hidden",
                marginTop: 8
              }}>
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
          </div>

          <div className="card-footer">
            <button className="btn btn-primary" onClick={generarPDF}>
              Descargar PDF 🧾
            </button>
          </div>
        </div>
      </section>

      {/* Versión especial para PDF */}
      <div
        id="factura-pdf"
        style={{
          width: "794px",                 // A4 a ~96dpi
          margin: "0 auto",
          padding: "24px",
          background: getComputedStyle(document.body).backgroundColor,
          color: "var(--text)",
          borderRadius: "12px",
        }}
      >
        {/* Cabecera empresa para PDF (se renderiza en el archivo) */}
        <div style={{
          display:"flex", alignItems:"center", justifyContent:"space-between",
          marginBottom: 16, paddingBottom: 12, borderBottom: "1px solid var(--border)"
        }}>
          <div style={{ display:"flex", alignItems:"center", gap:12 }}>
            {empresa?.logoUrl && (
              <img
                src={empresa.logoUrl}
                alt="Logo"
                style={{ width:48, height:48, borderRadius:8, objectFit:"cover", border:"1px solid var(--border)" }}
              />
            )}
            <div>
              <div style={{ fontWeight:700, fontSize:18 }}>{empresa?.nombre || "Mi Empresa"}</div>
              {empresa?.nit && <div className="inv-subtle" style={{ fontSize:12 }}>NIT: {empresa.nit}</div>}
            </div>
          </div>
          <div style={{ textAlign:"right" }}>
            <div style={{ fontWeight:700, fontSize:16 }}>FACTURA</div>
            <div className="inv-subtle" style={{ fontSize:12 }}>#{id.slice(0,8).toUpperCase()}</div>
          </div>
        </div>

        {/* Datos de cliente/fecha/total */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "12px",
          marginBottom: "12px"
        }}>
          <div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>Cliente</div>
            <div style={{ fontWeight: 600 }}>{clienteNombre}</div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>Documento</div>
            <div style={{ fontWeight: 600 }}>{clienteDocumento || "—"}</div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>Fecha</div>
            <div style={{ fontWeight: 600 }}>{fechaStr}</div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>Total</div>
            <div style={{ fontWeight: 700 }}>${formatear(total)}</div>
          </div>
        </div>

        {/* Tabla */}
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


