import { useParams, Link } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../../firebase";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import "./inventario.css";

// === Hook de tema (igual que en Inventario/Ventas) ===
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
  const [venta, setVenta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

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
    if (typeof f?.toDate === "function") return f.toDate(); // Firestore Timestamp
    if (typeof f === "number") return new Date(f);
    if (typeof f === "string") return new Date(f);
    return null;
  }, [venta]);

  const formatear = (n) =>
    (Number.isFinite(n) ? n : 0).toLocaleString(undefined, { minimumFractionDigits: 0 });

  const fechaStr = fecha ? fecha.toLocaleString() : "—";

  // ✅ GENERAR PDF estable: renderizamos un "paper" especial y lo paginamos manualmente
  const generarPDF = async () => {
    const nodo = document.getElementById("factura-pdf"); // 👈 usamos la versión especial para PDF
    if (!nodo) return;

    // Color de fondo real según tema, para que el PDF luzca igual
    const bg =
      getComputedStyle(document.body).backgroundColor ||
      (theme === "dark" ? "#0f1115" : "#ffffff");

    // Renderiza a canvas con nitidez
    const canvas = await html2canvas(nodo, {
      backgroundColor: bg,
      useCORS: true,
      scale: 2, // más nítido
      windowWidth: nodo.scrollWidth, // respeta el ancho del "paper"
    });

    const imgData = canvas.toDataURL("image/png");

    const pdf = new jsPDF("p", "mm", "a4");
    const pdfW = pdf.internal.pageSize.getWidth();
    const pdfH = pdf.internal.pageSize.getHeight();

    // Altura de la imagen en mm, manteniendo proporción al ajustar al ancho del PDF
    const imgH = (canvas.height * pdfW) / canvas.width;

    let position = 0;
    let heightLeft = imgH;

    // Primera página
    pdf.addImage(imgData, "PNG", 0, position, pdfW, imgH);
    heightLeft -= pdfH;

    // Páginas adicionales (recorta verticalmente la misma imagen)
    while (heightLeft > 0) {
      position = heightLeft - imgH; // desplaza hacia arriba lo que ya se imprimió
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

  return (
    <div className="inv-root">
      {/* Header con tema y navegación */}
      <header className="inv-header">
        <div>
          <h1>Factura</h1>
          <p className="inv-subtle">Comprobante de venta y detalle de productos</p>
        </div>
        <div className="header-actions">
          <button className="btn theme-toggle" onClick={toggle}>
            {theme === "dark" ? "☀️ Claro" : "🌙 Oscuro"}
          </button>
          <Link to="/" className="btn">← Inventario</Link>
        </div>
      </header>

      {/* =================== VISTA EN PANTALLA (card bonita) =================== */}
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

              <div
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: 12,
                  overflow: "hidden",
                  marginTop: 8,
                }}
              >
                {/* Encabezados */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 100px 140px 140px",
                    gap: 8,
                    padding: "10px 12px",
                    background: "var(--card)",
                    borderBottom: "1px solid var(--border)",
                    fontWeight: 600,
                  }}
                >
                  <div>Producto</div>
                  <div style={{ textAlign: "right" }}>Cant.</div>
                  <div style={{ textAlign: "right" }}>P. Unit</div>
                  <div style={{ textAlign: "right" }}>Subtotal</div>
                </div>

                {/* Filas */}
                {items.map((it, idx) => {
                  const sub = it.cantidad * it.precioUnitario;
                  return (
                    <div
                      key={idx}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 100px 140px 140px",
                        gap: 8,
                        padding: "10px 12px",
                        borderBottom: "1px solid var(--border)",
                      }}
                    >
                      <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {it.nombre}
                      </div>
                      <div style={{ textAlign: "right" }}>{formatear(it.cantidad)}</div>
                      <div style={{ textAlign: "right" }}>${formatear(it.precioUnitario)}</div>
                      <div style={{ textAlign: "right" }}>${formatear(sub)}</div>
                    </div>
                  );
                })}

                {/* Total */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 100px 140px 140px",
                    gap: 8,
                    padding: "12px",
                    background: "transparent",
                    fontWeight: 700,
                  }}
                >
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

      {/* =================== VERSIÓN ESPECIAL PARA PDF ===================
          Ancho fijo tipo A4 en pantalla (~794px a 96dpi), sin inputs, solo texto. */}
      <div
        id="factura-pdf"
        style={{
          // "Papel" A4 en pixeles aproximados a 96dpi
          width: "794px",
          margin: "0 auto",
          padding: "24px",
          background: getComputedStyle(document.body).backgroundColor,
          color: "var(--text)",
          borderRadius: "12px",
        }}
      >
        <h2 style={{ marginTop: 0, marginBottom: 12 }}>
          Factura #{id.slice(0, 8).toUpperCase()}
        </h2>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "12px",
            marginBottom: "12px",
          }}
        >
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

        {/* Tabla PDF simple */}
        <div
          style={{
            border: "1px solid var(--border)",
            borderRadius: 12,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 100px 140px 140px",
              gap: 8,
              padding: "10px 12px",
              background: "var(--card)",
              borderBottom: "1px solid var(--border)",
              fontWeight: 600,
            }}
          >
            <div>Producto</div>
            <div style={{ textAlign: "right" }}>Cant.</div>
            <div style={{ textAlign: "right" }}>P. Unit</div>
            <div style={{ textAlign: "right" }}>Subtotal</div>
          </div>

          {items.map((it, idx) => {
            const sub = it.cantidad * it.precioUnitario;
            return (
              <div
                key={idx}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 100px 140px 140px",
                  gap: 8,
                  padding: "10px 12px",
                  borderBottom: "1px solid var(--border)",
                }}
              >
                <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {it.nombre}
                </div>
                <div style={{ textAlign: "right" }}>{formatear(it.cantidad)}</div>
                <div style={{ textAlign: "right" }}>${formatear(it.precioUnitario)}</div>
                <div style={{ textAlign: "right" }}>${formatear(sub)}</div>
              </div>
            );
          })}

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 100px 140px 140px",
              gap: 8,
              padding: "12px",
              fontWeight: 700,
            }}
          >
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
import { useParams, Link } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../../firebase";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import "./inventario.css";

