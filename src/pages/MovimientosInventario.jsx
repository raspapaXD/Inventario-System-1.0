// src/pages/MovimientosInventario.jsx

import {
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";

import {
  collection,
  getDocs
} from "firebase/firestore";

import {
  Link,
  useSearchParams
} from "react-router-dom";

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

const moneda = valor =>
  `$${Number(valor || 0).toLocaleString("es-CO", {
    maximumFractionDigits: 0
  })}`;

const cantidad = valor =>
  Number(valor || 0)
    .toLocaleString("es-CO");

function convertirFecha(fecha) {
  if (!fecha) {
    return null;
  }

  if (
    typeof fecha?.toDate ===
    "function"
  ) {
    return fecha.toDate();
  }

  const date =
    new Date(fecha);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return null;
  }

  return date;
}

function fechaCompleta(fecha) {
  const date =
    convertirFecha(fecha);

  if (!date) {
    return "Fecha no disponible";
  }

  return date.toLocaleString(
    "es-CO",
    {
      dateStyle: "medium",
      timeStyle: "short"
    }
  );
}

/* =========================================================
   DIFERENCIA REAL
========================================================= */

function obtenerDiferencia(movimiento) {
  const guardada =
    Number(
      movimiento?.diferencia
    );

  if (
    Number.isFinite(guardada) &&
    movimiento?.diferencia !==
      undefined
  ) {
    return guardada;
  }

  const cant =
    Number(
      movimiento?.cantidad ||
      0
    );

  if (
    movimiento?.tipo ===
    "VENTA"
  ) {
    return -Math.abs(cant);
  }

  if (
    movimiento?.tipo ===
    "COMPRA"
  ) {
    return Math.abs(cant);
  }

  return cant;
}

/* =========================================================
   INFORMACIÓN VISUAL
========================================================= */

function infoTipo(tipo) {
  if (tipo === "COMPRA") {
    return {
      titulo: "Compra",
      icono: "🛒",
      color: "#22c55e",
      fondo: "rgba(34,197,94,.06)"
    };
  }

  if (tipo === "VENTA") {
    return {
      titulo: "Venta",
      icono: "🧾",
      color: "#3b82f6",
      fondo: "rgba(59,130,246,.06)"
    };
  }

  if (tipo === "AJUSTE") {
    return {
      titulo: "Ajuste",
      icono: "📦",
      color: "#f59e0b",
      fondo: "rgba(245,158,11,.06)"
    };
  }

  return {
    titulo: tipo || "Movimiento",
    icono: "↔️",
    color: "var(--text)",
    fondo: "rgba(255,255,255,.025)"
  };
}

/* =========================================================
   MOTIVOS
========================================================= */

function nombreMotivo(motivo) {
  const motivos = {
    CONTEO_FISICO:
      "Conteo físico",

    PRODUCTO_DANADO:
      "Producto dañado",

    PERDIDA:
      "Pérdida / faltante",

    DEVOLUCION:
      "Devolución",

    ERROR_REGISTRO:
      "Corrección de registro",

    OTRO:
      "Otro"
  };

  return (
    motivos[motivo] ||
    motivo ||
    "—"
  );
}

/* =========================================================
   PÁGINA
========================================================= */

