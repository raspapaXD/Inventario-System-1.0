// src/pages/FacturaCompra.jsx

import {
  useEffect,
  useMemo,
  useState
} from "react";

import {
  useNavigate,
  useParams
} from "react-router-dom";

import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  where
} from "firebase/firestore";

import { db } from "../../firebaseClient.js";
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

const moneda = value =>
  `$${Number(value || 0).toLocaleString("es-CO", {
    maximumFractionDigits: 0
  })}`;

const cantidad = value =>
  Number(value || 0).toLocaleString("es-CO");

function convertirFecha(value) {
  if (!value) {
    return null;
  }

  if (
    typeof value?.toDate ===
    "function"
  ) {
    return value.toDate();
  }

  if (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    return new Date(
      `${value}T12:00:00`
    );
  }

  const date =
    new Date(value);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return null;
  }

  return date;
}

function formatearFecha(value) {
  const date =
    convertirFecha(value);

  if (!date) {
    return "—";
  }

  return date.toLocaleDateString(
    "es-CO"
  );
}

function formatearFechaHora(value) {
  const date =
    convertirFecha(value);

  if (!date) {
    return "—";
  }

  return date.toLocaleString(
    "es-CO"
  );
}

/* =========================================================
   COMPONENTE
========================================================= */

export default function FacturaCompra() {
  const {
    id
  } = useParams();

  const navigate =
    useNavigate();

  const {
    empresa
  } = useTenant();

  const {
    theme,
    toggle
  } = useTheme();

  const [
    compra,
    setCompra
  ] = useState(null);

  const [
    cuenta,
    setCuenta
  ] = useState(null);

  const [
    empresaInfo,
    setEmpresaInfo
  ] = useState(null);

  const [
    cargando,
    setCargando
  ] = useState(true);

  const [
    error,
    setError
  ] = useState("");

  /* =======================================================
     VOLVER
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
      navigate(
        "/historial-compras"
      );
    }
  };

  /* =======================================================
     EMPRESA
  ======================================================= */

  useEffect(() => {
    (async () => {
      if (!empresa?.id) {
        return;
      }

      try {
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
     CARGAR COMPRA + CUENTA POR PAGAR
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
        setCargando(
          true
        );

        setError("");

        const compraSnap =
          await getDoc(
            doc(
              db,
              "empresas",
              empresa.id,
              "compras",
              id
            )
          );

        if (
          !compraSnap.exists()
        ) {
          setError(
            "La compra no fue encontrada."
          );

          return;
        }

        setCompra(
          {
            id:
              compraSnap.id,

            ...compraSnap.data()
          }
        );

        /*
         * Si fue una compra a crédito,
         * buscamos la cuenta por pagar.
         *
         * Así mostramos el saldo REAL actual,
         * no solamente el saldo que tenía
         * la factura cuando fue creada.
         */

        try {
          const cuentaSnap =
            await getDocs(
              query(
                collection(
                  db,
                  "empresas",
                  empresa.id,
                  "cuentasPorPagar"
                ),
                where(
                  "compraId",
                  "==",
                  id
                ),
                limit(1)
              )
            );

          if (
            !cuentaSnap.empty
          ) {
            const documento =
              cuentaSnap.docs[0];

            setCuenta({
              id:
                documento.id,

              ...documento.data()
            });

          } else {
            setCuenta(
              null
            );
          }

        } catch (e) {
          /*
           * La compra se puede seguir mostrando
           * aunque no podamos consultar cartera.
           */

          console.warn(
            "No fue posible consultar la cuenta por pagar.",
            e
          );

          setCuenta(
            null
          );
        }

      } catch (e) {
        console.error(e);

        setError(
          "No fue posible cargar la compra."
        );

      } finally {
        setCargando(
          false
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
      return (
        compra?.items ||
        []
      ).map(
        item => ({
          nombre:
            item.nombre ||
            "Producto",

          cantidad:
            Number(
              item.cantidad ||
              0
            ),

          costoUnitario:
            Number(
              item.costoUnitario ??
              item.costoCompra ??
              0
            ),

          subtotal:
            Number(
              item.subtotal ||
              0
            ),

          stockAnterior:
            item.stockAnterior,

          stockNuevo:
            item.stockNuevo,

          diferencia:
            item.diferencia
        })
      );

    }, [
      compra
    ]);

  /* =======================================================
     TOTALES / CARTERA
  ======================================================= */

  const totalCalculado =
    useMemo(
      () =>
        items.reduce(
          (
            acc,
            item
          ) =>
            acc +
            (
              item.subtotal ||
              (
                item.cantidad *
                item.costoUnitario
              )
            ),
          0
        ),
      [
        items
      ]
    );

  const total =
    Number(
      compra?.total
    ) > 0
      ? Number(
          compra.total
        )
      : totalCalculado;

  const esCredito =
    compra?.tipoPago ===
    "CREDITO";

  const saldoPendiente =
    esCredito
      ? Number(
          cuenta?.saldoPendiente ??
          compra?.saldoPendiente ??
          total
        )
      : 0;

  const pagado =
    Math.max(
      0,
      total -
      saldoPendiente
    );

  const estadoPago =
    !esCredito
      ? "PAGADA"
      : saldoPendiente <= 0
        ? "PAGADA"
        : saldoPendiente < total
          ? "PARCIAL"
          : (
              cuenta?.estado ||
              compra?.estadoPago ||
              "PENDIENTE"
            );

  const fechaVencimiento =
    formatearFecha(
      cuenta?.fechaVencimiento ??
      compra?.fechaVencimiento
    );

  /* =========================================================
     CARGANDO
  ========================================================= */

  if (
    cargando
  ) {
    return (
      <div className="inv-root">

        <header className="inv-header">

          <div>
            <h1>
              Factura de compra
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
          Cargando compra…
        </p>

      </div>
    );
  }

  /* =========================================================
     ERROR
  ========================================================= */

  if (
    !compra ||
    error
  ) {
    return (
      <div className="inv-root">

        <header className="inv-header">

          <div>
            <h1>
              Factura de compra
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
            position: "static"
          }}
        >
          {error ||
            "Compra no encontrada."}
        </div>

      </div>
    );
  }

  /* =========================================================
     RENDER
  ========================================================= */

  return (
    <div className="inv-root">

      {/* =====================================================
          HEADER
      ===================================================== */}

      <header className="inv-header">

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12
          }}
        >

          {empresaInfo?.logoUrl && (

            <img
              src={
                empresaInfo.logoUrl
              }
              alt="Logo"
              style={{
                width: 40,
                height: 40,
                borderRadius: 10,
                objectFit: "cover",
                border:
                  "1px solid var(--border)"
              }}
            />

          )}

          <div>

            <h1>
              🛒 Factura de compra
            </h1>

            <p className="inv-subtle">

              {empresaInfo?.nombre
                ? `${empresaInfo.nombre} • `
                : ""}

              Registro de proveedor

            </p>

          </div>

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

      {/* =====================================================
          FACTURA
      ===================================================== */}

      <section
        className="inv-grid"
        style={{
          gridTemplateColumns:
            "1fr"
        }}
      >

        <div className="card">

          {/* CABECERA */}

          <div className="card-header">

            <div>

              <h2
                style={{
                  margin: 0
                }}
              >
                Factura{" "}
                {compra.numeroFactura ||
                  "—"}
              </h2>

              <p
                className="inv-subtle"
                style={{
                  margin:
                    "4px 0 0"
                }}
              >
                Registrada{" "}
                {formatearFechaHora(
                  compra.createdAt
                )}
              </p>

            </div>

            <span
              className="badge"
              style={{
                color:
                  esCredito
                    ? "#f59e0b"
                    : "#22c55e"
              }}
            >
              {esCredito
                ? "📅 Crédito"
                : "💵 Contado"}
            </span>

          </div>

          <div className="card-body">

            {/* =================================================
                PROVEEDOR
            ================================================= */}

            <div
              style={{
                display: "grid",
                gridTemplateColumns:
                  "repeat(auto-fit, minmax(190px, 1fr))",
                gap: 12,
                marginBottom: 18
              }}
            >

              <DatoGrande
                titulo="Proveedor"
                valor={
                  compra.proveedorNombre ||
                  "—"
                }
              />

              <DatoGrande
                titulo="NIT / Documento"
                valor={
                  compra.proveedorDocumento ||
                  "—"
                }
              />

              <DatoGrande
                titulo="Fecha factura"
                valor={
                  formatearFecha(
                    compra.fechaFactura
                  )
                }
              />

              <DatoGrande
                titulo="Forma de pago"
                valor={
                  esCredito
                    ? "Crédito"
                    : "Contado"
                }
                color={
                  esCredito
                    ? "#f59e0b"
                    : "#22c55e"
                }
              />

            </div>

            {/* =================================================
                ESTADO DE PAGO
            ================================================= */}

            <div
              style={{
                padding: 16,
                marginBottom: 18,
                borderRadius: 16,

                border:
                  estadoPago === "PAGADA"
                    ? "1px solid rgba(34,197,94,.28)"
                    : "1px solid rgba(245,158,11,.28)",

                background:
                  estadoPago === "PAGADA"
                    ? "rgba(34,197,94,.055)"
                    : "rgba(245,158,11,.055)"
              }}
            >

              <div
                style={{
                  display: "flex",
                  justifyContent:
                    "space-between",
                  gap: 14,
                  alignItems: "center",
                  flexWrap: "wrap"
                }}
              >

                <div>

                  <div className="inv-subtle">
                    Estado del pago
                  </div>

                  <strong
                    style={{
                      fontSize: 17,

                      color:
                        estadoPago === "PAGADA"
                          ? "#22c55e"
                          : "#f59e0b"
                    }}
                  >
                    {estadoPago === "PAGADA"
                      ? "✅ PAGADA"
                      : estadoPago === "PARCIAL"
                        ? "🟡 PAGO PARCIAL"
                        : "🕒 PENDIENTE"}
                  </strong>

                </div>

                <div
                  style={{
                    textAlign: "right"
                  }}
                >

                  <div className="inv-subtle">
                    Total factura
                  </div>

                  <strong
                    style={{
                      fontSize: 22
                    }}
                  >
                    {moneda(
                      total
                    )}
                  </strong>

                </div>

              </div>

              {esCredito && (

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns:
                      "repeat(auto-fit, minmax(150px, 1fr))",
                    gap: 10,
                    marginTop: 14,
                    paddingTop: 14,
                    borderTop:
                      "1px solid var(--border)"
                  }}
                >

                  <MiniDato
                    titulo="Vencimiento"
                    valor={
                      fechaVencimiento
                    }
                  />

                  <MiniDato
                    titulo="Pagado"
                    valor={
                      moneda(
                        pagado
                      )
                    }
                    color="#22c55e"
                  />

                  <MiniDato
                    titulo="Saldo pendiente"
                    valor={
                      moneda(
                        saldoPendiente
                      )
                    }
                    color={
                      saldoPendiente > 0
                        ? "#f59e0b"
                        : "#22c55e"
                    }
                  />

                </div>

              )}

            </div>

            {/* =================================================
                PRODUCTOS
            ================================================= */}

            <h3
              style={{
                marginTop: 0
              }}
            >
              Productos recibidos
            </h3>

            <div
              style={{
                overflowX: "auto",
                border:
                  "1px solid var(--border)",
                borderRadius: 14
              }}
            >

              <div
                style={{
                  minWidth: 720
                }}
              >

                {/* ENCABEZADO */}

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns:
                      "1fr 90px 130px 140px 170px",
                    gap: 8,
                    padding:
                      "11px 12px",
                    fontWeight: 700,
                    borderBottom:
                      "1px solid var(--border)",
                    background:
                      "rgba(255,255,255,.025)"
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
                    Costo
                  </div>

                  <div
                    style={{
                      textAlign:
                        "right"
                    }}
                  >
                    Subtotal
                  </div>

                  <div
                    style={{
                      textAlign:
                        "right"
                    }}
                  >
                    Inventario
                  </div>

                </div>

                {/* FILAS */}

                {items.map(
                  (
                    item,
                    index
                  ) => {

                    const subtotal =
                      item.subtotal ||
                      (
                        item.cantidad *
                        item.costoUnitario
                      );

                    const tieneKardex =
                      item.stockAnterior !==
                        undefined &&
                      item.stockNuevo !==
                        undefined;

                    return (

                      <div
                        key={
                          index
                        }
                        style={{
                          display:
                            "grid",

                          gridTemplateColumns:
                            "1fr 90px 130px 140px 170px",

                          gap: 8,

                          padding:
                            "11px 12px",

                          borderBottom:
                            "1px solid var(--border)"
                        }}
                      >

                        <div>
                          <strong>
                            {
                              item.nombre
                            }
                          </strong>
                        </div>

                        <div
                          style={{
                            textAlign:
                              "right"
                          }}
                        >
                          {cantidad(
                            item.cantidad
                          )}
                        </div>

                        <div
                          style={{
                            textAlign:
                              "right"
                          }}
                        >
                          {moneda(
                            item.costoUnitario
                          )}
                        </div>

                        <div
                          style={{
                            textAlign:
                              "right"
                          }}
                        >
                          {moneda(
                            subtotal
                          )}
                        </div>

                        <div
                          style={{
                            textAlign:
                              "right"
                          }}
                        >

                          {tieneKardex ? (

                            <span>
                              {cantidad(
                                item.stockAnterior
                              )}
                              {" → "}
                              <b
                                style={{
                                  color:
                                    "#22c55e"
                                }}
                              >
                                {cantidad(
                                  item.stockNuevo
                                )}
                              </b>
                            </span>

                          ) : (

                            <span className="inv-subtle">
                              No registrado
                            </span>

                          )}

                        </div>

                      </div>

                    );
                  }
                )}

                {/* TOTAL */}

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns:
                      "1fr 90px 130px 140px 170px",
                    gap: 8,
                    padding: 13,
                    fontWeight: 800
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
                    {moneda(
                      total
                    )}
                  </div>

                  <div />

                </div>

              </div>

            </div>

          </div>

        </div>

      </section>

    </div>
  );
}

/* =========================================================
   DATO GRANDE
========================================================= */

function DatoGrande({
  titulo,
  valor,
  color
}) {
  return (
    <div
      style={{
        padding: 13,
        border:
          "1px solid var(--border)",
        borderRadius: 13,
        background:
          "rgba(255,255,255,.02)"
      }}
    >

      <div
        className="inv-subtle"
        style={{
          fontSize: 11
        }}
      >
        {titulo}
      </div>

      <strong
        style={{
          display: "block",
          marginTop: 4,
          color:
            color ||
            "var(--text)"
        }}
      >
        {valor}
      </strong>

    </div>
  );
}

/* =========================================================
   MINI DATO
========================================================= */

function MiniDato({
  titulo,
  valor,
  color
}) {
  return (
    <div>

      <div
        className="inv-subtle"
        style={{
          fontSize: 11
        }}
      >
        {titulo}
      </div>

      <strong
        style={{
          display: "block",
          marginTop: 3,
          color:
            color ||
            "var(--text)"
        }}
      >
        {valor}
      </strong>

    </div>
  );
}