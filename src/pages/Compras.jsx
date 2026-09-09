// src/pages/Compras.jsx

import {
  useEffect,
  useMemo,
  useState
} from "react";

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
    document.documentElement.setAttribute(
      "data-theme",
      theme
    );

    localStorage.setItem(
      "theme",
      theme
    );
  }, [theme]);

  const toggle = () =>
    setTheme(t =>
      t === "dark"
        ? "light"
        : "dark"
    );

  return {
    theme,
    toggle
  };
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
    .replace(/^-+|-+$/g, "") ||
  "proveedor";

const hoyISO = () => {
  const d =
    new Date();

  const y =
    d.getFullYear();

  const m =
    String(
      d.getMonth() + 1
    ).padStart(
      2,
      "0"
    );

  const dia =
    String(
      d.getDate()
    ).padStart(
      2,
      "0"
    );

  return `${y}-${m}-${dia}`;
};

/* =========================================================
   COMPONENTE
========================================================= */

export default function Compras() {
  /*
   * Ahora también obtenemos user para guardar
   * quién registró la compra y cada movimiento.
   */
  const {
    empresa,
    user
  } = useTenant();

  const {
    theme,
    toggle
  } = useTheme();

  /* =======================================================
     PRODUCTOS
  ======================================================= */

  const [
    productos,
    setProductos
  ] = useState([]);

  const [
    cargandoProductos,
    setCargandoProductos
  ] = useState(true);

  /* =======================================================
     FACTURA
  ======================================================= */

  const [
    factura,
    setFactura
  ] = useState({
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

  const [
    productoId,
    setProductoId
  ] = useState("");

  const [
    busqueda,
    setBusqueda
  ] = useState("");

  const [
    linea,
    setLinea
  ] = useState({
    cantidad: 1,
    costoCompra: "",
    gananciaObjetivo: 30,
    gananciaMinima: 10,
    precioVenta: ""
  });

  /* =======================================================
     ITEMS / ESTADO
  ======================================================= */

  const [
    items,
    setItems
  ] = useState([]);

  const [
    guardando,
    setGuardando
  ] = useState(false);

  const [
    error,
    setError
  ] = useState("");

  const [
    exito,
    setExito
  ] = useState("");

  /* =======================================================
     CARGAR PRODUCTOS
  ======================================================= */

  useEffect(() => {
    (async () => {
      if (!empresa?.id) {
        return;
      }

      try {
        setCargandoProductos(
          true
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
          snap.docs.map(
            d => ({
              id: d.id,
              ...d.data()
            })
          )
        );

      } catch (e) {
        console.error(e);

        setError(
          "No se pudieron cargar los productos."
        );

      } finally {
        setCargandoProductos(
          false
        );
      }
    })();
  }, [
    empresa?.id
  ]);

  /* =======================================================
     PRODUCTO ACTUAL
  ======================================================= */

  const productoActual =
    useMemo(
      () =>
        productos.find(
          p =>
            p.id ===
              productoId &&
            p.activo !== false
        ) || null,
      [
        productos,
        productoId
      ]
    );

  /* =======================================================
     FILTRAR PRODUCTOS
  ======================================================= */

  const productosFiltrados =
    useMemo(() => {
      const q =
        busqueda
          .trim()
          .toLowerCase();

      const activos =
        productos.filter(
          p =>
            p.activo !== false
        );

      if (!q) {
        return activos;
      }

      return activos.filter(
        p =>
          `${p.nombre || ""} ${
            p.categoriaNombre || ""
          }`
            .toLowerCase()
            .includes(q)
      );

    }, [
      productos,
      busqueda
    ]);

  /* =======================================================
     SIMULACIÓN
  ======================================================= */

  const simulacion =
    useMemo(() => {
      if (
        !productoActual
      ) {
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
        Number(
          productoActual.cantidad ||
          0
        );

      const costoAnterior =
        Number(
          productoActual.costoPromedio ??
          productoActual.costoUnitario ??
          0
        );

      const cantidadNueva =
        numero(
          linea.cantidad
        );

      const costoCompra =
        numero(
          linea.costoCompra
        );

      const nuevoStock =
        stockActual +
        cantidadNueva;

      const valorAnterior =
        stockActual *
        costoAnterior;

      const valorCompra =
        cantidadNueva *
        costoCompra;

      const costoPromedio =
        nuevoStock > 0
          ? (
              valorAnterior +
              valorCompra
            ) /
            nuevoStock
          : costoCompra;

      const gananciaObjetivo =
        numero(
          linea.gananciaObjetivo
        ) /
        100;

      const gananciaMinima =
        numero(
          linea.gananciaMinima
        ) /
        100;

      const precioSugerido =
        costoPromedio *
        (
          1 +
          gananciaObjetivo
        );

      const precioMinimo =
        costoPromedio *
        (
          1 +
          gananciaMinima
        );

      return {
        stockActual,
        costoAnterior,
        nuevoStock,
        costoPromedio,
        precioSugerido,
        precioMinimo
      };

    }, [
      productoActual,
      linea
    ]);

  /* =======================================================
     CARGAR COSTO AL SELECCIONAR
  ======================================================= */

  useEffect(() => {
    if (
      !productoActual
    ) {
      return;
    }

    if (
      !linea.costoCompra
    ) {
      setLinea(
        prev => ({
          ...prev,

          costoCompra:
            productoActual.costoPromedio ??
            productoActual.costoUnitario ??
            ""
        })
      );
    }

  }, [
    productoActual
  ]);

  /* =======================================================
     PRECIO SUGERIDO
  ======================================================= */

  useEffect(() => {
    if (
      !productoActual
    ) {
      return;
    }

    if (
      simulacion.precioSugerido <=
      0
    ) {
      return;
    }

    setLinea(
      prev => ({
        ...prev,

        precioVenta:
          Math.round(
            simulacion.precioSugerido
          )
      })
    );

  }, [
    productoActual?.id,
    linea.costoCompra,
    linea.cantidad,
    linea.gananciaObjetivo
  ]);

  /* =======================================================
     SELECCIONAR PRODUCTO
  ======================================================= */

  const seleccionarProducto =
    id => {
      const p =
        productos.find(
          x =>
            x.id === id &&
            x.activo !== false
        );

      if (!p) {
        setProductoId(
          ""
        );

        return setError(
          "Este producto está inactivo y no puede agregarse a compras."
        );
      }

      setProductoId(
        id
      );

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

  const agregarProducto =
    () => {
      setError("");

      if (
        !productoActual
      ) {
        return setError(
          "Selecciona un producto."
        );
      }

      if (
        productoActual.activo ===
        false
      ) {
        return setError(
          "Este producto está inactivo y no puede agregarse a compras."
        );
      }

      const cantidad =
        numero(
          linea.cantidad
        );

      const costoCompra =
        numero(
          linea.costoCompra
        );

      const precioVenta =
        numero(
          linea.precioVenta
        );

      if (
        !Number.isInteger(
          cantidad
        ) ||
        cantidad <= 0
      ) {
        return setError(
          "La cantidad comprada debe ser un número entero mayor que cero."
        );
      }

      if (
        costoCompra <= 0
      ) {
        return setError(
          "Ingresa el costo de compra."
        );
      }

      if (
        numero(
          linea.gananciaMinima
        ) < 0
      ) {
        return setError(
          "La ganancia mínima no puede ser negativa."
        );
      }

      if (
        numero(
          linea.gananciaObjetivo
        ) <
        numero(
          linea.gananciaMinima
        )
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
          i =>
            i.productoId ===
            productoActual.id
        )
      ) {
        return setError(
          "Este producto ya fue agregado a la factura."
        );
      }

      setItems(
        prev => [
          ...prev,

          {
            productoId:
              productoActual.id,

            nombre:
              productoActual.nombre,

            cantidad,

            costoCompra,

            subtotal:
              cantidad *
              costoCompra,

            gananciaObjetivo:
              numero(
                linea.gananciaObjetivo
              ),

            gananciaMinima:
              numero(
                linea.gananciaMinima
              ),

            precioVenta:
              Math.round(
                precioVenta
              )
          }
        ]
      );

      setProductoId(
        ""
      );

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

  const quitarItem =
    id => {
      setItems(
        prev =>
          prev.filter(
            i =>
              i.productoId !==
              id
          )
      );
    };

  /* =======================================================
     TOTAL
  ======================================================= */

  const total =
    useMemo(
      () =>
        items.reduce(
          (
            acc,
            item
          ) =>
            acc +
            Number(
              item.subtotal ||
              0
            ),
          0
        ),
      [
        items
      ]
    );

  /* =======================================================
     GUARDAR COMPRA
  ======================================================= */

  const guardarCompra =
    async () => {
      try {
        setError("");
        setExito("");

        if (
          !empresa?.id
        ) {
          return setError(
            "No hay empresa activa."
          );
        }

        if (
          !factura.numeroFactura
            .trim()
        ) {
          return setError(
            "Ingresa el número de la factura."
          );
        }

        if (
          !factura.proveedorNombre
            .trim()
        ) {
          return setError(
            "Ingresa el nombre del proveedor."
          );
        }

        if (
          !factura.fecha
        ) {
          return setError(
            "Selecciona la fecha de la factura."
          );
        }

        if (
          items.length ===
          0
        ) {
          return setError(
            "Agrega al menos un producto."
          );
        }

        if (
          factura.tipoPago ===
            "CREDITO" &&
          !factura.fechaVencimiento
        ) {
          return setError(
            "Una factura a crédito debe tener fecha de vencimiento."
          );
        }

        if (
          total <= 0
        ) {
          return setError(
            "El total de la compra debe ser mayor que cero."
          );
        }

        setGuardando(
          true
        );

        /* ---------------------------------------------
           PROVEEDOR
        --------------------------------------------- */

        const proveedorId =
          factura.proveedorDocumento
            .trim() ||
          slug(
            factura.proveedorNombre
          );

        /* ---------------------------------------------
           REFERENCIAS
        --------------------------------------------- */

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
          factura.tipoPago ===
          "CREDITO"
            ? doc(
                collection(
                  db,
                  "empresas",
                  empresa.id,
                  "cuentasPorPagar"
                )
              )
            : null;

        /* =================================================
           TRANSACCIÓN
        ================================================= */

        await runTransaction(
          db,
          async transaction => {

            /*
             * PRIMERO HACEMOS TODAS LAS LECTURAS.
             *
             * Esto es importante para mantener
             * la transacción atómica.
             */

            const lecturas =
              [];

            for (
              const item
              of items
            ) {
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

              if (
                !snap.exists()
              ) {
                throw new Error(
                  `El producto ${item.nombre} ya no existe.`
                );
              }

              if (
                snap.data()
                  .activo ===
                false
              ) {
                throw new Error(
                  `"${item.nombre}" está inactivo y no puede comprarse.`
                );
              }

              lecturas.push({
                item,
                productoRef,
                producto:
                  snap.data()
              });
            }

            /* -----------------------------------------
               PROCESAR PRODUCTOS
            ----------------------------------------- */

            const itemsCompra =
              [];

            for (
              const {
                item,
                productoRef,
                producto
              }
              of lecturas
            ) {

              /*
               * STOCK REAL JUSTO ANTES
               * DE LA COMPRA.
               */
              const stockAnterior =
                Number(
                  producto.cantidad ||
                  0
                );

              const costoAnterior =
                Number(
                  producto.costoPromedio ??
                  producto.costoUnitario ??
                  0
                );

              /*
               * Una compra representa una
               * ENTRADA de inventario.
               */
              const diferencia =
                Number(
                  item.cantidad ||
                  0
                );

              const stockNuevo =
                stockAnterior +
                diferencia;

              /* ---------------------------------------
                 COSTO PROMEDIO
              --------------------------------------- */

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

              /* ---------------------------------------
                 PRECIOS
              --------------------------------------- */

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

              /* ---------------------------------------
                 ACTUALIZAR PRODUCTO
              --------------------------------------- */

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

              /* =======================================
                 KARDEX
              ======================================= */

              const movimientoRef =
                doc(
                  collection(
                    db,
                    "empresas",
                    empresa.id,
                    "movimientos"
                  )
                );

              /*
               * cantidad:
               * sigue siendo POSITIVA para mantener
               * compatibilidad con el sistema.
               *
               * diferencia:
               * también es POSITIVA porque la compra
               * aumenta el inventario.
               */
              transaction.set(
                movimientoRef,
                {
                  tipo:
                    "COMPRA",

                  productoId:
                    item.productoId,

                  productoNombre:
                    item.nombre,

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
                    factura.numeroFactura
                      .trim(),

                  proveedorId,

                  proveedorNombre:
                    factura.proveedorNombre
                      .trim(),

                  proveedorDocumento:
                    factura.proveedorDocumento
                      .trim() ||
                    null,

                  usuarioId:
                    user?.uid ||
                    null,

                  usuarioEmail:
                    user?.email ||
                    null,

                  fecha:
                    serverTimestamp()
                }
              );

              /* ---------------------------------------
                 ITEM DE LA COMPRA
              --------------------------------------- */

              itemsCompra.push({
                productoId:
                  item.productoId,

                nombre:
                  item.nombre,

                cantidad:
                  item.cantidad,

                costoUnitario:
                  item.costoCompra,

                subtotal:
                  item.cantidad *
                  item.costoCompra,

                /*
                 * También dejamos aquí la trazabilidad
                 * del inventario para que el documento
                 * de compra pueda mostrarla en el futuro.
                 */
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

            /* -----------------------------------------
               PROVEEDOR
            ----------------------------------------- */

            transaction.set(
              proveedorRef,
              {
                nombre:
                  factura.proveedorNombre
                    .trim(),

                nombreLower:
                  factura.proveedorNombre
                    .trim()
                    .toLowerCase(),

                documento:
                  factura.proveedorDocumento
                    .trim() ||
                  null,

                updatedAt:
                  serverTimestamp()
              },
              {
                merge: true
              }
            );

            const esCredito =
              factura.tipoPago ===
              "CREDITO";

            /* =========================================
               COMPRA
            ========================================= */

            transaction.set(
              compraRef,
              {
                numeroFactura:
                  factura.numeroFactura
                    .trim(),

                proveedorId,

                proveedorNombre:
                  factura.proveedorNombre
                    .trim(),

                proveedorDocumento:
                  factura.proveedorDocumento
                    .trim() ||
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

                /*
                 * Auditoría de quién registró
                 * la compra.
                 */
                usuarioId:
                  user?.uid ||
                  null,

                usuarioEmail:
                  user?.email ||
                  null,

                createdAt:
                  serverTimestamp()
              }
            );

            /* =========================================
               CUENTA POR PAGAR
            ========================================= */

            if (
              esCredito
            ) {
              transaction.set(
                cuentaRef,
                {
                  compraId:
                    compraRef.id,

                  numeroFactura:
                    factura.numeroFactura
                      .trim(),

                  proveedorId,

                  proveedorNombre:
                    factura.proveedorNombre
                      .trim(),

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

        /* =================================================
           LIMPIAR FORMULARIO
        ================================================= */

        setFactura({
          numeroFactura: "",
          fecha: hoyISO(),
          proveedorNombre: "",
          proveedorDocumento: "",
          tipoPago: "CONTADO",
          fechaVencimiento: ""
        });

        setItems(
          []
        );

        setProductoId(
          ""
        );

        setBusqueda(
          ""
        );

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

        /* =================================================
           RECARGAR PRODUCTOS
        ================================================= */

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
          snap.docs.map(
            d => ({
              id: d.id,
              ...d.data()
            })
          )
        );

      } catch (e) {
        console.error(e);

        setError(
          e?.message ||
          "No se pudo registrar la compra."
        );

      } finally {
        setGuardando(
          false
        );
      }
    };

  /* =========================================================
     RENDER
  ========================================================= */

  return (
    <div className="inv-root">

      {/* =====================================================
          HEADER
      ===================================================== */}

      <header className="inv-header">

        <div>

          <h1>
            🛒 Registrar compra
          </h1>

          <p className="inv-subtle">
            Ingresa una factura de proveedor y actualiza el inventario automáticamente.
          </p>

        </div>

        <div className="header-actions">

          <button
            className="btn theme-toggle"
            onClick={
              toggle
            }
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

      {/* =====================================================
          GRID
      ===================================================== */}

      <section className="inv-grid">

        {/* =================================================
            FACTURA
        ================================================= */}

        <div className="card">

          <div className="card-header">

            <h2>
              Factura de proveedor
            </h2>

          </div>

          <div className="card-body">

            <div className="form-grid">

              <div className="form-field">

                <label>
                  Número de factura *
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
                />

              </div>

              <div className="form-field">

                <label>
                  Fecha *
                </label>

                <input
                  type="date"
                  value={
                    factura.fecha
                  }
                  onChange={e =>
                    setFactura({
                      ...factura,

                      fecha:
                        e.target.value
                    })
                  }
                />

              </div>

              <div className="form-field">

                <label>
                  Proveedor *
                </label>

                <input
                  value={
                    factura.proveedorNombre
                  }
                  placeholder="Nombre del proveedor"
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
                    Contado
                  </option>

                  <option value="CREDITO">
                    Crédito
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

          </div>

        </div>

        {/* =================================================
            PRODUCTOS
        ================================================= */}

        <div className="card">

          <div className="card-header">

            <h2>
              Agregar productos
            </h2>

          </div>

          <div className="card-body">

            <div className="form-field">

              <label>
                Buscar producto
              </label>

              <input
                placeholder="🔎 Buscar por nombre o categoría..."
                value={
                  busqueda
                }
                onChange={e =>
                  setBusqueda(
                    e.target.value
                  )
                }
              />

            </div>

            <div className="form-field">

              <label>
                Producto *
              </label>

              <select
                value={
                  productoId
                }
                onChange={e =>
                  seleccionarProducto(
                    e.target.value
                  )
                }
                disabled={
                  cargandoProductos
                }
              >

                <option value="">
                  Selecciona…
                </option>

                {productosFiltrados.map(
                  p => (

                    <option
                      key={
                        p.id
                      }
                      value={
                        p.id
                      }
                    >
                      {p.nombre} — Stock:{" "}
                      {p.cantidad}
                    </option>

                  )
                )}

              </select>

            </div>

            {productoActual && (

              <>

                {/* PRODUCTO ACTUAL */}

                <div
                  style={{
                    padding: 14,
                    border:
                      "1px solid var(--border)",
                    borderRadius: 14,
                    marginTop: 12,
                    marginBottom: 14
                  }}
                >

                  <strong>
                    {
                      productoActual.nombre
                    }
                  </strong>

                  <div
                    className="product-meta"
                    style={{
                      marginTop: 8
                    }}
                  >

                    <span>
                      Stock actual:{" "}

                      <b>
                        {
                          simulacion.stockActual
                        }
                      </b>
                    </span>

                    <span>
                      Costo actual:{" "}

                      <b>
                        {moneda(
                          simulacion.costoAnterior
                        )}
                      </b>
                    </span>

                  </div>

                </div>

                {/* FORMULARIO */}

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

                  </div>

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

                  <div className="form-field">

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
                    />

                  </div>

                </div>

                {/* SIMULACIÓN */}

                <div
                  style={{
                    marginTop: 14,
                    padding: 16,
                    borderRadius: 16,
                    border:
                      "1px solid var(--border)",
                    background:
                      "rgba(255,255,255,.025)"
                  }}
                >

                  <div className="product-meta">

                    <span>
                      Nuevo stock:{" "}

                      <b>
                        {
                          simulacion.nuevoStock
                        }
                      </b>
                    </span>

                    <span>
                      Costo promedio:{" "}

                      <b>
                        {moneda(
                          simulacion.costoPromedio
                        )}
                      </b>
                    </span>

                    <span>
                      Precio sugerido:{" "}

                      <b>
                        {moneda(
                          simulacion.precioSugerido
                        )}
                      </b>
                    </span>

                    <span>
                      Precio mínimo:{" "}

                      <b>
                        {moneda(
                          simulacion.precioMinimo
                        )}
                      </b>
                    </span>

                  </div>

                </div>

                <button
                  className="btn btn-primary"
                  style={{
                    marginTop: 14
                  }}
                  onClick={
                    agregarProducto
                  }
                >
                  ➕ Agregar a factura
                </button>

              </>

            )}

          </div>

        </div>

      </section>

      {/* =====================================================
          DETALLE COMPRA
      ===================================================== */}

      <div
        className="card"
        style={{
          marginTop: 18
        }}
      >

        <div className="card-header">

          <h2>
            Detalle de la compra
          </h2>

        </div>

        <div className="card-body">

          {items.length ===
          0 ? (

            <p className="inv-subtle">
              Todavía no has agregado productos.
            </p>

          ) : (

            <ul className="product-list">

              {items.map(
                item => (

                  <li
                    className="product-item"
                    key={
                      item.productoId
                    }
                  >

                    <div className="product-info">

                      <strong>
                        {item.nombre}
                      </strong>

                      <div className="product-meta">

                        <span>
                          Cantidad:{" "}

                          <b>
                            {
                              item.cantidad
                            }
                          </b>
                        </span>

                        <span>
                          Costo:{" "}

                          <b>
                            {moneda(
                              item.costoCompra
                            )}
                          </b>
                        </span>

                        <span>
                          Venta:{" "}

                          <b>
                            {moneda(
                              item.precioVenta
                            )}
                          </b>
                        </span>

                        <span>
                          Subtotal:{" "}

                          <b>
                            {moneda(
                              item.subtotal
                            )}
                          </b>
                        </span>

                      </div>

                    </div>

                    <div className="product-actions">

                      <button
                        className="btn btn-small btn-danger"
                        onClick={() =>
                          quitarItem(
                            item.productoId
                          )
                        }
                      >
                        Quitar
                      </button>

                    </div>

                  </li>

                )
              )}

            </ul>

          )}

          {/* TOTAL */}

          <div
            style={{
              marginTop: 18,
              paddingTop: 16,
              borderTop:
                "1px solid var(--border)",
              display: "flex",
              justifyContent:
                "space-between",
              alignItems:
                "center"
            }}
          >

            <strong>
              Total factura
            </strong>

            <h2
              style={{
                margin: 0
              }}
            >
              {moneda(
                total
              )}
            </h2>

          </div>

        </div>

        <div className="card-footer">

          <button
            className="btn btn-primary"
            onClick={
              guardarCompra
            }
            disabled={
              guardando ||
              items.length === 0
            }
          >
            {guardando
              ? "Registrando..."
              : "💾 Registrar factura"}
          </button>

        </div>

      </div>

      {/* =====================================================
          ERROR
      ===================================================== */}

      {error && (

        <div
          className="toast toast-error"
          style={{
            position: "static",
            marginTop: 16
          }}
        >
          {error}
        </div>

      )}

      {/* =====================================================
          ÉXITO
      ===================================================== */}

      {exito && (

        <div
          className="card"
          style={{
            marginTop: 16,
            padding: 16,
            border:
              "1px solid #22c55e"
          }}
        >
          ✅ {exito}
        </div>

      )}

    </div>
  );
}