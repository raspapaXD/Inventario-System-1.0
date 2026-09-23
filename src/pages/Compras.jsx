// src/pages/Compras.jsx

import { useEffect, useMemo, useRef, useState } from "react";
import {
  collection,
  doc,
  endAt,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  startAt,
  Timestamp,
  where
} from "firebase/firestore";

import { db } from "../../firebaseClient.js";
import { Link } from "react-router-dom";
import { useTenant } from "../tenant/TenantProvider";
import AppMenu from "../components/AppMenu.jsx";
import ImportarComprobanteModal from "../components/ImportarComprobanteModal.jsx";

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


const limpiarNumero = value =>
  String(value ?? "")
    .replace(/[^0-9]/g, "");

const formatearNumeroInput = value => {
  const limpio =
    limpiarNumero(value);

  if (!limpio) {
    return "";
  }

  return Number(limpio)
    .toLocaleString("es-CO");
};

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


const PROVEEDORES_BUSQUEDA_LIMITE = 8;
const PROVEEDORES_RECIENTES_LIMITE = 5;

const normalizarNombreBusqueda = value =>
  String(value || "")
    .trim()
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


/* =========================================================
   COMPONENTE
========================================================= */

export default function Compras() {
  const { empresa, user } = useTenant();
  const { theme, toggle } = useTheme();

  /*
   * Borrador temporal de compra:
   * conserva factura, proveedor y productos mientras
   * navegas por Ordexa dentro de esta misma pestaña.
   */
  const borradorRestauradoRef =
    useRef(false);

  const productoPendienteRestaurarRef =
    useRef(null);

  const [
    borradorRecuperado,
    setBorradorRecuperado
  ] = useState(false);

  const esClaro = theme === "light";

  const superficieSuave = esClaro
    ? "#f8fafc"
    : "rgba(255,255,255,.025)";

  const superficieAcento = esClaro
    ? "#f5f8ff"
    : "rgba(59,130,246,.055)";

  /* =======================================================
     PROVEEDOR - BÚSQUEDA ESCALABLE

     No descargamos toda la colección de proveedores.
     Buscamos por prefijo con debounce y máximo 8 resultados.
  ======================================================= */

  const [
    proveedorSeleccionado,
    setProveedorSeleccionado
  ] = useState(null);

  const [
    proveedorNuevo,
    setProveedorNuevo
  ] = useState(false);

  const [
    qProveedor,
    setQProveedor
  ] = useState("");

  const [
    resultadosProveedores,
    setResultadosProveedores
  ] = useState([]);

  const [
    buscandoProveedor,
    setBuscandoProveedor
  ] = useState(false);

  const [
    recientesProveedores,
    setRecientesProveedores
  ] = useState([]);

  /* =======================================================
     PROVEEDORES RECIENTES
  ======================================================= */

  const proveedoresRecientesKey =
    empresa?.id
      ? `ordexa_proveedores_recientes_${empresa.id}`
      : null;

  useEffect(() => {
    if (!proveedoresRecientesKey) {
      setRecientesProveedores([]);
      return;
    }

    try {
      const guardados =
        JSON.parse(
          localStorage.getItem(
            proveedoresRecientesKey
          ) ||
          "[]"
        );

      setRecientesProveedores(
        Array.isArray(guardados)
          ? guardados.slice(
              0,
              PROVEEDORES_RECIENTES_LIMITE
            )
          : []
      );
    } catch {
      setRecientesProveedores([]);
    }
  }, [
    proveedoresRecientesKey
  ]);

  const guardarProveedorReciente =
    proveedor => {
      if (
        !proveedoresRecientesKey ||
        !proveedor?.id
      ) {
        return;
      }

      setRecientesProveedores(
        prev => {
          const nuevo = [
            {
              id:
                proveedor.id,

              nombre:
                proveedor.nombre ||
                "Proveedor",

              documento:
                proveedor.documento ||
                ""
            },

            ...prev.filter(
              p =>
                p.id !==
                proveedor.id
            )
          ].slice(
            0,
            PROVEEDORES_RECIENTES_LIMITE
          );

          try {
            localStorage.setItem(
              proveedoresRecientesKey,
              JSON.stringify(
                nuevo
              )
            );
          } catch {
            // No bloqueamos una compra por localStorage.
          }

          return nuevo;
        }
      );
    };

  /* =======================================================
     CONSULTAS DE PROVEEDORES
  ======================================================= */

  const proveedoresCol =
    useMemo(() => {
      if (!empresa?.id) {
        return null;
      }

      return collection(
        db,
        "empresas",
        empresa.id,
        "proveedores"
      );
    }, [
      empresa?.id
    ]);

  const buscarProveedorPrefijo =
    async (
      campo,
      prefijo
    ) => {
      if (
        !proveedoresCol ||
        !prefijo
      ) {
        return [];
      }

      const snap =
        await getDocs(
          query(
            proveedoresCol,
            orderBy(
              campo
            ),
            startAt(
              prefijo
            ),
            endAt(
              `${prefijo}\uf8ff`
            ),
            limit(
              PROVEEDORES_BUSQUEDA_LIMITE
            )
          )
        );

      return snap.docs.map(
        d => ({
          id:
            d.id,
          ...d.data()
        })
      );
    };

  const buscarProveedoresRemoto =
    async texto => {
      const limpio =
        String(texto || "")
          .trim();

      if (
        limpio.length < 2 ||
        !proveedoresCol
      ) {
        return [];
      }

      const porDocumento =
        esBusquedaDocumento(
          limpio
        );

      /*
       * Buscamos tanto en los campos nuevos como
       * en los campos legacy para no perder los
       * proveedores que ya existen en Ordexa.
       */
      const consultas =
        porDocumento
          ? [
              buscarProveedorPrefijo(
                "documentoNormalizado",
                normalizarDocumento(
                  limpio
                )
              ),

              buscarProveedorPrefijo(
                "documento",
                limpio
              )
            ]
          : [
              buscarProveedorPrefijo(
                "nombreBusqueda",
                normalizarNombreBusqueda(
                  limpio
                )
              ),

              buscarProveedorPrefijo(
                "nombreLower",
                limpio.toLowerCase()
              )
            ];

      const respuestas =
        await Promise.allSettled(
          consultas
        );

      const unicos =
        new Map();

      for (
        const respuesta
        of respuestas
      ) {
        if (
          respuesta.status ===
          "fulfilled"
        ) {
          for (
            const proveedor
            of respuesta.value
          ) {
            unicos.set(
              proveedor.id,
              proveedor
            );
          }
        }
      }

      return Array.from(
        unicos.values()
      ).slice(
        0,
        PROVEEDORES_BUSQUEDA_LIMITE
      );
    };

  useEffect(() => {
    const texto =
      qProveedor.trim();

    if (
      proveedorSeleccionado ||
      proveedorNuevo ||
      texto.length < 2
    ) {
      setResultadosProveedores([]);
      setBuscandoProveedor(false);
      return;
    }

    let cancelado =
      false;

    const timer =
      setTimeout(
        async () => {
          try {
            setBuscandoProveedor(true);

            const lista =
              await buscarProveedoresRemoto(
                texto
              );

            if (!cancelado) {
              setResultadosProveedores(
                lista
              );
            }
          } catch (e) {
            console.error(
              "Error buscando proveedores:",
              e
            );

            if (!cancelado) {
              setResultadosProveedores([]);
            }
          } finally {
            if (!cancelado) {
              setBuscandoProveedor(false);
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
    qProveedor,
    proveedorSeleccionado,
    proveedorNuevo,
    proveedoresCol
  ]);

  const seleccionarProveedor =
    proveedor => {
      if (!proveedor) {
        return;
      }

      setProveedorSeleccionado(
        proveedor
      );

      setProveedorNuevo(
        false
      );

      setQProveedor(
        ""
      );

      setResultadosProveedores(
        []
      );

      setFactura(
        prev => ({
          ...prev,

          proveedorNombre:
            proveedor.nombre ||
            "",

          proveedorDocumento:
            proveedor.documento ||
            ""
        })
      );

      guardarProveedorReciente(
        proveedor
      );

      setError(
        ""
      );
    };

  const limpiarProveedor =
    () => {
      setProveedorSeleccionado(
        null
      );

      setProveedorNuevo(
        false
      );

      setQProveedor(
        ""
      );

      setResultadosProveedores(
        []
      );

      setFactura(
        prev => ({
          ...prev,
          proveedorNombre: "",
          proveedorDocumento: ""
        })
      );
    };

  const iniciarProveedorNuevo =
    () => {
      const texto =
        qProveedor.trim();

      setProveedorSeleccionado(
        null
      );

      setProveedorNuevo(
        true
      );

      setResultadosProveedores(
        []
      );

      setFactura(
        prev => ({
          ...prev,

          proveedorNombre:
            esBusquedaDocumento(
              texto
            )
              ? ""
              : texto,

          proveedorDocumento:
            esBusquedaDocumento(
              texto
            )
              ? texto
              : ""
        })
      );

      setError(
        ""
      );
    };

  const cancelarProveedorNuevo =
    () => {
      setProveedorNuevo(
        false
      );

      setFactura(
        prev => ({
          ...prev,
          proveedorNombre: "",
          proveedorDocumento: ""
        })
      );
    };

  const buscarProveedorDocumentoExacto =
    async documento => {
      if (
        !proveedoresCol ||
        !documento
      ) {
        return null;
      }

      const documentoNormalizado =
        normalizarDocumento(
          documento
        );

      const consultas = [
        getDocs(
          query(
            proveedoresCol,
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
            proveedoresCol,
            where(
              "documento",
              "==",
              documento
            ),
            limit(1)
          )
        )
      ];

      const respuestas =
        await Promise.allSettled(
          consultas
        );

      for (
        const respuesta
        of respuestas
      ) {
        if (
          respuesta.status ===
            "fulfilled" &&
          !respuesta.value.empty
        ) {
          const d =
            respuesta.value.docs[0];

          return {
            id:
              d.id,
            ...d.data()
          };
        }
      }

      return null;
    };

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
  const [modalImportar, setModalImportar] = useState(false);

  /* =======================================================
     BORRADOR DE COMPRA

     sessionStorage permite:
     - ir a Inventario / Proveedores / Cartera
     - volver a Compras sin perder lo ingresado
     - recuperar el borrador tras refrescar esta pestaña

     Al cerrar la pestaña, el borrador desaparece.
  ======================================================= */

  const borradorKey =
    empresa?.id &&
    user?.uid
      ? `ordexa_borrador_compra_${empresa.id}_${user.uid}`
      : null;

  /*
   * Restaurar una sola vez por montaje.
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
        borrador?.factura &&
        typeof borrador.factura ===
          "object"
      ) {
        setFactura(
          prev => ({
            ...prev,
            ...borrador.factura
          })
        );
      }

      if (
        borrador?.proveedorSeleccionado &&
        typeof borrador.proveedorSeleccionado ===
          "object"
      ) {
        setProveedorSeleccionado(
          borrador.proveedorSeleccionado
        );
      }

      setProveedorNuevo(
        Boolean(
          borrador?.proveedorNuevo
        )
      );

      setQProveedor(
        borrador?.qProveedor ||
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

      setBusqueda(
        borrador?.busqueda ||
        ""
      );

      if (
        borrador?.linea &&
        typeof borrador.linea ===
          "object"
      ) {
        setLinea(
          prev => ({
            ...prev,
            ...borrador.linea
          })
        );
      }

      productoPendienteRestaurarRef.current =
        borrador?.productoId ||
        null;

      const tieneContenido =
        Boolean(
          borrador?.factura?.numeroFactura ||
          borrador?.factura?.proveedorNombre ||
          borrador?.proveedorSeleccionado?.id ||
          borrador?.proveedorNuevo ||
          (
            Array.isArray(
              borrador?.items
            ) &&
            borrador.items.length > 0
          ) ||
          borrador?.productoId
        );

      setBorradorRecuperado(
        tieneContenido
      );

    } catch (e) {
      console.warn(
        "No se pudo restaurar el borrador de compra.",
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
   * Guardado automático.
   * Esperamos a que primero se intente restaurar,
   * para no sobrescribir un borrador con valores vacíos.
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
      Boolean(
        factura.numeroFactura ||
        factura.proveedorNombre ||
        factura.proveedorDocumento ||
        proveedorSeleccionado?.id ||
        proveedorNuevo ||
        items.length > 0 ||
        productoId
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

      factura,

      proveedorSeleccionado:
        proveedorSeleccionado
          ? {
              id:
                proveedorSeleccionado.id,

              nombre:
                proveedorSeleccionado.nombre ||
                "",

              documento:
                proveedorSeleccionado.documento ||
                ""
            }
          : null,

      proveedorNuevo,

      qProveedor,

      items,

      productoId,

      busqueda,

      linea,

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
        "No se pudo guardar el borrador de compra.",
        e
      );
    }
  }, [
    borradorKey,
    factura,
    proveedorSeleccionado,
    proveedorNuevo,
    qProveedor,
    items,
    productoId,
    busqueda,
    linea,
    guardando
  ]);

  /*
   * Si había un producto seleccionado antes de salir,
   * lo recuperamos usando el producto FRESCO leído de
   * Firestore. Así un ajuste hecho en Inventario se refleja
   * al volver a Compras.
   */
  useEffect(() => {
    const idPendiente =
      productoPendienteRestaurarRef.current;

    if (
      !idPendiente ||
      productos.length === 0
    ) {
      return;
    }

    const producto =
      productos.find(
        p =>
          p.id ===
          idPendiente
      );

    productoPendienteRestaurarRef.current =
      null;

    if (
      producto &&
      producto.activo !== false
    ) {
      setProductoId(
        producto.id
      );
    }
  }, [
    productos
  ]);

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

    const precioMinimoCalculado =
      costoPromedio *
      (
        1 +
        gananciaMinima
      );

    const precioMinimoManual =
      Number(
        productoActual?.precioMinimo ||
        0
      );

    const usaPrecioMinimoManual =
      productoActual?.precioMinimoManual ===
        true &&
      Number.isFinite(
        precioMinimoManual
      ) &&
      precioMinimoManual >
        0;

    const precioMinimo =
      usaPrecioMinimoManual
        ? precioMinimoManual
        : precioMinimoCalculado;

    return {
      stockActual,
      costoAnterior,
      nuevoStock,
      costoPromedio,
      precioSugerido,
      precioMinimo,
      usaPrecioMinimoManual
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
          formatearNumeroInput(
            productoActual.costoPromedio ??
            productoActual.costoUnitario ??
            ""
          )
      }));
    }
  }, [productoActual]);

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
        formatearNumeroInput(
          p?.costoPromedio ??
          p?.costoUnitario ??
          ""
        ),
      gananciaObjetivo:
        p?.porcentajeGanancia ??
        30,
      gananciaMinima:
        p?.porcentajeGananciaMinima ??
        10,
      precioVenta:
        formatearNumeroInput(
          p?.precioUnitario ??
          0
        )
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

      /*
       * Si estamos creando un proveedor nuevo y tiene
       * documento, comprobamos que no exista otro con
       * ese mismo documento antes de registrar la compra.
       */
      if (
        !proveedorSeleccionado &&
        factura.proveedorDocumento.trim()
      ) {
        const existente =
          await buscarProveedorDocumentoExacto(
            factura.proveedorDocumento.trim()
          );

        if (
          existente
        ) {
          seleccionarProveedor(
            existente
          );

          setGuardando(
            false
          );

          return setError(
            `Ya existe el proveedor "${existente.nombre || "Proveedor"}" con ese documento. Ordexa lo seleccionó automáticamente; revisa los datos y vuelve a registrar la factura.`
          );
        }
      }

      const proveedorDocumentoNormalizado =
        normalizarDocumento(
          factura.proveedorDocumento
        );

      /*
       * Si el proveedor ya existe conservamos su ID.
       * Si es nuevo usamos documento normalizado o,
       * si no tiene documento, un slug del nombre.
       */
      const proveedorId =
        proveedorSeleccionado?.id ||
        proveedorDocumentoNormalizado ||
        slug(
          factura.proveedorNombre
        );

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

            const precioMinimoCalculado =
              costoPromedio *
              (
                1 +
                item.gananciaMinima /
                  100
              );

            const precioMinimoManual =
              Number(
                producto.precioMinimo ||
                0
              );

            const usaPrecioMinimoManual =
              producto.precioMinimoManual ===
                true &&
              Number.isFinite(
                precioMinimoManual
              ) &&
              precioMinimoManual >
                0;

            const precioMinimo =
              usaPrecioMinimoManual
                ? precioMinimoManual
                : precioMinimoCalculado;

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
                /*
                 * Un mínimo manual se conserva.
                 * Si el producto usa mínimo automático,
                 * lo recalculamos normalmente.
                 */
                precioMinimo:
                  Math.round(
                    precioMinimo
                  ),

                precioMinimoManual:
                  usaPrecioMinimoManual,

                /*
                 * El precio de venta lo define el usuario al crear
                 * o editar el producto. La compra solo recalcula la
                 * sugerencia según el costo y el margen configurado.
                 */
                precioUnitario:
                  Number(
                    producto.precioUnitario ??
                    item.precioVenta ??
                    0
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

              /*
               * Conservamos nombreLower por compatibilidad
               * y agregamos los campos preparados para las
               * búsquedas escalables.
               */
              nombreLower:
                factura.proveedorNombre
                  .trim()
                  .toLowerCase(),

              nombreBusqueda:
                normalizarNombreBusqueda(
                  factura.proveedorNombre
                ),

              documento:
                factura.proveedorDocumento.trim() ||
                null,

              documentoNormalizado:
                proveedorDocumentoNormalizado ||
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

      const proveedorGuardado = {
        id:
          proveedorId,

        nombre:
          factura.proveedorNombre.trim(),

        documento:
          factura.proveedorDocumento.trim()
      };

      guardarProveedorReciente(
        proveedorGuardado
      );

      /*
       * Compra registrada correctamente:
       * ya no necesitamos conservar el borrador.
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

      setBorradorRecuperado(
        false
      );

      setProveedorSeleccionado(
        null
      );

      setProveedorNuevo(
        false
      );

      setQProveedor(
        ""
      );

      setResultadosProveedores(
        []
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

          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setModalImportar(true)}
          >
            📄 Importar compra
          </button>

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
            marginBottom: 12,
            padding:
              "9px 12px",
            border:
              "1px solid rgba(59,130,246,.22)",
            borderRadius: 11,
            background:
              esClaro
                ? "#f3f7ff"
                : "rgba(59,130,246,.055)",
            fontSize: 11
          }}
        >
          <span>
            💾 Recuperamos la compra que estabas preparando.
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
                  display: "flex",
                  justifyContent:
                    "space-between",
                  gap: 10,
                  alignItems: "center",
                  flexWrap: "wrap",
                  marginBottom: 10
                }}
              >
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 800,
                    color: "var(--muted)",
                    textTransform:
                      "uppercase",
                    letterSpacing: ".05em"
                  }}
                >
                  Proveedor
                </div>

                {!proveedorSeleccionado &&
                  !proveedorNuevo && (

                  <span
                    className="inv-subtle"
                    style={{
                      fontSize: 10
                    }}
                  >
                    🔎 Búsqueda remota · máximo {PROVEEDORES_BUSQUEDA_LIMITE} resultados
                  </span>

                )}
              </div>

              {proveedorSeleccionado ? (

                <div
                  style={{
                    padding: 14,
                    borderRadius: 14,
                    border:
                      "1px solid rgba(34,197,94,.30)",
                    background:
                      esClaro
                        ? "#f3fff7"
                        : "rgba(34,197,94,.055)"
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent:
                        "space-between",
                      gap: 12,
                      alignItems: "center",
                      flexWrap: "wrap"
                    }}
                  >
                    <div>
                      <div
                        style={{
                          display: "flex",
                          gap: 7,
                          alignItems: "center",
                          flexWrap: "wrap"
                        }}
                      >
                        <strong
                          style={{
                            fontSize: 16
                          }}
                        >
                          {factura.proveedorNombre}
                        </strong>

                        <span
                          className="badge"
                          style={{
                            color: "#22c55e"
                          }}
                        >
                          ✓ Seleccionado
                        </span>
                      </div>

                      <div
                        className="inv-subtle"
                        style={{
                          marginTop: 5,
                          fontSize: 12
                        }}
                      >
                        NIT / Documento:{" "}
                        <b>
                          {factura.proveedorDocumento ||
                            "No registrado"}
                        </b>
                      </div>
                    </div>

                    <button
                      type="button"
                      className="btn btn-small"
                      onClick={
                        limpiarProveedor
                      }
                    >
                      Cambiar proveedor
                    </button>
                  </div>
                </div>

              ) : proveedorNuevo ? (

                <div
                  style={{
                    padding: 14,
                    borderRadius: 14,
                    border:
                      "1px solid rgba(59,130,246,.25)",
                    background:
                      esClaro
                        ? "#f7faff"
                        : "rgba(59,130,246,.045)"
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent:
                        "space-between",
                      alignItems: "center",
                      gap: 10,
                      marginBottom: 11
                    }}
                  >
                    <strong>
                      ➕ Proveedor nuevo
                    </strong>

                    <button
                      type="button"
                      className="btn btn-small"
                      onClick={
                        cancelarProveedorNuevo
                      }
                    >
                      Cancelar
                    </button>
                  </div>

                  <div className="form-grid">
                    <div className="form-field">
                      <label>
                        Nombre del proveedor *
                      </label>

                      <input
                        autoFocus
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

                  <p
                    className="inv-subtle"
                    style={{
                      margin:
                        "9px 0 0",
                      fontSize: 11
                    }}
                  >
                    Ordexa guardará este proveedor al registrar la factura y quedará disponible para futuras compras.
                  </p>
                </div>

              ) : (

                <>
                  <div
                    className="input-with-icon"
                    style={{
                      maxWidth: "100%"
                    }}
                  >
                    <span className="icon">
                      🔎
                    </span>

                    <input
                      type="text"
                      placeholder="Buscar por nombre o NIT / documento…"
                      value={
                        qProveedor
                      }
                      onChange={e =>
                        setQProveedor(
                          e.target.value
                        )
                      }
                    />
                  </div>

                  {qProveedor.trim().length === 1 && (

                    <p
                      className="inv-subtle"
                      style={{
                        margin:
                          "7px 0 0",
                        fontSize: 11
                      }}
                    >
                      Escribe al menos 2 caracteres para buscar.
                    </p>

                  )}

                  {!qProveedor &&
                    recientesProveedores.length > 0 && (

                    <div
                      style={{
                        marginTop: 11
                      }}
                    >
                      <div
                        className="inv-subtle"
                        style={{
                          marginBottom: 7,
                          fontSize: 11
                        }}
                      >
                        Proveedores recientes
                      </div>

                      <div
                        style={{
                          display: "flex",
                          gap: 7,
                          flexWrap: "wrap"
                        }}
                      >
                        {recientesProveedores.map(
                          proveedor => (

                            <button
                              key={
                                proveedor.id
                              }
                              type="button"
                              className="btn btn-small"
                              onClick={() =>
                                seleccionarProveedor(
                                  proveedor
                                )
                              }
                            >
                              🏢 {proveedor.nombre}
                            </button>

                          )
                        )}
                      </div>
                    </div>

                  )}

                  {qProveedor.trim().length >= 2 && (

                    <div
                      style={{
                        marginTop: 10,
                        border:
                          "1px solid var(--border)",
                        borderRadius: 13,
                        overflow: "hidden"
                      }}
                    >
                      {buscandoProveedor ? (

                        <div
                          className="inv-subtle"
                          style={{
                            padding: 13
                          }}
                        >
                          Buscando proveedores…
                        </div>

                      ) : resultadosProveedores.length > 0 ? (

                        resultadosProveedores.map(
                          proveedor => (

                            <button
                              key={
                                proveedor.id
                              }
                              type="button"
                              onClick={() =>
                                seleccionarProveedor(
                                  proveedor
                                )
                              }
                              style={{
                                width: "100%",
                                display: "flex",
                                justifyContent:
                                  "space-between",
                                alignItems: "center",
                                gap: 12,
                                padding: "11px 12px",
                                border: 0,
                                borderBottom:
                                  "1px solid var(--border)",
                                background:
                                  "transparent",
                                color:
                                  "var(--text)",
                                cursor: "pointer",
                                textAlign: "left"
                              }}
                            >
                              <div>
                                <strong>
                                  {proveedor.nombre ||
                                    "Proveedor"}
                                </strong>

                                <div
                                  className="inv-subtle"
                                  style={{
                                    marginTop: 3,
                                    fontSize: 11
                                  }}
                                >
                                  NIT / Documento:{" "}
                                  {proveedor.documento ||
                                    "—"}
                                </div>
                              </div>

                              <span
                                style={{
                                  color: "#22c55e",
                                  fontWeight: 800,
                                  fontSize: 12
                                }}
                              >
                                Seleccionar
                              </span>
                            </button>

                          )
                        )

                      ) : (

                        <div
                          style={{
                            padding: 13
                          }}
                        >
                          <strong>
                            No encontramos proveedores.
                          </strong>

                          <p
                            className="inv-subtle"
                            style={{
                              margin:
                                "4px 0 10px",
                              fontSize: 11
                            }}
                          >
                            Si es un proveedor nuevo, puedes registrarlo sin salir de la factura.
                          </p>

                          <button
                            type="button"
                            className="btn btn-primary btn-small"
                            onClick={
                              iniciarProveedorNuevo
                            }
                          >
                            ➕ Registrar proveedor nuevo
                          </button>
                        </div>

                      )}
                    </div>

                  )}

                  {!qProveedor && (

                    <button
                      type="button"
                      className="btn btn-small"
                      onClick={
                        iniciarProveedorNuevo
                      }
                      style={{
                        marginTop: 11
                      }}
                    >
                      ➕ Proveedor nuevo
                    </button>

                  )}
                </>

              )}
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
                      type="text"
                      inputMode="numeric"
                      value={
                        linea.costoCompra
                      }
                      onChange={e =>
                        setLinea({
                          ...linea,
                          costoCompra:
                            formatearNumeroInput(
                              e.target.value
                            )
                        })
                      }
                      placeholder="0"
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

                  {simulacion.usaPrecioMinimoManual && (

                    <div
                      style={{
                        marginBottom: 11,
                        padding: "9px 11px",
                        borderRadius: 10,
                        border:
                          "1px solid rgba(245,158,11,.25)",
                        background:
                          "rgba(245,158,11,.06)",
                        fontSize: 11
                      }}
                    >
                      🔒 Este producto usa un precio mínimo manual de{" "}
                      <b>
                        {moneda(
                          simulacion.precioMinimo
                        )}
                      </b>
                      . La compra actualizará el costo promedio, pero no reemplazará ese mínimo.
                    </div>

                  )}

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
                        Precio de venta registrado
                      </label>

                      <input
                        type="text"
                        inputMode="numeric"
                        value={
                          linea.precioVenta
                        }
                        onChange={e =>
                          setLinea({
                            ...linea,
                            precioVenta:
                              formatearNumeroInput(
                                e.target.value
                              )
                          })
                        }
                        readOnly
                        placeholder="0"
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

      {modalImportar && (
        <ImportarComprobanteModal
          tipo="compra"
          productos={productos}
          onClose={() => setModalImportar(false)}
          onApply={datos => {
            setFactura(prev => ({
              ...prev,
              numeroFactura: datos.numeroFactura || prev.numeroFactura,
              fecha: datos.fecha || prev.fecha,
              proveedorNombre: datos.nombre || prev.proveedorNombre,
              proveedorDocumento: datos.documento || prev.proveedorDocumento
            }));
            setItems(
              datos.items.map(item => {
                const producto = productos.find(p => p.id === item.productoId);
                const costoCompra = Number(item.precio || 0);
                return {
                  productoId: item.productoId,
                  codigo: producto?.codigo || null,
                  nombre: producto?.nombre || item.nombre,
                  cantidad: Number(item.cantidad || 0),
                  costoCompra,
                  subtotal: costoCompra * Number(item.cantidad || 0),
                  gananciaObjetivo: Number(producto?.porcentajeGanancia ?? 30),
                  gananciaMinima: Number(producto?.porcentajeGananciaMinima ?? 10),
                  precioVenta: Number(producto?.precioUnitario || 0)
                };
              })
            );
          }}
        />
      )}
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