export default function MovimientosInventario() {
  const {
    empresa
  } = useTenant();

  const {
    theme,
    toggle
  } = useTheme();

  const [
    searchParams,
    setSearchParams
  ] = useSearchParams();

  /*
   * Evita restaurar el scroll más de una vez
   * durante el mismo montaje de la página.
   */
  const restauracionRealizada =
    useRef(false);

  /* =======================================================
     CLAVE DE SESIÓN
  ======================================================= */

  const storageKey =
    empresa?.id
      ? `ordexa_movimientos_inventario_${empresa.id}`
      : null;

  /* =======================================================
     ESTADOS
  ======================================================= */

  const [
    movimientos,
    setMovimientos
  ] = useState([]);

  const [
    productos,
    setProductos
  ] = useState([]);

  const [
    cargando,
    setCargando
  ] = useState(true);

  const [
    error,
    setError
  ] = useState("");

  const [
    busqueda,
    setBusqueda
  ] = useState("");

  const [
    tipo,
    setTipo
  ] = useState("TODOS");

  const [
    productoId,
    setProductoId
  ] = useState(
    () =>
      searchParams.get(
        "producto"
      ) || "TODOS"
  );

  const [
    desde,
    setDesde
  ] = useState("");

  const [
    hasta,
    setHasta
  ] = useState("");

  /* =======================================================
     CARGAR DATOS
  ======================================================= */

  useEffect(() => {
    (async () => {
      if (!empresa?.id) {
        return;
      }

      try {
        setCargando(
          true
        );

        setError("");

        const [
          movimientosSnap,
          productosSnap
        ] =
          await Promise.all([
            getDocs(
              collection(
                db,
                "empresas",
                empresa.id,
                "movimientos"
              )
            ),

            getDocs(
              collection(
                db,
                "empresas",
                empresa.id,
                "productos"
              )
            )
          ]);

        const listaMovimientos =
          movimientosSnap.docs.map(
            d => ({
              id: d.id,
              ...d.data()
            })
          );

        listaMovimientos.sort(
          (a, b) => {
            const fechaA =
              convertirFecha(
                a.fecha
              )?.getTime() ||
              0;

            const fechaB =
              convertirFecha(
                b.fecha
              )?.getTime() ||
              0;

            return (
              fechaB -
              fechaA
            );
          }
        );

        const listaProductos =
          productosSnap.docs.map(
            d => ({
              id: d.id,
              ...d.data()
            })
          );

        listaProductos.sort(
          (a, b) =>
            (
              a.nombre ||
              ""
            ).localeCompare(
              b.nombre ||
              ""
            )
        );

        setMovimientos(
          listaMovimientos
        );

        setProductos(
          listaProductos
        );

      } catch (e) {
        console.error(e);

        setError(
          "No fue posible cargar los movimientos de inventario."
        );

      } finally {
        setCargando(
          false
        );
      }
    })();

  }, [
    empresa?.id
  ]);

  /* =======================================================
     RESTAURAR ESTADO AL VOLVER
  ======================================================= */

  useEffect(() => {
    if (
      cargando ||
      !storageKey ||
      restauracionRealizada.current
    ) {
      return;
    }

    const guardado =
      sessionStorage.getItem(
        storageKey
      );

    if (!guardado) {
      restauracionRealizada.current =
        true;

      return;
    }

    try {
      const estado =
        JSON.parse(
          guardado
        );

      /*
       * Primero restauramos los filtros.
       */

      if (
        typeof estado.busqueda ===
        "string"
      ) {
        setBusqueda(
          estado.busqueda
        );
      }

      if (
        estado.tipo
      ) {
        setTipo(
          estado.tipo
        );
      }

      if (
        estado.productoId
      ) {
        setProductoId(
          estado.productoId
        );

        const nuevos =
          new URLSearchParams(
            searchParams
          );

        if (
          estado.productoId ===
          "TODOS"
        ) {
          nuevos.delete(
            "producto"
          );
        } else {
          nuevos.set(
            "producto",
            estado.productoId
          );
        }

        setSearchParams(
          nuevos,
          {
            replace: true
          }
        );
      }

      if (
        typeof estado.desde ===
        "string"
      ) {
        setDesde(
          estado.desde
        );
      }

      if (
        typeof estado.hasta ===
        "string"
      ) {
        setHasta(
          estado.hasta
        );
      }

      /*
       * Marcamos como restaurado antes de mover
       * la pantalla para evitar dobles ejecuciones.
       */

      restauracionRealizada.current =
        true;

      /*
       * React necesita un pequeño momento para
       * volver a dibujar la lista con los filtros.
       *
       * Dos requestAnimationFrame hacen que el
       * scroll ocurra después del render real.
       */

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

                behavior: "auto"
              });
            }
          );
        }
      );

    } catch (e) {
      console.warn(
        "No fue posible restaurar Movimientos de inventario.",
        e
      );

      restauracionRealizada.current =
        true;
    }

  }, [
    cargando,
    storageKey,
    searchParams,
    setSearchParams
  ]);

  /* =======================================================
     GUARDAR ESTADO ANTES DE ABRIR FACTURA
  ======================================================= */

  const guardarEstadoPagina =
    movimientoId => {
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

            tipo,

            productoId,

            desde,

            hasta,

            movimientoId
          })
        );

      } catch (e) {
        console.warn(
          "No fue posible guardar la posición de Movimientos.",
          e
        );
      }
    };

  /* =======================================================
     CAMBIAR PRODUCTO
  ======================================================= */

  const cambiarProducto =
    value => {
      setProductoId(
        value
      );

      const nuevos =
        new URLSearchParams(
          searchParams
        );

      if (
        value ===
        "TODOS"
      ) {
        nuevos.delete(
          "producto"
        );
      } else {
        nuevos.set(
          "producto",
          value
        );
      }

      setSearchParams(
        nuevos,
        {
          replace: true
        }
      );
    };

  /* =======================================================
     FILTRADO
  ======================================================= */

  const movimientosFiltrados =
    useMemo(() => {
      const q =
        busqueda
          .trim()
          .toLowerCase();

      return movimientos.filter(
        movimiento => {

          /* TIPO */

          if (
            tipo !== "TODOS" &&
            movimiento.tipo !==
              tipo
          ) {
            return false;
          }

          /* PRODUCTO */

          if (
            productoId !==
              "TODOS" &&
            movimiento.productoId !==
              productoId
          ) {
            return false;
          }

          /* FECHA */

          const fecha =
            convertirFecha(
              movimiento.fecha
            );

          if (desde) {
            const fechaDesde =
              new Date(
                `${desde}T00:00:00`
              );

            if (
              !fecha ||
              fecha <
                fechaDesde
            ) {
              return false;
            }
          }

          if (hasta) {
            const fechaHasta =
              new Date(
                `${hasta}T23:59:59`
              );

            if (
              !fecha ||
              fecha >
                fechaHasta
            ) {
              return false;
            }
          }

          /* BÚSQUEDA */

          if (q) {
            const texto = `
              ${movimiento.productoNombre || ""}
              ${movimiento.tipo || ""}
              ${movimiento.numeroFactura || ""}
              ${movimiento.proveedorNombre || ""}
              ${movimiento.clienteNombre || ""}
              ${movimiento.usuarioEmail || ""}
              ${movimiento.motivo || ""}
              ${movimiento.observacion || ""}
              ${movimiento.ventaId || ""}
              ${movimiento.compraId || ""}
            `
              .toLowerCase();

            if (
              !texto.includes(q)
            ) {
              return false;
            }
          }

          return true;
        }
      );

    }, [
      movimientos,
      tipo,
      productoId,
      desde,
      hasta,
      busqueda
    ]);

  /* =======================================================
     RESUMEN
  ======================================================= */

  const resumen =
    useMemo(() => {
      let entradas = 0;
      let salidas = 0;
      let compras = 0;
      let ventas = 0;
      let ajustes = 0;

      for (
        const movimiento
        of movimientosFiltrados
      ) {
        const diferencia =
          obtenerDiferencia(
            movimiento
          );

        if (
          diferencia > 0
        ) {
          entradas +=
            diferencia;
        }

        if (
          diferencia < 0
        ) {
          salidas +=
            Math.abs(
              diferencia
            );
        }

        if (
          movimiento.tipo ===
          "COMPRA"
        ) {
          compras++;
        }

        if (
          movimiento.tipo ===
          "VENTA"
        ) {
          ventas++;
        }

        if (
          movimiento.tipo ===
          "AJUSTE"
        ) {
          ajustes++;
        }
      }

      return {
        total:
          movimientosFiltrados.length,

        entradas,

        salidas,

        compras,

        ventas,

        ajustes
      };

    }, [
      movimientosFiltrados
    ]);

  /* =======================================================
     PRODUCTO SELECCIONADO
  ======================================================= */

  const productoSeleccionado =
    useMemo(
      () =>
        productoId ===
        "TODOS"
          ? null
          : productos.find(
              p =>
                p.id ===
                productoId
            ) || null,
      [
        productoId,
        productos
      ]
    );

  /* =======================================================
     LIMPIAR FILTROS
  ======================================================= */

  const limpiarFiltros =
    () => {
      setBusqueda("");
      setTipo("TODOS");
      setProductoId("TODOS");
      setDesde("");
      setHasta("");

      setSearchParams(
        {},
        {
          replace: true
        }
      );

      /*
       * Si el usuario limpia los filtros
       * conscientemente, eliminamos también
       * el estado anterior guardado.
       */

      if (
        storageKey
      ) {
        sessionStorage.removeItem(
          storageKey
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
            📜 Movimientos de inventario
          </h1>

          <p className="inv-subtle">
            Historial de compras, ventas y ajustes de existencias.
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

          <AppMenu />

        </div>

      </header>

      {/* =====================================================
          PRODUCTO ESPECÍFICO
      ===================================================== */}

      {productoSeleccionado && (

        <div
          className="card"
          style={{
            marginBottom: 16,
            padding: 16,
            border:
              "1px solid rgba(59,130,246,.28)",
            background:
              "rgba(59,130,246,.045)"
          }}
        >

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap"
            }}
          >

            {productoSeleccionado.imagen && (

              <img
                src={
                  productoSeleccionado.imagen
                }
                alt={
                  productoSeleccionado.nombre
                }
                style={{
                  width: 54,
                  height: 54,
                  objectFit: "cover",
                  borderRadius: 12,
                  border:
                    "1px solid var(--border)"
                }}
              />

            )}

            <div
              style={{
                flex: 1
              }}
            >

              <div className="inv-subtle">
                Historial del producto
              </div>

              <strong
                style={{
                  fontSize: 18
                }}
              >
                {
                  productoSeleccionado.nombre
                }
              </strong>

              <div
                className="product-meta"
                style={{
                  marginTop: 5
                }}
              >

                <span>
                  Stock actual:{" "}

                  <b>
                    {cantidad(
                      productoSeleccionado.cantidad
                    )}
                  </b>
                </span>

                <span>
                  Mínimo:{" "}

                  <b>
                    {cantidad(
                      productoSeleccionado.minimo
                    )}
                  </b>
                </span>

              </div>

            </div>

            <button
              className="btn btn-small"
              onClick={() =>
                cambiarProducto(
                  "TODOS"
                )
              }
            >
              Ver todos
            </button>

          </div>

        </div>

      )}

      {/* =====================================================
          INDICADORES
      ===================================================== */}

      <section
        style={{
          display: "grid",
          gridTemplateColumns:
            "repeat(auto-fit, minmax(170px, 1fr))",
          gap: 12,
          marginBottom: 18
        }}
      >

        <ResumenCard
          titulo="Movimientos"
          valor={
            cantidad(
              resumen.total
            )
          }
          detalle="Registros encontrados"
          icono="📜"
        />

        <ResumenCard
          titulo="Entradas"
          valor={
            `+${cantidad(
              resumen.entradas
            )}`
          }
          detalle={`${resumen.compras} compras / ajustes positivos`}
          icono="📥"
          color="#22c55e"
        />

        <ResumenCard
          titulo="Salidas"
          valor={
            `-${cantidad(
              resumen.salidas
            )}`
          }
          detalle={`${resumen.ventas} ventas / ajustes negativos`}
          icono="📤"
          color="#ef4444"
        />

        <ResumenCard
          titulo="Ajustes"
          valor={
            cantidad(
              resumen.ajustes
            )
          }
          detalle="Correcciones manuales registradas"
          icono="📦"
          color="#f59e0b"
        />

      </section>

      {/* =====================================================
          FILTROS
      ===================================================== */}

      <div
        className="card"
        style={{
          marginBottom: 18
        }}
      >

        <div className="card-header">

          <div>

            <h2>
              Buscar movimientos
            </h2>

            <p
              className="inv-subtle"
              style={{
                margin:
                  "4px 0 0"
              }}
            >
              Filtra por operación, producto, fecha o responsable.
            </p>

          </div>

        </div>

        <div className="card-body">

          <div
            style={{
              display: "grid",
              gridTemplateColumns:
                "repeat(auto-fit, minmax(190px, 1fr))",
              gap: 12
            }}
          >

            {/* BUSCADOR */}

            <div className="form-field">

              <label>
                Buscar
              </label>

              <div className="input-with-icon">

                <span className="icon">
                  🔎
                </span>

                <input
                  placeholder="Producto, factura, cliente, proveedor..."
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

            </div>

            {/* PRODUCTO */}

            <div className="form-field">

              <label>
                Producto
              </label>

              <select
                value={
                  productoId
                }
                onChange={e =>
                  cambiarProducto(
                    e.target.value
                  )
                }
              >

                <option value="TODOS">
                  Todos los productos
                </option>

                {productos.map(
                  producto => (

                    <option
                      key={
                        producto.id
                      }
                      value={
                        producto.id
                      }
                    >
                      {producto.nombre}
                    </option>

                  )
                )}

              </select>

            </div>

            {/* DESDE */}

            <div className="form-field">

              <label>
                Desde
              </label>

              <input
                type="date"
                value={
                  desde
                }
                onChange={e =>
                  setDesde(
                    e.target.value
                  )
                }
              />

            </div>

            {/* HASTA */}

            <div className="form-field">

              <label>
                Hasta
              </label>

              <input
                type="date"
                value={
                  hasta
                }
                onChange={e =>
                  setHasta(
                    e.target.value
                  )
                }
              />

            </div>

          </div>

          {/* TIPOS */}

          <div
            style={{
              display: "flex",
              gap: 8,
              flexWrap: "wrap",
              marginTop: 14,
              paddingTop: 14,
              borderTop:
                "1px solid var(--border)"
            }}
          >

            <FiltroButton
              activo={
                tipo ===
                "TODOS"
              }
              onClick={() =>
                setTipo(
                  "TODOS"
                )
              }
            >
              Todos
            </FiltroButton>

            <FiltroButton
              activo={
                tipo ===
                "COMPRA"
              }
              onClick={() =>
                setTipo(
                  "COMPRA"
                )
              }
            >
              🛒 Compras
            </FiltroButton>

            <FiltroButton
              activo={
                tipo ===
                "VENTA"
              }
              onClick={() =>
                setTipo(
                  "VENTA"
                )
              }
            >
              🧾 Ventas
            </FiltroButton>

            <FiltroButton
              activo={
                tipo ===
                "AJUSTE"
              }
              onClick={() =>
                setTipo(
                  "AJUSTE"
                )
              }
            >
              📦 Ajustes
            </FiltroButton>

            <button
              className="btn btn-small"
              onClick={
                limpiarFiltros
              }
              style={{
                marginLeft: "auto"
              }}
            >
              Limpiar filtros
            </button>

          </div>

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
            marginBottom: 14
          }}
        >
          {error}
        </div>

      )}

      {/* =====================================================
          MOVIMIENTOS
      ===================================================== */}

      <section className="card">

        <div className="card-header">

          <div>

            <h2>
              Historial
            </h2>

            <p
              className="inv-subtle"
              style={{
                margin:
                  "4px 0 0"
              }}
            >
              {movimientosFiltrados.length} movimientos encontrados.
            </p>

          </div>

        </div>

        <div className="card-body">

          {cargando ? (

            <p className="inv-subtle">
              Cargando movimientos…
            </p>

          ) : movimientosFiltrados.length ===
            0 ? (

            <div
              style={{
                textAlign: "center",
                padding:
                  "48px 20px"
              }}
            >

              <div
                style={{
                  fontSize: 38,
                  marginBottom: 10
                }}
              >
                📜
              </div>

              <strong>
                No encontramos movimientos
              </strong>

              <p className="inv-subtle">
                Prueba cambiando los filtros.
              </p>

            </div>

          ) : (

            <div
              style={{
                display: "grid",
                gap: 12
              }}
            >

              {movimientosFiltrados.map(
                movimiento => (

                  <MovimientoCard
                    key={
                      movimiento.id
                    }
                    movimiento={
                      movimiento
                    }
                    onAbrirDetalle={() =>
                      guardarEstadoPagina(
                        movimiento.id
                      )
                    }
                  />

                )
              )}

            </div>

          )}

        </div>

      </section>

    </div>
  );
}

