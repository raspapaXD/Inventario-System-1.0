// src/pages/Ventas.jsx

import { useEffect, useMemo, useRef, useState } from "react";
import { db } from "../../firebaseClient.js";

import {
  collection,
  getDocs,
  doc,
  serverTimestamp,
  runTransaction
} from "firebase/firestore";

import { useNavigate, Link } from "react-router-dom";
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

const norm = s =>
  (s || "")
    .toString()
    .trim();

const slug = s =>
  norm(s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") ||
  "sin-id";

const formatMoney = value =>
  `$${Number(value || 0).toLocaleString("es-CO", {
    maximumFractionDigits: 0
  })}`;

const limpiarNumero = value =>
  String(value ?? "")
    .replace(/[^0-9]/g, "");

const numeroDesdeInput = value => {
  const limpio = limpiarNumero(value);

  return limpio
    ? Number(limpio)
    : 0;
};

const formatearNumeroInput = value => {
  const limpio = limpiarNumero(value);

  if (!limpio) {
    return "";
  }

  return Number(limpio).toLocaleString("es-CO");
};

/* =========================================================
   PRECIO MÍNIMO
========================================================= */

function obtenerPrecioMinimo(producto) {
  const minimoGuardado =
    Number(producto?.precioMinimo);

  if (
    Number.isFinite(minimoGuardado) &&
    minimoGuardado > 0
  ) {
    return Math.round(minimoGuardado);
  }

  const costo =
    Number(
      producto?.costoPromedio ??
      producto?.costoUnitario ??
      0
    );

  const porcentajeMinimo =
    Number(
      producto?.porcentajeGananciaMinima
    );

  if (
    Number.isFinite(costo) &&
    costo > 0 &&
    Number.isFinite(porcentajeMinimo) &&
    porcentajeMinimo >= 0
  ) {
    return Math.round(
      costo *
      (
        1 +
        porcentajeMinimo / 100
      )
    );
  }

  return Math.round(
    Number(
      producto?.precioUnitario ||
      0
    )
  );
}

/* =========================================================
   INFORMACIÓN DE STOCK
========================================================= */

function stockInfo(producto) {
  const cantidad =
    Number(producto?.cantidad || 0);

  const minimo =
    Number(producto?.minimo || 0);

  if (cantidad <= 0) {
    return {
      label: "Sin stock",
      icon: "🔴",
      color: "#ef4444"
    };
  }

  if (
    cantidad <= minimo ||
    cantidad <= 2
  ) {
    return {
      label: "Stock bajo",
      icon: "🟡",
      color: "#f59e0b"
    };
  }

  return {
    label: "Disponible",
    icon: "🟢",
    color: "#22c55e"
  };
}

/* =========================================================
   COMPONENTE
========================================================= */

export default function Ventas() {
  const {
    theme,
    toggle
  } = useTheme();

  const navigate =
    useNavigate();

  /*
   * Ahora también obtenemos "user"
   * para dejar trazabilidad de quién
   * realizó la venta.
   */
  const {
    empresa,
    user
  } = useTenant();

  const cantidadRef =
    useRef(null);

  /* =======================================================
     ESTADOS
  ======================================================= */

  const [
    productos,
    setProductos
  ] = useState([]);

  const [
    cliente,
    setCliente
  ] = useState({
    nombre: "",
    documento: ""
  });

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
  ] = useState(null);

  const [
    productoSeleccionado,
    setProductoSeleccionado
  ] = useState(null);

  const [
    cantidad,
    setCantidad
  ] = useState(1);

  const [
    precioVenta,
    setPrecioVenta
  ] = useState("");

  const [
    modalProductos,
    setModalProductos
  ] = useState(false);

  const [
    qModal,
    setQModal
  ] = useState("");

  const [
    recientes,
    setRecientes
  ] = useState([]);

  /* =======================================================
     FORMA DE PAGO / CARTERA
  ======================================================= */

  const [
    tipoPago,
    setTipoPago
  ] = useState("CONTADO");

  const [
    fechaVencimiento,
    setFechaVencimiento
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
          "No fue posible cargar los productos."
        );
      }
    })();
  }, [empresa?.id]);

  /* =======================================================
     PRODUCTOS MODAL
  ======================================================= */

  const productosModal =
    useMemo(() => {
      const q =
        qModal
          .trim()
          .toLowerCase();

      const activos =
        productos.filter(
          p =>
            p.activo !== false
        );

      const lista =
        !q
          ? [...activos]
          : activos.filter(p =>
              `${p.nombre || ""} ${
                p.categoriaNombre || ""
              }`
                .toLowerCase()
                .includes(q)
            );

      return lista.sort(
        (a, b) =>
          (a.nombre || "")
            .localeCompare(
              b.nombre || ""
            )
      );

    }, [
      qModal,
      productos
    ]);

  /* =======================================================
     RECIENTES
  ======================================================= */

  const productosRecientes =
    useMemo(() => {
      return recientes
        .map(id =>
          productos.find(
            p => p.id === id
          )
        )
        .filter(
          p =>
            p &&
            p.activo !== false
        )
        .slice(0, 5);

    }, [
      recientes,
      productos
    ]);

  /* =======================================================
     INFORMACIÓN DE PRECIO
  ======================================================= */

  const precioNormalActual =
    Number(
      productoSeleccionado?.precioUnitario ||
      0
    );

  const precioMinimoActual =
    productoSeleccionado
      ? obtenerPrecioMinimo(
          productoSeleccionado
        )
      : 0;

  const precioVentaActual =
    numeroDesdeInput(
      precioVenta
    );

  const descuentoUnitarioActual =
    Math.max(
      0,
      precioNormalActual -
      precioVentaActual
    );

  const descuentoPorcentajeActual =
    precioNormalActual > 0 &&
    precioVentaActual <
      precioNormalActual
      ? (
          descuentoUnitarioActual /
          precioNormalActual
        ) * 100
      : 0;

  const precioInvalido =
    !!productoSeleccionado &&
    precioVentaActual <
      precioMinimoActual;

  /* =======================================================
     SUBTOTAL
  ======================================================= */

  const subtotalActual =
    useMemo(() => {
      if (
        !productoSeleccionado
      ) {
        return 0;
      }

      return (
        numeroDesdeInput(
          precioVenta
        ) *
        Number(
          cantidad || 0
        )
      );

    }, [
      productoSeleccionado,
      precioVenta,
      cantidad
    ]);

  /* =======================================================
     TOTAL VENTA
  ======================================================= */

  const total =
    useMemo(
      () =>
        items.reduce(
          (acc, it) =>
            acc +
            Number(
              it.precioUnitario || 0
            ) *
            Number(
              it.cantidad || 0
            ),
          0
        ),
      [items]
    );

  /* =======================================================
     DESCUENTO TOTAL
  ======================================================= */

  const descuentoTotal =
    useMemo(
      () =>
        items.reduce(
          (acc, it) => {
            const precioLista =
              Number(
                it.precioLista ||
                it.precioUnitario ||
                0
              );

            const precioReal =
              Number(
                it.precioUnitario ||
                0
              );

            const descuento =
              Math.max(
                0,
                precioLista -
                precioReal
              );

            return (
              acc +
              descuento *
              Number(
                it.cantidad || 0
              )
            );
          },
          0
        ),
      [items]
    );

  /* =======================================================
     SELECCIONAR PRODUCTO
  ======================================================= */

  const seleccionarProducto =
    producto => {
      if (
        !producto ||
        producto.activo === false
      ) {
        setProductoSeleccionado(
          null
        );

        return setError(
          "Este producto está inactivo y no puede venderse."
        );
      }

      setProductoSeleccionado(
        producto
      );

      setCantidad(1);

      setPrecioVenta(
        formatearNumeroInput(
          Math.round(
            Number(
              producto.precioUnitario ||
              0
            )
          )
        )
      );

      setModalProductos(false);
      setQModal("");
      setError(null);

      setRecientes(prev => {
        const limpio =
          prev.filter(
            id =>
              id !==
              producto.id
          );

        return [
          producto.id,
          ...limpio
        ].slice(0, 6);
      });

      setTimeout(
        () =>
          cantidadRef
            .current
            ?.focus(),
        80
      );
    };

  /* =======================================================
     AGREGAR AL CARRITO
  ======================================================= */

  const agregarItem = () => {
    setError(null);

    if (
      !productoSeleccionado
    ) {
      return setError(
        "Selecciona un producto."
      );
    }

    if (
      productoSeleccionado.activo ===
      false
    ) {
      return setError(
        "Este producto está inactivo y no puede venderse."
      );
    }

    const cantidadNueva =
      Number(cantidad || 0);

    if (
      !Number.isInteger(
        cantidadNueva
      ) ||
      cantidadNueva <= 0
    ) {
      return setError(
        "La cantidad debe ser un número entero mayor que cero."
      );
    }

    const stockDisponible =
      Number(
        productoSeleccionado
          .cantidad || 0
      );

    const precioNormal =
      Number(
        productoSeleccionado
          .precioUnitario || 0
      );

    const precioMinimo =
      obtenerPrecioMinimo(
        productoSeleccionado
      );

    const precioReal =
      numeroDesdeInput(
        precioVenta
      );

    if (
      !Number.isFinite(
        precioReal
      ) ||
      precioReal <= 0
    ) {
      return setError(
        "Ingresa un precio de venta válido."
      );
    }

    if (
      precioReal <
      precioMinimo
    ) {
      return setError(
        `El precio mínimo permitido para "${productoSeleccionado.nombre}" es ${formatMoney(
          precioMinimo
        )}.`
      );
    }

    const costoUnitario =
      Number(
        productoSeleccionado
          .costoPromedio ??
        productoSeleccionado
          .costoUnitario ??
        0
      );

    if (
      !Number.isFinite(
        costoUnitario
      ) ||
      costoUnitario < 0
    ) {
      return setError(
        `El producto "${productoSeleccionado.nombre}" no tiene un costo válido.`
      );
    }

    const ya =
      items.findIndex(
        i =>
          i.productoId ===
          productoSeleccionado.id
      );

    const cantidadEnCarrito =
      ya >= 0
        ? Number(
            items[ya]
              .cantidad || 0
          )
        : 0;

    const cantidadFinal =
      cantidadEnCarrito +
      cantidadNueva;

    if (
      cantidadFinal >
      stockDisponible
    ) {
      return setError(
        `No hay suficiente stock. Disponible: ${stockDisponible}.`
      );
    }

    const descuentoUnitario =
      Math.max(
        0,
        precioNormal -
        precioReal
      );

    const descuentoPorcentaje =
      precioNormal > 0
        ? (
            descuentoUnitario /
            precioNormal
          ) * 100
        : 0;

    const base = {
      productoId:
        productoSeleccionado.id,

      nombre:
        productoSeleccionado
          .nombre,

      cantidad:
        cantidadNueva,

      precioLista:
        precioNormal,

      precioUnitario:
        precioReal,

      precioMinimo,

      costoUnitario,

      descuentoUnitario,

      descuentoPorcentaje
    };

    if (ya >= 0) {
      const nuevos =
        [...items];

      nuevos[ya] = {
        ...nuevos[ya],

        cantidad:
          cantidadFinal,

        precioLista:
          precioNormal,

        precioUnitario:
          precioReal,

        precioMinimo,

        costoUnitario,

        descuentoUnitario,

        descuentoPorcentaje
      };

      setItems(nuevos);

    } else {
      setItems([
        ...items,
        base
      ]);
    }

    setProductoSeleccionado(
      null
    );

    setPrecioVenta("");

    setCantidad(1);
  };

  /* =======================================================
     QUITAR ITEM
  ======================================================= */

  const quitarItem =
    id => {
      setItems(
        items.filter(
          i =>
            i.productoId !== id
        )
      );
    };

  /* =======================================================
     FORMA DE PAGO
  ======================================================= */

  const seleccionarTipoPago =
    tipo => {
      setTipoPago(tipo);
      setError(null);

      if (
        tipo === "CONTADO"
      ) {
        setFechaVencimiento(
          ""
        );
      }
    };

  /* =======================================================
     REGISTRAR VENTA
  ======================================================= */

  const registrarVenta =
    async () => {
      if (guardando) {
        return;
      }

      try {
        if (!empresa?.id) {
          return;
        }

        setError(null);

        /* ---------------------------------------------
           VALIDACIONES GENERALES
        --------------------------------------------- */

        if (
          items.length === 0
        ) {
          return setError(
            "Agrega al menos un producto."
          );
        }

        if (
          total <= 0
        ) {
          return setError(
            "El total de la venta debe ser mayor que cero."
          );
        }

        /* ---------------------------------------------
           CRÉDITO
        --------------------------------------------- */

        if (
          tipoPago ===
          "CREDITO"
        ) {
          if (
            !norm(
              cliente.nombre
            )
          ) {
            return setError(
              "Para una venta a crédito debes ingresar el nombre del cliente."
            );
          }

          if (
            !norm(
              cliente.documento
            )
          ) {
            return setError(
              "Para una venta a crédito debes ingresar el documento o NIT del cliente."
            );
          }

          if (
            !fechaVencimiento
          ) {
            return setError(
              "Selecciona la fecha de vencimiento de la venta a crédito."
            );
          }

          const hoy =
            new Date();

          hoy.setHours(
            0,
            0,
            0,
            0
          );

          const vencimiento =
            new Date(
              `${fechaVencimiento}T00:00:00`
            );

          if (
            Number.isNaN(
              vencimiento.getTime()
            )
          ) {
            return setError(
              "La fecha de vencimiento no es válida."
            );
          }

          if (
            vencimiento <
            hoy
          ) {
            return setError(
              "La fecha de vencimiento no puede estar en el pasado."
            );
          }
        }

        setGuardando(true);

        /* ---------------------------------------------
           CLIENTE
        --------------------------------------------- */

        const nombreCliente =
          norm(
            cliente.nombre
          ) ||
          "Consumidor final";

        const documentoCliente =
          norm(
            cliente.documento
          );

        const clienteId =
          documentoCliente ||
          slug(
            nombreCliente
          );

        /* ---------------------------------------------
           REFERENCIAS
        --------------------------------------------- */

        const clienteRef =
          doc(
            db,
            "empresas",
            empresa.id,
            "clientes",
            clienteId
          );

        const ventaRef =
          doc(
            collection(
              db,
              "empresas",
              empresa.id,
              "ventas"
            )
          );

        const cuentaCobrarRef =
          tipoPago ===
          "CREDITO"
            ? doc(
                collection(
                  db,
                  "empresas",
                  empresa.id,
                  "cuentasPorCobrar"
                )
              )
            : null;

        /* ---------------------------------------------
           TRANSACCIÓN
        --------------------------------------------- */

        await runTransaction(
          db,
          async transaction => {

            /*
             * Todas las lecturas se hacen primero.
             */

            const productosActuales =
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

              const productoSnap =
                await transaction.get(
                  productoRef
                );

              if (
                !productoSnap.exists()
              ) {
                throw new Error(
                  `El producto "${item.nombre}" ya no existe.`
                );
              }

              productosActuales.push({
                item,
                ref:
                  productoRef,
                data:
                  productoSnap.data()
              });
            }

            /* -----------------------------------------
               VALIDAR STOCK Y PRECIOS
            ----------------------------------------- */

            for (
              const registro
              of productosActuales
            ) {
              if (
                registro
                  .data
                  .activo ===
                false
              ) {
                throw new Error(
                  `"${registro.item.nombre}" está inactivo y no puede venderse.`
                );
              }

              const stockActual =
                Number(
                  registro
                    .data
                    .cantidad || 0
                );

              const cantidadVenta =
                Number(
                  registro
                    .item
                    .cantidad || 0
                );

              if (
                stockActual <
                cantidadVenta
              ) {
                throw new Error(
                  `No hay suficiente stock de "${registro.item.nombre}". Disponible actualmente: ${stockActual}.`
                );
              }

              const minimoActual =
                obtenerPrecioMinimo(
                  registro.data
                );

              const precioCobrado =
                Number(
                  registro
                    .item
                    .precioUnitario ||
                  0
                );

              if (
                precioCobrado <
                minimoActual
              ) {
                throw new Error(
                  `${registro.item.nombre}: el precio mínimo actual es ${formatMoney(
                    minimoActual
                  )}. La venta no fue registrada.`
                );
              }

              if (
                !Number.isFinite(
                  precioCobrado
                ) ||
                precioCobrado <= 0
              ) {
                throw new Error(
                  `${registro.item.nombre}: el precio de venta no es válido.`
                );
              }
            }

            /* -----------------------------------------
               CLIENTE
            ----------------------------------------- */

            transaction.set(
              clienteRef,
              {
                nombre:
                  nombreCliente,

                nombreLower:
                  slug(
                    nombreCliente
                  ),

                documento:
                  documentoCliente ||
                  null,

                updatedAt:
                  serverTimestamp()
              },
              {
                merge:
                  true
              }
            );

            /* -----------------------------------------
               VENTA
            ----------------------------------------- */

            transaction.set(
              ventaRef,
              {
                clienteId,

                cliente: {
                  nombre:
                    nombreCliente,

                  documento:
                    documentoCliente ||
                    "-"
                },

                items,

                total,

                descuentoTotal,

                tipoPago,

                estadoPago:
                  tipoPago ===
                  "CONTADO"
                    ? "PAGADA"
                    : "PENDIENTE",

                saldoPendiente:
                  tipoPago ===
                  "CONTADO"
                    ? 0
                    : total,

                fechaVencimiento:
                  tipoPago ===
                  "CREDITO"
                    ? fechaVencimiento
                    : null,

                /*
                 * También dejamos quién registró
                 * la operación en la propia venta.
                 */
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

            /* -----------------------------------------
               CUENTA POR COBRAR
            ----------------------------------------- */

            if (
              tipoPago ===
                "CREDITO" &&
              cuentaCobrarRef
            ) {
              transaction.set(
                cuentaCobrarRef,
                {
                  ventaId:
                    ventaRef.id,

                  clienteId,

                  clienteNombre:
                    nombreCliente,

                  clienteDocumento:
                    documentoCliente,

                  total,

                  saldoPendiente:
                    total,

                  estado:
                    "PENDIENTE",

                  fechaVencimiento,

                  createdAt:
                    serverTimestamp(),

                  updatedAt:
                    serverTimestamp()
                }
              );
            }

            /* =================================================
               STOCK + KARDEX
            ================================================= */

            for (
              const registro
              of productosActuales
            ) {
              const {
                item,
                ref,
                data
              } =
                registro;

              /*
               * Existencia real justo antes
               * de registrar la venta.
               */
              const stockAnterior =
                Number(
                  data.cantidad ||
                  0
                );

              const cantidadVenta =
                Number(
                  item.cantidad ||
                  0
                );

              /*
               * Una venta siempre representa
               * una salida de inventario.
               */
              const diferencia =
                -cantidadVenta;

              const stockNuevo =
                stockAnterior +
                diferencia;

              /*
               * Actualizamos el producto.
               */
              transaction.update(
                ref,
                {
                  cantidad:
                    stockNuevo,

                  actualizadoEn:
                    serverTimestamp()
                }
              );

              /*
               * Para calcular utilidad usamos
               * el costo actual almacenado en
               * el producto.
               */
              const costoUnitarioActual =
                Number(
                  data.costoPromedio ??
                  data.costoUnitario ??
                  item.costoUnitario ??
                  0
                );

              const ingreso =
                Number(
                  item.precioUnitario ||
                  0
                ) *
                cantidadVenta;

              const costo =
                costoUnitarioActual *
                cantidadVenta;

              const descuentoLinea =
                Math.max(
                  0,

                  Number(
                    item.precioLista ||
                    item.precioUnitario ||
                    0
                  ) -
                  Number(
                    item.precioUnitario ||
                    0
                  )
                ) *
                cantidadVenta;

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
               * KARDEX COMPLETO
               *
               * cantidad:
               * Se mantiene POSITIVA para
               * compatibilidad con Reportes.
               *
               * diferencia:
               * Es NEGATIVA porque una venta
               * saca unidades del inventario.
               */
              transaction.set(
                movimientoRef,
                {
                  tipo:
                    "VENTA",

                  productoId:
                    item.productoId,

                  productoNombre:
                    item.nombre,

                  cantidad:
                    cantidadVenta,

                  diferencia,

                  stockAnterior,

                  stockNuevo,

                  precioLista:
                    Number(
                      item.precioLista ||
                      item.precioUnitario ||
                      0
                    ),

                  precioVenta:
                    Number(
                      item.precioUnitario ||
                      0
                    ),

                  precioMinimo:
                    Number(
                      item.precioMinimo ||
                      0
                    ),

                  descuento:
                    descuentoLinea,

                  ingreso,

                  costoUnitario:
                    costoUnitarioActual,

                  costo,

                  utilidad:
                    ingreso -
                    costo,

                  ventaId:
                    ventaRef.id,

                  clienteId,

                  clienteNombre:
                    nombreCliente,

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
            }
          }
        );

        navigate(
          `/factura/${ventaRef.id}`
        );

      } catch (e) {
        console.error(e);

        setError(
          e?.message ||
          "Error registrando la venta."
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

      {/* =====================================================
          HEADER
      ===================================================== */}

      <header className="inv-header">

        <div>

          <h1>
            Ventas
          </h1>

          <p className="inv-subtle">
            Registrar venta y generar factura
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

      {/* =====================================================
          GRID PRINCIPAL
      ===================================================== */}

      <section className="inv-grid">

        {/* =================================================
            CLIENTE
        ================================================= */}

        <div className="card">

          <div className="card-header">

            <h2>
              Cliente
            </h2>

            {tipoPago ===
              "CREDITO" && (

              <span
                className="badge"
                style={{
                  color: "#f59e0b"
                }}
              >
                Obligatorio para crédito
              </span>

            )}

          </div>

          <div className="card-body form-grid">

            <div className="form-field">

              <label>
                Nombre
                {tipoPago ===
                  "CREDITO"
                  ? " *"
                  : ""}
              </label>

              <input
                placeholder={
                  tipoPago ===
                  "CREDITO"
                    ? "Nombre del cliente"
                    : "Consumidor final"
                }
                value={
                  cliente.nombre
                }
                onChange={e =>
                  setCliente({
                    ...cliente,
                    nombre:
                      e.target.value
                  })
                }
              />

            </div>

            <div className="form-field">

              <label>
                Documento
                {tipoPago ===
                  "CREDITO"
                  ? " *"
                  : ""}
              </label>

              <input
                placeholder="CC / NIT"
                value={
                  cliente.documento
                }
                onChange={e =>
                  setCliente({
                    ...cliente,
                    documento:
                      e.target.value
                  })
                }
              />

            </div>

          </div>

        </div>

        {/* =================================================
            FORMA DE PAGO
        ================================================= */}

        <div className="card">

          <div className="card-header">

            <div>

              <h2>
                Forma de pago
              </h2>

              <p
                className="inv-subtle"
                style={{
                  margin: "4px 0 0"
                }}
              >
                Define si la venta se paga ahora o queda en cartera.
              </p>

            </div>

          </div>

          <div className="card-body">

            <div
              style={{
                display: "grid",
                gridTemplateColumns:
                  "repeat(auto-fit, minmax(180px, 1fr))",
                gap: 12
              }}
            >

              {/* CONTADO */}

              <button
                type="button"
                onClick={() =>
                  seleccionarTipoPago(
                    "CONTADO"
                  )
                }
                style={{
                  textAlign: "left",
                  cursor: "pointer",
                  borderRadius: 18,
                  padding: 16,

                  border:
                    tipoPago ===
                    "CONTADO"
                      ? "2px solid #22c55e"
                      : "1px solid var(--border)",

                  background:
                    tipoPago ===
                    "CONTADO"
                      ? "rgba(34,197,94,.10)"
                      : "rgba(255,255,255,.025)",

                  color: "var(--text)",
                  transition:
                    "all .15s ease"
                }}
              >

                <div
                  style={{
                    fontSize: 25,
                    marginBottom: 8
                  }}
                >
                  💵
                </div>

                <strong
                  style={{
                    display: "block",
                    fontSize: 17
                  }}
                >
                  Contado
                </strong>

                <span
                  className="inv-subtle"
                  style={{
                    display: "block",
                    marginTop: 5
                  }}
                >
                  El cliente paga inmediatamente.
                </span>

                {tipoPago ===
                  "CONTADO" && (

                  <span
                    style={{
                      display:
                        "inline-block",
                      marginTop: 10,
                      fontSize: 12,
                      fontWeight: 800,
                      color: "#22c55e"
                    }}
                  >
                    ✓ Seleccionado
                  </span>

                )}

              </button>

              {/* CRÉDITO */}

              <button
                type="button"
                onClick={() =>
                  seleccionarTipoPago(
                    "CREDITO"
                  )
                }
                style={{
                  textAlign: "left",
                  cursor: "pointer",
                  borderRadius: 18,
                  padding: 16,

                  border:
                    tipoPago ===
                    "CREDITO"
                      ? "2px solid #f59e0b"
                      : "1px solid var(--border)",

                  background:
                    tipoPago ===
                    "CREDITO"
                      ? "rgba(245,158,11,.10)"
                      : "rgba(255,255,255,.025)",

                  color: "var(--text)",
                  transition:
                    "all .15s ease"
                }}
              >

                <div
                  style={{
                    fontSize: 25,
                    marginBottom: 8
                  }}
                >
                  📅
                </div>

                <strong
                  style={{
                    display: "block",
                    fontSize: 17
                  }}
                >
                  Crédito
                </strong>

                <span
                  className="inv-subtle"
                  style={{
                    display: "block",
                    marginTop: 5
                  }}
                >
                  El saldo queda pendiente en cartera.
                </span>

                {tipoPago ===
                  "CREDITO" && (

                  <span
                    style={{
                      display:
                        "inline-block",
                      marginTop: 10,
                      fontSize: 12,
                      fontWeight: 800,
                      color: "#f59e0b"
                    }}
                  >
                    ✓ Seleccionado
                  </span>

                )}

              </button>

            </div>

            {tipoPago ===
              "CREDITO" && (

              <div
                style={{
                  marginTop: 18,
                  padding: 16,
                  border:
                    "1px solid var(--border)",
                  borderRadius: 16,
                  background:
                    "rgba(245,158,11,.055)"
                }}
              >

                <div className="form-field">

                  <label>
                    Fecha de vencimiento *
                  </label>

                  <input
                    type="date"
                    value={
                      fechaVencimiento
                    }
                    onChange={e =>
                      setFechaVencimiento(
                        e.target.value
                      )
                    }
                  />

                </div>

                <div
                  style={{
                    display: "flex",
                    justifyContent:
                      "space-between",
                    alignItems: "center",
                    gap: 12,
                    flexWrap: "wrap",
                    marginTop: 12
                  }}
                >

                  <span className="inv-subtle">
                    Saldo que quedará por cobrar
                  </span>

                  <strong
                    style={{
                      fontSize: 22,
                      color: "#f59e0b"
                    }}
                  >
                    {formatMoney(total)}
                  </strong>

                </div>

              </div>

            )}

          </div>

        </div>

        {/* =================================================
            AGREGAR PRODUCTO
        ================================================= */}

        <div className="card">

          <div className="card-header">

            <h2>
              Agregar producto
            </h2>

          </div>

          <div className="card-body">

            <div className="form-field">

              <label>
                Producto
              </label>

              <button
                type="button"
                className="btn btn-primary"
                onClick={() =>
                  setModalProductos(
                    true
                  )
                }
                style={{
                  width: "100%",
                  justifyContent:
                    "center",
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
                    border:
                      "1px solid var(--border)",
                    borderRadius: 18,
                    padding: 14,
                    background:
                      "linear-gradient(180deg, rgba(255,255,255,.045), rgba(255,255,255,.015))"
                  }}
                >

                  <div
                    style={{
                      display: "flex",
                      gap: 14,
                      alignItems: "center"
                    }}
                  >

                    <div
                      style={{
                        width: 76,
                        height: 76,
                        borderRadius: 16,
                        overflow: "hidden",
                        border:
                          "1px solid var(--border)",
                        background:
                          "rgba(255,255,255,.04)",
                        display: "grid",
                        placeItems:
                          "center",
                        flexShrink: 0
                      }}
                    >

                      {productoSeleccionado.imagen ? (

                        <img
                          src={
                            productoSeleccionado.imagen
                          }
                          alt={
                            productoSeleccionado.nombre
                          }
                          style={{
                            width: "100%",
                            height: "100%",
                            objectFit:
                              "cover"
                          }}
                        />

                      ) : (

                        <span
                          className="inv-subtle"
                          style={{
                            fontSize: 11
                          }}
                        >
                          Sin imagen
                        </span>

                      )}

                    </div>

                    <div
                      style={{
                        flex: 1,
                        minWidth: 0
                      }}
                    >

                      <div className="product-title-row">

                        <strong>
                          {
                            productoSeleccionado.nombre
                          }
                        </strong>

                        <span className="badge">
                          Seleccionado
                        </span>

                      </div>

                      <div className="product-meta">

                        <span>
                          Precio normal:{" "}

                          <b>
                            {formatMoney(
                              precioNormalActual
                            )}
                          </b>
                        </span>

                        <span>
                          Precio mínimo:{" "}

                          <b
                            style={{
                              color:
                                "#f59e0b"
                            }}
                          >
                            {formatMoney(
                              precioMinimoActual
                            )}
                          </b>
                        </span>

                        <span>
                          Stock:{" "}

                          <b>
                            {
                              productoSeleccionado.cantidad
                            }
                          </b>
                        </span>

                      </div>

                    </div>

                  </div>

                  {/* PRECIO EDITABLE */}

                  <div
                    style={{
                      marginTop: 16,
                      paddingTop: 14,
                      borderTop:
                        "1px solid var(--border)"
                    }}
                  >

                    <div className="form-field">

                      <label>
                        Precio de venta
                      </label>

                      <input
                        type="text"
                        inputMode="numeric"
                        value={
                          precioVenta
                        }
                        onChange={e =>
                          setPrecioVenta(
                            formatearNumeroInput(
                              e.target.value
                            )
                          )
                        }
                        style={{
                          fontWeight: 800,
                          fontSize: 18,

                          borderColor:
                            precioInvalido
                              ? "#ef4444"
                              : undefined
                        }}
                      />

                    </div>

                    <div
                      style={{
                        display: "flex",
                        justifyContent:
                          "space-between",
                        gap: 10,
                        flexWrap: "wrap",
                        marginTop: 8
                      }}
                    >

                      <span
                        className="inv-subtle"
                        style={{
                          fontSize: 12
                        }}
                      >
                        Mínimo permitido:{" "}

                        <b
                          style={{
                            color:
                              "#f59e0b"
                          }}
                        >
                          {formatMoney(
                            precioMinimoActual
                          )}
                        </b>
                      </span>

                      {descuentoPorcentajeActual >
                        0 && (

                        <span
                          style={{
                            fontSize: 12,
                            fontWeight: 800,
                            color:
                              "#22c55e"
                          }}
                        >
                          Descuento:{" "}
                          {descuentoPorcentajeActual.toFixed(
                            1
                          )}
                          %
                        </span>

                      )}

                    </div>

                    {precioInvalido && (

                      <div
                        style={{
                          marginTop: 10,
                          padding:
                            "9px 11px",
                          borderRadius: 10,
                          color:
                            "#ef4444",
                          background:
                            "rgba(239,68,68,.08)",
                          border:
                            "1px solid rgba(239,68,68,.25)",
                          fontSize: 13,
                          fontWeight: 700
                        }}
                      >
                        ⚠️ El precio no puede ser menor que{" "}
                        {formatMoney(
                          precioMinimoActual
                        )}.
                      </div>

                    )}

                  </div>

                  {/* SUBTOTAL */}

                  <div
                    style={{
                      marginTop: 14,
                      display: "flex",
                      justifyContent:
                        "space-between",
                      alignItems: "center",
                      borderTop:
                        "1px solid var(--border)",
                      paddingTop: 12
                    }}
                  >

                    <span className="inv-subtle">
                      Subtotal estimado
                    </span>

                    <strong
                      style={{
                        fontSize: 22
                      }}
                    >
                      {formatMoney(
                        subtotalActual
                      )}
                    </strong>

                  </div>

                </div>

              ) : (

                <p
                  className="inv-subtle"
                  style={{
                    marginTop: 10
                  }}
                >
                  No has seleccionado ningún producto.
                </p>

              )}

            </div>

            <div className="form-field">

              <label>
                Cantidad
              </label>

              <input
                ref={
                  cantidadRef
                }
                type="number"
                min="1"
                step="1"
                value={
                  cantidad
                }
                onChange={e =>
                  setCantidad(
                    Number(
                      e.target.value
                    )
                  )
                }
              />

            </div>

            <button
              className="btn btn-primary"
              onClick={
                agregarItem
              }
              disabled={
                !productoSeleccionado ||
                precioInvalido
              }
            >
              ➕ Agregar al carrito
            </button>

            {error && (

              <div
                className="toast toast-error"
                style={{
                  position: "static",
                  marginTop: 12
                }}
              >
                {error}
              </div>

            )}

          </div>

        </div>

        {/* =================================================
            DETALLE VENTA
        ================================================= */}

        <div className="card">

          <div className="card-header">

            <h2>
              Detalle de la venta
            </h2>

            <span
              className="badge"
              style={{
                color:
                  tipoPago ===
                  "CREDITO"
                    ? "#f59e0b"
                    : "#22c55e"
              }}
            >
              {tipoPago ===
              "CREDITO"
                ? "📅 Crédito"
                : "💵 Contado"}
            </span>

          </div>

          <div className="card-body">

            {items.length ===
            0 ? (

              <p className="inv-subtle">
                Sin productos agregados.
              </p>

            ) : (

              <ul className="product-list">

                {items.map(it => {

                  const tieneDescuento =
                    Number(
                      it.precioUnitario
                    ) <
                    Number(
                      it.precioLista
                    );

                  return (

                    <li
                      key={
                        it.productoId
                      }
                      className="product-item"
                    >

                      <div className="product-info">

                        <div className="product-title-row">

                          <strong>
                            {it.nombre}
                          </strong>

                          {tieneDescuento && (

                            <span
                              className="badge"
                              style={{
                                color:
                                  "#22c55e"
                              }}
                            >
                              🏷️{" "}
                              {Number(
                                it.descuentoPorcentaje ||
                                0
                              ).toFixed(
                                1
                              )}
                              % desc.
                            </span>

                          )}

                        </div>

                        <div className="product-meta">

                          <span>
                            Cant:{" "}

                            <b>
                              {
                                it.cantidad
                              }
                            </b>
                          </span>

                          {tieneDescuento && (

                            <span>
                              Precio normal:{" "}

                              <b
                                style={{
                                  textDecoration:
                                    "line-through",
                                  opacity:
                                    0.65
                                }}
                              >
                                {formatMoney(
                                  it.precioLista
                                )}
                              </b>
                            </span>

                          )}

                          <span>
                            Precio cobrado:{" "}

                            <b>
                              {formatMoney(
                                it.precioUnitario
                              )}
                            </b>
                          </span>

                          <span>
                            Mínimo:{" "}

                            <b>
                              {formatMoney(
                                it.precioMinimo
                              )}
                            </b>
                          </span>

                          <span>
                            Subtotal:{" "}

                            <b>
                              {formatMoney(
                                it.cantidad *
                                it.precioUnitario
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
                              it.productoId
                            )
                          }
                        >
                          Quitar
                        </button>

                      </div>

                    </li>

                  );
                })}

              </ul>

            )}

            {/* DESCUENTO */}

            {descuentoTotal >
              0 && (

              <div
                style={{
                  marginTop: 16,
                  padding:
                    "11px 14px",
                  borderRadius: 12,
                  display: "flex",
                  justifyContent:
                    "space-between",
                  alignItems:
                    "center",
                  gap: 12,
                  background:
                    "rgba(34,197,94,.07)",
                  border:
                    "1px solid rgba(34,197,94,.20)"
                }}
              >

                <span>
                  🏷️ Descuentos aplicados
                </span>

                <strong
                  style={{
                    color:
                      "#22c55e"
                  }}
                >
                  -{formatMoney(
                    descuentoTotal
                  )}
                </strong>

              </div>

            )}

            {/* TOTAL */}

            <div
              style={{
                marginTop: 16,
                display: "flex",
                justifyContent:
                  "space-between",
                alignItems:
                  "center",
                gap: 12,
                flexWrap: "wrap",
                borderTop:
                  "1px solid var(--border)",
                paddingTop: 14
              }}
            >

              <strong>
                Total:
              </strong>

              <h2
                style={{
                  margin: 0
                }}
              >
                {formatMoney(total)}
              </h2>

            </div>

            {/* SALDO CRÉDITO */}

            {tipoPago ===
              "CREDITO" && (

              <div
                style={{
                  marginTop: 12,
                  display: "flex",
                  justifyContent:
                    "space-between",
                  alignItems:
                    "center",
                  gap: 12,
                  flexWrap: "wrap",
                  padding:
                    "12px 14px",
                  borderRadius: 14,
                  background:
                    "rgba(245,158,11,.08)",
                  border:
                    "1px solid rgba(245,158,11,.25)"
                }}
              >

                <span>
                  Saldo pendiente:
                </span>

                <strong
                  style={{
                    color:
                      "#f59e0b"
                  }}
                >
                  {formatMoney(total)}
                </strong>

              </div>

            )}

          </div>

          <div className="card-footer">

            <button
              className="btn btn-primary"
              onClick={
                registrarVenta
              }
              disabled={
                guardando ||
                items.length === 0
              }
            >
              {guardando
                ? "Guardando..."
                : tipoPago ===
                  "CREDITO"
                  ? "Registrar venta a crédito"
                  : "Registrar venta"}
            </button>

          </div>

        </div>

      </section>

      {/* =====================================================
          MODAL PRODUCTOS
      ===================================================== */}

      {modalProductos && (

        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
        >

          <div
            className="modal-card"
            style={{
              maxWidth: 980,
              width: "92vw",
              maxHeight: "82vh",
              overflow: "hidden",
              borderRadius: 24,
              boxShadow:
                "0 28px 90px rgba(0,0,0,.48)"
            }}
          >

            {/* CABECERA */}

            <div
              style={{
                display: "flex",
                justifyContent:
                  "space-between",
                gap: 12,
                alignItems:
                  "center",
                marginBottom: 12
              }}
            >

              <div>

                <h3
                  style={{
                    margin: 0
                  }}
                >
                  Seleccionar producto
                </h3>

                <p
                  className="inv-subtle"
                  style={{
                    margin:
                      "5px 0 0"
                  }}
                >
                  Elige un producto del catálogo o usa el buscador.
                </p>

              </div>

              <button
                className="btn"
                onClick={() => {
                  setModalProductos(
                    false
                  );

                  setQModal("");
                }}
              >
                ✕
              </button>

            </div>

            {/* BUSCADOR */}

            <div
              className="input-with-icon"
              style={{
                marginBottom: 12
              }}
            >

              <span className="icon">
                🔎
              </span>

              <input
                autoFocus
                type="text"
                placeholder="Buscar por nombre o categoría..."
                value={
                  qModal
                }
                onChange={e =>
                  setQModal(
                    e.target.value
                  )
                }
              />

            </div>

            {/* RECIENTES */}

            {productosRecientes.length >
              0 &&
              !qModal && (

              <div
                style={{
                  marginBottom: 12
                }}
              >

                <p
                  className="inv-subtle"
                  style={{
                    margin:
                      "0 0 8px"
                  }}
                >
                  Productos recientes
                </p>

                <div
                  style={{
                    display: "flex",
                    gap: 8,
                    flexWrap: "wrap"
                  }}
                >

                  {productosRecientes.map(
                    p => (

                      <button
                        key={p.id}
                        type="button"
                        className="btn btn-small"
                        onClick={() =>
                          seleccionarProducto(
                            p
                          )
                        }
                      >
                        {p.nombre}
                      </button>

                    )
                  )}

                </div>

              </div>

            )}

            {/* PRODUCTOS */}

            <div
              style={{
                maxHeight: "58vh",
                overflowY: "auto",
                paddingRight: 6
              }}
            >

              {productosModal.length ===
              0 ? (

                <p className="inv-subtle">
                  No hay productos que coincidan.
                </p>

              ) : (

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns:
                      "repeat(auto-fill, minmax(210px, 1fr))",
                    gap: 14,
                    alignItems: "start"
                  }}
                >

                  {productosModal.map(
                    p => {

                      const stock =
                        stockInfo(p);

                      const minimoVenta =
                        obtenerPrecioMinimo(
                          p
                        );

                      return (

                        <div
                          key={p.id}
                          style={{
                            border:
                              "1px solid var(--border)",
                            background:
                              "linear-gradient(180deg, rgba(255,255,255,.045), rgba(255,255,255,.015))",
                            color:
                              "var(--text)",
                            borderRadius: 18,
                            padding: 12,
                            boxShadow:
                              "0 10px 28px rgba(0,0,0,.16)"
                          }}
                        >

                          {/* IMAGEN */}

                          <div
                            style={{
                              width: "100%",
                              height: 104,
                              borderRadius: 14,
                              overflow:
                                "hidden",
                              border:
                                "1px solid var(--border)",
                              background:
                                "rgba(255,255,255,.04)",
                              display: "grid",
                              placeItems:
                                "center",
                              marginBottom: 10
                            }}
                          >

                            {p.imagen ? (

                              <img
                                src={
                                  p.imagen
                                }
                                alt={
                                  p.nombre
                                }
                                style={{
                                  width: "100%",
                                  height: "100%",
                                  objectFit:
                                    "cover"
                                }}
                              />

                            ) : (

                              <span className="inv-subtle">
                                Sin imagen
                              </span>

                            )}

                          </div>

                          {/* NOMBRE */}

                          <strong
                            style={{
                              display: "block",
                              marginBottom: 8
                            }}
                          >
                            {p.nombre}
                          </strong>

                          {/* DATOS */}

                          <div
                            style={{
                              display: "grid",
                              gap: 6,
                              marginBottom: 10
                            }}
                          >

                            <span
                              style={{
                                fontWeight: 800,
                                fontSize: 16
                              }}
                            >
                              {formatMoney(
                                p.precioUnitario
                              )}
                            </span>

                            <span
                              style={{
                                fontSize: 12,
                                color:
                                  "#f59e0b"
                              }}
                            >
                              Mínimo:{" "}

                              <b>
                                {formatMoney(
                                  minimoVenta
                                )}
                              </b>
                            </span>

                            <span
                              style={{
                                color:
                                  stock.color,
                                fontWeight: 700,
                                fontSize: 13
                              }}
                            >
                              {stock.icon}{" "}
                              {stock.label}:{" "}
                              {p.cantidad}
                            </span>

                            {p.categoriaNombre && (

                              <span
                                style={{
                                  width:
                                    "fit-content",
                                  fontSize: 12,
                                  padding:
                                    "4px 8px",
                                  borderRadius: 999,
                                  border:
                                    "1px solid var(--border)",
                                  color:
                                    "var(--muted)"
                                }}
                              >
                                🏷️{" "}
                                {
                                  p.categoriaNombre
                                }
                              </span>

                            )}

                          </div>

                          {/* SELECCIONAR */}

                          <button
                            type="button"
                            className="btn btn-primary"
                            onClick={() =>
                              seleccionarProducto(
                                p
                              )
                            }
                            style={{
                              width: "100%",
                              justifyContent:
                                "center"
                            }}
                            disabled={
                              Number(
                                p.cantidad ||
                                0
                              ) <= 0
                            }
                          >
                            {Number(
                              p.cantidad ||
                              0
                            ) <= 0
                              ? "Sin stock"
                              : "Seleccionar"}
                          </button>

                        </div>

                      );
                    }
                  )}

                </div>

              )}

            </div>

          </div>

        </div>

      )}

    </div>
  );
}