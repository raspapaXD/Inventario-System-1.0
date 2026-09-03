// src/pages/Ventas.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { db } from "../../firebaseClient.js";
import {
  collection,
  getDocs,
  addDoc,
  doc,
  updateDoc,
  setDoc,
  serverTimestamp
} from "firebase/firestore";
import { useNavigate, Link } from "react-router-dom";
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

const norm = (s) => (s || "").toString().trim();

const slug = (s) =>
  norm(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "sin-id";

const formatMoney = (value) => `$${Number(value || 0).toLocaleString()}`;

function stockInfo(producto) {
  const cantidad = Number(producto?.cantidad || 0);
  const minimo = Number(producto?.minimo || 0);

  if (cantidad <= 0) return { label: "Sin stock", icon: "🔴", color: "#ef4444" };
  if (cantidad <= minimo || cantidad <= 2) return { label: "Stock bajo", icon: "🟡", color: "#f59e0b" };

  return { label: "Disponible", icon: "🟢", color: "#22c55e" };
}

export default function Ventas() {
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();
  const { empresa } = useTenant();

  const cantidadRef = useRef(null);

  const [productos, setProductos] = useState([]);
  const [cliente, setCliente] = useState({ nombre: "", documento: "" });
  const [items, setItems] = useState([]);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);

  const [productoSeleccionado, setProductoSeleccionado] = useState(null);
  const [cantidad, setCantidad] = useState(1);

  const [modalProductos, setModalProductos] = useState(false);
  const [qModal, setQModal] = useState("");
  const [recientes, setRecientes] = useState([]);

  useEffect(() => {
    (async () => {
      if (!empresa?.id) return;

      const snap = await getDocs(collection(db, "empresas", empresa.id, "productos"));
      setProductos(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    })();
  }, [empresa?.id]);

  const productosModal = useMemo(() => {
    const q = qModal.trim().toLowerCase();

    const lista = !q
      ? productos
      : productos.filter(p =>
          `${p.nombre || ""} ${p.categoriaNombre || ""}`.toLowerCase().includes(q)
        );

    return lista.sort((a, b) => (a.nombre || "").localeCompare(b.nombre || ""));
  }, [qModal, productos]);

  const productosRecientes = useMemo(() => {
    return recientes
      .map(id => productos.find(p => p.id === id))
      .filter(Boolean)
      .slice(0, 5);
  }, [recientes, productos]);

  const subtotalActual = useMemo(() => {
    if (!productoSeleccionado) return 0;
    return Number(productoSeleccionado.precioUnitario || 0) * Number(cantidad || 0);
  }, [productoSeleccionado, cantidad]);

  const total = useMemo(
    () => items.reduce((acc, it) => acc + Number(it.precioUnitario || 0) * Number(it.cantidad || 0), 0),
    [items]
  );

  const seleccionarProducto = (producto) => {
    setProductoSeleccionado(producto);
    setCantidad(1);
    setModalProductos(false);
    setQModal("");
    setError(null);

    setRecientes(prev => {
      const limpio = prev.filter(id => id !== producto.id);
      return [producto.id, ...limpio].slice(0, 6);
    });

    setTimeout(() => cantidadRef.current?.focus(), 80);
  };

  const agregarItem = () => {
    setError(null);

    if (!productoSeleccionado) return setError("Selecciona un producto.");
    if (cantidad <= 0) return setError("Cantidad inválida.");

    if (cantidad > Number(productoSeleccionado.cantidad || 0)) {
      return setError("No hay suficiente stock.");
    }

    const ya = items.findIndex(i => i.productoId === productoSeleccionado.id);

    const base = {
      productoId: productoSeleccionado.id,
      nombre: productoSeleccionado.nombre,
      cantidad,
      precioUnitario: Number(productoSeleccionado.precioUnitario || 0),
      costoUnitario: Number(productoSeleccionado.costoUnitario || 0)
    };

    if (ya >= 0) {
      const nuevos = [...items];
      nuevos[ya] = {
        ...nuevos[ya],
        cantidad: Number(nuevos[ya].cantidad || 0) + Number(cantidad || 0)
      };
      setItems(nuevos);
    } else {
      setItems([...items, base]);
    }

    setProductoSeleccionado(null);
    setCantidad(1);
  };

  const quitarItem = (id) => {
    setItems(items.filter(i => i.productoId !== id));
  };

  const registrarVenta = async () => {
    try {
      if (!empresa?.id) return;
      if (items.length === 0) return setError("Agrega al menos un producto.");

      setGuardando(true);
      setError(null);

      const clienteId = norm(cliente.documento) || slug(norm(cliente.nombre));

      await setDoc(
        doc(db, "empresas", empresa.id, "clientes", clienteId),
        {
          nombre: norm(cliente.nombre) || "Consumidor final",
          nombreLower: slug(norm(cliente.nombre)),
          documento: norm(cliente.documento) || null,
          updatedAt: serverTimestamp()
        },
        { merge: true }
      );

      const ventaRef = await addDoc(
        collection(db, "empresas", empresa.id, "ventas"),
        {
          clienteId,
          cliente: {
            nombre: norm(cliente.nombre) || "Consumidor final",
            documento: norm(cliente.documento) || "-"
          },
          items,
          total,
          fecha: serverTimestamp()
        }
      );

      const movimientosCol = collection(db, "empresas", empresa.id, "movimientos");

      await Promise.all(
        items.map(async (it) => {
          const ingreso = Number(it.precioUnitario || 0) * Number(it.cantidad || 0);
          const costo = Number(it.costoUnitario || 0) * Number(it.cantidad || 0);

          await addDoc(movimientosCol, {
            tipo: "VENTA",
            productoId: it.productoId,
            productoNombre: it.nombre,
            cantidad: it.cantidad,
            ingreso,
            costo,
            utilidad: ingreso - costo,
            ventaId: ventaRef.id,
            fecha: serverTimestamp()
          });

          const prod = productos.find(p => p.id === it.productoId);

          await updateDoc(
            doc(db, "empresas", empresa.id, "productos", it.productoId),
            { cantidad: Number(prod?.cantidad || 0) - Number(it.cantidad || 0) }
          );
        })
      );

      navigate(`/factura/${ventaRef.id}`);
    } catch (e) {
      console.error(e);
      setError("Error registrando la venta.");
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="inv-root">
      <header className="inv-header">
        <div>
          <h1>Ventas</h1>
          <p className="inv-subtle">Registrar venta y generar factura</p>
        </div>

        <div className="header-actions">
          <button className="btn theme-toggle" onClick={toggle}>
            {theme === "dark" ? "☀️ Claro" : "🌙 Oscuro"}
          </button>
          <Link to="/" className="btn">← Inventario</Link>
          <Link to="/historial" className="btn">📊 Historial</Link>
        </div>
      </header>

      <section className="inv-grid">
        <div className="card">
          <div className="card-header">
            <h2>Cliente</h2>
          </div>

          <div className="card-body form-grid">
            <div className="form-field">
              <label>Nombre</label>
              <input
                placeholder="Consumidor final"
                value={cliente.nombre}
                onChange={e => setCliente({ ...cliente, nombre: e.target.value })}
              />
            </div>

            <div className="form-field">
              <label>Documento</label>
              <input
                placeholder="CC / NIT"
                value={cliente.documento}
                onChange={e => setCliente({ ...cliente, documento: e.target.value })}
              />
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h2>Agregar producto</h2>
          </div>

          <div className="card-body">
            <div className="form-field">
              <label>Producto</label>

              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setModalProductos(true)}
                style={{
                  width: "100%",
                  justifyContent: "center",
                  minHeight: 44,
                  fontWeight: 700
                }}
              >
                🔎 Buscar producto
              </button>

              {productoSeleccionado ? (
                <div
                  style={{
                    marginTop: 14,
                    border: "1px solid var(--border)",
                    borderRadius: 18,
                    padding: 14,
                    background: "linear-gradient(180deg, rgba(255,255,255,.045), rgba(255,255,255,.015))"
                  }}
                >
                  <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
                    <div
                      style={{
                        width: 76,
                        height: 76,
                        borderRadius: 16,
                        overflow: "hidden",
                        border: "1px solid var(--border)",
                        background: "rgba(255,255,255,.04)",
                        display: "grid",
                        placeItems: "center",
                        flexShrink: 0
                      }}
                    >
                      {productoSeleccionado.imagen ? (
                        <img
                          src={productoSeleccionado.imagen}
                          alt={productoSeleccionado.nombre}
                          style={{ width: "100%", height: "100%", objectFit: "cover" }}
                        />
                      ) : (
                        <span className="inv-subtle" style={{ fontSize: 11 }}>Sin imagen</span>
                      )}
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="product-title-row">
                        <strong>{productoSeleccionado.nombre}</strong>
                        <span className="badge">Seleccionado</span>
                      </div>

                      <div className="product-meta">
                        <span>Precio: <b>{formatMoney(productoSeleccionado.precioUnitario)}</b></span>
                        <span>Stock: <b>{productoSeleccionado.cantidad}</b></span>
                        {productoSeleccionado.categoriaNombre && (
                          <span>Categoría: <b>{productoSeleccionado.categoriaNombre}</b></span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div
                    style={{
                      marginTop: 14,
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      borderTop: "1px solid var(--border)",
                      paddingTop: 12
                    }}
                  >
                    <span className="inv-subtle">Subtotal estimado</span>
                    <strong style={{ fontSize: 22 }}>{formatMoney(subtotalActual)}</strong>
                  </div>
                </div>
              ) : (
                <p className="inv-subtle" style={{ marginTop: 10 }}>
                  No has seleccionado ningún producto.
                </p>
              )}
            </div>

            <div className="form-field">
              <label>Cantidad</label>
              <input
                ref={cantidadRef}
                type="number"
                min="1"
                value={cantidad}
                onChange={e => setCantidad(Number(e.target.value))}
              />
            </div>

            <button className="btn btn-primary" onClick={agregarItem}>
              ➕ Agregar al carrito
            </button>

            {error && (
              <div className="toast toast-error" style={{ position: "static", marginTop: 12 }}>
                {error}
              </div>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h2>Detalle de la venta</h2>
          </div>

          <div className="card-body">
            {items.length === 0 ? (
              <p className="inv-subtle">Sin productos agregados.</p>
            ) : (
              <ul className="product-list">
                {items.map(it => (
                  <li key={it.productoId} className="product-item">
                    <div className="product-info">
                      <div className="product-title-row">
                        <strong>{it.nombre}</strong>
                      </div>

                      <div className="product-meta">
                        <span>Cant: <b>{it.cantidad}</b></span>
                        <span>Precio: <b>{formatMoney(it.precioUnitario)}</b></span>
                        <span>Subtotal: <b>{formatMoney(it.cantidad * it.precioUnitario)}</b></span>
                      </div>
                    </div>

                    <div className="product-actions">
                      <button
                        className="btn btn-small btn-danger"
                        onClick={() => quitarItem(it.productoId)}
                      >
                        Quitar
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <div
              style={{
                marginTop: 16,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                borderTop: "1px solid var(--border)",
                paddingTop: 14
              }}
            >
              <strong>Total:</strong>
              <h2 style={{ margin: 0 }}>{formatMoney(total)}</h2>
            </div>
          </div>

          <div className="card-footer">
            <button
              className="btn btn-primary"
              onClick={registrarVenta}
              disabled={guardando || items.length === 0}
            >
              {guardando ? "Guardando..." : "Registrar venta"}
            </button>
          </div>
        </div>
      </section>

      {modalProductos && (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div
            className="modal-card"
            style={{
              maxWidth: 980,
              width: "92vw",
              maxHeight: "82vh",
              overflow: "hidden",
              borderRadius: 24,
              boxShadow: "0 28px 90px rgba(0,0,0,.48)"
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
                alignItems: "center",
                marginBottom: 12
              }}
            >
              <div>
                <h3 style={{ margin: 0 }}>Seleccionar producto</h3>
                <p className="inv-subtle" style={{ margin: "5px 0 0" }}>
                  Elige un producto del catálogo o usa el buscador.
                </p>
              </div>

              <button
                className="btn"
                onClick={() => {
                  setModalProductos(false);
                  setQModal("");
                }}
              >
                ✕
              </button>
            </div>

            <div className="input-with-icon" style={{ marginBottom: 12 }}>
              <span className="icon">🔎</span>
              <input
                autoFocus
                type="text"
                placeholder="Buscar por nombre o categoría..."
                value={qModal}
                onChange={(e) => setQModal(e.target.value)}
              />
            </div>

            <div
              style={{
                maxHeight: "58vh",
                overflowY: "auto",
                paddingRight: 6
              }}
            >
              {productosModal.length === 0 ? (
                <p className="inv-subtle">No hay productos que coincidan.</p>
              ) : (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))",
                    gap: 14,
                    alignItems: "start"
                  }}
                >
                  {productosModal.map(p => {
                    const stock = stockInfo(p);

                    return (
                      <div
                        key={p.id}
                        style={{
                          border: "1px solid var(--border)",
                          background: "linear-gradient(180deg, rgba(255,255,255,.045), rgba(255,255,255,.015))",
                          color: "var(--text)",
                          borderRadius: 18,
                          padding: 12,
                          boxShadow: "0 10px 28px rgba(0,0,0,.16)"
                        }}
                      >
                        <div
                          style={{
                            width: "100%",
                            height: 104,
                            borderRadius: 14,
                            overflow: "hidden",
                            border: "1px solid var(--border)",
                            background: "rgba(255,255,255,.04)",
                            display: "grid",
                            placeItems: "center",
                            marginBottom: 10
                          }}
                        >
                          {p.imagen ? (
                            <img
                              src={p.imagen}
                              alt={p.nombre}
                              style={{
                                width: "100%",
                                height: "100%",
                                objectFit: "cover"
                              }}
                            />
                          ) : (
                            <span className="inv-subtle">Sin imagen</span>
                          )}
                        </div>

                        <strong style={{ display: "block", marginBottom: 8 }}>
                          {p.nombre}
                        </strong>

                        <div style={{ display: "grid", gap: 6, marginBottom: 10 }}>
                          <span style={{ fontWeight: 800, fontSize: 16 }}>
                            {formatMoney(p.precioUnitario)}
                          </span>

                          <span style={{ color: stock.color, fontWeight: 700, fontSize: 13 }}>
                            {stock.icon} {stock.label}: {p.cantidad}
                          </span>

                          {p.categoriaNombre && (
                            <span
                              style={{
                                width: "fit-content",
                                fontSize: 12,
                                padding: "4px 8px",
                                borderRadius: 999,
                                border: "1px solid var(--border)",
                                color: "var(--muted)"
                              }}
                            >
                              🏷️ {p.categoriaNombre}
                            </span>
                          )}
                        </div>

                        <button
                          type="button"
                          className="btn btn-primary"
                          onClick={() => seleccionarProducto(p)}
                          style={{ width: "100%", justifyContent: "center" }}
                          disabled={Number(p.cantidad || 0) <= 0}
                        >
                          {Number(p.cantidad || 0) <= 0 ? "Sin stock" : "Seleccionar"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}