/* =========================================================
   MOVIMIENTO
========================================================= */

function MovimientoCard({
  movimiento,
  onAbrirDetalle
}) {
  const info =
    infoTipo(
      movimiento.tipo
    );

  const diferencia =
    obtenerDiferencia(
      movimiento
    );

  const tieneStockCompleto =
    movimiento.stockAnterior !==
      undefined &&
    movimiento.stockNuevo !==
      undefined;

  return (
    <div
      id={`movimiento-${movimiento.id}`}
      style={{
        padding: 16,
        borderRadius: 18,
        border:
          `1px solid ${info.color}40`,
        background:
          info.fondo
      }}
    >

      {/* CABECERA */}

      <div
        style={{
          display: "flex",
          justifyContent:
            "space-between",
          alignItems:
            "flex-start",
          gap: 14,
          flexWrap: "wrap"
        }}
      >

        <div
          style={{
            display: "flex",
            gap: 11
          }}
        >

          <div
            style={{
              width: 44,
              height: 44,
              flexShrink: 0,
              borderRadius: 13,
              display: "grid",
              placeItems:
                "center",
              fontSize: 21,
              background:
                `${info.color}15`,
              border:
                `1px solid ${info.color}35`
            }}
          >
            {info.icono}
          </div>

          <div>

            <div
              style={{
                display: "flex",
                alignItems:
                  "center",
                gap: 8,
                flexWrap: "wrap"
              }}
            >

              <strong
                style={{
                  fontSize: 17
                }}
              >
                {
                  movimiento.productoNombre ||
                  "Producto"
                }
              </strong>

              <span
                className="badge"
                style={{
                  color:
                    info.color
                }}
              >
                {info.titulo}
              </span>

            </div>

            <div
              className="inv-subtle"
              style={{
                marginTop: 5,
                fontSize: 12
              }}
            >
              {fechaCompleta(
                movimiento.fecha
              )}
            </div>

          </div>

        </div>

        {/* DIFERENCIA */}

        <div
          style={{
            textAlign: "right"
          }}
        >

          <div
            className="inv-subtle"
            style={{
              fontSize: 11
            }}
          >
            Movimiento
          </div>

          <strong
            style={{
              fontSize: 23,
              color:
                diferencia > 0
                  ? "#22c55e"
                  : diferencia < 0
                    ? "#ef4444"
                    : "var(--text)"
            }}
          >
            {diferencia > 0
              ? "+"
              : ""}

            {cantidad(
              diferencia
            )}
          </strong>

        </div>

      </div>

      {/* =====================================================
          STOCK
      ===================================================== */}

      <div
        style={{
          display: "grid",
          gridTemplateColumns:
            "repeat(auto-fit, minmax(120px, 1fr))",
          gap: 9,
          marginTop: 16
        }}
      >

        <MiniDato
          titulo="Stock anterior"
          valor={
            tieneStockCompleto
              ? cantidad(
                  movimiento.stockAnterior
                )
              : "No registrado"
          }
        />

        <MiniDato
          titulo="Cambio"
          valor={
            `${diferencia > 0 ? "+" : ""}${cantidad(
              diferencia
            )}`
          }
          color={
            diferencia > 0
              ? "#22c55e"
              : diferencia < 0
                ? "#ef4444"
                : undefined
          }
        />

        <MiniDato
          titulo="Stock nuevo"
          valor={
            tieneStockCompleto
              ? cantidad(
                  movimiento.stockNuevo
                )
              : "No registrado"
          }
        />

      </div>

      {/* =====================================================
          COMPRA
      ===================================================== */}

      {movimiento.tipo ===
        "COMPRA" && (

        <div
          className="product-meta"
          style={{
            marginTop: 14
          }}
        >

          <span>
            Factura:{" "}

            <b>
              {movimiento.numeroFactura ||
                "—"}
            </b>
          </span>

          <span>
            Proveedor:{" "}

            <b>
              {movimiento.proveedorNombre ||
                "—"}
            </b>
          </span>

          <span>
            Costo unitario:{" "}

            <b>
              {moneda(
                movimiento.costoUnitario
              )}
            </b>
          </span>

          <span>
            Costo total:{" "}

            <b>
              {moneda(
                movimiento.costoTotal
              )}
            </b>
          </span>

        </div>

      )}

      {/* =====================================================
          VENTA
      ===================================================== */}

      {movimiento.tipo ===
        "VENTA" && (

        <div
          className="product-meta"
          style={{
            marginTop: 14
          }}
        >

          <span>
            Cliente:{" "}

            <b>
              {movimiento.clienteNombre ||
                "Consumidor final"}
            </b>
          </span>

          <span>
            Precio:{" "}

            <b>
              {moneda(
                movimiento.precioVenta
              )}
            </b>
          </span>

          <span>
            Ingreso:{" "}

            <b>
              {moneda(
                movimiento.ingreso
              )}
            </b>
          </span>

          {Number(
            movimiento.descuento ||
            0
          ) > 0 && (

            <span>
              Descuento:{" "}

              <b>
                {moneda(
                  movimiento.descuento
                )}
              </b>
            </span>

          )}

        </div>

      )}

      {/* =====================================================
          AJUSTE
      ===================================================== */}

      {movimiento.tipo ===
        "AJUSTE" && (

        <div
          style={{
            marginTop: 14,
            padding: 13,
            borderRadius: 12,
            border:
              "1px solid rgba(245,158,11,.22)",
            background:
              "rgba(245,158,11,.045)"
          }}
        >

          <div
            style={{
              display: "grid",
              gap: 7
            }}
          >

            <div>

              <span className="inv-subtle">
                Motivo
              </span>

              <div>
                <strong>
                  {nombreMotivo(
                    movimiento.motivo
                  )}
                </strong>
              </div>

            </div>

            {movimiento.observacion && (

              <div>

                <span className="inv-subtle">
                  Observación
                </span>

                <div
                  style={{
                    marginTop: 2
                  }}
                >
                  {
                    movimiento.observacion
                  }
                </div>

              </div>

            )}

          </div>

        </div>

      )}

      {/* =====================================================
          RESPONSABLE / REFERENCIAS
      ===================================================== */}

      <div
        style={{
          display: "flex",
          justifyContent:
            "space-between",
          alignItems:
            "center",
          gap: 12,
          flexWrap: "wrap",
          marginTop: 14,
          paddingTop: 12,
          borderTop:
            "1px solid var(--border)"
        }}
      >

        <div
          className="inv-subtle"
          style={{
            fontSize: 11
          }}
        >
          👤{" "}
          {movimiento.usuarioEmail ||
            "Usuario no registrado"}
        </div>

        <div
          style={{
            display: "flex",
            gap: 8,
            flexWrap: "wrap"
          }}
        >

          {movimiento.tipo ===
            "VENTA" &&
            movimiento.ventaId && (

            <Link
              to={`/factura/${movimiento.ventaId}`}
              className="btn btn-small"
              onClick={
                onAbrirDetalle
              }
            >
              🧾 Ver factura
            </Link>

          )}

          {movimiento.tipo ===
  "COMPRA" &&
  movimiento.compraId && (

  <Link
    to={`/factura-compra/${movimiento.compraId}`}
    className="btn btn-small"
    onClick={
      onAbrirDetalle
    }
  >
    🛒 Ver factura
  </Link>

)}

        </div>

      </div>

    </div>
  );
}

