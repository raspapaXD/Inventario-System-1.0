// src/pages/Factura.jsx

import {
  useNavigate,
  useParams
} from "react-router-dom";

import {
  useEffect,
  useMemo,
  useState
} from "react";

import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  where
} from "firebase/firestore";

import { db } from "../../firebaseClient";
import jsPDF from "jspdf";

import "./inventario.css";

import { useTenant } from "../tenant/TenantProvider";
import AppMenu from "../components/AppMenu.jsx";

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

const formatMoney = value =>
  `$${Number(value || 0).toLocaleString("es-CO")}`;

function formatearFechaSimple(fecha) {
  if (!fecha) {
    return "—";
  }

  if (
    typeof fecha === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(fecha)
  ) {
    const [
      year,
      month,
      day
    ] =
      fecha.split("-");

    return `${day}/${month}/${year}`;
  }

  if (
    typeof fecha?.toDate ===
    "function"
  ) {
    return fecha
      .toDate()
      .toLocaleDateString(
        "es-CO"
      );
  }

  const date =
    new Date(fecha);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return "—";
  }

  return date.toLocaleDateString(
    "es-CO"
  );
}

async function cargarImagenComoDataURL(
  url
) {
  if (!url) {
    return null;
  }

  try {
    const response =
      await fetch(url);

    if (!response.ok) {
      return null;
    }

    const blob =
      await response.blob();

    return await new Promise(
      (
        resolve,
        reject
      ) => {
        const reader =
          new FileReader();

        reader.onloadend = () =>
          resolve(
            reader.result
          );

        reader.onerror =
          reject;

        reader.readAsDataURL(
          blob
        );
      }
    );

  } catch (e) {
    console.warn(
      "No fue posible cargar el logo para el PDF.",
      e
    );

    return null;
  }
}

/* =========================================================
   COMPONENTE
========================================================= */