// === Hook de tema (igual que en Inventario/Ventas) ===
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
  const [venta, setVenta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

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
    if (typeof f?.toDate === "function") return f.toDate(); // Firestore Timestamp
    if (typeof f === "number") return new Date(f);
    if (typeof f === "string") return new Date(f);
    return null;
  }, [venta]);

  const formatear = (n) =>
    (Number.isFinite(n) ? n : 0).toLocaleString(undefined, { minimumFractionDigits: 0 });

  const fechaStr = fecha ? fecha.toLocaleString() : "—";

  // ✅ GENERAR PDF estable: renderizamos un "paper" especial y lo paginamos manualmente
  const generarPDF = async () => {
    const nodo = document.getElementById("factura-pdf"); // 👈 usamos la versión especial para PDF
    if (!nodo) return;

    // Color de fondo real según tema, para que el PDF luzca igual
    const bg =
      getComputedStyle(document.body).backgroundColor ||
      (theme === "dark" ? "#0f1115" : "#ffffff");

    // Renderiza a canvas con nitidez
    const canvas = await html2canvas(nodo, {
      backgroundColor: bg,
      useCORS: true,
      scale: 2, // más nítido
      windowWidth: nodo.scrollWidth, // respeta el ancho del "paper"
    });

    const imgData = canvas.toDataURL("image/png");

    const pdf = new jsPDF("p", "mm", "a4");
    const pdfW = pdf.internal.pageSize.getWidth();
    const pdfH = pdf.internal.pageSize.getHeight();

    // Altura de la imagen en mm, manteniendo proporción al ajustar al ancho del PDF
    const imgH = (canvas.height * pdfW) / canvas.width;

    let position = 0;
    let heightLeft = imgH;

    // Primera página
    pdf.addImage(imgData, "PNG", 0, position, pdfW, imgH);
    heightLeft -= pdfH;

    // Páginas adicionales (recorta verticalmente la misma imagen)
    while (heightLeft > 0) {
      position = heightLeft - imgH; // desplaza hacia arriba lo que ya se imprimió
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

  return (
    <div className="inv-root">
      {/* Header con tema y navegación */}
      <header className="inv-header">
        <div>
          <h1>Factura</h1>
          <p className="inv-subtle">Comprobante de venta y detalle de productos</p>
        </div>
        <div className="header-actions">
          <button className="btn theme-toggle" onClick={toggle}>
            {theme === "dark" ? "☀️ Claro" : "🌙 Oscuro"}
          </button>
          <Link to="/" className="btn">← Inventario</Link>
        </div>
      </header>

      {/* =================== VISTA EN PANTALLA (card bonita) =================== */}
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

              <div
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: 12,
                  overflow: "hidden",
                  marginTop: 8,
                }}
              >
                {/* Encabezados */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 100px 140px 140px",
                    gap: 8,
                    padding: "10px 12px",
                    background: "var(--card)",
                    borderBottom: "1px solid var(--border)",
                    fontWeight: 600,
                  }}
                >
                  <div>Producto</div>
                  <div style={{ textAlign: "right" }}>Cant.</div>
                  <div style={{ textAlign: "right" }}>P. Unit</div>
                  <div style={{ textAlign: "right" }}>Subtotal</div>
                </div>

                {/* Filas */}
                {items.map((it, idx) => {
                  const sub = it.cantidad * it.precioUnitario;
                  return (
                    <div
                      key={idx}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 100px 140px 140px",
                        gap: 8,
                        padding: "10px 12px",
                        borderBottom: "1px solid var(--border)",
                      }}
                    >
                      <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {it.nombre}
                      </div>
                      <div style={{ textAlign: "right" }}>{formatear(it.cantidad)}</div>
                      <div style={{ textAlign: "right" }}>${formatear(it.precioUnitario)}</div>
                      <div style={{ textAlign: "right" }}>${formatear(sub)}</div>
                    </div>
                  );
                })}

                {/* Total */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 100px 140px 140px",
                    gap: 8,
                    padding: "12px",
                    background: "transparent",
                    fontWeight: 700,
                  }}
                >
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

      {/* =================== VERSIÓN ESPECIAL PARA PDF ===================
          Ancho fijo tipo A4 en pantalla (~794px a 96dpi), sin inputs, solo texto. */}
      <div
        id="factura-pdf"
        style={{
          // "Papel" A4 en pixeles aproximados a 96dpi
          width: "794px",
          margin: "0 auto",
          padding: "24px",
          background: getComputedStyle(document.body).backgroundColor,
          color: "var(--text)",
          borderRadius: "12px",
        }}
      >
        <h2 style={{ marginTop: 0, marginBottom: 12 }}>
          Factura #{id.slice(0, 8).toUpperCase()}
        </h2>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "12px",
            marginBottom: "12px",
          }}
        >
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

        {/* Tabla PDF simple */}
        <div
          style={{
            border: "1px solid var(--border)",
            borderRadius: 12,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 100px 140px 140px",
              gap: 8,
              padding: "10px 12px",
              background: "var(--card)",
              borderBottom: "1px solid var(--border)",
              fontWeight: 600,
            }}
          >
            <div>Producto</div>
            <div style={{ textAlign: "right" }}>Cant.</div>
            <div style={{ textAlign: "right" }}>P. Unit</div>
            <div style={{ textAlign: "right" }}>Subtotal</div>
          </div>

          {items.map((it, idx) => {
            const sub = it.cantidad * it.precioUnitario;
            return (
              <div
                key={idx}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 100px 140px 140px",
                  gap: 8,
                  padding: "10px 12px",
                  borderBottom: "1px solid var(--border)",
                }}
              >
                <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {it.nombre}
                </div>
                <div style={{ textAlign: "right" }}>{formatear(it.cantidad)}</div>
                <div style={{ textAlign: "right" }}>${formatear(it.precioUnitario)}</div>
                <div style={{ textAlign: "right" }}>${formatear(sub)}</div>
              </div>
            );
          })}

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 100px 140px 140px",
              gap: 8,
              padding: "12px",
              fontWeight: 700,
            }}
          >
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





