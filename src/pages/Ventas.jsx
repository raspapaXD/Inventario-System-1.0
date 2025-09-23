import { useEffect, useMemo, useState } from "react";
import { db } from "../../firebase";
import {
  collection, getDocs, addDoc, doc, updateDoc, serverTimestamp,
  setDoc, getDoc
} from "firebase/firestore";
import { useNavigate, Link } from "react-router-dom";
import "./inventario.css";

// Reuso del hook de tema
function useTheme() {
  const [theme, setTheme] = useState(() => localStorage.getItem("theme") || "dark");
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("theme", theme);
  }, [theme]);
  const toggle = () => setTheme(t => (t === "dark" ? "light" : "dark"));
  return { theme, toggle };
}

// Normaliza el id de cliente a partir del documento (o “sin-doc”)
const normalizarIdCliente = (docu) =>
  (docu || "sin-doc")
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-");

export default function Ventas() {
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();

  const [empresa, setEmpresa] = useState(null);

  const [productos, setProductos] = useState([]);
  const [cliente, setCliente] = useState({ nombre: "", documento: "" });
  const [seleccion, setSeleccion] = useState({ productoId: "", cantidad: 1 });
  const [items, setItems] = useState([]);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);

  // Cargar datos de empresa (logo/nombre/NIT)
  useEffect(() => {
    (async () => {
      try {
        const snap = await getDoc(doc(db, "empresas", "empresa"));
        if (snap.exists()) setEmpresa(snap.data());
      } catch {}
    })();
  }, []);

  // cargar productos
  useEffect(() => {
    (async () => {
      const snap = await getDocs(collection(db, "productos"));
      const lista = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setProductos(lista);
    })();
  }, []);

  const productoActual = useMemo(
    () => productos.find(p => p.id === seleccion.productoId) || null,
    [productos, seleccion.productoId]
  );

  const subtotalActual = useMemo(() => {
    if (!productoActual) return 0;
    const pu = Number(productoActual.precioUnitario || 0);
    return pu * Number(seleccion.cantidad || 0);
  }, [productoActual, seleccion.cantidad]);

  const total = useMemo(
    () => items.reduce((acc, it) => acc + (Number(it.precioUnitario) * Number(it.cantidad)), 0),
    [items]
  );

  const agregarItem = () => {
    setError(null);
    if (!productoActual) { setError("Selecciona un producto."); return; }
    const cant = Number(seleccion.cantidad || 0);
    if (cant <= 0) { setError("La cantidad debe ser mayor a 0."); return; }
    if (cant > Number(productoActual.cantidad || 0)) {
      setError("No hay suficiente stock.");
      return;
    }
    // agregar o acumular
    const ya = items.findIndex(i => i.productoId === productoActual.id);
    const base = {
      productoId: productoActual.id,
      nombre: productoActual.nombre,
      cantidad: cant,
      precioUnitario: Number(productoActual.precioUnitario || 0)
    };
    if (ya >= 0) {
      const nuevos = [...items];
      nuevos[ya] = { ...nuevos[ya], cantidad: nuevos[ya].cantidad + cant };
      setItems(nuevos);
    } else {
      setItems([...items, base]);
    }
    // reset cantidad
    setSeleccion(s => ({ ...s, cantidad: 1 }));
  };

  const quitarItem = (id) => setItems(items.filter(i => i.productoId !== id));

  const registrarVenta = async () => {
    try {
      setGuardando(true); setError(null);
      if (items.length === 0) { setError("Agrega al menos un producto."); setGuardando(false); return; }

      // Verificación de stock en cliente
      for (const it of items) {
        const prod = productos.find(p => p.id === it.productoId);
        if (!prod || Number(prod.cantidad) < Number(it.cantidad)) {
          setError(`Stock insuficiente para ${prod?.nombre || it.productoId}.`);
          setGuardando(false); return;
        }
      }

      // 1) Asegurar cliente en colección "clientes"
      const nombreCli = (cliente.nombre || "-").trim() || "-";
      const docCli = (cliente.documento || "-").trim() || "-";
      const clienteId = normalizarIdCliente(docCli);
      const clienteRef = doc(db, "clientes", clienteId);
      const cliSnap = await getDoc(clienteRef);
      if (!cliSnap.exists()) {
        await setDoc(clienteRef, {
          nombre: nombreCli,
          documento: docCli,
          creadoEn: serverTimestamp()
        });
      } else {
        // Opcional: actualizar nombre si vino diferente
        const actual = cliSnap.data();
        if (nombreCli && nombreCli !== actual?.nombre) {
          await setDoc(clienteRef, { nombre: nombreCli }, { merge: true });
        }
      }

      // 2) Crear venta con referencia a cliente
      const venta = {
        cliente: { nombre: nombreCli, documento: docCli }, // compatibilidad con tu factura
        clienteId: `clientes/${clienteId}`,
        items,
        total,
        fecha: serverTimestamp()
      };
      const ref = await addDoc(collection(db, "ventas"), venta);

      // 3) Descontar stock (simple)
      await Promise.all(items.map(async (it) => {
        const prod = productos.find(p => p.id === it.productoId);
        const nuevaCantidad = Number(prod.cantidad) - Number(it.cantidad);
        await updateDoc(doc(db, "productos", it.productoId), { cantidad: nuevaCantidad });
      }));

      // 4) Navegar a factura
      navigate(`/factura/${ref.id}`);
    } catch (e) {
      console.error(e);
      setError("No se pudo registrar la venta.");
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="inv-root">
      {/* Header con marca de empresa + acciones */}
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
            <h1>{empresa?.nombre || "Ventas"}</h1>
            <p className="inv-subtle">{empresa?.nit ? `NIT: ${empresa.nit}` : "Registra productos vendidos y genera la factura"}</p>
          </div>
        </div>
        <div className="header-actions">
          <button className="btn theme-toggle" onClick={toggle} aria-label="Cambiar tema">
            {theme === "dark" ? "☀️ Claro" : "🌙 Oscuro"}
          </button>
          <Link to="/" className="btn">← Inventario</Link>
          <Link to="/clientes" className="btn">👥 Clientes</Link>
          <Link to="/configuracion" className="btn">⚙️ Configuración</Link>
        </div>
      </header>

      <section className="inv-grid">
        {/* Cliente + Selección */}
        <div className="card">
          <div className="card-header"><h2>Datos y selección</h2></div>
          <div className="card-body">
            <div className="form-grid">
              <div className="form-field">
                <label>Nombre del cliente</label>
                <input
                  type="text"
                  placeholder="Ej: Emmanuel"
                  value={cliente.nombre}
                  onChange={(e) => setCliente({ ...cliente, nombre: e.target.value })}
                />
              </div>
              <div className="form-field">
                <label>Documento</label>
                <input
                  type="text"
                  placeholder="CC / NIT"
                  value={cliente.documento}
                  onChange={(e) => setCliente({ ...cliente, documento: e.target.value })}
                />
              </div>
            </div>

            <div className="form-grid" style={{ marginTop: 8 }}>
              <div className="form-field">
                <label>Producto</label>
                <select
                  value={seleccion.productoId}
                  onChange={(e) => setSeleccion({ ...seleccion, productoId: e.target.value })}
                >
                  <option value="">Selecciona…</option>
                  {productos.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.nombre} — ${Number(p.precioUnitario||0).toLocaleString()}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-field">
                <label>Cantidad</label>
                <input
                  type="number"
                  min="1"
                  value={seleccion.cantidad}
                  onChange={(e) => setSeleccion({ ...seleccion, cantidad: Number(e.target.value) })}
                />
              </div>
            </div>

            <div className="row" style={{ marginTop: 8, gap: 12, alignItems: "center" }}>
              <button className="btn" onClick={agregarItem}>➕ Agregar producto</button>
              {productoActual && (
                <span className="inv-subtle">
                  Subtotal: <b>${subtotalActual.toLocaleString()}</b> — Stock disp.: <b>{productoActual.cantidad}</b>
                </span>
              )}
            </div>

            {error && <div className="toast toast-error" style={{ position: "static", marginTop: 12 }}>{error}</div>}
          </div>
          <div className="card-footer">
            <Link to="/" className="btn">← Volver</Link>
          </div>
        </div>

        {/* Carrito */}
        <div className="card">
          <div className="card-header"><h2>Detalle de la venta</h2></div>
          <div className="card-body">
            {items.length === 0 ? (
              <p className="inv-subtle">No hay productos agregados.</p>
            ) : (
              <ul className="product-list">
                {items.map((it) => (
                  <li className="product-item" key={it.productoId}>
                    <div className="product-info" style={{ gridColumn: "1 / -1" }}>
                      <div className="product-title-row">
                        <strong>{it.nombre}</strong>
                      </div>
                      <div className="product-meta">
                        <span>Cant: <b>{it.cantidad}</b></span>
                        <span>P. Unit: <b>${it.precioUnitario.toLocaleString()}</b></span>
                        <span>Subtotal: <b>${(it.cantidad*it.precioUnitario).toLocaleString()}</b></span>
                      </div>
                    </div>
                    <div className="product-actions">
                      <button className="btn btn-small btn-danger" onClick={() => quitarItem(it.productoId)}>Quitar</button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <div style={{ marginTop: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <strong>Total:</strong>
              <strong>${total.toLocaleString()}</strong>
            </div>
          </div>
          <div className="card-footer">
            <button className="btn btn-primary" onClick={registrarVenta} disabled={guardando || items.length===0}>
              {guardando ? "Guardando..." : "Registrar venta"}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