export default function Factura() {
  const {
    id
  } = useParams();

  const navigate =
    useNavigate();

  const {
    theme,
    toggle
  } = useTheme();

  const {
    empresa
  } = useTenant();

  const [
    venta,
    setVenta
  ] = useState(null);

  /*
   * NUEVO:
   *
   * Aquí guardamos la cuenta por cobrar
   * asociada a la venta.
   *
   * Esta cuenta es la fuente actual del
   * saldo de cartera.
   */
  const [
    cuentaCobrar,
    setCuentaCobrar
  ] = useState(null);

  const [
    empresaInfo,
    setEmpresaInfo
  ] = useState(null);

  const [
    loading,
    setLoading
  ] = useState(true);

  const [
    err,
    setErr
  ] = useState(null);

  const [
    generandoPDF,
    setGenerandoPDF
  ] = useState(false);

  /* =======================================================
     VOLVER A LA PÁGINA ANTERIOR
  ======================================================= */

  const volver = () => {
    const indice =
      window.history
        .state
        ?.idx;

    if (
      typeof indice ===
        "number" &&
      indice > 0
    ) {
      navigate(-1);
    } else {
      navigate("/");
    }
  };

  /* =======================================================
     EMPRESA
  ======================================================= */

  useEffect(() => {
    (async () => {
      try {
        if (
          !empresa?.id
        ) {
          return;
        }

        const snap =
          await getDoc(
            doc(
              db,
              "empresas",
              empresa.id
            )
          );

        setEmpresaInfo(
          snap.exists()
            ? snap.data()
            : {}
        );

      } catch (e) {
        console.error(e);
      }
    })();

  }, [
    empresa?.id
  ]);

  /* =======================================================
     VENTA
  ======================================================= */

  useEffect(() => {
    (async () => {
      try {
        setLoading(
          true
        );

        setErr(
          null
        );

        let snap =
          null;

        if (
          empresa?.id
        ) {
          snap =
            await getDoc(
              doc(
                db,
                "empresas",
                empresa.id,
                "ventas",
                id
              )
            );
        }

        /*
         * Compatibilidad con ventas antiguas.
         */

        if (
          !snap ||
          !snap.exists()
        ) {
          const legacy =
            await getDoc(
              doc(
                db,
                "ventas",
                id
              )
            );

          if (
            legacy.exists()
          ) {
            snap =
              legacy;
          }
        }

        if (
          snap &&
          snap.exists()
        ) {
          setVenta(
            snap.data()
          );

        } else {
          setErr(
            "Venta no encontrada."
          );
        }

      } catch (e) {
        console.error(e);

        setErr(
          "Error al obtener la venta."
        );

      } finally {
        setLoading(
          false
        );
      }
    })();

  }, [
    id,
    empresa?.id
  ]);

  /* =======================================================
     CUENTA POR COBRAR ACTUAL
  ======================================================= */

  useEffect(() => {
    (async () => {
      if (
        !empresa?.id ||
        !id
      ) {
        return;
      }

      try {
        /*
         * Buscamos la cuenta por cobrar cuya
         * ventaId corresponde a esta factura.
         */

        const snap =
          await getDocs(
            query(
              collection(
                db,
                "empresas",
                empresa.id,
                "cuentasPorCobrar"
              ),

              where(
                "ventaId",
                "==",
                id
              ),

              limit(1)
            )
          );

        if (
          !snap.empty
        ) {
          const documento =
            snap.docs[0];

          setCuentaCobrar({
            id:
              documento.id,

            ...documento.data()
          });

        } else {
          /*
           * Ventas de contado y ventas antiguas
           * normalmente no tienen cuenta por cobrar.
           */

          setCuentaCobrar(
            null
          );
        }

      } catch (e) {
        /*
         * La factura puede seguir funcionando con
         * los datos originales aunque haya algún
         * problema consultando cartera.
         */

        console.warn(
          "No fue posible consultar la cuenta por cobrar.",
          e
        );

        setCuentaCobrar(
          null
        );
      }
    })();

  }, [
    empresa?.id,
    id
  ]);

  /* =======================================================
     ITEMS
  ======================================================= */

  const items =
    useMemo(() => {
      if (!venta) {
        return [];
      }

      return (
        venta.items ||
        venta.productos ||
        []
      ).map(
        it => ({
          nombre:
            it.nombre ||
            "—",

          cantidad:
            Number(
              it.cantidad ||
              0
            ),

          precioUnitario:
            Number(
              it.precioUnitario ||
              0
            )
        })
      );

    }, [
      venta
    ]);

  /* =======================================================
     TOTAL
  ======================================================= */

  const totalCalculado =
    useMemo(
      () =>
        items.reduce(
          (
            acc,
            it
          ) =>
            acc +
            it.cantidad *
            it.precioUnitario,
          0
        ),
      [
        items
      ]
    );

  const total =
    Number(
      venta?.total
    ) > 0
      ? Number(
          venta.total
        )
      : totalCalculado;

  /* =======================================================
     CLIENTE
  ======================================================= */

  const clienteNombre =
    (
      venta?.cliente &&
      typeof venta.cliente ===
        "object"
        ? venta.cliente
            .nombre
        : venta?.cliente
    ) ||
    venta?.clienteNombre ||
    "Consumidor final";

  const clienteDocumento =
    (
      venta?.cliente &&
      typeof venta.cliente ===
        "object"
        ? venta.cliente
            .documento
        : venta?.documento
    ) ||
    "";

  /* =======================================================
     FECHA
  ======================================================= */

  const fecha =
    useMemo(() => {
      const f =
        venta?.fecha;

      if (!f) {
        return null;
      }

      if (
        typeof f?.toDate ===
        "function"
      ) {
        return f.toDate();
      }

      if (
        typeof f ===
          "number" ||
        typeof f ===
          "string"
      ) {
        return new Date(
          f
        );
      }

      return null;

    }, [
      venta
    ]);

  const fechaStr =
    fecha
      ? fecha.toLocaleString(
          "es-CO"
        )
      : "—";

  const fechaPDF =
    fecha
      ? fecha.toLocaleDateString(
          "es-CO"
        )
      : "—";

  /* =======================================================
     PAGO / CARTERA EN TIEMPO REAL
  ======================================================= */

  const tipoPago =
    venta?.tipoPago ===
    "CREDITO"
      ? "CREDITO"
      : "CONTADO";

  const esCredito =
    tipoPago ===
    "CREDITO";

  /*
   * IMPORTANTE:
   *
   * Para crédito, la cuenta por cobrar tiene
   * prioridad sobre la venta original.
   *
   * Si no existe cuenta por cobrar, usamos
   * los datos de la venta por compatibilidad.
   */

  const saldoPendiente =
    esCredito
      ? Math.max(
          0,

          Number(
            cuentaCobrar?.saldoPendiente ??
            venta?.saldoPendiente ??
            total
          )
        )
      : 0;

  const abonado =
    Math.max(
      0,
      total -
      saldoPendiente
    );

  /*
   * Calculamos el estado basándonos en el saldo
   * actual para evitar inconsistencias.
   */

  const estadoPago =
    !esCredito
      ? "PAGADA"
      : saldoPendiente <= 0
        ? "PAGADA"
        : saldoPendiente < total
          ? "PARCIAL"
          : (
              cuentaCobrar?.estado ||
              venta?.estadoPago ||
              "PENDIENTE"
            );

  /*
   * La fecha de vencimiento de cartera también
   * tiene prioridad sobre el valor histórico.
   */

  const fechaVencimiento =
    esCredito
      ? formatearFechaSimple(
          cuentaCobrar?.fechaVencimiento ??
          venta?.fechaVencimiento
        )
      : "—";

  const folio =
    id
      .slice(
        0,
        8
      )
      .toUpperCase();

  /* =======================================================
     PDF PROFESIONAL
  ======================================================= */

  const generarPDF =
    async () => {
      if (
        generandoPDF
      ) {
        return;
      }

      try {
        setGenerandoPDF(
          true
        );

        const pdf =
          new jsPDF({
            orientation:
              "portrait",

            unit:
              "mm",

            format:
              "a4"
          });

        const pageWidth =
          pdf.internal.pageSize
            .getWidth();

        const pageHeight =
          pdf.internal.pageSize
            .getHeight();

        const margin =
          16;

        const contentWidth =
          pageWidth -
          margin * 2;

        /* COLORES */

        const dark =
          [31, 41, 55];

        const gray =
          [100, 116, 139];

        const border =
          [226, 232, 240];

        const light =
          [248, 250, 252];

        const green =
          [22, 163, 74];

        const amber =
          [217, 119, 6];

        /* ===============================================
           NUEVA PÁGINA
        =============================================== */

        const nuevaPagina =
          () => {
            pdf.addPage();

            pdf.setFillColor(
              255,
              255,
              255
            );

            pdf.rect(
              0,
              0,
              pageWidth,
              pageHeight,
              "F"
            );

            return 18;
          };

        /* ===============================================
           FONDO
        =============================================== */

        pdf.setFillColor(
          255,
          255,
          255
        );

        pdf.rect(
          0,
          0,
          pageWidth,
          pageHeight,
          "F"
        );

        /* ===============================================
           LOGO
        =============================================== */

        const logoData =
          await cargarImagenComoDataURL(
            empresaInfo?.logoUrl
          );

        let empresaX =
          margin;

        if (
          logoData
        ) {
          try {
            const tipoImagen =
              logoData.includes(
                "image/png"
              )
                ? "PNG"
                : "JPEG";

            pdf.addImage(
              logoData,
              tipoImagen,
              margin,
              14,
              18,
              18
            );

            empresaX =
              margin +
              24;

          } catch (e) {
            console.warn(
              "No se pudo insertar el logo en el PDF.",
              e
            );
          }
        }

        /* ===============================================
           EMPRESA
        =============================================== */

        pdf.setTextColor(
          ...dark
        );

        pdf.setFont(
          "helvetica",
          "bold"
        );

        pdf.setFontSize(
          17
        );

        pdf.text(
          empresaInfo?.nombre ||
          "Mi Empresa",
          empresaX,
          21
        );

        pdf.setFont(
          "helvetica",
          "normal"
        );

        pdf.setFontSize(
          9.5
        );

        pdf.setTextColor(
          ...gray
        );

        if (
          empresaInfo?.nit
        ) {
          pdf.text(
            `NIT: ${empresaInfo.nit}`,
            empresaX,
            27
          );
        }

        /* ===============================================
           FACTURA
        =============================================== */

        pdf.setTextColor(
          ...dark
        );

        pdf.setFont(
          "helvetica",
          "bold"
        );

        pdf.setFontSize(
          20
        );

        pdf.text(
          "FACTURA",
          pageWidth -
          margin,
          19,
          {
            align: "right"
          }
        );

        pdf.setFontSize(
          11
        );

        pdf.text(
          `#${folio}`,
          pageWidth -
          margin,
          25,
          {
            align: "right"
          }
        );

        pdf.setFont(
          "helvetica",
          "normal"
        );

        pdf.setFontSize(
          9
        );

        pdf.setTextColor(
          ...gray
        );

        pdf.text(
          fechaPDF,
          pageWidth -
          margin,
          30,
          {
            align: "right"
          }
        );

        /* ===============================================
           LÍNEA
        =============================================== */

        pdf.setDrawColor(
          ...border
        );

        pdf.setLineWidth(
          0.4
        );

        pdf.line(
          margin,
          39,
          pageWidth -
          margin,
          39
        );

        /* ===============================================
           CLIENTE
        =============================================== */

        const infoY =
          48;

        const colWidth =
          contentWidth /
          2;

        pdf.setFont(
          "helvetica",
          "bold"
        );

        pdf.setFontSize(
          8
        );

        pdf.setTextColor(
          ...gray
        );

        pdf.text(
          "CLIENTE",
          margin,
          infoY
        );

        pdf.setFontSize(
          11
        );

        pdf.setTextColor(
          ...dark
        );

        pdf.text(
          clienteNombre,
          margin,
          infoY + 6
        );

        if (
          clienteDocumento
        ) {
          pdf.setFont(
            "helvetica",
            "normal"
          );

          pdf.setFontSize(
            9
          );

          pdf.setTextColor(
            ...gray
          );

          pdf.text(
            `Documento: ${clienteDocumento}`,
            margin,
            infoY + 12
          );
        }

        /* ===============================================
           PAGO
        =============================================== */

        const pagoX =
          margin +
          colWidth;

        pdf.setFont(
          "helvetica",
          "bold"
        );

        pdf.setFontSize(
          8
        );

        pdf.setTextColor(
          ...gray
        );

        pdf.text(
          "FORMA DE PAGO",
          pagoX,
          infoY
        );

        pdf.setFontSize(
          11
        );

        pdf.setTextColor(
          ...(esCredito
            ? amber
            : green)
        );

        pdf.text(
          esCredito
            ? "CRÉDITO"
            : "CONTADO",
          pagoX,
          infoY + 6
        );

        pdf.setFont(
          "helvetica",
          "normal"
        );

        pdf.setFontSize(
          9
        );

        pdf.setTextColor(
          ...gray
        );

        if (
          esCredito
        ) {
          pdf.text(
            `Vencimiento: ${fechaVencimiento}`,
            pagoX,
            infoY + 12
          );

        } else {
          pdf.text(
            "Venta pagada",
            pagoX,
            infoY + 12
          );
        }

        /* ===============================================
           ESTADO
        =============================================== */

        let y =
          69;

        const estadoHeight =
          esCredito
            ? 28
            : 22;

        pdf.setFillColor(
          ...light
        );

        pdf.setDrawColor(
          ...border
        );

        pdf.roundedRect(
          margin,
          y,
          contentWidth,
          estadoHeight,
          2,
          2,
          "FD"
        );

        pdf.setFont(
          "helvetica",
          "bold"
        );

        pdf.setFontSize(
          8
        );

        pdf.setTextColor(
          ...gray
        );

        pdf.text(
          "ESTADO DE PAGO",
          margin + 5,
          y + 7
        );

        pdf.setFontSize(
          11
        );

        pdf.setTextColor(
          ...(estadoPago ===
          "PAGADA"
            ? green
            : amber)
        );

        pdf.text(
          estadoPago,
          margin + 5,
          y + 14
        );

        /* TOTAL */

        pdf.setTextColor(
          ...gray
        );

        pdf.setFontSize(
          8
        );

        pdf.text(
          "TOTAL",
          pageWidth -
          margin -
          5,
          y + 7,
          {
            align:
              "right"
          }
        );

        pdf.setTextColor(
          ...dark
        );

        pdf.setFontSize(
          15
        );

        pdf.text(
          formatMoney(
            total
          ),
          pageWidth -
          margin -
          5,
          y + 15,
          {
            align:
              "right"
          }
        );

        /* CRÉDITO */

        if (
          esCredito
        ) {
          const terceraParte =
            contentWidth /
            3;

          pdf.setDrawColor(
            ...border
          );

          pdf.line(
            margin + 5,
            y + 18,
            pageWidth -
            margin -
            5,
            y + 18
          );

          pdf.setFontSize(
            7.5
          );

          pdf.setFont(
            "helvetica",
            "normal"
          );

          pdf.setTextColor(
            ...gray
          );

          pdf.text(
            "Total factura",
            margin + 5,
            y + 23
          );

          pdf.text(
            "Abonado",
            margin +
            terceraParte +
            5,
            y + 23
          );

          pdf.text(
            "Saldo pendiente",
            margin +
            terceraParte *
              2 +
            5,
            y + 23
          );

          pdf.setFont(
            "helvetica",
            "bold"
          );

          pdf.setFontSize(
            9.5
          );

          pdf.setTextColor(
            ...dark
          );

          pdf.text(
            formatMoney(
              total
            ),
            margin + 5,
            y + 27
          );

          pdf.text(
            formatMoney(
              abonado
            ),
            margin +
            terceraParte +
            5,
            y + 27
          );

          if (
  saldoPendiente > 0
) {
  pdf.setTextColor(
    ...amber
  );
} else {
  pdf.setTextColor(
    ...green
  );
}

pdf.text(
  formatMoney(
    saldoPendiente
  ),
            margin +
            terceraParte *
              2 +
            5,
            y + 27
          );
        }

        y +=
          estadoHeight +
          10;

        /* ===============================================
           TABLA
        =============================================== */

        const colProducto =
          margin;

        const colCantidad =
          118;

        const colPrecio =
          147;

        const colSubtotal =
          pageWidth -
          margin;

        const headerHeight =
          10;

        const dibujarEncabezadoTabla =
          () => {
            pdf.setFillColor(
              241,
              245,
              249
            );

            pdf.setDrawColor(
              ...border
            );

            pdf.rect(
              margin,
              y,
              contentWidth,
              headerHeight,
              "FD"
            );

            pdf.setFont(
              "helvetica",
              "bold"
            );

            pdf.setFontSize(
              8.5
            );

            pdf.setTextColor(
              ...dark
            );

            pdf.text(
              "Producto",
              colProducto +
              4,
              y + 6.5
            );

            pdf.text(
              "Cant.",
              colCantidad,
              y + 6.5,
              {
                align:
                  "right"
              }
            );

            pdf.text(
              "P. Unit",
              colPrecio,
              y + 6.5,
              {
                align:
                  "right"
              }
            );

            pdf.text(
              "Subtotal",
              colSubtotal -
              4,
              y + 6.5,
              {
                align:
                  "right"
              }
            );

            y +=
              headerHeight;
          };

        dibujarEncabezadoTabla();

        pdf.setFont(
          "helvetica",
          "normal"
        );

        pdf.setFontSize(
          9
        );

        for (
          const item
          of items
        ) {
          const subtotal =
            item.cantidad *
            item.precioUnitario;

          const nombreLineas =
            pdf.splitTextToSize(
              item.nombre,
              78
            );

          const rowHeight =
            Math.max(
              10,
              nombreLineas.length *
                4.5 +
                4
            );

          if (
            y +
            rowHeight >
            pageHeight -
            38
          ) {
            y =
              nuevaPagina();

            dibujarEncabezadoTabla();
          }

          pdf.setDrawColor(
            ...border
          );

          pdf.setTextColor(
            ...dark
          );

          pdf.rect(
            margin,
            y,
            contentWidth,
            rowHeight
          );

          pdf.text(
            nombreLineas,
            colProducto +
            4,
            y + 6
          );

          pdf.text(
            String(
              item.cantidad
            ),
            colCantidad,
            y + 6,
            {
              align:
                "right"
            }
          );

          pdf.text(
            formatMoney(
              item.precioUnitario
            ),
            colPrecio,
            y + 6,
            {
              align:
                "right"
            }
          );

          pdf.text(
            formatMoney(
              subtotal
            ),
            colSubtotal -
            4,
            y + 6,
            {
              align:
                "right"
            }
          );

          y +=
            rowHeight;
        }

        /* ===============================================
           TOTAL FINAL
        =============================================== */

        if (
          y >
          pageHeight -
          52
        ) {
          y =
            nuevaPagina();
        }

        y +=
          4;

        pdf.setDrawColor(
          ...border
        );

        pdf.line(
          118,
          y,
          pageWidth -
          margin,
          y
        );

        y +=
          8;

        pdf.setFont(
          "helvetica",
          "bold"
        );

        pdf.setFontSize(
          10
        );

        pdf.setTextColor(
          ...gray
        );

        pdf.text(
          "TOTAL",
          147,
          y,
          {
            align:
              "right"
          }
        );

        pdf.setFontSize(
          14
        );

        pdf.setTextColor(
          ...dark
        );

        pdf.text(
          formatMoney(
            total
          ),
          pageWidth -
          margin,
          y,
          {
            align:
              "right"
          }
        );

        /* ===============================================
           CRÉDITO
        =============================================== */

        if (
          esCredito
        ) {
          y +=
            13;

          pdf.setFillColor(
            255,
            251,
            235
          );

          pdf.setDrawColor(
            253,
            230,
            138
          );

          pdf.roundedRect(
            margin,
            y,
            contentWidth,
            19,
            2,
            2,
            "FD"
          );

          pdf.setFont(
            "helvetica",
            "bold"
          );

          pdf.setFontSize(
            8
          );

          pdf.setTextColor(
            ...amber
          );

          pdf.text(
            "VENTA A CRÉDITO",
            margin + 5,
            y + 6
          );

          pdf.setFont(
            "helvetica",
            "normal"
          );

          pdf.setFontSize(
            8.5
          );

          pdf.setTextColor(
            ...dark
          );

          pdf.text(
            `Vencimiento: ${fechaVencimiento}`,
            margin + 5,
            y + 12
          );

          pdf.text(
            `Saldo pendiente: ${formatMoney(
              saldoPendiente
            )}`,
            pageWidth -
            margin -
            5,
            y + 12,
            {
              align:
                "right"
            }
          );

          y +=
            19;
        }

        /* ===============================================
           PIE
        =============================================== */

        const footerY =
          Math.max(
            y + 18,
            pageHeight -
            25
          );

        if (
          footerY <
          pageHeight -
          8
        ) {
          pdf.setDrawColor(
            ...border
          );

          pdf.line(
            margin,
            footerY,
            pageWidth -
            margin,
            footerY
          );

          pdf.setFont(
            "helvetica",
            "normal"
          );

          pdf.setFontSize(
            8
          );

          pdf.setTextColor(
            ...gray
          );

          pdf.text(
            esCredito
              ? "Documento generado por Ordexa · Conserva esta factura como soporte de la operación."
              : "Gracias por su compra · Documento generado por Ordexa.",
            pageWidth /
            2,
            footerY + 6,
            {
              align:
                "center"
            }
          );
        }

        /* ===============================================
           GUARDAR
        =============================================== */

        pdf.save(
          `Factura-${folio}.pdf`
        );

      } catch (e) {
        console.error(e);

        alert(
          "No fue posible generar el PDF."
        );

      } finally {
        setGenerandoPDF(
          false
        );
      }
    };

  /* =========================================================
     CARGANDO
  ========================================================= */

  if (
    loading
  ) {
    return (
      <div className="inv-root">

        <header className="inv-header">

          <div>
            <h1>
              Factura
            </h1>
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

            <button
              type="button"
              className="btn"
              onClick={
                volver
              }
            >
              ← Volver
            </button>

            <AppMenu />

          </div>

        </header>

        <p className="inv-subtle">
          Cargando factura…
        </p>

      </div>
    );
  }

  /* =========================================================
     ERROR
  ========================================================= */

  if (
    !venta ||
    err
  ) {
    return (
      <div className="inv-root">

        <header className="inv-header">

          <div>
            <h1>
              Factura
            </h1>
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

            <button
              type="button"
              className="btn"
              onClick={
                volver
              }
            >
              ← Volver
            </button>

            <AppMenu />

          </div>

        </header>

        <div
          className="toast toast-error"
          style={{
            position:
              "static"
          }}
        >
          {err ||
            "No se encontró la venta."}
        </div>

      </div>
    );
  }

  /* =========================================================
     FACTURA
  ========================================================= */

  return (
    <div className="inv-root">

      {/* HEADER */}

      <header className="inv-header">

        <div
          style={{
            display: "flex",
            alignItems:
              "center",
            gap: 12
          }}
        >

          {empresaInfo?.logoUrl ? (

            <img
              src={
                empresaInfo.logoUrl
              }
              alt="Logo"
              style={{
                width: 36,
                height: 36,
                borderRadius: 8,
                objectFit:
                  "cover",
                border:
                  "1px solid var(--border)"
              }}
            />

          ) : null}

          <div>

            <h1>
              {empresaInfo?.nombre ||
                "Factura"}
            </h1>

            <p className="inv-subtle">

              {empresaInfo?.nit
                ? `NIT: ${empresaInfo.nit} • `
                : ""}

              Comprobante de venta

            </p>

          </div>

        </div>

        <div
          className="header-actions"
          style={{
            gap: 8,
            flexWrap:
              "wrap"
          }}
        >

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

          <button
            type="button"
            className="btn"
            onClick={
              volver
            }
          >
            ← Volver
          </button>

          <AppMenu />

          <button
            className="btn btn-primary"
            onClick={
              generarPDF
            }
            disabled={
              generandoPDF
            }
          >
            {generandoPDF
              ? "Generando PDF..."
              : "Descargar PDF 🧾"}
          </button>

        </div>

      </header>

      {/* FACTURA */}

      <section
        className="inv-grid"
        style={{
          gridTemplateColumns:
            "1fr"
        }}
      >

        <div className="card">

          <div className="card-header">

            <h2>
              Factura #{folio}
            </h2>

            <span
              className="badge"
              style={{
                color:
                  esCredito
                    ? "#f59e0b"
                    : "#22c55e",

                fontWeight:
                  800
              }}
            >
              {esCredito
                ? "📅 Crédito"
                : "💵 Contado"}
            </span>

          </div>

          <div className="card-body">

            {/* DATOS */}

            <div
              style={{
                display: "grid",
                gridTemplateColumns:
                  "repeat(auto-fit, minmax(220px, 1fr))",
                gap: 12,
                marginBottom:
                  16
              }}
            >

              <div>

                <div
                  className="inv-subtle"
                  style={{
                    fontSize:
                      12
                  }}
                >
                  Cliente
                </div>

                <div
                  style={{
                    fontWeight:
                      600
                  }}
                >
                  {clienteNombre}
                </div>

                {clienteDocumento ? (

                  <div className="inv-subtle">
                    Doc:{" "}
                    {clienteDocumento}
                  </div>

                ) : null}

              </div>

              <div>

                <div
                  className="inv-subtle"
                  style={{
                    fontSize:
                      12
                  }}
                >
                  Fecha
                </div>

                <div
                  style={{
                    fontWeight:
                      600
                  }}
                >
                  {fechaStr}
                </div>

              </div>

              <div>

                <div
                  className="inv-subtle"
                  style={{
                    fontSize:
                      12
                  }}
                >
                  Forma de pago
                </div>

                <div
                  style={{
                    fontWeight:
                      700,

                    color:
                      esCredito
                        ? "#f59e0b"
                        : "#22c55e"
                  }}
                >
                  {esCredito
                    ? "📅 Crédito"
                    : "💵 Contado"}
                </div>

              </div>

            </div>

            {/* ESTADO */}

            <div
              style={{
                marginBottom:
                  18,

                padding:
                  16,

                borderRadius:
                  16,

                border:
                  estadoPago ===
                  "PAGADA"
                    ? "1px solid rgba(34,197,94,.30)"
                    : "1px solid rgba(245,158,11,.30)",

                background:
                  estadoPago ===
                  "PAGADA"
                    ? "rgba(34,197,94,.07)"
                    : "rgba(245,158,11,.07)"
              }}
            >

              <div
                style={{
                  display: "flex",
                  justifyContent:
                    "space-between",
                  alignItems:
                    "center",
                  gap: 12,
                  flexWrap:
                    "wrap"
                }}
              >

                <div>

                  <div
                    className="inv-subtle"
                    style={{
                      fontSize:
                        12
                    }}
                  >
                    Estado del pago
                  </div>

                  <strong
                    style={{
                      color:
                        estadoPago ===
                        "PAGADA"
                          ? "#22c55e"
                          : "#f59e0b"
                    }}
                  >
                    {estadoPago ===
                    "PAGADA"
                      ? "✅ PAGADA"
                      : estadoPago ===
                        "PARCIAL"
                        ? "🟡 PAGO PARCIAL"
                        : "🕒 PENDIENTE"}
                  </strong>

                </div>

                <div
                  style={{
                    textAlign:
                      "right"
                  }}
                >

                  <div className="inv-subtle">
                    Total factura
                  </div>

                  <strong
                    style={{
                      fontSize:
                        20
                    }}
                  >
                    {formatMoney(
                      total
                    )}
                  </strong>

                </div>

              </div>

              {esCredito && (

                <div
                  style={{
                    display:
                      "grid",

                    gridTemplateColumns:
                      "repeat(auto-fit, minmax(170px, 1fr))",

                    gap: 12,

                    marginTop:
                      14,

                    paddingTop:
                      14,

                    borderTop:
                      "1px solid var(--border)"
                  }}
                >

                  <div>

                    <div
                      className="inv-subtle"
                      style={{
                        fontSize:
                          12
                      }}
                    >
                      Vencimiento
                    </div>

                    <strong>
                      {fechaVencimiento}
                    </strong>

                  </div>

                  <div>

                    <div
                      className="inv-subtle"
                      style={{
                        fontSize:
                          12
                      }}
                    >
                      Abonado
                    </div>

                    <strong
                      style={{
                        color:
                          abonado > 0
                            ? "#22c55e"
                            : "var(--text)"
                      }}
                    >
                      {formatMoney(
                        abonado
                      )}
                    </strong>

                  </div>

                  <div>

                    <div
                      className="inv-subtle"
                      style={{
                        fontSize:
                          12
                      }}
                    >
                      Saldo pendiente
                    </div>

                    <strong
                      style={{
                        color:
                          saldoPendiente >
                          0
                            ? "#f59e0b"
                            : "#22c55e",

                        fontSize:
                          18
                      }}
                    >
                      {formatMoney(
                        saldoPendiente
                      )}
                    </strong>

                  </div>

                </div>

              )}

            </div>

            {/* TABLA */}

            <div
              style={{
                border:
                  "1px solid var(--border)",

                borderRadius:
                  12,

                overflow:
                  "hidden"
              }}
            >

              <div
                style={{
                  display:
                    "grid",

                  gridTemplateColumns:
                    "1fr 100px 140px 140px",

                  gap: 8,

                  padding:
                    "10px 12px",

                  background:
                    "var(--card)",

                  borderBottom:
                    "1px solid var(--border)",

                  fontWeight:
                    600
                }}
              >

                <div>
                  Producto
                </div>

                <div
                  style={{
                    textAlign:
                      "right"
                  }}
                >
                  Cant.
                </div>

                <div
                  style={{
                    textAlign:
                      "right"
                  }}
                >
                  P. Unit
                </div>

                <div
                  style={{
                    textAlign:
                      "right"
                  }}
                >
                  Subtotal
                </div>

              </div>

              {items.map(
                (
                  it,
                  idx
                ) => {
                  const sub =
                    it.cantidad *
                    it.precioUnitario;

                  return (

                    <div
                      key={
                        idx
                      }
                      style={{
                        display:
                          "grid",

                        gridTemplateColumns:
                          "1fr 100px 140px 140px",

                        gap:
                          8,

                        padding:
                          "10px 12px",

                        borderBottom:
                          "1px solid var(--border)"
                      }}
                    >

                      <div
                        style={{
                          overflow:
                            "hidden",

                          textOverflow:
                            "ellipsis",

                          whiteSpace:
                            "nowrap"
                        }}
                      >
                        {it.nombre}
                      </div>

                      <div
                        style={{
                          textAlign:
                            "right"
                        }}
                      >
                        {Number(
                          it.cantidad
                        ).toLocaleString(
                          "es-CO"
                        )}
                      </div>

                      <div
                        style={{
                          textAlign:
                            "right"
                        }}
                      >
                        {formatMoney(
                          it.precioUnitario
                        )}
                      </div>

                      <div
                        style={{
                          textAlign:
                            "right"
                        }}
                      >
                        {formatMoney(
                          sub
                        )}
                      </div>

                    </div>

                  );
                }
              )}

              <div
                style={{
                  display:
                    "grid",

                  gridTemplateColumns:
                    "1fr 100px 140px 140px",

                  gap: 8,

                  padding:
                    12,

                  fontWeight:
                    700
                }}
              >

                <div />
                <div />

                <div
                  style={{
                    textAlign:
                      "right"
                  }}
                >
                  TOTAL
                </div>

                <div
                  style={{
                    textAlign:
                      "right"
                  }}
                >
                  {formatMoney(
                    total
                  )}
                </div>

              </div>

            </div>

          </div>

          <div className="card-footer">

            <button
              className="btn btn-primary"
              onClick={
                generarPDF
              }
              disabled={
                generandoPDF
              }
            >
              {generandoPDF
                ? "Generando PDF..."
                : "Descargar PDF 🧾"}
            </button>

          </div>

        </div>

      </section>

    </div>
  );
}