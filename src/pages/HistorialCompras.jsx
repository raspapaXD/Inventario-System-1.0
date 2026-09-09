// src/pages/HistorialCompras.jsx

import {
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";

import {
  Link
} from "react-router-dom";

import {
  collection,
  getDocs,
  query,
  orderBy,
  limit,
  startAfter
} from "firebase/firestore";

import { db } from "../../firebaseClient.js";
import { useTenant } from "../tenant/TenantProvider";
import AppMenu from "../components/AppMenu.jsx";

import "./inventario.css";

const PAGE_SIZE = 20;

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
  `$${Number(value || 0).toLocaleString("es-CO")}`;

const formatearFecha =
  value => {
    if (!value) {
      return "—";
    }

    if (
      typeof value?.toDate ===
      "function"
    ) {
      return value
        .toDate()
        .toLocaleDateString(
          "es-CO"
        );
    }

    if (
      value instanceof Date
    ) {
      return value.toLocaleDateString(
        "es-CO"
      );
    }

    const d =
      new Date(value);

    if (
      Number.isNaN(
        d.getTime()
      )
    ) {
      return "—";
    }

    return d.toLocaleDateString(
      "es-CO"
    );
  };

/* =========================================================
   COMPONENTE
========================================================= */

export default function HistorialCompras() {
  const {
    empresa
  } = useTenant();

  const {
    theme,
    toggle
  } = useTheme();

  const restauracionInicializada =
    useRef(false);

  /* =======================================================
     ESTADOS
  ======================================================= */

  const [
    compras,
    setCompras
  ] = useState([]);

  const [
    ultimoDoc,
    setUltimoDoc
  ] = useState(null);

  const [
    hayMas,
    setHayMas
  ] = useState(true);

  const [
    busqueda,
    setBusqueda
  ] = useState("");

  const [
    cargando,
    setCargando
  ] = useState(false);

  const [
    error,
    setError
  ] = useState("");

  /* =======================================================
     STORAGE
  ======================================================= */

  const storageKey =
    empresa?.id
      ? `ordexa_historial_compras_${empresa.id}`
      : null;

  /* =======================================================
     COLECCIÓN
  ======================================================= */

  const comprasCol =
    useMemo(() => {
      if (!empresa?.id) {
        return null;
      }

      return collection(
        db,
        "empresas",
        empresa.id,
        "compras"
      );

    }, [
      empresa?.id
    ]);

  const normalizarCompra =
    d => ({
      id: d.id,
      ...d.data(),
      _doc: d
    });

  /* =======================================================
     PRIMERA PÁGINA
  ======================================================= */

  const cargarPrimeraPagina =
    async (
      cantidadInicial =
        PAGE_SIZE
    ) => {
      if (!comprasCol) {
        return;
      }

      try {
        setCargando(
          true
        );

        setError("");

        const limiteReal =
          Math.max(
            PAGE_SIZE,
            Number(
              cantidadInicial ||
              PAGE_SIZE
            )
          );

        const qy =
          query(
            comprasCol,
            orderBy(
              "createdAt",
              "desc"
            ),
            limit(
              limiteReal
            )
          );

        const snap =
          await getDocs(
            qy
          );

        const lista =
          snap.docs.map(
            normalizarCompra
          );

        setCompras(
          lista
        );

        setUltimoDoc(
          snap.docs[
            snap.docs.length -
            1
          ] ||
          null
        );

        setHayMas(
          snap.docs.length ===
          limiteReal
        );

      } catch (e) {
        console.error(e);

        setError(
          "No se pudo cargar el historial de compras."
        );

      } finally {
        setCargando(
          false
        );
      }
    };

  /* =======================================================
     CARGAR MÁS
  ======================================================= */

  const cargarMas =
    async () => {
      if (
        !comprasCol ||
        !ultimoDoc
      ) {
        return;
      }

      try {
        setCargando(
          true
        );

        setError("");

        const qy =
          query(
            comprasCol,

            orderBy(
              "createdAt",
              "desc"
            ),

            startAfter(
              ultimoDoc
            ),

            limit(
              PAGE_SIZE
            )
          );

        const snap =
          await getDocs(
            qy
          );

        const lista =
          snap.docs.map(
            normalizarCompra
          );

        setCompras(
          prev => [
            ...prev,
            ...lista
          ]
        );

        setUltimoDoc(
          snap.docs[
            snap.docs.length -
            1
          ] ||
          null
        );

        setHayMas(
          snap.docs.length ===
          PAGE_SIZE
        );

      } catch (e) {
        console.error(e);

        setError(
          "No se pudieron cargar más compras."
        );

      } finally {
        setCargando(
          false
        );
      }
    };

  /* =======================================================
     CARGA + RESTAURACIÓN
  ======================================================= */

  useEffect(() => {
    if (
      !comprasCol ||
      restauracionInicializada.current
    ) {
      return;
    }

    restauracionInicializada.current =
      true;

    (async () => {
      let estado =
        null;

      if (
        storageKey
      ) {
        try {
          const guardado =
            sessionStorage.getItem(
              storageKey
            );

          if (
            guardado
          ) {
            estado =
              JSON.parse(
                guardado
              );
          }

        } catch (e) {
          console.warn(
            "No fue posible leer el estado del historial de compras.",
            e
          );
        }
      }

      if (
        estado &&
        typeof estado.busqueda ===
          "string"
      ) {
        setBusqueda(
          estado.busqueda
        );
      }

      const cantidadACargar =
        estado?.loadedCount
          ? Math.max(
              PAGE_SIZE,
              Number(
                estado.loadedCount
              )
            )
          : PAGE_SIZE;

      await cargarPrimeraPagina(
        cantidadACargar
      );

      /*
       * Si venimos de una factura,
       * restauramos exactamente la
       * posición anterior.
       */

      if (
        estado
      ) {
        requestAnimationFrame(
          () => {
            requestAnimationFrame(
              () => {
                window.scrollTo({
                  top:
                    Number(
                      estado.scrollY ||
                      0
                    ),

                  left: 0,

                  behavior:
                    "auto"
                });

                /*
                 * Ya fue utilizado.
                 *
                 * Así si después entras desde
                 * el menú, no te manda a una
                 * posición antigua.
                 */

                if (
                  storageKey
                ) {
                  sessionStorage.removeItem(
                    storageKey
                  );
                }
              }
            );
          }
        );
      }
    })();

  }, [
    comprasCol,
    storageKey
  ]);

  /* =======================================================
     GUARDAR POSICIÓN
  ======================================================= */

  const guardarEstadoPagina =
    compraId => {
      if (!storageKey) {
        return;
      }

      try {
        sessionStorage.setItem(
          storageKey,

          JSON.stringify({
            scrollY:
              window.scrollY,

            busqueda,

            loadedCount:
              compras.length,

            compraId
          })
        );

      } catch (e) {
        console.warn(
          "No fue posible guardar la posición del historial de compras.",
          e
        );
      }
    };

  /* =======================================================
     FILTRAR
  ======================================================= */

  const comprasFiltradas =
    useMemo(() => {
      const q =
        busqueda
          .trim()
          .toLowerCase();

      if (!q) {
        return compras;
      }

      return compras.filter(
        compra => {
          const factura =
            String(
              compra.numeroFactura ||
              ""
            ).toLowerCase();

          const proveedor =
            String(
              compra.proveedorNombre ||
              ""
            ).toLowerCase();

          const documento =
            String(
              compra.proveedorDocumento ||
              ""
            ).toLowerCase();

          return (
            factura.includes(q) ||
            proveedor.includes(q) ||
            documento.includes(q)
          );
        }
      );

    }, [
      compras,
      busqueda
    ]);

  /* =======================================================
     TOTAL
  ======================================================= */

  const totalMostrado =
    useMemo(
      () =>
        comprasFiltradas.reduce(
          (
            acc,
            compra
          ) =>
            acc +
            Number(
              compra.total ||
              0
            ),
          0
        ),
      [
        comprasFiltradas
      ]
    );

  /* =======================================================
     EMPRESA
  ======================================================= */

  if (
    !empresa?.id
  ) {
    return (
      <div className="inv-root">

        <header className="inv-header">

          <h1>
            Cargando empresa…
          </h1>

        </header>

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

        <div>

          <h1>
            📑 Historial de compras
          </h1>

          <p className="inv-subtle">

            {cargando &&
            compras.length === 0
              ? "Cargando compras..."
              : `${comprasFiltradas.length} factura(s) • Total ${moneda(
                  totalMostrado
                )}`}

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

          <Link
            to="/compras"
            className="btn btn-primary"
          >
            🛒 Nueva compra
          </Link>

          <AppMenu />

        </div>

      </header>

      {/* =====================================================
          BUSCADOR
      ===================================================== */}

      <section className="inv-toolbar">

        <div
          className="input-with-icon"
          style={{
            maxWidth: 460
          }}
        >

          <span className="icon">
            🔎
          </span>

          <input
            type="text"
            placeholder="Buscar por factura, proveedor o NIT..."
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

      </section>

      {/* =====================================================
          FACTURAS
      ===================================================== */}

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
              Facturas de compra
            </h2>

          </div>

          <div className="card-body">

            {error && (

              <div
                className="toast toast-error"
                style={{
                  position: "static",
                  marginBottom: 12
                }}
              >
                {error}
              </div>

            )}

            {!cargando &&
            comprasFiltradas.length ===
              0 ? (

              <div
                style={{
                  textAlign: "center",
                  padding:
                    "40px 20px"
                }}
              >

                <div
                  style={{
                    fontSize: 34,
                    marginBottom: 10
                  }}
                >
                  📑
                </div>

                <strong>
                  No hay compras para mostrar
                </strong>

                <p className="inv-subtle">
                  Registra una compra o cambia la búsqueda.
                </p>

              </div>

            ) : (

              <ul className="product-list">

                {comprasFiltradas.map(
                  compra => {

                    const esCredito =
                      compra.tipoPago ===
                      "CREDITO";

                    const pendiente =
                      compra.estadoPago ===
                        "PENDIENTE" ||
                      compra.estadoPago ===
                        "PARCIAL";

                    return (

                      <li
                        id={`compra-${compra.id}`}
                        key={
                          compra.id
                        }
                        className="product-item"
                        style={{
                          gridTemplateColumns:
                            "1fr auto"
                        }}
                      >

                        <div className="product-info">

                          <div className="product-title-row">

                            <strong>
                              Factura{" "}
                              {compra.numeroFactura ||
                                "—"}
                            </strong>

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

                            {pendiente ? (

                              <span
                                className="badge"
                                style={{
                                  color:
                                    compra.estadoPago ===
                                    "PARCIAL"
                                      ? "#3b82f6"
                                      : "#f59e0b"
                                }}
                              >
                                {compra.estadoPago ===
                                "PARCIAL"
                                  ? "Pago parcial"
                                  : "Pendiente"}
                              </span>

                            ) : (

                              <span
                                className="badge"
                                style={{
                                  color:
                                    "#22c55e"
                                }}
                              >
                                ✅ Pagada
                              </span>

                            )}

                          </div>

                          <div className="product-meta">

                            <span>
                              Proveedor:{" "}

                              <b>
                                {compra.proveedorNombre ||
                                  "—"}
                              </b>
                            </span>

                            <span>
                              NIT / Documento:{" "}

                              <b>
                                {compra.proveedorDocumento ||
                                  "—"}
                              </b>
                            </span>

                            <span>
                              Fecha factura:{" "}

                              <b>
                                {formatearFecha(
                                  compra.fechaFactura
                                )}
                              </b>
                            </span>

                            {esCredito && (

                              <span>
                                Vence:{" "}

                                <b>
                                  {formatearFecha(
                                    compra.fechaVencimiento
                                  )}
                                </b>
                              </span>

                            )}

                            <span>
                              Productos:{" "}

                              <b>
                                {
                                  (
                                    compra.items ||
                                    []
                                  ).length
                                }
                              </b>
                            </span>

                            <span>
                              Total:{" "}

                              <b>
                                {moneda(
                                  compra.total
                                )}
                              </b>
                            </span>

                            {esCredito && (

                              <span>
                                Saldo registrado:{" "}

                                <b>
                                  {moneda(
                                    compra.saldoPendiente
                                  )}
                                </b>
                              </span>

                            )}

                          </div>

                        </div>

                        <div className="product-actions">

                          <Link
                            to={`/factura-compra/${compra.id}`}
                            className="btn btn-small"
                            onClick={() =>
                              guardarEstadoPagina(
                                compra.id
                              )
                            }
                          >
                            🧾 Ver factura
                          </Link>

                        </div>

                      </li>

                    );
                  }
                )}

              </ul>

            )}

            {/* CARGAR MÁS */}

            {hayMas && (

              <div
                style={{
                  marginTop: 14
                }}
              >

                <button
                  type="button"
                  className="btn"
                  onClick={
                    cargarMas
                  }
                  disabled={
                    cargando
                  }
                >
                  {cargando
                    ? "Cargando..."
                    : "Cargar más"}
                </button>

              </div>

            )}

          </div>

        </div>

      </section>

    </div>
  );
}