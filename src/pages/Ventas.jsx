import { useEffect, useMemo, useState } from "react";
import { db } from "../../firebaseClient";
import {
  collection, getDocs, addDoc, doc, updateDoc, serverTimestamp
} from "firebase/firestore";
import { useNavigate, Link } from "react-router-dom";
import { useTenant } from "../tenant/TenantProvider";
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

export default function Ventas() {
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();
  const { empresa } = useTenant();

  const [productos, setProductos] = useState([]);
  const [cliente, setCliente] = useState({ nombre: "", documento: "" });
  const [seleccion, setSeleccion] = useState({ productoId: "", cantidad: 1 });
  const [items, setItems] = useState([]);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);

  // cargar productos de la empresa
  useEffect(() => {
    (async () => {
      if (!empresa?.id) return;
      const snap = await getDocs(collection(db, "empresas", empresa.id, "productos"));
      const lista = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setProductos(lista);
    })();
  }, [empresa]);

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
    () => items.reduce((acc, it) => acc + (Number(it.precioUnitario)*Number(it.cantidad)), 0),
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
      precioUnitario: Number(productoActual.precioUnitario || 0),
      costoUnitario: Number(productoActual.costoUnitario || 0) // ✅ guardamos costo en el item
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
      if (!empresa?.id) { setError("No hay empresa activa."); return; }
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

      // Crear venta (en subcolección de la empresa)
      const venta = {
        cliente: { nombre: cliente.nombre || "-", documento: cliente.documento || "-" },
        items,
        total,
        fecha: serverTimestamp()
      };
      const ref = await addDoc(collection(db, "empresas", empresa.id, "ventas"), venta);

      // Descontar stock (simple)
      await Promise.all(items.map(async (it) => {
        const prod = productos.find(p => p.id === it.productoId);
        const nuevaCantidad = Number(prod.cantidad) - Number(it.cantidad);
        await updateDoc(doc(db, "empresas", empresa.id, "productos", it.productoId), { cantidad: nuevaCantidad });
      }));

      // Navegar a factura
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
      <header className="inv-header">
        <div>
          <h1>Ventas</h1>
          <p className="inv-subtle">Registra productos vendidos y genera la factura</p>
        </div>
        <div className="header-actions">
          <button className="btn theme-toggle" onClick={toggle} aria-label="Cambiar tema">
            {theme === "dark" ? "☀️ Claro" : "🌙 Oscuro"}
          </button>
          <Link to="/" className="btn">← Inventario</Link>
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

            <div className="row" style={{ marginTop: 8 }}>
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
                        {/* Mostramos costo solo en la vista de venta para ti (no en la factura) */}
                        <span style={{ opacity:.8 }}>Costo: <b>${Number(it.costoUnitario||0).toLocaleString()}</b></span>
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