/* =========================================================
   RESUMEN
========================================================= */

function ResumenCard({
  titulo,
  valor,
  detalle,
  icono,
  color
}) {
  return (
    <div
      className="card"
      style={{
        padding: 16
      }}
    >

      <div
        style={{
          display: "flex",
          justifyContent:
            "space-between",
          gap: 10
        }}
      >

        <span className="inv-subtle">
          {titulo}
        </span>

        <span
          style={{
            fontSize: 21
          }}
        >
          {icono}
        </span>

      </div>

      <div
        style={{
          marginTop: 5,
          fontSize: 24,
          fontWeight: 900,
          color:
            color ||
            "var(--text)"
        }}
      >
        {valor}
      </div>

      <div
        className="inv-subtle"
        style={{
          marginTop: 4,
          fontSize: 11
        }}
      >
        {detalle}
      </div>

    </div>
  );
}

/* =========================================================
   FILTRO
========================================================= */

function FiltroButton({
  activo,
  onClick,
  children
}) {
  return (
    <button
      type="button"
      className={
        activo
          ? "btn btn-primary btn-small"
          : "btn btn-small"
      }
      onClick={
        onClick
      }
    >
      {children}
    </button>
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
    <div
      style={{
        padding:
          "10px 12px",
        borderRadius: 12,
        border:
          "1px solid var(--border)",
        background:
          "rgba(255,255,255,.02)"
      }}
    >

      <div
        className="inv-subtle"
        style={{
          fontSize: 10
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