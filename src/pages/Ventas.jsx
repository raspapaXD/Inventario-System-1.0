// src/pages/Ventas.jsx

import { useEffect, useMemo, useRef, useState } from "react";
import { db } from "../../firebaseClient.js";

import {
  collection,
  getDocs,
  doc,
  serverTimestamp,
  runTransaction,
  query,
  orderBy,
  startAt,
  endAt,
  limit,
  where
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

const normalizarNombreBusqueda = value =>
  norm(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");

const normalizarDocumento = value =>
  String(value || "")
    .replace(/[^0-9a-zA-Z]/g, "")
    .toLowerCase();

const esBusquedaDocumento = value =>
  /[0-9]/.test(
    String(value || "")
  );

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

  /*
   * Borrador temporal de venta:
   * mantiene la venta mientras navegas por Ordexa
   * dentro de esta misma pestaña.
   */
  const borradorRestauradoRef =
    useRef(false);

  const productoPendienteRestaurarRef =
    useRef(null);

  const [
    borradorRecuperado,
    setBorradorRecuperado
  ] = useState(false);

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
    id: null,
    nombre: "",
    documento: "",
    existente: false
  });

  const [
    busquedaCliente,
    setBusquedaCliente
  ] = useState("");

  const [
    resultadosClientes,
    setResultadosClientes
  ] = useState([]);

  const [
    buscandoClientes,
    setBuscandoClientes
  ] = useState(false);

  const [
    modoClienteNuevo,
    setModoClienteNuevo
  ] = useState(false);

  const [
    clientesRecientes,
    setClientesRecientes
  ] = useState([]);

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
     BORRADOR DE VENTA

     Usamos sessionStorage para que:
     - puedas ir a Inventario, Cartera, Clientes, etc.
     - volver a Ventas sin perder la venta
     - incluso un refresh de esta pestaña la recupere

     Al cerrar la pestaña, el borrador desaparece.
  ======================================================= */

  const borradorKey =
    empresa?.id &&
    user?.uid
      ? `ordexa_borrador_venta_${empresa.id}_${user.uid}`
      : null;

  /*
   * Restauramos una sola vez por montaje.
   */
  useEffect(() => {
    if (
      !borradorKey ||
      borradorRestauradoRef.current
    ) {
      return;
    }

    borradorRestauradoRef.current =
      true;

    try {
      const guardado =
        sessionStorage.getItem(
          borradorKey
        );

      if (!guardado) {
        return;
      }

      const borrador =
        JSON.parse(
          guardado
        );

      if (
        borrador?.cliente &&
        typeof borrador.cliente ===
          "object"
      ) {
        setCliente({
          id:
            borrador.cliente.id ??
            null,

          nombre:
            borrador.cliente.nombre ||
            "",

          documento:
            borrador.cliente.documento ||
            "",

          existente:
            Boolean(
              borrador.cliente.existente
            )
        });
      }

      setModoClienteNuevo(
        Boolean(
          borrador?.modoClienteNuevo
        )
      );

      setBusquedaCliente(
        borrador?.busquedaCliente ||
        ""
      );

      if (
        Array.isArray(
          borrador?.items
        )
      ) {
        setItems(
          borrador.items
        );
      }

      setTipoPago(
        borrador?.tipoPago ===
          "CREDITO"
          ? "CREDITO"
          : "CONTADO"
      );

      setFechaVencimiento(
        borrador?.fechaVencimiento ||
        ""
      );

      setCantidad(
        Number(
          borrador?.cantidad ||
          1
        )
      );

      setPrecioVenta(
        borrador?.precioVenta ||
        ""
      );

      productoPendienteRestaurarRef.current =
        borrador?.productoSeleccionadoId ||
        null;

      setBorradorRecuperado(
        Boolean(
          (
            Array.isArray(
              borrador?.items
            ) &&
            borrador.items.length > 0
          ) ||
          borrador?.cliente?.id ||
          borrador?.cliente?.nombre ||
          borrador?.tipoPago ===
            "CREDITO" ||
          borrador?.productoSeleccionadoId
        )
      );

    } catch (e) {
      console.warn(
        "No se pudo restaurar el borrador de venta.",
        e
      );

      sessionStorage.removeItem(
        borradorKey
      );
    }
  }, [
    borradorKey
  ]);

  /*
   * Guardado automático del borrador.
   * Solo empieza después de haber intentado restaurarlo,
   * para no sobrescribir una venta pendiente con valores vacíos.
   */
  useEffect(() => {
    if (
      !borradorKey ||
      !borradorRestauradoRef.current ||
      guardando
    ) {
      return;
    }

    const tieneContenido =
      items.length > 0 ||
      Boolean(
        cliente.id ||
        norm(cliente.nombre) ||
        norm(cliente.documento)
      ) ||
      modoClienteNuevo ||
      tipoPago === "CREDITO" ||
      Boolean(
        productoSeleccionado?.id
      );

    if (
      !tieneContenido
    ) {
      sessionStorage.removeItem(
        borradorKey
      );

      return;
    }

    const borrador = {
      version: 1,

      cliente: {
        id:
          cliente.id ??
          null,

        nombre:
          cliente.nombre ||
          "",

        documento:
          cliente.documento ||
          "",

        existente:
          Boolean(
            cliente.existente
          )
      },

      modoClienteNuevo,

      busquedaCliente,

      items,

      tipoPago,

      fechaVencimiento,

      productoSeleccionadoId:
        productoSeleccionado?.id ||
        null,

      cantidad,

      precioVenta,

      guardadoEn:
        Date.now()
    };

    try {
      sessionStorage.setItem(
        borradorKey,
        JSON.stringify(
          borrador
        )
      );
    } catch (e) {
      console.warn(
        "No se pudo guardar el borrador de venta.",
        e
      );
    }
  }, [
    borradorKey,
    cliente,
    modoClienteNuevo,
    busquedaCliente,
    items,
    tipoPago,
    fechaVencimiento,
    productoSeleccionado?.id,
    cantidad,
    precioVenta,
    guardando
  ]);

  /*
   * Si había un producto seleccionado antes de navegar,
   * lo restauramos usando el producto FRESCO que acabamos
   * de leer de Firestore. Así si hiciste un ajuste de stock,
   * ves el stock nuevo y no una copia vieja.
   */
  useEffect(() => {
    const productoId =
      productoPendienteRestaurarRef.current;

    if (
      !productoId ||
      productos.length === 0
    ) {
      return;
    }

    const producto =
      productos.find(
        p =>
          p.id ===
          productoId
      );

    productoPendienteRestaurarRef.current =
      null;

    if (
      producto &&
      producto.activo !== false
    ) {
      setProductoSeleccionado(
        producto
      );
    }
  }, [
    productos
  ]);

  /* =======================================================
     STOCK DISPONIBLE DENTRO DE LA VENTA ACTUAL

     Firestore conserva el stock real hasta que se registra
     la venta. Mientras el vendedor arma el carrito,
     descontamos visualmente las unidades ya agregadas.
  ======================================================= */

  const cantidadEnCarritoDe =
    productoId => {
      const item =
        items.find(
          it =>
            it.productoId ===
            productoId
        );

      return Number(
        item?.cantidad || 0
      );
    };

  const stockDisponibleEnVenta =
    producto => {
      if (!producto?.id) {
        return 0;
      }

      const stockBase =
        Number(
          producto.cantidad || 0
        );

      const reservado =
        cantidadEnCarritoDe(
          producto.id
        );

      return Math.max(
        0,
        stockBase -
        reservado
      );
    };

  const cantidadSeleccionadaEnCarrito =
    productoSeleccionado
      ? cantidadEnCarritoDe(
          productoSeleccionado.id
        )
      : 0;

  const stockDisponibleSeleccionado =
    productoSeleccionado
      ? stockDisponibleEnVenta(
          productoSeleccionado
        )
      : 0;

  /* =======================================================
     CLIENTES ESCALABLES
     - No descargamos toda la colección.
     - Buscamos por prefijo y traemos máximo 8 resultados.
     - Compatibilidad con clientes antiguos:
       nombreLower / documento.
  ======================================================= */

  const recientesKey =
    empresa?.id
      ? `ordexa_clientes_recientes_${empresa.id}`
      : null;

  useEffect(() => {
    if (!recientesKey) {
      setClientesRecientes([]);
      return;
    }

    try {
      const guardados =
        JSON.parse(
          localStorage.getItem(
            recientesKey
          ) || "[]"
        );

      setClientesRecientes(
        Array.isArray(guardados)
          ? guardados.slice(0, 5)
          : []
      );
    } catch {
      setClientesRecientes([]);
    }
  }, [recientesKey]);

  const guardarClienteReciente =
    clienteGuardado => {
      if (
        !recientesKey ||
        !clienteGuardado?.id
      ) {
        return;
      }

      setClientesRecientes(prev => {
        const siguiente = [
          clienteGuardado,
          ...prev.filter(
            item =>
              item.id !==
              clienteGuardado.id
          )
        ].slice(0, 5);

        localStorage.setItem(
          recientesKey,
          JSON.stringify(
            siguiente
          )
        );

        return siguiente;
      });
    };

  const convertirCliente =
    documentoSnap => ({
      id:
        documentoSnap.id,
      ...documentoSnap.data()
    });

  const ejecutarBusquedaPrefijo =
    async (
      campo,
      prefijo,
      maximo = 8
    ) => {
      if (
        !empresa?.id ||
        !prefijo
      ) {
        return [];
      }

      const ref =
        collection(
          db,
          "empresas",
          empresa.id,
          "clientes"
        );

      const snap =
        await getDocs(
          query(
            ref,
            orderBy(campo),
            startAt(prefijo),
            endAt(
              `${prefijo}\uf8ff`
            ),
            limit(maximo)
          )
        );

      return snap.docs.map(
        convertirCliente
      );
    };

  const buscarClientesRemotos =
    async texto => {
      if (
        !empresa?.id ||
        texto.trim().length < 2
      ) {
        return [];
      }

      const porDocumento =
        esBusquedaDocumento(
          texto
        );

      if (porDocumento) {
        const documento =
          normalizarDocumento(
            texto
          );

        const consultas =
          await Promise.allSettled([
            ejecutarBusquedaPrefijo(
              "documentoNormalizado",
              documento
            ),

            /*
             * Compatibilidad con los clientes
             * creados antes de documentoNormalizado.
             */
            ejecutarBusquedaPrefijo(
              "documento",
              norm(texto)
            )
          ]);

        const map =
          new Map();

        for (
          const resultado
          of consultas
        ) {
          if (
            resultado.status ===
            "fulfilled"
          ) {
            for (
              const item
              of resultado.value
            ) {
              map.set(
                item.id,
                item
              );
            }
          }
        }

        return Array.from(
          map.values()
        ).slice(0, 8);
      }

      const nombreBusqueda =
        normalizarNombreBusqueda(
          texto
        );

      const nombreLegacy =
        slug(texto);

      const consultas =
        await Promise.allSettled([
          ejecutarBusquedaPrefijo(
            "nombreBusqueda",
            nombreBusqueda
          ),

          /*
           * nombreLower en la versión antigua
           * se guardaba como slug.
           */
          ejecutarBusquedaPrefijo(
            "nombreLower",
            nombreLegacy
          )
        ]);

      const map =
        new Map();

      for (
        const resultado
        of consultas
      ) {
        if (
          resultado.status ===
          "fulfilled"
        ) {
          for (
            const item
            of resultado.value
          ) {
            map.set(
              item.id,
              item
            );
          }
        }
      }

      return Array.from(
        map.values()
      ).slice(0, 8);
    };

  useEffect(() => {
    if (
      cliente.id ||
      modoClienteNuevo
    ) {
      setResultadosClientes([]);
      setBuscandoClientes(false);
      return;
    }

    const texto =
      busquedaCliente.trim();

    if (
      texto.length < 2
    ) {
      setResultadosClientes([]);
      setBuscandoClientes(false);
      return;
    }

    let cancelado =
      false;

    const timer =
      setTimeout(
        async () => {
          try {
            setBuscandoClientes(true);

            const resultados =
              await buscarClientesRemotos(
                texto
              );

            if (!cancelado) {
              setResultadosClientes(
                resultados
              );
            }
          } catch (e) {
            console.error(
              "Error buscando clientes:",
              e
            );

            if (!cancelado) {
              setResultadosClientes([]);
            }
          } finally {
            if (!cancelado) {
              setBuscandoClientes(false);
            }
          }
        },
        320
      );

    return () => {
      cancelado =
        true;

      clearTimeout(
        timer
      );
    };
  }, [
    busquedaCliente,
    empresa?.id,
    cliente.id,
    modoClienteNuevo
  ]);

  const seleccionarCliente =
    clienteElegido => {
      if (!clienteElegido) {
        return;
      }

      setCliente({
        id:
          clienteElegido.id,
        nombre:
          clienteElegido.nombre ||
          "",
        documento:
          clienteElegido.documento ||
          "",
        existente:
          true
      });

      setBusquedaCliente("");
      setResultadosClientes([]);
      setModoClienteNuevo(false);

      guardarClienteReciente({
        id:
          clienteElegido.id,
        nombre:
          clienteElegido.nombre ||
          "",
        documento:
          clienteElegido.documento ||
          ""
      });
    };

  const cambiarCliente =
    () => {
      setCliente({
        id: null,
        nombre: "",
        documento: "",
        existente: false
      });

      setBusquedaCliente("");
      setResultadosClientes([]);
      setModoClienteNuevo(false);
    };

  const iniciarClienteNuevo =
    () => {
      setCliente({
        id: null,
        nombre:
          esBusquedaDocumento(
            busquedaCliente
          )
            ? ""
            : busquedaCliente.trim(),
        documento:
          esBusquedaDocumento(
            busquedaCliente
          )
            ? busquedaCliente.trim()
            : "",
        existente:
          false
      });

      setModoClienteNuevo(true);
      setResultadosClientes([]);
    };

  const usarConsumidorFinal =
    () => {
      setCliente({
        id: null,
        nombre: "",
        documento: "",
        existente: false
      });

      setBusquedaCliente("");
      setResultadosClientes([]);
      setModoClienteNuevo(false);
    };

  const buscarClienteExactoPorDocumento =
    async documento => {
      if (
        !empresa?.id ||
        !documento
      ) {
        return null;
      }

      const documentoNormalizado =
        normalizarDocumento(
          documento
        );

      const ref =
        collection(
          db,
          "empresas",
          empresa.id,
          "clientes"
        );

      const consultas =
        await Promise.allSettled([
          getDocs(
            query(
              ref,
              where(
                "documentoNormalizado",
                "==",
                documentoNormalizado
              ),
              limit(1)
            )
          ),

          getDocs(
            query(
              ref,
              where(
                "documento",
                "==",
                norm(documento)
              ),
              limit(1)
            )
          )
        ]);

      for (
        const resultado
        of consultas
      ) {
        if (
          resultado.status ===
          "fulfilled" &&
          !resultado.value.empty
        ) {
          return convertirCliente(
            resultado.value.docs[0]
          );
        }
      }

      return null;
    };

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
              `${p.codigo || ""} ${p.nombre || ""} ${
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
            p.activo !== false &&
            stockDisponibleEnVenta(p) > 0
        )
        .slice(0, 5);

    }, [
      recientes,
      productos,
      items
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
     TOTAL DE UNIDADES
  ======================================================= */

  const totalUnidades =
    useMemo(
      () =>
        items.reduce(
          (acc, it) =>
            acc +
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

      const disponible =
        stockDisponibleEnVenta(
          producto
        );

      if (
        disponible <= 0
      ) {
        setProductoSeleccionado(
          null
        );

        return setError(
          `Ya agregaste todo el stock disponible de "${producto.nombre}" a esta venta.`
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

    const stockDisponibleVenta =
      Math.max(
        0,
        stockDisponible -
        cantidadEnCarrito
      );

    const cantidadFinal =
      cantidadEnCarrito +
      cantidadNueva;

    if (
      cantidadNueva >
      stockDisponibleVenta
    ) {
      return setError(
        `No hay suficiente stock. Disponible para agregar: ${stockDisponibleVenta}.`
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

        /*
         * Si el vendedor decidió registrar un cliente nuevo,
         * no permitimos guardar un documento sin nombre.
         */
        if (
          modoClienteNuevo &&
          norm(
            cliente.documento
          ) &&
          !norm(
            cliente.nombre
          )
        ) {
          return setError(
            "Ingresa el nombre del cliente antes de registrar la venta."
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

        const tieneClienteReal =
          Boolean(
            norm(
              cliente.nombre
            ) ||
            norm(
              cliente.documento
            )
          );

        const nombreCliente =
          norm(
            cliente.nombre
          ) ||
          "Consumidor final";

        const documentoCliente =
          norm(
            cliente.documento
          );

        const documentoNormalizado =
          normalizarDocumento(
            documentoCliente
          );

        /*
         * Si el usuario escribió un cliente nuevo con
         * documento, verificamos antes de guardar que
         * no exista ya en la empresa.
         */
        let clienteExistentePorDocumento =
          null;

        if (
          tieneClienteReal &&
          documentoCliente &&
          !cliente.existente
        ) {
          clienteExistentePorDocumento =
            await buscarClienteExactoPorDocumento(
              documentoCliente
            );

          if (
            clienteExistentePorDocumento
          ) {
            seleccionarCliente(
              clienteExistentePorDocumento
            );

            return setError(
              `Ya existe un cliente con este documento: ${clienteExistentePorDocumento.nombre}. Lo seleccionamos para que puedas revisar la venta.`
            );
          }
        }

        const clienteId =
          cliente.id ||
          (
            documentoNormalizado ||
            (
              tieneClienteReal
                ? slug(
                    nombreCliente
                  )
                : null
            )
          );

        /* ---------------------------------------------
           REFERENCIAS
        --------------------------------------------- */

        const clienteRef =
          clienteId
            ? doc(
                db,
                "empresas",
                empresa.id,
                "clientes",
                clienteId
              )
            : null;

        const ventaRef =
          doc(
            collection(
              db,
              "empresas",
              empresa.id,
              "ventas"
            )
          );

        /*
         * Contador independiente por empresa.
         *
         * Cada tenant mantiene su propia secuencia:
         * 000001, 000002, 000003...
         *
         * El ID técnico de Firestore sigue siendo el mismo;
         * numeroFactura es el consecutivo comercial visible.
         */
        const contadorFacturaRef =
          doc(
            db,
            "empresas",
            empresa.id,
            "contadores",
            "facturasVentas"
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
             *
             * El contador se lee dentro de la misma transacción,
             * así dos usuarios vendiendo al mismo tiempo no pueden
             * recibir el mismo número de factura.
             */
            const contadorSnap =
              await transaction.get(
                contadorFacturaRef
              );

            const ultimoNumeroFactura =
              contadorSnap.exists()
                ? Number(
                    contadorSnap.data()?.ultimoNumero ||
                    0
                  )
                : 0;

            const numeroFactura =
              ultimoNumeroFactura + 1;

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
               CONTADOR DE FACTURA
            ----------------------------------------- */

            transaction.set(
              contadorFacturaRef,
              {
                ultimoNumero:
                  numeroFactura,

                updatedAt:
                  serverTimestamp()
              },
              {
                merge:
                  true
              }
            );

            /* -----------------------------------------
               CLIENTE
            ----------------------------------------- */

            if (
              clienteRef &&
              tieneClienteReal
            ) {
              transaction.set(
                clienteRef,
                {
                  nombre:
                    nombreCliente,

                  /*
                   * Compatibilidad con la estructura anterior.
                   */
                  nombreLower:
                    slug(
                      nombreCliente
                    ),

                  /*
                   * Campos preparados para búsquedas
                   * escalables por prefijo.
                   */
                  nombreBusqueda:
                    normalizarNombreBusqueda(
                      nombreCliente
                    ),

                  documento:
                    documentoCliente ||
                    null,

                  documentoNormalizado:
                    documentoNormalizado ||
                    null,

                  updatedAt:
                    serverTimestamp()
                },
                {
                  merge:
                    true
                }
              );
            }

            /* -----------------------------------------
               VENTA
            ----------------------------------------- */

            transaction.set(
              ventaRef,
              {
                /*
                 * Consecutivo comercial visible.
                 * El formato 000001 se aplica solo al mostrarlo.
                 */
                numeroFactura,

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

                  numeroFactura,

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

                  numeroFactura,

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

        if (
          clienteId &&
          tieneClienteReal
        ) {
          guardarClienteReciente({
            id:
              clienteId,
            nombre:
              nombreCliente,
            documento:
              documentoCliente
          });
        }

        /*
         * La venta ya quedó registrada.
         * Eliminamos el borrador para que una venta nueva
         * no recupere información de la anterior.
         */
        if (
          borradorKey
        ) {
          sessionStorage.removeItem(
            borradorKey
          );
        }

        borradorRestauradoRef.current =
          false;

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
     ESTADO VISUAL DEL FLUJO
  ========================================================= */

  const clienteListo =
    tipoPago === "CONTADO"
      ? true
      : Boolean(
          norm(cliente.nombre) &&
          norm(cliente.documento)
        );

  const pagoListo =
    tipoPago === "CONTADO"
      ? true
      : Boolean(fechaVencimiento);

  const datosVentaListos =
    clienteListo &&
    pagoListo;

  /* =========================================================
     RENDER
  ========================================================= */

  return (
    <div className="inv-root ventas-page">

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

      {borradorRecuperado && (

        <div
          style={{
            display: "flex",
            justifyContent:
              "space-between",
            alignItems: "center",
            gap: 10,
            flexWrap: "wrap",
            marginBottom: 10,
            padding:
              "8px 11px",
            border:
              "1px solid rgba(59,130,246,.22)",
            borderRadius: 10,
            background:
              "rgba(59,130,246,.05)",
            fontSize: 11
          }}
        >
          <span>
            💾 Recuperamos la venta que estabas preparando.
          </span>

          <button
            type="button"
            className="btn btn-small"
            onClick={() =>
              setBorradorRecuperado(
                false
              )
            }
          >
            Entendido
          </button>
        </div>

      )}

      {/* =====================================================
          FLUJO DE VENTA
      ===================================================== */}

      <div
        className="card"
        style={{
          marginBottom: 14,
          overflow: "visible"
        }}
      >
        <div
          className="card-body"
          style={{
            padding: 10
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
            <PasoVenta
              numero="1"
              titulo="Cliente y pago"
              detalle={
                datosVentaListos
                  ? tipoPago === "CREDITO"
                    ? "Cliente y crédito listos"
                    : "Venta de contado lista"
                  : "Completa los datos requeridos"
              }
              completo={
                datosVentaListos
              }
            />

            <PasoVenta
              numero="2"
              titulo="Productos"
              detalle={
                items.length
                  ? `${items.length} referencia(s) • ${totalUnidades} unidad(es)`
                  : "Agrega lo vendido"
              }
              completo={
                items.length > 0
              }
            />

            <PasoVenta
              numero="3"
              titulo="Confirmar"
              detalle={
                items.length
                  ? `Total ${formatMoney(total)}`
                  : "Revisa y registra"
              }
              completo={
                datosVentaListos &&
                items.length > 0
              }
            />
          </div>
        </div>
      </div>

      {error && (

        <div
          className="toast toast-error"
          style={{
            position: "static",
            marginBottom: 14
          }}
        >
          ⚠️ {error}
        </div>

      )}

      {/* =====================================================
          DATOS + PRODUCTOS
      ===================================================== */}

      <section
        className="inv-grid"
        style={{
          alignItems: "start"
        }}
      >

        {/* =================================================
            1. CLIENTE Y FORMA DE PAGO
        ================================================= */}

        <div
          className="card"
          style={{
            border:
              datosVentaListos
                ? "1px solid rgba(34,197,94,.30)"
                : "1px solid rgba(59,130,246,.28)"
          }}
        >

          <div
            className="card-header"
            style={{
              background:
                datosVentaListos
                  ? "rgba(34,197,94,.045)"
                  : "rgba(59,130,246,.045)"
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent:
                  "space-between",
                alignItems:
                  "flex-start",
                gap: 10
              }}
            >
              <div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8
                  }}
                >
                  <span
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: 999,
                      display: "grid",
                      placeItems: "center",
                      background:
                        datosVentaListos
                          ? "#22c55e"
                          : "#3b82f6",
                      color: "#fff",
                      fontSize: 12,
                      fontWeight: 900
                    }}
                  >
                    {datosVentaListos
                      ? "✓"
                      : "1"}
                  </span>

                  <h2
                    style={{
                      margin: 0
                    }}
                  >
                    Cliente y pago
                  </h2>
                </div>

                <p
                  className="inv-subtle"
                  style={{
                    margin:
                      "4px 0 0",
                    fontSize: 12
                  }}
                >
                  Selecciona el cliente y define cómo paga.
                </p>
              </div>

              <span
                className="badge"
                style={{
                  color:
                    tipoPago === "CREDITO"
                      ? "#f59e0b"
                      : "#22c55e"
                }}
              >
                {tipoPago === "CREDITO"
                  ? "📅 Crédito"
                  : "💵 Contado"}
              </span>
            </div>
          </div>

          <div
            className="card-body"
            style={{
              padding: 16
            }}
          >

            {/* CLIENTE */}

            <div
              style={{
                fontSize: 11,
                fontWeight: 800,
                color: "var(--muted)",
                textTransform:
                  "uppercase",
                letterSpacing: ".05em",
                marginBottom: 9
              }}
            >
              Cliente
            </div>

            {cliente.id ? (

              <div
                style={{
                  display: "flex",
                  justifyContent:
                    "space-between",
                  alignItems: "center",
                  gap: 10,
                  flexWrap: "wrap",
                  padding: 11,
                  border:
                    "1px solid rgba(34,197,94,.28)",
                  borderRadius: 12,
                  background:
                    "rgba(34,197,94,.05)"
                }}
              >
                <div>
                  <strong>
                    {cliente.nombre}
                  </strong>

                  <div
                    className="inv-subtle"
                    style={{
                      marginTop: 3,
                      fontSize: 11
                    }}
                  >
                    Documento:{" "}
                    {cliente.documento ||
                      "—"}
                  </div>
                </div>

                <button
                  type="button"
                  className="btn btn-small"
                  onClick={
                    cambiarCliente
                  }
                >
                  Cambiar
                </button>
              </div>

            ) : modoClienteNuevo ? (

              <div
                style={{
                  padding: 11,
                  border:
                    "1px solid var(--border)",
                  borderRadius: 12,
                  background:
                    "rgba(59,130,246,.035)"
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent:
                      "space-between",
                    alignItems: "center",
                    gap: 8,
                    marginBottom: 9
                  }}
                >
                  <strong>
                    ➕ Cliente nuevo
                  </strong>

                  <button
                    type="button"
                    className="btn btn-small"
                    onClick={
                      cambiarCliente
                    }
                  >
                    Cancelar
                  </button>
                </div>

                <div className="form-grid">

                  <div className="form-field">
                    <label>
                      Nombre
                      {tipoPago === "CREDITO"
                        ? " *"
                        : ""}
                    </label>

                    <input
                      autoFocus
                      placeholder="Nombre del cliente"
                      value={
                        cliente.nombre
                      }
                      onChange={e =>
                        setCliente(
                          prev => ({
                            ...prev,
                            nombre:
                              e.target.value
                          })
                        )
                      }
                    />
                  </div>

                  <div className="form-field">
                    <label>
                      Documento
                      {tipoPago === "CREDITO"
                        ? " *"
                        : ""}
                    </label>

                    <input
                      placeholder="CC / NIT"
                      value={
                        cliente.documento
                      }
                      onChange={e =>
                        setCliente(
                          prev => ({
                            ...prev,
                            documento:
                              e.target.value
                          })
                        )
                      }
                    />
                  </div>

                </div>
              </div>

            ) : (

              <>
                <div className="input-with-icon">

                  <span className="icon">
                    🔎
                  </span>

                  <input
                    type="text"
                    placeholder="Buscar por nombre o documento..."
                    value={
                      busquedaCliente
                    }
                    onChange={e =>
                      setBusquedaCliente(
                        e.target.value
                      )
                    }
                  />

                </div>

                {busquedaCliente.trim().length ===
                  1 && (

                  <p
                    className="inv-subtle"
                    style={{
                      margin:
                        "6px 0 0",
                      fontSize: 10
                    }}
                  >
                    Escribe al menos 2 caracteres.
                  </p>

                )}

                {buscandoClientes && (

                  <p
                    className="inv-subtle"
                    style={{
                      margin:
                        "8px 0 0",
                      fontSize: 11
                    }}
                  >
                    Buscando clientes…
                  </p>

                )}

                {!buscandoClientes &&
                  resultadosClientes.length >
                    0 && (

                  <div
                    style={{
                      display: "grid",
                      gap: 6,
                      marginTop: 8,
                      maxHeight: 170,
                      overflowY: "auto"
                    }}
                  >
                    {resultadosClientes.map(
                      resultado => (

                        <button
                          key={
                            resultado.id
                          }
                          type="button"
                          className="btn"
                          onClick={() =>
                            seleccionarCliente(
                              resultado
                            )
                          }
                          style={{
                            display: "flex",
                            justifyContent:
                              "space-between",
                            alignItems: "center",
                            gap: 10,
                            textAlign: "left",
                            padding:
                              "8px 10px"
                          }}
                        >
                          <span>
                            <strong>
                              {resultado.nombre ||
                                "Sin nombre"}
                            </strong>

                            <span
                              className="inv-subtle"
                              style={{
                                display: "block",
                                marginTop: 2,
                                fontSize: 10
                              }}
                            >
                              {resultado.documento ||
                                "Sin documento"}
                            </span>
                          </span>

                          <span>
                            →
                          </span>
                        </button>

                      )
                    )}
                  </div>

                )}

                {!busquedaCliente &&
                  clientesRecientes.length >
                    0 && (

                  <div
                    style={{
                      marginTop: 9
                    }}
                  >
                    <div
                      className="inv-subtle"
                      style={{
                        marginBottom: 6,
                        fontSize: 10
                      }}
                    >
                      Clientes recientes
                    </div>

                    <div
                      style={{
                        display: "flex",
                        gap: 6,
                        flexWrap: "wrap"
                      }}
                    >
                      {clientesRecientes.map(
                        reciente => (

                          <button
                            key={
                              reciente.id
                            }
                            type="button"
                            className="btn btn-small"
                            onClick={() =>
                              seleccionarCliente(
                                reciente
                              )
                            }
                          >
                            👤 {reciente.nombre}
                          </button>

                        )
                      )}
                    </div>
                  </div>

                )}

                <div
                  style={{
                    display: "flex",
                    gap: 7,
                    flexWrap: "wrap",
                    marginTop: 9
                  }}
                >
                  <button
                    type="button"
                    className="btn btn-small"
                    onClick={
                      iniciarClienteNuevo
                    }
                  >
                    ➕ Cliente nuevo
                  </button>

                  {tipoPago === "CONTADO" && (

                    <button
                      type="button"
                      className="btn btn-small"
                      onClick={
                        usarConsumidorFinal
                      }
                    >
                      👤 Consumidor final
                    </button>

                  )}
                </div>
              </>

            )}

            {/* PAGO */}

            <div
              style={{
                marginTop: 14,
                paddingTop: 13,
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
                  marginBottom: 9
                }}
              >
                Forma de pago
              </div>

              <div className="form-grid">

                <div className="form-field">
                  <label>
                    Tipo *
                  </label>

                  <select
                    value={
                      tipoPago
                    }
                    onChange={e =>
                      seleccionarTipoPago(
                        e.target.value
                      )
                    }
                  >
                    <option value="CONTADO">
                      💵 Contado
                    </option>

                    <option value="CREDITO">
                      📅 Crédito
                    </option>
                  </select>
                </div>

                {tipoPago === "CREDITO" ? (

                  <div className="form-field">
                    <label>
                      Vencimiento *
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

                ) : (

                  <div
                    style={{
                      display: "flex",
                      alignItems: "end"
                    }}
                  >
                    <div
                      style={{
                        width: "100%",
                        minHeight: 40,
                        padding:
                          "9px 11px",
                        border:
                          "1px solid rgba(34,197,94,.25)",
                        borderRadius: 10,
                        background:
                          "rgba(34,197,94,.05)",
                        fontSize: 11
                      }}
                    >
                      ✅ Pago inmediato
                    </div>
                  </div>

                )}

              </div>
            </div>

          </div>

        </div>

        {/* =================================================
            2. AGREGAR PRODUCTOS
        ================================================= */}

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
                "rgba(139,92,246,.045)"
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent:
                  "space-between",
                alignItems:
                  "flex-start",
                gap: 10
              }}
            >
              <div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8
                  }}
                >
                  <span
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: 999,
                      display: "grid",
                      placeItems: "center",
                      background:
                        items.length
                          ? "#22c55e"
                          : "#8b5cf6",
                      color: "#fff",
                      fontSize: 12,
                      fontWeight: 900
                    }}
                  >
                    {items.length
                      ? "✓"
                      : "2"}
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
                    margin:
                      "4px 0 0",
                    fontSize: 12
                  }}
                >
                  Selecciona cada referencia vendida.
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
              padding: 16
            }}
          >

            <button
              type="button"
              className="btn btn-primary"
              onClick={() =>
                setModalProductos(
                  true
                )
              }
            >
              🔎 Buscar producto
            </button>

            {!productoSeleccionado ? (

              <div
                style={{
                  marginTop: 12,
                  padding:
                    "24px 16px",
                  textAlign: "center",
                  border:
                    "1px dashed var(--border)",
                  borderRadius: 13,
                  background:
                    "rgba(255,255,255,.012)"
                }}
              >
                <div
                  style={{
                    fontSize: 24,
                    marginBottom: 6
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
                      "4px 0 0",
                    fontSize: 11
                  }}
                >
                  Aquí aparecerán cantidad, precio y stock disponible.
                </p>
              </div>

            ) : (

              <>
                <div
                  style={{
                    marginTop: 12,
                    padding: 12,
                    border:
                      "1px solid rgba(139,92,246,.25)",
                    borderRadius: 13,
                    background:
                      "rgba(139,92,246,.035)"
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent:
                        "space-between",
                      alignItems:
                        "flex-start",
                      gap: 10,
                      flexWrap: "wrap"
                    }}
                  >
                    <div>
                      <strong
                        style={{
                          fontSize: 15
                        }}
                      >
                        {productoSeleccionado.nombre}
                      </strong>

                      <div
                        className="product-meta"
                        style={{
                          marginTop: 5,
                          fontSize: 10
                        }}
                      >
                        <span>
                          Normal:{" "}
                          <b>
                            {formatMoney(
                              precioNormalActual
                            )}
                          </b>
                        </span>

                        <span>
                          Mínimo:{" "}
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
                          Disponible:{" "}
                          <b
                            style={{
                              color:
                                stockDisponibleSeleccionado >
                                0
                                  ? "#22c55e"
                                  : "#ef4444"
                            }}
                          >
                            {stockDisponibleSeleccionado}
                          </b>
                        </span>
                      </div>
                    </div>

                    {cantidadSeleccionadaEnCarrito >
                      0 && (

                      <span
                        className="badge"
                        style={{
                          color:
                            "#00b4d8"
                        }}
                      >
                        🛒 {cantidadSeleccionadaEnCarrito} en carrito
                      </span>

                    )}
                  </div>
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns:
                      "90px minmax(140px, 1fr) minmax(120px, .75fr)",
                    gap: 9,
                    alignItems: "end",
                    marginTop: 11
                  }}
                >

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
                        borderColor:
                          precioInvalido
                            ? "#ef4444"
                            : undefined
                      }}
                    />
                  </div>

                  <div
                    style={{
                      minHeight: 40,
                      padding:
                        "8px 10px",
                      border:
                        "1px solid var(--border)",
                      borderRadius: 10,
                      textAlign: "right"
                    }}
                  >
                    <div
                      className="inv-subtle"
                      style={{
                        fontSize: 9
                      }}
                    >
                      Subtotal
                    </div>

                    <strong>
                      {formatMoney(
                        subtotalActual
                      )}
                    </strong>
                  </div>

                </div>

                <div
                  style={{
                    display: "flex",
                    justifyContent:
                      "space-between",
                    gap: 8,
                    flexWrap: "wrap",
                    marginTop: 6,
                    fontSize: 10
                  }}
                >
                  <span className="inv-subtle">
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
                        color:
                          "#22c55e",
                        fontWeight: 800
                      }}
                    >
                      🏷️ {descuentoPorcentajeActual.toFixed(
                        1
                      )}
                      %
                    </span>

                  )}
                </div>

                {precioInvalido && (

                  <div
                    style={{
                      marginTop: 7,
                      padding:
                        "7px 9px",
                      border:
                        "1px solid rgba(239,68,68,.25)",
                      borderRadius: 9,
                      background:
                        "rgba(239,68,68,.07)",
                      color:
                        "#ef4444",
                      fontSize: 10,
                      fontWeight: 700
                    }}
                  >
                    ⚠️ El precio no puede ser menor que{" "}
                    {formatMoney(
                      precioMinimoActual
                    )}.
                  </div>

                )}

                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={
                    agregarItem
                  }
                  disabled={
                    precioInvalido
                  }
                  style={{
                    marginTop: 10
                  }}
                >
                  ➕ Agregar
                </button>

              </>

            )}

          </div>

        </div>

      </section>

      {/* =====================================================
          3. DETALLE DE LA VENTA
      ===================================================== */}

      <div
        style={{
          marginTop: 14
        }}
      >

        {/* =================================================
            DETALLE VENTA - VISTA COMPACTA
        ================================================= */}

        <div className="card venta-detalle-card">

          <div className="card-header venta-detalle-header">

            <div>

              <h2>
                Detalle de la venta
              </h2>

              <p className="inv-subtle venta-detalle-resumen">
                {items.length === 0
                  ? "Aún no hay productos agregados."
                  : `${items.length} ${
                      items.length === 1
                        ? "referencia"
                        : "referencias"
                    } • ${totalUnidades} ${
                      totalUnidades === 1
                        ? "unidad"
                        : "unidades"
                    }`}
              </p>

            </div>

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

          <div className="card-body venta-detalle-body">

            {items.length === 0 ? (

              <div className="venta-detalle-vacio">
                <span className="venta-detalle-vacio-icono">
                  🛒
                </span>

                <p className="inv-subtle">
                  Sin productos agregados.
                </p>
              </div>

            ) : (

              <div className="venta-tabla-wrap">

                <div className="venta-tabla">

                  <div className="venta-tabla-head">
                    <span>Producto</span>
                    <span className="venta-col-center">
                      Cant.
                    </span>
                    <span className="venta-col-number">
                      Precio
                    </span>
                    <span className="venta-col-number venta-col-minimo">
                      Mínimo
                    </span>
                    <span className="venta-col-number">
                      Subtotal
                    </span>
                    <span
                      className="venta-col-center"
                      aria-hidden="true"
                    >
                      Acción
                    </span>
                  </div>

                  <div className="venta-tabla-body">

                    {items.map(it => {

                      const tieneDescuento =
                        Number(
                          it.precioUnitario
                        ) <
                        Number(
                          it.precioLista
                        );

                      return (

                        <div
                          key={
                            it.productoId
                          }
                          className="venta-tabla-row"
                        >

                          <div className="venta-producto-cell">

                            <strong
                              className="venta-producto-nombre"
                              title={it.nombre}
                            >
                              {it.nombre}
                            </strong>

                            {tieneDescuento && (

                              <span className="venta-descuento-mini">
                                🏷️{" "}
                                {Number(
                                  it.descuentoPorcentaje ||
                                  0
                                ).toFixed(
                                  1
                                )}
                                %
                              </span>

                            )}

                          </div>

                          <div
                            className="venta-col-center venta-cantidad"
                            data-label="Cantidad"
                          >
                            {it.cantidad}
                          </div>

                          <div
                            className="venta-col-number venta-precio-cell"
                            data-label="Precio"
                          >

                            {tieneDescuento && (

                              <span className="venta-precio-lista">
                                {formatMoney(
                                  it.precioLista
                                )}
                              </span>

                            )}

                            <strong>
                              {formatMoney(
                                it.precioUnitario
                              )}
                            </strong>

                          </div>

                          <div
                            className="venta-col-number venta-col-minimo"
                            data-label="Mínimo"
                          >
                            {formatMoney(
                              it.precioMinimo
                            )}
                          </div>

                          <div
                            className="venta-col-number venta-subtotal"
                            data-label="Subtotal"
                          >
                            {formatMoney(
                              it.cantidad *
                              it.precioUnitario
                            )}
                          </div>

                          <div className="venta-col-center venta-accion">

                            <button
                              type="button"
                              className="btn btn-small btn-danger venta-quitar-btn"
                              onClick={() =>
                                quitarItem(
                                  it.productoId
                                )
                              }
                              title={`Quitar ${it.nombre}`}
                              aria-label={`Quitar ${it.nombre}`}
                            >
                              ✕
                              <span className="venta-quitar-texto">
                                Quitar
                              </span>
                            </button>

                          </div>

                        </div>

                      );
                    })}

                  </div>

                </div>

              </div>

            )}

            <div className="venta-resumen-fijo">

              {descuentoTotal >
                0 && (

                <div className="venta-resumen-linea venta-resumen-descuento">

                  <span>
                    🏷️ Descuentos aplicados
                  </span>

                  <strong>
                    -{formatMoney(
                      descuentoTotal
                    )}
                  </strong>

                </div>

              )}

              <div className="venta-resumen-total">

                <div>
                  <span className="inv-subtle venta-total-etiqueta">
                    Total de la venta
                  </span>

                  <strong className="venta-total-referencias">
                    {items.length} ref. • {totalUnidades} unid.
                  </strong>
                </div>

                <strong className="venta-total-valor">
                  {formatMoney(total)}
                </strong>

              </div>

              {tipoPago ===
                "CREDITO" && (

                <div className="venta-resumen-linea venta-resumen-credito">

                  <span>
                    Saldo pendiente
                  </span>

                  <strong>
                    {formatMoney(total)}
                  </strong>

                </div>

              )}

            </div>

          </div>

          <div className="card-footer venta-footer">

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



      </div>

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
                placeholder="Buscar por código, nombre o categoría..."
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
                        title={`${stockDisponibleEnVenta(
                          p
                        )} disponibles`}
                      >
                        {p.nombre} ·{" "}
                        {stockDisponibleEnVenta(
                          p
                        )} disp.
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

                      const reservadoEnVenta =
                        cantidadEnCarritoDe(
                          p.id
                        );

                      const disponibleEnVenta =
                        stockDisponibleEnVenta(
                          p
                        );

                      const stock =
                        stockInfo({
                          ...p,
                          cantidad:
                            disponibleEnVenta
                        });

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
                              Disponible:{" "}
                              {disponibleEnVenta}
                            </span>

                            {reservadoEnVenta >
                              0 && (

                              <span
                                style={{
                                  fontSize: 12,
                                  color:
                                    "#00b4d8",
                                  fontWeight: 700
                                }}
                              >
                                🛒 En esta venta:{" "}
                                {reservadoEnVenta}
                              </span>

                            )}

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
                              disponibleEnVenta <= 0
                            }
                          >
                            {disponibleEnVenta <= 0
                              ? reservadoEnVenta > 0
                                ? "Agotado en esta venta"
                                : "Sin stock"
                              : `Seleccionar · ${disponibleEnVenta} disp.`}
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

/* =========================================================
   PASO VENTA
========================================================= */

function PasoVenta({
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

