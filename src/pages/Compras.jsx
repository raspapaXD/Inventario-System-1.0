// src/pages/Compras.jsx

import { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  getDocs,
  runTransaction,
  serverTimestamp,
  Timestamp
} from "firebase/firestore";

import { db } from "../../firebaseClient.js";
import { Link } from "react-router-dom";
import { useTenant } from "../tenant/TenantProvider";
import AppMenu from "../components/AppMenu.jsx";

import "./inventario.css";

/* =========================================================
   TEMA
========================================================= */

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

/* =========================================================
   HELPERS
========================================================= */

const moneda = n =>
  `$${Number(n || 0).toLocaleString("es-CO", {
    maximumFractionDigits: 0
  })}`;

const numero = v =>
  Number(
    String(v ?? "")
      .replace(/\./g, "")
      .replace(/,/g, ".")
  ) || 0;

const slug = s =>
  String(s || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "proveedor";

const hoyISO = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dia}`;
};

/* =========================================================
   COMPONENTE
========================================================= */

export default function Compras() {
  const { empresa, user } = useTenant();
  const { theme, toggle } = useTheme();

  const esClaro = theme === "light";

  const superficieSuave = esClaro
    ? "#f8fafc"
    : "rgba(255,255,255,.025)";

  const superficieAcento = esClaro
    ? "#f5f8ff"
    : "rgba(59,130,246,.055)";

  /* =======================================================
     PRODUCTOS
  ======================================================= */

  const [productos, setProductos] = useState([]);
  const [cargandoProductos, setCargandoProductos] = useState(true);

  /* =======================================================
     FACTURA
  ======================================================= */

  const [factura, setFactura] = useState({
    numeroFactura: "",
    fecha: hoyISO(),
    proveedorNombre: "",
    proveedorDocumento: "",
    tipoPago: "CONTADO",
    fechaVencimiento: ""
  });

  /* =======================================================
     SELECCIÓN PRODUCTO
  ======================================================= */

  const [productoId, setProductoId] = useState("");
  const [busqueda, setBusqueda] = useState("");

  const [linea, setLinea] = useState({
    cantidad: 1,
    costoCompra: "",
    gananciaObjetivo: 30,
    gananciaMinima: 10,
    precioVenta: ""
  });

  /* =======================================================
     ITEMS / ESTADO
  ======================================================= */

  const [items, setItems] = useState([]);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const [exito, setExito] = useState("");

  /* =======================================================
     CARGAR PRODUCTOS
  ======================================================= */

  useEffect(() => {
    (async () => {
      if (!empresa?.id) return;

      try {
        setCargandoProductos(true);

        const snap = await getDocs(
          collection(
            db,
            "empresas",
            empresa.id,
            "productos"
          )
        );

        setProductos(
          snap.docs.map(d => ({
            id: d.id,
            ...d.data()
          }))
        );
      } catch (e) {
        console.error(e);
        setError("No se pudieron cargar los productos.");
      } finally {
        setCargandoProductos(false);
      }
    })();
  }, [empresa?.id]);

  /* =======================================================
     PRODUCTO ACTUAL
  ======================================================= */

  const productoActual = useMemo(
    () =>
      productos.find(
        p => p.id === productoId
      ) || null,
    [productos, productoId]
  );

  /* =======================================================
     FILTRAR PRODUCTOS
  ======================================================= */

  const productosFiltrados = useMemo(() => {
    const q = busqueda
      .trim()
      .toLowerCase();

    return productos.filter(p => {
      /*
       * No ofrecemos productos inactivos para nuevas compras.
       * Los productos antiguos sin "activo" se consideran activos.
       */
      if (p.activo === false) {
        return false;
      }

      if (!q) {
        return true;
      }

      return `${p.codigo || ""} ${p.nombre || ""} ${p.categoriaNombre || ""}`
        .toLowerCase()
        .includes(q);
    });
  }, [productos, busqueda]);

  /* =======================================================
     SIMULACIÓN
  ======================================================= */

  const simulacion = useMemo(() => {
    if (!productoActual) {
      return {
        stockActual: 0,
        costoAnterior: 0,
        nuevoStock: 0,
        costoPromedio: 0,
        precioSugerido: 0,
        precioMinimo: 0
      };
    }

    const stockActual =
      Number(productoActual.cantidad || 0);

    const costoAnterior =
      Number(
        productoActual.costoPromedio ??
        productoActual.costoUnitario ??
        0
      );

    const cantidadNueva =
      numero(linea.cantidad);

    const costoCompra =
      numero(linea.costoCompra);

    const nuevoStock =
      stockActual + cantidadNueva;

    const valorAnterior =
      stockActual * costoAnterior;

    const valorCompra =
      cantidadNueva * costoCompra;

    const costoPromedio =
      nuevoStock > 0
        ? (valorAnterior + valorCompra) / nuevoStock
        : costoCompra;

    const gananciaObjetivo =
      numero(linea.gananciaObjetivo) / 100;

    const gananciaMinima =
      numero(linea.gananciaMinima) / 100;

    const precioSugerido =
      costoPromedio * (1 + gananciaObjetivo);

    const precioMinimo =
      costoPromedio * (1 + gananciaMinima);

    return {
      stockActual,
      costoAnterior,
      nuevoStock,
      costoPromedio,
      precioSugerido,
      precioMinimo
    };
  }, [productoActual, linea]);

  /* =======================================================
     CARGAR COSTO AL SELECCIONAR
  ======================================================= */

  useEffect(() => {
    if (!productoActual) return;

    if (!linea.costoCompra) {
      setLinea(prev => ({
        ...prev,
        costoCompra:
          productoActual.costoPromedio ??
          productoActual.costoUnitario ??
          ""
      }));
    }
  }, [productoActual]);

  /* =======================================================
     PRECIO SUGERIDO
  ======================================================= */

  useEffect(() => {
    if (!productoActual) return;
    if (simulacion.precioSugerido <= 0) return;

    setLinea(prev => ({
      ...prev,
      precioVenta:
        Math.round(simulacion.precioSugerido)
    }));
  }, [
    productoActual?.id,
    linea.costoCompra,
    linea.cantidad,
    linea.gananciaObjetivo
  ]);

  /* =======================================================
     SELECCIONAR PRODUCTO
  ======================================================= */

  const seleccionarProducto = id => {
    const p =
      productos.find(
        x => x.id === id
      );

    if (p?.activo === false) {
      setProductoId("");
      return setError(
        "Este producto está inactivo y no puede recibir nuevas compras."
      );
    }

    setProductoId(id);

    setLinea({
      cantidad: 1,
      costoCompra:
        p?.costoPromedio ??
        p?.costoUnitario ??
        "",
      gananciaObjetivo:
        p?.porcentajeGanancia ??
        30,
      gananciaMinima:
        p?.porcentajeGananciaMinima ??
        10,
      precioVenta: ""
    });

    setError("");
  };

  /* =======================================================
     AGREGAR PRODUCTO
  ======================================================= */

  const agregarProducto = () => {
    setError("");

    if (!productoActual) {
      return setError(
        "Selecciona un producto."
      );
    }

    const cantidad =
      numero(linea.cantidad);

    const costoCompra =
      numero(linea.costoCompra);

    const precioVenta =
      numero(linea.precioVenta);

    if (
      !Number.isInteger(cantidad) ||
      cantidad <= 0
    ) {
      return setError(
        "La cantidad comprada debe ser un número entero mayor que cero."
      );
    }

    if (costoCompra <= 0) {
      return setError(
        "Ingresa el costo de compra."
      );
    }

    if (
      numero(linea.gananciaMinima) < 0
    ) {
      return setError(
        "La ganancia mínima no puede ser negativa."
      );
    }

    if (
      numero(linea.gananciaObjetivo) <
      numero(linea.gananciaMinima)
    ) {
      return setError(
        "La ganancia objetivo no puede ser menor que la ganancia mínima."
      );
    }

    if (
      precioVenta <
      simulacion.precioMinimo
    ) {
      return setError(
        `El precio de venta no puede ser menor que ${moneda(
          simulacion.precioMinimo
        )}.`
      );
    }

    if (
      items.some(
        i => i.productoId === productoActual.id
      )
    ) {
      return setError(
        "Este producto ya fue agregado a la factura."
      );
    }

    setItems(prev => [
      ...prev,
      {
        productoId:
          productoActual.id,
        codigo:
          productoActual.codigo || null,
        nombre:
          productoActual.nombre,
        cantidad,
        costoCompra,
        subtotal:
          cantidad * costoCompra,
        gananciaObjetivo:
          numero(linea.gananciaObjetivo),
        gananciaMinima:
          numero(linea.gananciaMinima),
        precioVenta:
          Math.round(precioVenta)
      }
    ]);

    setProductoId("");
    setBusqueda("");

    setLinea({
      cantidad: 1,
      costoCompra: "",
      gananciaObjetivo: 30,
      gananciaMinima: 10,
      precioVenta: ""
    });
  };

  /* =======================================================
     QUITAR ITEM
  ======================================================= */

  const quitarItem = id => {
    setItems(prev =>
      prev.filter(
        i => i.productoId !== id
      )
    );
  };

  /* =======================================================
     TOTALES / ESTADO VISUAL
  ======================================================= */

  const total = useMemo(
    () =>
      items.reduce(
        (acc, item) =>
          acc +
          Number(item.subtotal || 0),
        0
      ),
    [items]
  );

  const totalUnidades = useMemo(
    () =>
      items.reduce(
        (acc, item) =>
          acc + Number(item.cantidad || 0),
        0
      ),
    [items]
  );

  const facturaLista =
    Boolean(
      factura.numeroFactura.trim() &&
      factura.fecha &&
      factura.proveedorNombre.trim() &&
      (
        factura.tipoPago !== "CREDITO" ||
        factura.fechaVencimiento
      )
    );

  /* =======================================================
     GUARDAR COMPRA
  ======================================================= */

  const guardarCompra = async () => {
    try {
      setError("");
      setExito("");

      if (!empresa?.id) {
        return setError(
          "No hay empresa activa."
        );
      }

      if (
        !factura.numeroFactura.trim()
      ) {
        return setError(
          "Ingresa el número de la factura."
        );
      }

      if (
        !factura.proveedorNombre.trim()
      ) {
        return setError(
          "Ingresa el nombre del proveedor."
        );
      }

      if (!factura.fecha) {
        return setError(
          "Selecciona la fecha de la factura."
        );
      }

      if (items.length === 0) {
        return setError(
          "Agrega al menos un producto."
        );
      }

      if (
        factura.tipoPago === "CREDITO" &&
        !factura.fechaVencimiento
      ) {
        return setError(
          "Una factura a crédito debe tener fecha de vencimiento."
        );
      }

      if (total <= 0) {
        return setError(
          "El total de la compra debe ser mayor que cero."
        );
      }

      setGuardando(true);

      const proveedorId =
        factura.proveedorDocumento.trim() ||
        slug(factura.proveedorNombre);

      const compraRef =
        doc(
          collection(
            db,
            "empresas",
            empresa.id,
            "compras"
          )
        );

      const proveedorRef =
        doc(
          db,
          "empresas",
          empresa.id,
          "proveedores",
          proveedorId
        );

      const cuentaRef =
        factura.tipoPago === "CREDITO"
          ? doc(
              collection(
                db,
                "empresas",
                empresa.id,
                "cuentasPorPagar"
              )
            )
          : null;

      await runTransaction(
        db,
        async transaction => {
          /*
           * Primero hacemos todas las lecturas.
           * Firestore requiere leer antes de escribir
           * dentro de esta transacción.
           */
          const lecturas = [];

          for (const item of items) {
            const productoRef =
              doc(
                db,
                "empresas",
                empresa.id,
                "productos",
                item.productoId
              );

            const snap =
              await transaction.get(
                productoRef
              );

            if (!snap.exists()) {
              throw new Error(
                `El producto ${item.nombre} ya no existe.`
              );
            }

            if (
              snap.data()?.activo === false
            ) {
              throw new Error(
                `${item.nombre} está inactivo. Reactívalo antes de registrar una compra.`
              );
            }

            lecturas.push({
              item,
              productoRef,
              producto:
                snap.data()
            });
          }

          const itemsCompra = [];

          for (const {
            item,
            productoRef,
            producto
          } of lecturas) {
            const stockAnterior =
              Number(
                producto.cantidad || 0
              );

            const costoAnterior =
              Number(
                producto.costoPromedio ??
                producto.costoUnitario ??
                0
              );

            const diferencia =
              Number(item.cantidad || 0);

            const stockNuevo =
              stockAnterior +
              diferencia;

            const costoPromedio =
              stockNuevo > 0
                ? (
                    stockAnterior *
                      costoAnterior +
                    item.cantidad *
                      item.costoCompra
                  ) /
                  stockNuevo
                : item.costoCompra;

            const precioSugerido =
              costoPromedio *
              (
                1 +
                item.gananciaObjetivo /
                  100
              );

            const precioMinimo =
              costoPromedio *
              (
                1 +
                item.gananciaMinima /
                  100
              );

            if (
              item.precioVenta <
              precioMinimo
            ) {
              throw new Error(
                `${item.nombre}: el precio seleccionado quedó por debajo del precio mínimo.`
              );
            }

            transaction.update(
              productoRef,
              {
                cantidad:
                  stockNuevo,
                costoPromedio,
                costoUnitario:
                  costoPromedio,
                porcentajeGanancia:
                  item.gananciaObjetivo,
                porcentajeGananciaMinima:
                  item.gananciaMinima,
                precioSugerido:
                  Math.round(
                    precioSugerido
                  ),
                precioMinimo:
                  Math.round(
                    precioMinimo
                  ),
                precioUnitario:
                  Math.round(
                    item.precioVenta
                  ),
                actualizadoEn:
                  serverTimestamp()
              }
            );

            const movimientoRef =
              doc(
                collection(
                  db,
                  "empresas",
                  empresa.id,
                  "movimientos"
                )
              );

            transaction.set(
              movimientoRef,
              {
                tipo: "COMPRA",
                productoId:
                  item.productoId,
                productoNombre:
                  item.nombre,
                productoCodigo:
                  producto.codigo ||
                  item.codigo ||
                  null,
                cantidad:
                  item.cantidad,
                diferencia,
                stockAnterior,
                stockNuevo,
                costoUnitario:
                  item.costoCompra,
                costoTotal:
                  item.cantidad *
                  item.costoCompra,
                costoAnterior,
                costoPromedioNuevo:
                  costoPromedio,
                precioVentaNuevo:
                  Math.round(
                    item.precioVenta
                  ),
                precioMinimoNuevo:
                  Math.round(
                    precioMinimo
                  ),
                compraId:
                  compraRef.id,
                numeroFactura:
                  factura.numeroFactura.trim(),
                proveedorId,
                proveedorNombre:
                  factura.proveedorNombre.trim(),
                proveedorDocumento:
                  factura.proveedorDocumento.trim() ||
                  null,
                usuarioId:
                  user?.uid || null,
                usuarioEmail:
                  user?.email || null,
                fecha:
                  serverTimestamp()
              }
            );

            itemsCompra.push({
              productoId:
                item.productoId,
              codigo:
                producto.codigo ||
                item.codigo ||
                null,
              nombre:
                item.nombre,
              cantidad:
                item.cantidad,
              costoUnitario:
                item.costoCompra,
              subtotal:
                item.cantidad *
                item.costoCompra,
              stockAnterior,
              stockNuevo,
              diferencia,
              costoPromedioNuevo:
                costoPromedio,
              porcentajeGanancia:
                item.gananciaObjetivo,
              porcentajeGananciaMinima:
                item.gananciaMinima,
              precioSugerido:
                Math.round(
                  precioSugerido
                ),
              precioMinimo:
                Math.round(
                  precioMinimo
                ),
              precioVenta:
                Math.round(
                  item.precioVenta
                )
            });
          }

          transaction.set(
            proveedorRef,
            {
              nombre:
                factura.proveedorNombre.trim(),
              nombreLower:
                factura.proveedorNombre
                  .trim()
                  .toLowerCase(),
              documento:
                factura.proveedorDocumento.trim() ||
                null,
              updatedAt:
                serverTimestamp()
            },
            { merge: true }
          );

          const esCredito =
            factura.tipoPago ===
            "CREDITO";

          transaction.set(
            compraRef,
            {
              numeroFactura:
                factura.numeroFactura.trim(),
              proveedorId,
              proveedorNombre:
                factura.proveedorNombre.trim(),
              proveedorDocumento:
                factura.proveedorDocumento.trim() ||
                null,
              tipoPago:
                factura.tipoPago,
              fechaFactura:
                Timestamp.fromDate(
                  new Date(
                    `${factura.fecha}T12:00:00`
                  )
                ),
              fechaVencimiento:
                esCredito
                  ? Timestamp.fromDate(
                      new Date(
                        `${factura.fechaVencimiento}T12:00:00`
                      )
                    )
                  : null,
              items:
                itemsCompra,
              total,
              estadoPago:
                esCredito
                  ? "PENDIENTE"
                  : "PAGADA",
              saldoPendiente:
                esCredito
                  ? total
                  : 0,
              usuarioId:
                user?.uid || null,
              usuarioEmail:
                user?.email || null,
              createdAt:
                serverTimestamp()
            }
          );

          if (esCredito) {
            transaction.set(
              cuentaRef,
              {
                compraId:
                  compraRef.id,
                numeroFactura:
                  factura.numeroFactura.trim(),
                proveedorId,
                proveedorNombre:
                  factura.proveedorNombre.trim(),
                total,
                saldoPendiente:
                  total,
                estado:
                  "PENDIENTE",
                fechaFactura:
                  Timestamp.fromDate(
                    new Date(
                      `${factura.fecha}T12:00:00`
                    )
                  ),
                fechaVencimiento:
                  Timestamp.fromDate(
                    new Date(
                      `${factura.fechaVencimiento}T12:00:00`
                    )
                  ),
                createdAt:
                  serverTimestamp(),
                updatedAt:
                  serverTimestamp()
              }
            );
          }
        }
      );

      setFactura({
        numeroFactura: "",
        fecha: hoyISO(),
        proveedorNombre: "",
        proveedorDocumento: "",
        tipoPago: "CONTADO",
        fechaVencimiento: ""
      });

      setItems([]);
      setProductoId("");
      setBusqueda("");

      setLinea({
        cantidad: 1,
        costoCompra: "",
        gananciaObjetivo: 30,
        gananciaMinima: 10,
        precioVenta: ""
      });

      setExito(
        "Factura registrada correctamente. El inventario fue actualizado."
      );

      const snap =
        await getDocs(
          collection(
            db,
            "empresas",
            empresa.id,
            "productos"
          )
        );

      setProductos(
        snap.docs.map(d => ({
          id: d.id,
          ...d.data()
        }))
      );
    } catch (e) {
      console.error(e);

      setError(
        e?.message ||
        "No se pudo registrar la compra."
      );
    } finally {
      setGuardando(false);
    }
  };

  /* =========================================================
     RENDER
  ========================================================= */

  return (
    <div className="inv-root">

      {/* HEADER */}

      <header className="inv-header">
        <div>
          <h1>🛒 Registrar compra</h1>

          <p className="inv-subtle">
            Registra la factura del proveedor, agrega los productos y revisa el total antes de guardar.
          </p>
        </div>

        <div className="header-actions">
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

      {/* GUÍA VISUAL DEL PROCESO */}

      <div
        className="card"
        style={{
          marginBottom: 18,
          overflow: "visible"
        }}
      >
        <div
          className="card-body"
          style={{
            padding: 12
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns:
                "repeat(3, minmax(0, 1fr))",
              gap: 8
            }}
          >
            <PasoCompra
              numero="1"
              titulo="Datos de factura"
              detalle={
                facturaLista
                  ? "Información completa"
                  : "Proveedor, número y fecha"
              }
              completo={facturaLista}
            />

            <PasoCompra
              numero="2"
              titulo="Productos"
              detalle={
                items.length
                  ? `${items.length} referencia(s) • ${totalUnidades} unidad(es)`
                  : "Agrega lo recibido"
              }
              completo={items.length > 0}
            />

            <PasoCompra
              numero="3"
              titulo="Confirmar"
              detalle={
                items.length
                  ? `Total ${moneda(total)}`
                  : "Revisa y registra"
              }
              completo={
                facturaLista &&
                items.length > 0
              }
            />
          </div>
        </div>
      </div>

      {/* MENSAJES */}

      {error && (
        <div
          className="toast toast-error"
          style={{
            position: "static",
            marginBottom: 16
          }}
        >
          ⚠️ {error}
        </div>
      )}

      {exito && (
        <div
          className="card"
          style={{
            marginBottom: 16,
            padding: 16,
            border:
              "1px solid rgba(34,197,94,.38)",
            background:
              esClaro
                ? "#f0fdf4"
                : "rgba(34,197,94,.07)"
          }}
        >
          ✅ {exito}
        </div>
      )}

      {/* PASOS 1 Y 2 */}

      <section
        className="inv-grid"
        style={{
          alignItems: "start"
        }}
      >
        {/* PASO 1 - FACTURA */}

        <div
          className="card"
          style={{
            border:
              facturaLista
                ? "1px solid rgba(34,197,94,.32)"
                : "1px solid rgba(59,130,246,.30)"
          }}
        >
          <div
            className="card-header"
            style={{
              background:
                facturaLista
                  ? esClaro
                    ? "#f4fff8"
                    : "rgba(34,197,94,.055)"
                  : superficieAcento
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent:
                  "space-between",
                gap: 12,
                alignItems:
                  "flex-start"
              }}
            >
              <div>
                <div
                  style={{
                    display: "flex",
                    gap: 8,
                    alignItems: "center",
                    marginBottom: 5
                  }}
                >
                  <span
                    style={{
                      display: "inline-grid",
                      placeItems: "center",
                      width: 26,
                      height: 26,
                      borderRadius: 999,
                      background:
                        facturaLista
                          ? "#22c55e"
                          : "#3b82f6",
                      color: "#fff",
                      fontSize: 12,
                      fontWeight: 900
                    }}
                  >
                    {facturaLista
                      ? "✓"
                      : "1"}
                  </span>

                  <h2
                    style={{
                      margin: 0
                    }}
                  >
                    Factura de proveedor
                  </h2>
                </div>

                <p
                  className="inv-subtle"
                  style={{
                    margin: 0,
                    fontSize: 12
                  }}
                >
                  Primero identifica la factura y el proveedor.
                </p>
              </div>

              <span
                className="badge"
                style={{
                  whiteSpace: "nowrap"
                }}
              >
                {factura.tipoPago ===
                "CREDITO"
                  ? "🕒 Crédito"
                  : "💵 Contado"}
              </span>
            </div>
          </div>

          <div
            className="card-body"
            style={{
              padding: 18
            }}
          >
            {/* DATOS PRINCIPALES */}

            <div
              style={{
                padding: 14,
                borderRadius: 14,
                border:
                  "1px solid var(--border)",
                background:
                  superficieSuave,
                marginBottom: 16
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 800,
                  color: "var(--muted)",
                  textTransform:
                    "uppercase",
                  letterSpacing: ".05em",
                  marginBottom: 11
                }}
              >
                Datos principales
              </div>

              <div className="form-grid">
                <div className="form-field">
                  <label>
                    Número de factura
                    <span
                      style={{
                        color: "#ef4444"
                      }}
                    >
                      {" "}*
                    </span>
                  </label>

                  <input
                    value={
                      factura.numeroFactura
                    }
                    placeholder="Ej: FV-001245"
                    onChange={e =>
                      setFactura({
                        ...factura,
                        numeroFactura:
                          e.target.value
                      })
                    }
                    style={{
                      fontWeight: 700
                    }}
                  />
                </div>

                <div className="form-field">
                  <label>
                    Fecha
                    <span
                      style={{
                        color: "#ef4444"
                      }}
                    >
                      {" "}*
                    </span>
                  </label>

                  <input
                    type="date"
                    value={factura.fecha}
                    onChange={e =>
                      setFactura({
                        ...factura,
                        fecha:
                          e.target.value
                      })
                    }
                  />
                </div>
              </div>
            </div>

            {/* PROVEEDOR */}

            <div
              style={{
                marginBottom: 16
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 800,
                  color: "var(--muted)",
                  textTransform:
                    "uppercase",
                  letterSpacing: ".05em",
                  marginBottom: 10
                }}
              >
                Proveedor
              </div>

              <div className="form-grid">
                <div className="form-field">
                  <label>
                    Nombre del proveedor
                    <span
                      style={{
                        color: "#ef4444"
                      }}
                    >
                      {" "}*
                    </span>
                  </label>

                  <input
                    value={
                      factura.proveedorNombre
                    }
                    placeholder="Ej: Distribuciones ABC"
                    onChange={e =>
                      setFactura({
                        ...factura,
                        proveedorNombre:
                          e.target.value
                      })
                    }
                  />
                </div>

                <div className="form-field">
                  <label>
                    NIT / Documento
                  </label>

                  <input
                    value={
                      factura.proveedorDocumento
                    }
                    placeholder="Opcional"
                    onChange={e =>
                      setFactura({
                        ...factura,
                        proveedorDocumento:
                          e.target.value
                      })
                    }
                  />
                </div>
              </div>
            </div>

            {/* PAGO */}

            <div>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 800,
                  color: "var(--muted)",
                  textTransform:
                    "uppercase",
                  letterSpacing: ".05em",
                  marginBottom: 10
                }}
              >
                Condiciones de pago
              </div>

              <div className="form-grid">
                <div className="form-field">
                  <label>
                    Forma de pago *
                  </label>

                  <select
                    value={
                      factura.tipoPago
                    }
                    onChange={e =>
                      setFactura({
                        ...factura,
                        tipoPago:
                          e.target.value,
                        fechaVencimiento:
                          e.target.value ===
                          "CONTADO"
                            ? ""
                            : factura.fechaVencimiento
                      })
                    }
                  >
                    <option value="CONTADO">
                      💵 Contado
                    </option>

                    <option value="CREDITO">
                      🕒 Crédito
                    </option>
                  </select>
                </div>

                {factura.tipoPago ===
                  "CREDITO" && (
                  <div className="form-field">
                    <label>
                      Fecha de vencimiento *
                    </label>

                    <input
                      type="date"
                      value={
                        factura.fechaVencimiento
                      }
                      onChange={e =>
                        setFactura({
                          ...factura,
                          fechaVencimiento:
                            e.target.value
                        })
                      }
                    />
                  </div>
                )}
              </div>

              {factura.tipoPago ===
                "CREDITO" && (
                <div
                  style={{
                    marginTop: 12,
                    padding: 11,
                    borderRadius: 11,
                    border:
                      "1px solid rgba(245,158,11,.25)",
                    background:
                      esClaro
                        ? "#fffbeb"
                        : "rgba(245,158,11,.055)",
                    fontSize: 12
                  }}
                >
                  🧾 Esta factura generará automáticamente una cuenta por pagar en Cartera.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* PASO 2 - PRODUCTOS */}

        <div
          className="card"
          style={{
            border:
              "1px solid rgba(139,92,246,.30)"
          }}
        >
          <div
            className="card-header"
            style={{
              background:
                esClaro
                  ? "#faf7ff"
                  : "rgba(139,92,246,.055)"
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent:
                  "space-between",
                alignItems:
                  "flex-start",
                gap: 12
              }}
            >
              <div>
                <div
                  style={{
                    display: "flex",
                    gap: 8,
                    alignItems: "center",
                    marginBottom: 5
                  }}
                >
                  <span
                    style={{
                      display: "inline-grid",
                      placeItems: "center",
                      width: 26,
                      height: 26,
                      borderRadius: 999,
                      background:
                        "#8b5cf6",
                      color: "#fff",
                      fontSize: 12,
                      fontWeight: 900
                    }}
                  >
                    2
                  </span>

                  <h2
                    style={{
                      margin: 0
                    }}
                  >
                    Agregar productos
                  </h2>
                </div>

                <p
                  className="inv-subtle"
                  style={{
                    margin: 0,
                    fontSize: 12
                  }}
                >
                  Selecciona cada referencia recibida en la factura.
                </p>
              </div>

              <span className="badge">
                {items.length} agregado(s)
              </span>
            </div>
          </div>

          <div
            className="card-body"
            style={{
              padding: 18
            }}
          >
            {/* BUSCADOR PROMINENTE */}

            <div
              style={{
                padding: 14,
                borderRadius: 14,
                border:
                  "1px solid var(--border)",
                background:
                  superficieSuave
              }}
            >
              <div className="form-field">
                <label>
                  🔎 Buscar producto
                </label>

                <input
                  placeholder="Nombre, código SKU o categoría..."
                  value={busqueda}
                  onChange={e =>
                    setBusqueda(
                      e.target.value
                    )
                  }
                  style={{
                    minHeight: 44,
                    fontSize: 14
                  }}
                />
              </div>

              <div
                className="form-field"
                style={{
                  marginTop: 10
                }}
              >
                <label>
                  Producto *
                </label>

                <select
                  value={productoId}
                  onChange={e =>
                    seleccionarProducto(
                      e.target.value
                    )
                  }
                  disabled={
                    cargandoProductos
                  }
                  style={{
                    minHeight: 44,
                    fontWeight:
                      productoId
                        ? 700
                        : 400
                  }}
                >
                  <option value="">
                    {cargandoProductos
                      ? "Cargando productos..."
                      : "Selecciona un producto…"}
                  </option>

                  {productosFiltrados.map(
                    p => (
                      <option
                        key={p.id}
                        value={p.id}
                      >
                        {p.codigo
                          ? `${p.codigo} · `
                          : ""}
                        {p.nombre} — Stock: {p.cantidad}
                      </option>
                    )
                  )}
                </select>

                <span
                  className="inv-subtle"
                  style={{
                    display: "block",
                    fontSize: 11,
                    marginTop: 5
                  }}
                >
                  {productosFiltrados.length} producto(s) disponible(s)
                </span>
              </div>
            </div>

            {productoActual ? (
              <>
                {/* PRODUCTO SELECCIONADO */}

                <div
                  style={{
                    padding: 15,
                    border:
                      "1px solid rgba(139,92,246,.28)",
                    borderRadius: 15,
                    marginTop: 14,
                    marginBottom: 14,
                    background:
                      esClaro
                        ? "#fcfaff"
                        : "rgba(139,92,246,.045)"
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent:
                        "space-between",
                      alignItems:
                        "flex-start",
                      gap: 12,
                      flexWrap: "wrap"
                    }}
                  >
                    <div>
                      <div
                        style={{
                          display: "flex",
                          gap: 7,
                          alignItems:
                            "center",
                          flexWrap:
                            "wrap"
                        }}
                      >
                        <strong
                          style={{
                            fontSize: 17
                          }}
                        >
                          {productoActual.nombre}
                        </strong>

                        {productoActual.codigo && (
                          <span className="badge">
                            {productoActual.codigo}
                          </span>
                        )}
                      </div>

                      <div
                        className="inv-subtle"
                        style={{
                          marginTop: 5,
                          fontSize: 12
                        }}
                      >
                        {productoActual.categoriaNombre ||
                          "Sin categoría"}
                      </div>
                    </div>

                    <div
                      style={{
                        display: "flex",
                        gap: 8,
                        flexWrap: "wrap"
                      }}
                    >
                      <MiniCompra
                        titulo="Stock actual"
                        valor={
                          simulacion.stockActual
                        }
                      />

                      <MiniCompra
                        titulo="Costo actual"
                        valor={moneda(
                          simulacion.costoAnterior
                        )}
                      />
                    </div>
                  </div>
                </div>

                {/* DATOS DE LA ENTRADA */}

                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 800,
                    color: "var(--muted)",
                    textTransform:
                      "uppercase",
                    letterSpacing: ".05em",
                    marginBottom: 10
                  }}
                >
                  Datos de esta entrada
                </div>

                <div className="form-grid">
                  <div className="form-field">
                    <label>
                      Cantidad recibida *
                    </label>

                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={
                        linea.cantidad
                      }
                      onChange={e =>
                        setLinea({
                          ...linea,
                          cantidad:
                            e.target.value
                        })
                      }
                    />
                  </div>

                  <div className="form-field">
                    <label>
                      Costo unitario *
                    </label>

                    <input
                      type="number"
                      min="0"
                      value={
                        linea.costoCompra
                      }
                      onChange={e =>
                        setLinea({
                          ...linea,
                          costoCompra:
                            e.target.value
                        })
                      }
                    />

                    <span
                      className="inv-subtle"
                      style={{
                        display: "block",
                        fontSize: 10,
                        marginTop: 4
                      }}
                    >
                      Valor pagado por cada unidad.
                    </span>
                  </div>
                </div>

                {/* POLÍTICA DE PRECIO */}

                <div
                  style={{
                    marginTop: 16,
                    paddingTop: 14,
                    borderTop:
                      "1px solid var(--border)"
                  }}
                >
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 800,
                      color: "var(--muted)",
                      textTransform:
                        "uppercase",
                      letterSpacing: ".05em",
                      marginBottom: 10
                    }}
                  >
                    Precio de venta después de la compra
                  </div>

                  <div className="form-grid">
                    <div className="form-field">
                      <label>
                        Ganancia objetivo %
                      </label>

                      <input
                        type="number"
                        min="0"
                        value={
                          linea.gananciaObjetivo
                        }
                        onChange={e =>
                          setLinea({
                            ...linea,
                            gananciaObjetivo:
                              e.target.value
                          })
                        }
                      />
                    </div>

                    <div className="form-field">
                      <label>
                        Ganancia mínima %
                      </label>

                      <input
                        type="number"
                        min="0"
                        value={
                          linea.gananciaMinima
                        }
                        onChange={e =>
                          setLinea({
                            ...linea,
                            gananciaMinima:
                              e.target.value
                          })
                        }
                      />
                    </div>

                    <div
                      className="form-field"
                      style={{
                        gridColumn:
                          "1 / -1"
                      }}
                    >
                      <label>
                        Precio de venta *
                      </label>

                      <input
                        type="number"
                        min="0"
                        value={
                          linea.precioVenta
                        }
                        onChange={e =>
                          setLinea({
                            ...linea,
                            precioVenta:
                              e.target.value
                          })
                        }
                        style={{
                          fontWeight: 800,
                          fontSize: 15
                        }}
                      />
                    </div>
                  </div>
                </div>

                {/* RESULTADO DE LA ENTRADA */}

                <div
                  style={{
                    marginTop: 16,
                    padding: 14,
                    borderRadius: 14,
                    border:
                      "1px solid var(--border)",
                    background:
                      superficieSuave
                  }}
                >
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns:
                        "repeat(2, minmax(0, 1fr))",
                      gap: 8
                    }}
                  >
                    <MiniCompra
                      titulo="Nuevo stock"
                      valor={
                        simulacion.nuevoStock
                      }
                      destacado
                    />

                    <MiniCompra
                      titulo="Costo promedio"
                      valor={moneda(
                        simulacion.costoPromedio
                      )}
                    />

                    <MiniCompra
                      titulo="Precio sugerido"
                      valor={moneda(
                        simulacion.precioSugerido
                      )}
                    />

                    <MiniCompra
                      titulo="Precio mínimo"
                      valor={moneda(
                        simulacion.precioMinimo
                      )}
                    />
                  </div>
                </div>

                <button
                  type="button"
                  className="btn btn-primary"
                  style={{
                    width: "100%",
                    marginTop: 14,
                    minHeight: 46,
                    fontWeight: 800
                  }}
                  onClick={
                    agregarProducto
                  }
                >
                  ➕ Agregar este producto a la factura
                </button>
              </>
            ) : (
              <div
                style={{
                  marginTop: 14,
                  padding: "26px 18px",
                  textAlign: "center",
                  borderRadius: 14,
                  border:
                    "1px dashed var(--border)",
                  background:
                    superficieSuave
                }}
              >
                <div
                  style={{
                    fontSize: 27,
                    marginBottom: 7
                  }}
                >
                  📦
                </div>

                <strong>
                  Selecciona un producto
                </strong>

                <p
                  className="inv-subtle"
                  style={{
                    margin:
                      "5px 0 0",
                    fontSize: 12
                  }}
                >
                  Aquí aparecerán la cantidad, el costo y la simulación del nuevo inventario.
                </p>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* PASO 3 - DETALLE */}

      <div
        className="card"
        style={{
          marginTop: 18,
          border:
            items.length
              ? "1px solid rgba(34,197,94,.28)"
              : "1px solid var(--border)"
        }}
      >
        <div
          className="card-header"
          style={{
            background:
              items.length
                ? esClaro
                  ? "#f6fff9"
                  : "rgba(34,197,94,.045)"
                : undefined
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent:
                "space-between",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap"
            }}
          >
            <div>
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  alignItems: "center"
                }}
              >
                <span
                  style={{
                    display: "inline-grid",
                    placeItems: "center",
                    width: 26,
                    height: 26,
                    borderRadius: 999,
                    background:
                      items.length
                        ? "#22c55e"
                        : "#64748b",
                    color: "#fff",
                    fontSize: 12,
                    fontWeight: 900
                  }}
                >
                  {items.length
                    ? "✓"
                    : "3"}
                </span>

                <h2
                  style={{
                    margin: 0
                  }}
                >
                  Detalle de la compra
                </h2>
              </div>

              <p
                className="inv-subtle"
                style={{
                  margin:
                    "5px 0 0",
                  fontSize: 12
                }}
              >
                Verifica referencias, cantidades y costos antes de registrar.
              </p>
            </div>

            {items.length > 0 && (
              <span className="badge">
                {items.length} referencia(s) • {totalUnidades} unidad(es)
              </span>
            )}
          </div>
        </div>

        <div
          className="card-body"
          style={{
            padding:
              items.length
                ? 0
                : 16
          }}
        >
          {items.length === 0 ? (
            <div
              style={{
                padding: "34px 20px",
                textAlign: "center"
              }}
            >
              <div
                style={{
                  fontSize: 30,
                  marginBottom: 8
                }}
              >
                🧾
              </div>

              <strong>
                La factura todavía está vacía
              </strong>

              <p
                className="inv-subtle"
                style={{
                  margin:
                    "6px 0 0"
                }}
              >
                Agrega los productos recibidos desde el panel superior.
              </p>
            </div>
          ) : (
            <>
              {/* CABECERA DE DETALLE */}

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns:
                    "minmax(220px, 1.8fr) 90px 130px 130px 130px 76px",
                  gap: 10,
                  alignItems: "center",
                  padding: "10px 14px",
                  borderBottom:
                    "1px solid var(--border)",
                  background:
                    superficieSuave,
                  color:
                    "var(--muted)",
                  fontSize: 10,
                  fontWeight: 800,
                  textTransform:
                    "uppercase",
                  letterSpacing: ".04em",
                  overflowX: "auto"
                }}
              >
                <span>Producto</span>
                <span
                  style={{
                    textAlign: "center"
                  }}
                >
                  Cant.
                </span>
                <span
                  style={{
                    textAlign: "right"
                  }}
                >
                  Costo
                </span>
                <span
                  style={{
                    textAlign: "right"
                  }}
                >
                  Venta
                </span>
                <span
                  style={{
                    textAlign: "right"
                  }}
                >
                  Subtotal
                </span>
                <span />
              </div>

              <div
                style={{
                  maxHeight: 380,
                  overflowY: "auto"
                }}
              >
                {items.map(item => (
                  <div
                    key={
                      item.productoId
                    }
                    style={{
                      display: "grid",
                      gridTemplateColumns:
                        "minmax(220px, 1.8fr) 90px 130px 130px 130px 76px",
                      gap: 10,
                      alignItems: "center",
                      padding: "12px 14px",
                      borderBottom:
                        "1px solid var(--border)",
                      minWidth: 780
                    }}
                  >
                    <div
                      style={{
                        minWidth: 0
                      }}
                    >
                      <strong
                        style={{
                          display: "block",
                          overflow: "hidden",
                          textOverflow:
                            "ellipsis",
                          whiteSpace:
                            "nowrap"
                        }}
                      >
                        {item.nombre}
                      </strong>

                      {item.codigo && (
                        <span
                          className="inv-subtle"
                          style={{
                            display: "block",
                            marginTop: 3,
                            fontSize: 10
                          }}
                        >
                          SKU: {item.codigo}
                        </span>
                      )}
                    </div>

                    <strong
                      style={{
                        textAlign: "center"
                      }}
                    >
                      {item.cantidad}
                    </strong>

                    <span
                      style={{
                        textAlign: "right",
                        whiteSpace:
                          "nowrap"
                      }}
                    >
                      {moneda(
                        item.costoCompra
                      )}
                    </span>

                    <span
                      style={{
                        textAlign: "right",
                        whiteSpace:
                          "nowrap"
                      }}
                    >
                      {moneda(
                        item.precioVenta
                      )}
                    </span>

                    <strong
                      style={{
                        textAlign: "right",
                        whiteSpace:
                          "nowrap"
                      }}
                    >
                      {moneda(
                        item.subtotal
                      )}
                    </strong>

                    <button
                      className="btn btn-small btn-danger"
                      onClick={() =>
                        quitarItem(
                          item.productoId
                        )
                      }
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>

              {/* TOTAL FIJO */}

              <div
                style={{
                  display: "flex",
                  justifyContent:
                    "space-between",
                  alignItems: "center",
                  gap: 16,
                  padding: "16px",
                  background:
                    superficieSuave,
                  borderTop:
                    "1px solid var(--border)",
                  flexWrap: "wrap"
                }}
              >
                <div>
                  <span
                    className="inv-subtle"
                    style={{
                      fontSize: 11
                    }}
                  >
                    Total de la factura
                  </span>

                  <div
                    style={{
                      marginTop: 3,
                      fontSize: 11,
                      color:
                        "var(--muted)"
                    }}
                  >
                    {items.length} referencia(s) • {totalUnidades} unidad(es)
                  </div>
                </div>

                <strong
                  style={{
                    fontSize: 28,
                    lineHeight: 1
                  }}
                >
                  {moneda(total)}
                </strong>
              </div>
            </>
          )}
        </div>

        <div
          className="card-footer"
          style={{
            justifyContent:
              "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 12
          }}
        >
          <div
            className="inv-subtle"
            style={{
              fontSize: 11
            }}
          >
            {items.length === 0
              ? "Agrega al menos un producto para registrar."
              : !facturaLista
                ? "Completa los datos obligatorios de la factura."
                : "Todo listo para registrar la entrada al inventario."}
          </div>

          <button
            className="btn btn-primary"
            onClick={
              guardarCompra
            }
            disabled={
              guardando ||
              items.length === 0 ||
              !facturaLista
            }
            style={{
              minWidth: 210,
              minHeight: 44,
              fontWeight: 800
            }}
          >
            {guardando
              ? "Registrando..."
              : `💾 Registrar factura · ${moneda(total)}`}
          </button>
        </div>
      </div>
    </div>
  );
}

/* =========================================================
   COMPONENTES VISUALES
========================================================= */

function PasoCompra({
  numero,
  titulo,
  detalle,
  completo
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 9,
        minWidth: 0,
        padding: "9px 10px",
        borderRadius: 11,
        border:
          completo
            ? "1px solid rgba(34,197,94,.30)"
            : "1px solid var(--border)",
        background:
          completo
            ? "rgba(34,197,94,.06)"
            : "rgba(255,255,255,.015)"
      }}
    >
      <span
        style={{
          width: 25,
          height: 25,
          flexShrink: 0,
          borderRadius: 999,
          display: "grid",
          placeItems: "center",
          background:
            completo
              ? "#22c55e"
              : "var(--border)",
          color:
            completo
              ? "#fff"
              : "var(--text)",
          fontSize: 11,
          fontWeight: 900
        }}
      >
        {completo
          ? "✓"
          : numero}
      </span>

      <div
        style={{
          minWidth: 0
        }}
      >
        <strong
          style={{
            display: "block",
            fontSize: 12
          }}
        >
          {titulo}
        </strong>

        <span
          className="inv-subtle"
          style={{
            display: "block",
            marginTop: 1,
            fontSize: 10,
            overflow: "hidden",
            textOverflow:
              "ellipsis",
            whiteSpace: "nowrap"
          }}
        >
          {detalle}
        </span>
      </div>
    </div>
  );
}

function MiniCompra({
  titulo,
  valor,
  destacado = false
}) {
  return (
    <div
      style={{
        minWidth: 96,
        padding: "8px 10px",
        borderRadius: 10,
        border:
          destacado
            ? "1px solid rgba(34,197,94,.28)"
            : "1px solid var(--border)",
        background:
          destacado
            ? "rgba(34,197,94,.06)"
            : "rgba(255,255,255,.018)"
      }}
    >
      <div
        className="inv-subtle"
        style={{
          fontSize: 9,
          marginBottom: 3
        }}
      >
        {titulo}
      </div>

      <strong
        style={{
          fontSize: 12,
          color:
            destacado
              ? "#22c55e"
              : "var(--text)"
        }}
      >
        {valor}
      </strong>
    </div>
  );
}
