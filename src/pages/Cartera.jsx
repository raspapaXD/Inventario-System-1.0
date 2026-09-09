// src/pages/Cartera.jsx

import {
  useCallback,
  useEffect,
  useMemo,
  useState
} from "react";

import {
  collection,
  doc,
  getDocs,
  runTransaction,
  serverTimestamp
} from "firebase/firestore";

import { Link } from "react-router-dom";

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

const limpiarNumero = value =>
  String(value ?? "")
    .replace(/[^0-9]/g, "");

const numeroDesdeInput = value => {
  const limpio =
    limpiarNumero(value);

  return limpio
    ? Number(limpio)
    : 0;
};

const formatearInput = value => {
  const limpio =
    limpiarNumero(value);

  if (!limpio) {
    return "";
  }

  return Number(limpio)
    .toLocaleString("es-CO");
};

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

  if (
    typeof fecha === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(fecha)
  ) {
    return new Date(
      `${fecha}T12:00:00`
    );
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

function formatearFecha(fecha) {
  const date =
    convertirFecha(fecha);

  if (!date) {
    return "—";
  }

  return date.toLocaleDateString(
    "es-CO"
  );
}

function estaVencida(cuenta) {
  if (
    Number(
      cuenta?.saldoPendiente || 0
    ) <= 0
  ) {
    return false;
  }

  const vencimiento =
    convertirFecha(
      cuenta?.fechaVencimiento
    );

  if (!vencimiento) {
    return false;
  }

  const hoy =
    new Date();

  hoy.setHours(
    0,
    0,
    0,
    0
  );

  vencimiento.setHours(
    0,
    0,
    0,
    0
  );

  return vencimiento < hoy;
}

function estadoVisual(cuenta) {
  if (
    Number(
      cuenta?.saldoPendiente || 0
    ) <= 0
  ) {
    return "PAGADA";
  }

  if (
    estaVencida(cuenta)
  ) {
    return "VENCIDA";
  }

  return (
    cuenta?.estado ||
    "PENDIENTE"
  );
}

function colorEstado(estado) {
  if (estado === "PAGADA") {
    return "#22c55e";
  }

  if (estado === "VENCIDA") {
    return "#ef4444";
  }

  if (estado === "PARCIAL") {
    return "#3b82f6";
  }

  return "#f59e0b";
}

function iconoEstado(estado) {
  if (estado === "PAGADA") {
    return "✅";
  }

  if (estado === "VENCIDA") {
    return "🔴";
  }

  if (estado === "PARCIAL") {
    return "🔵";
  }

  return "🕒";
}

/* =========================================================
   COMPONENTE
========================================================= */

export default function Cartera() {
  const {
    empresa
  } = useTenant();

  const {
    theme,
    toggle
  } = useTheme();

  const [
    pestaña,
    setPestaña
  ] = useState("COBRAR");

  const [
    cuentasCobrar,
    setCuentasCobrar
  ] = useState([]);

  const [
    cuentasPagar,
    setCuentasPagar
  ] = useState([]);

  const [
    movimientos,
    setMovimientos
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
    exito,
    setExito
  ] = useState("");

  const [
    busqueda,
    setBusqueda
  ] = useState("");

  const [
    filtro,
    setFiltro
  ] = useState("ABIERTAS");

  const [
    modalAbono,
    setModalAbono
  ] = useState(null);

  const [
    montoAbono,
    setMontoAbono
  ] = useState("");

  const [
    guardandoAbono,
    setGuardandoAbono
  ] = useState(false);

  const [
    modalHistorial,
    setModalHistorial
  ] = useState(null);

  /* =======================================================
     CARGAR CARTERA
  ======================================================= */

  const cargarDatos =
    useCallback(
      async () => {
        if (!empresa?.id) {
          return;
        }

        try {
          setCargando(true);
          setError("");

          const [
            cobrarSnap,
            pagarSnap,
            movimientosSnap
          ] =
            await Promise.all([
              getDocs(
                collection(
                  db,
                  "empresas",
                  empresa.id,
                  "cuentasPorCobrar"
                )
              ),

              getDocs(
                collection(
                  db,
                  "empresas",
                  empresa.id,
                  "cuentasPorPagar"
                )
              ),

              getDocs(
                collection(
                  db,
                  "empresas",
                  empresa.id,
                  "movimientosCartera"
                )
              )
            ]);

          setCuentasCobrar(
            cobrarSnap.docs.map(
              d => ({
                id: d.id,
                ...d.data(),
                tipoCartera:
                  "COBRAR"
              })
            )
          );

          setCuentasPagar(
            pagarSnap.docs.map(
              d => ({
                id: d.id,
                ...d.data(),
                tipoCartera:
                  "PAGAR"
              })
            )
          );

          setMovimientos(
            movimientosSnap.docs.map(
              d => ({
                id: d.id,
                ...d.data()
              })
            )
          );

        } catch (e) {
          console.error(e);

          setError(
            "No fue posible cargar la cartera."
          );

        } finally {
          setCargando(false);
        }
      },
      [empresa?.id]
    );

  useEffect(() => {
    cargarDatos();
  }, [cargarDatos]);

  /* =======================================================
     RESÚMENES
  ======================================================= */

  const totalCobrar =
    useMemo(
      () =>
        cuentasCobrar.reduce(
          (acc, cuenta) =>
            acc +
            Number(
              cuenta.saldoPendiente ||
              0
            ),
          0
        ),
      [cuentasCobrar]
    );

  const totalPagar =
    useMemo(
      () =>
        cuentasPagar.reduce(
          (acc, cuenta) =>
            acc +
            Number(
              cuenta.saldoPendiente ||
              0
            ),
          0
        ),
      [cuentasPagar]
    );

  const vencidoCobrar =
    useMemo(
      () =>
        cuentasCobrar
          .filter(
            estaVencida
          )
          .reduce(
            (acc, cuenta) =>
              acc +
              Number(
                cuenta.saldoPendiente ||
                0
              ),
            0
          ),
      [cuentasCobrar]
    );

  const vencidoPagar =
    useMemo(
      () =>
        cuentasPagar
          .filter(
            estaVencida
          )
          .reduce(
            (acc, cuenta) =>
              acc +
              Number(
                cuenta.saldoPendiente ||
                0
              ),
            0
          ),
      [cuentasPagar]
    );

  const posicionNeta =
    totalCobrar -
    totalPagar;

  /* =======================================================
     CUENTAS VISIBLES
  ======================================================= */

  const cuentasVisibles =
    useMemo(() => {
      const origen =
        pestaña === "COBRAR"
          ? cuentasCobrar
          : cuentasPagar;

      const q =
        busqueda
          .trim()
          .toLowerCase();

      return [...origen]
        .filter(cuenta => {
          const estado =
            estadoVisual(
              cuenta
            );

          if (
            filtro === "ABIERTAS"
          ) {
            if (
              estado === "PAGADA"
            ) {
              return false;
            }
          } else if (
            filtro !== "TODAS" &&
            estado !== filtro
          ) {
            return false;
          }

          if (!q) {
            return true;
          }

          const texto =
            pestaña === "COBRAR"
              ? `
                ${cuenta.clienteNombre || ""}
                ${cuenta.clienteDocumento || ""}
                ${cuenta.ventaId || ""}
              `
              : `
                ${cuenta.proveedorNombre || ""}
                ${cuenta.numeroFactura || ""}
                ${cuenta.proveedorId || ""}
                ${cuenta.compraId || ""}
              `;

          return texto
            .toLowerCase()
            .includes(q);
        })
        .sort((a, b) => {
          /*
           * Vencidas primero.
           */

          const aV =
            estaVencida(a);

          const bV =
            estaVencida(b);

          if (
            aV !== bV
          ) {
            return aV
              ? -1
              : 1;
          }

          const fechaA =
            convertirFecha(
              a.fechaVencimiento
            )?.getTime() || Infinity;

          const fechaB =
            convertirFecha(
              b.fechaVencimiento
            )?.getTime() || Infinity;

          return (
            fechaA -
            fechaB
          );
        });

    }, [
      pestaña,
      cuentasCobrar,
      cuentasPagar,
      busqueda,
      filtro
    ]);

  /* =======================================================
     ABRIR ABONO
  ======================================================= */

  const abrirAbono =
    cuenta => {
      setModalAbono(
        cuenta
      );

      setMontoAbono("");

      setError("");
      setExito("");
    };

  /* =======================================================
     REGISTRAR ABONO
  ======================================================= */

  const registrarAbono =
    async () => {
      if (
        !modalAbono ||
        !empresa?.id
      ) {
        return;
      }

      if (guardandoAbono) {
        return;
      }

      const monto =
        numeroDesdeInput(
          montoAbono
        );

      if (monto <= 0) {
        return setError(
          "Ingresa un valor de abono mayor que cero."
        );
      }

      const saldoPantalla =
        Number(
          modalAbono
            .saldoPendiente || 0
        );

      if (
        monto >
        saldoPantalla
      ) {
        return setError(
          `El abono no puede superar el saldo pendiente de ${moneda(
            saldoPantalla
          )}.`
        );
      }

      try {
        setGuardandoAbono(
          true
        );

        setError("");
        setExito("");

        const esCobro =
          modalAbono
            .tipoCartera ===
          "COBRAR";

        const nombreColeccion =
          esCobro
            ? "cuentasPorCobrar"
            : "cuentasPorPagar";

        const cuentaRef =
          doc(
            db,
            "empresas",
            empresa.id,
            nombreColeccion,
            modalAbono.id
          );

        await runTransaction(
          db,
          async transaction => {

            /*
             * Leemos el saldo real en Firebase,
             * no confiamos únicamente en pantalla.
             */

            const cuentaSnap =
              await transaction.get(
                cuentaRef
              );

            if (
              !cuentaSnap.exists()
            ) {
              throw new Error(
                "La cuenta ya no existe."
              );
            }

            const cuentaActual =
              cuentaSnap.data();

            const saldoAnterior =
              Number(
                cuentaActual
                  .saldoPendiente || 0
              );

            if (
              saldoAnterior <= 0
            ) {
              throw new Error(
                "Esta cuenta ya está pagada."
              );
            }

            if (
              monto >
              saldoAnterior
            ) {
              throw new Error(
                `El saldo actual es ${moneda(
                  saldoAnterior
                )}.`
              );
            }

            const saldoNuevo =
              Math.max(
                0,
                saldoAnterior -
                monto
              );

            const estadoNuevo =
              saldoNuevo === 0
                ? "PAGADA"
                : "PARCIAL";

            /*
             * Actualizamos la deuda.
             */

            transaction.update(
              cuentaRef,
              {
                saldoPendiente:
                  saldoNuevo,

                estado:
                  estadoNuevo,

                updatedAt:
                  serverTimestamp()
              }
            );

            /*
             * Creamos un movimiento inmutable.
             */

            const movimientoRef =
              doc(
                collection(
                  db,
                  "empresas",
                  empresa.id,
                  "movimientosCartera"
                )
              );

            transaction.set(
              movimientoRef,
              {
                tipo:
                  esCobro
                    ? "ABONO_COBRO"
                    : "ABONO_PAGO",

                cuentaId:
                  modalAbono.id,

                monto,

                saldoAnterior,

                saldoNuevo,

                entidadId:
                  esCobro
                    ? modalAbono.clienteId
                    : modalAbono.proveedorId,

                entidadNombre:
                  esCobro
                    ? modalAbono.clienteNombre
                    : modalAbono.proveedorNombre,

                referencia:
                  esCobro
                    ? modalAbono.ventaId
                    : modalAbono.numeroFactura,

                fecha:
                  serverTimestamp()
              }
            );
          }
        );

        const texto =
          modalAbono.tipoCartera ===
          "COBRAR"
            ? `Abono recibido por ${moneda(monto)}.`
            : `Pago registrado por ${moneda(monto)}.`;

        setModalAbono(null);
        setMontoAbono("");

        setExito(
          texto
        );

        await cargarDatos();

      } catch (e) {
        console.error(e);

        setError(
          e?.message ||
          "No fue posible registrar el abono."
        );

      } finally {
        setGuardandoAbono(
          false
        );
      }
    };

  /* =======================================================
     HISTORIAL DE CUENTA
  ======================================================= */

  const movimientosCuenta =
    useMemo(() => {
      if (
        !modalHistorial
      ) {
        return [];
      }

      return movimientos
        .filter(
          mov =>
            mov.cuentaId ===
            modalHistorial.id
        )
        .sort(
          (a, b) => {
            const fechaA =
              convertirFecha(
                a.fecha
              )?.getTime() || 0;

            const fechaB =
              convertirFecha(
                b.fecha
              )?.getTime() || 0;

            return (
              fechaB -
              fechaA
            );
          }
        );

    }, [
      movimientos,
      modalHistorial
    ]);

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
            💰 Cartera
          </h1>

          <p className="inv-subtle">
            Controla lo que deben al local y lo que el local debe a proveedores.
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
          RESUMEN GENERAL
      ===================================================== */}

      <div
        style={{
          display: "grid",
          gridTemplateColumns:
            "repeat(auto-fit, minmax(190px, 1fr))",
          gap: 14,
          marginBottom: 18
        }}
      >

        <ResumenCard
          titulo="Por cobrar"
          valor={
            moneda(totalCobrar)
          }
          detalle={
            vencidoCobrar > 0
              ? `${moneda(vencidoCobrar)} vencido`
              : "Sin cartera vencida"
          }
          icono="📥"
          color={
            "#22c55e"
          }
        />

        <ResumenCard
          titulo="Por pagar"
          valor={
            moneda(totalPagar)
          }
          detalle={
            vencidoPagar > 0
              ? `${moneda(vencidoPagar)} vencido`
              : "Sin cartera vencida"
          }
          icono="📤"
          color={
            "#f59e0b"
          }
        />

        <ResumenCard
          titulo="Cartera vencida"
          valor={
            moneda(
              vencidoCobrar +
              vencidoPagar
            )
          }
          detalle={
            `Cobrar ${moneda(
              vencidoCobrar
            )} · Pagar ${moneda(
              vencidoPagar
            )}`
          }
          icono="⚠️"
          color={
            "#ef4444"
          }
        />

        <ResumenCard
          titulo="Posición neta"
          valor={
            moneda(
              posicionNeta
            )
          }
          detalle={
            posicionNeta >= 0
              ? "A favor del local"
              : "Mayor deuda que cartera"
          }
          icono={
            posicionNeta >= 0
              ? "📈"
              : "📉"
          }
          color={
            posicionNeta >= 0
              ? "#22c55e"
              : "#ef4444"
          }
        />

      </div>

      {/* =====================================================
          CARD CARTERA
      ===================================================== */}

      <div className="card">

        {/* PESTAÑAS */}

        <div
          className="card-header"
          style={{
            gap: 12,
            flexWrap: "wrap"
          }}
        >

          <div
            style={{
              display: "flex",
              gap: 8,
              flexWrap: "wrap"
            }}
          >

            <button
              type="button"
              className={
                pestaña ===
                "COBRAR"
                  ? "btn btn-primary"
                  : "btn"
              }
              onClick={() =>
                setPestaña(
                  "COBRAR"
                )
              }
            >
              📥 Por cobrar
              {" "}
              ({cuentasCobrar.filter(
                c =>
                  Number(
                    c.saldoPendiente ||
                    0
                  ) > 0
              ).length})
            </button>

            <button
              type="button"
              className={
                pestaña ===
                "PAGAR"
                  ? "btn btn-primary"
                  : "btn"
              }
              onClick={() =>
                setPestaña(
                  "PAGAR"
                )
              }
            >
              📤 Por pagar
              {" "}
              ({cuentasPagar.filter(
                c =>
                  Number(
                    c.saldoPendiente ||
                    0
                  ) > 0
              ).length})
            </button>

          </div>

        </div>

        <div className="card-body">

          {/* BUSCAR / FILTRAR */}

          <div
            style={{
              display: "grid",
              gridTemplateColumns:
                "minmax(220px, 1fr) minmax(180px, 260px)",
              gap: 12,
              marginBottom: 18
            }}
          >

            <div className="form-field">

              <label>
                Buscar
              </label>

              <input
                placeholder={
                  pestaña ===
                  "COBRAR"
                    ? "🔎 Cliente, documento..."
                    : "🔎 Proveedor, factura..."
                }
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
                Estado
              </label>

              <select
                value={
                  filtro
                }
                onChange={e =>
                  setFiltro(
                    e.target.value
                  )
                }
              >
                <option value="ABIERTAS">
                  Abiertas
                </option>

                <option value="PENDIENTE">
                  Pendientes
                </option>

                <option value="PARCIAL">
                  Pago parcial
                </option>

                <option value="VENCIDA">
                  Vencidas
                </option>

                <option value="PAGADA">
                  Pagadas
                </option>

                <option value="TODAS">
                  Todas
                </option>
              </select>

            </div>

          </div>

          {/* MENSAJES */}

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

          {exito && (

            <div
              style={{
                marginBottom: 14,
                padding: 12,
                border:
                  "1px solid rgba(34,197,94,.35)",
                borderRadius: 12,
                background:
                  "rgba(34,197,94,.08)"
              }}
            >
              ✅ {exito}
            </div>

          )}

          {/* CARGANDO */}

          {cargando ? (

            <p className="inv-subtle">
              Cargando cartera…
            </p>

          ) : cuentasVisibles.length === 0 ? (

            <div
              style={{
                textAlign: "center",
                padding: "38px 20px"
              }}
            >

              <div
                style={{
                  fontSize: 34,
                  marginBottom: 10
                }}
              >
                {pestaña ===
                "COBRAR"
                  ? "📥"
                  : "📤"}
              </div>

              <strong>
                No hay cuentas para mostrar.
              </strong>

              <p className="inv-subtle">
                Cambia el filtro o registra una operación a crédito.
              </p>

            </div>

          ) : (

            <div
              style={{
                display: "grid",
                gap: 12
              }}
            >

              {cuentasVisibles.map(
                cuenta => (

                  <CuentaCard
                    key={
                      cuenta.id
                    }
                    cuenta={
                      cuenta
                    }
                    tipo={
                      pestaña
                    }
                    onAbono={() =>
                      abrirAbono(
                        cuenta
                      )
                    }
                    onHistorial={() =>
                      setModalHistorial(
                        cuenta
                      )
                    }
                  />

                )
              )}

            </div>

          )}

        </div>

      </div>

      {/* =====================================================
          MODAL ABONO
      ===================================================== */}

      {modalAbono && (

        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
        >

          <div
            className="modal-card"
            style={{
              width: "92vw",
              maxWidth: 520,
              borderRadius: 22
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
                marginBottom: 18
              }}
            >

              <div>

                <h3
                  style={{
                    margin: 0
                  }}
                >
                  {modalAbono.tipoCartera ===
                  "COBRAR"
                    ? "📥 Registrar abono"
                    : "📤 Registrar pago"}
                </h3>

                <p
                  className="inv-subtle"
                  style={{
                    margin:
                      "5px 0 0"
                  }}
                >
                  {modalAbono.tipoCartera ===
                  "COBRAR"
                    ? modalAbono.clienteNombre
                    : modalAbono.proveedorNombre}
                </p>

              </div>

              <button
                className="btn"
                onClick={() => {
                  setModalAbono(
                    null
                  );

                  setMontoAbono(
                    ""
                  );

                  setError(
                    ""
                  );
                }}
              >
                ✕
              </button>

            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns:
                  "1fr 1fr",
                gap: 12,
                marginBottom: 18
              }}
            >

              <div
                style={{
                  padding: 14,
                  border:
                    "1px solid var(--border)",
                  borderRadius: 14
                }}
              >

                <div className="inv-subtle">
                  Total original
                </div>

                <strong>
                  {moneda(
                    modalAbono.total
                  )}
                </strong>

              </div>

              <div
                style={{
                  padding: 14,
                  border:
                    "1px solid rgba(245,158,11,.30)",
                  borderRadius: 14,
                  background:
                    "rgba(245,158,11,.06)"
                }}
              >

                <div className="inv-subtle">
                  Saldo pendiente
                </div>

                <strong
                  style={{
                    color:
                      "#f59e0b",
                    fontSize: 18
                  }}
                >
                  {moneda(
                    modalAbono.saldoPendiente
                  )}
                </strong>

              </div>

            </div>

            <div className="form-field">

              <label>
                {modalAbono.tipoCartera ===
                "COBRAR"
                  ? "Valor recibido *"
                  : "Valor pagado *"}
              </label>

              <input
                autoFocus
                type="text"
                inputMode="numeric"
                placeholder="0"
                value={
                  montoAbono
                }
                onChange={e =>
                  setMontoAbono(
                    formatearInput(
                      e.target.value
                    )
                  )
                }
                style={{
                  fontSize: 22,
                  fontWeight: 800
                }}
              />

            </div>

            {numeroDesdeInput(
              montoAbono
            ) > 0 && (

              <div
                style={{
                  marginTop: 12,
                  padding: 14,
                  borderRadius: 14,
                  background:
                    "rgba(255,255,255,.035)",
                  border:
                    "1px solid var(--border)"
                }}
              >

                <div
                  className="inv-subtle"
                  style={{
                    marginBottom: 4
                  }}
                >
                  Nuevo saldo
                </div>

                <strong
                  style={{
                    fontSize: 20
                  }}
                >
                  {moneda(
                    Math.max(
                      0,
                      Number(
                        modalAbono.saldoPendiente ||
                        0
                      ) -
                      numeroDesdeInput(
                        montoAbono
                      )
                    )
                  )}
                </strong>

              </div>

            )}

            <div
              style={{
                marginTop: 20,
                display: "flex",
                justifyContent:
                  "flex-end",
                gap: 8,
                flexWrap: "wrap"
              }}
            >

              <button
                className="btn"
                onClick={() =>
                  setModalAbono(
                    null
                  )
                }
              >
                Cancelar
              </button>

              <button
                className="btn btn-primary"
                onClick={
                  registrarAbono
                }
                disabled={
                  guardandoAbono
                }
              >
                {guardandoAbono
                  ? "Guardando..."
                  : modalAbono.tipoCartera ===
                    "COBRAR"
                    ? "✓ Registrar abono"
                    : "✓ Registrar pago"}
              </button>

            </div>

          </div>

        </div>

      )}

      {/* =====================================================
          MODAL HISTORIAL
      ===================================================== */}

      {modalHistorial && (

        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
        >

          <div
            className="modal-card"
            style={{
              width: "92vw",
              maxWidth: 680,
              maxHeight: "82vh",
              overflowY: "auto",
              borderRadius: 22
            }}
          >

            <div
              style={{
                display: "flex",
                justifyContent:
                  "space-between",
                gap: 12,
                alignItems:
                  "center",
                marginBottom: 18
              }}
            >

              <div>

                <h3
                  style={{
                    margin: 0
                  }}
                >
                  📜 Historial de abonos
                </h3>

                <p
                  className="inv-subtle"
                  style={{
                    margin:
                      "5px 0 0"
                  }}
                >
                  {modalHistorial.tipoCartera ===
                  "COBRAR"
                    ? modalHistorial.clienteNombre
                    : modalHistorial.proveedorNombre}
                </p>

              </div>

              <button
                className="btn"
                onClick={() =>
                  setModalHistorial(
                    null
                  )
                }
              >
                ✕
              </button>

            </div>

            <div
              style={{
                padding: 14,
                border:
                  "1px solid var(--border)",
                borderRadius: 14,
                marginBottom: 16
              }}
            >

              <div
                style={{
                  display: "flex",
                  justifyContent:
                    "space-between",
                  gap: 12,
                  flexWrap: "wrap"
                }}
              >

                <span className="inv-subtle">
                  Total original
                </span>

                <strong>
                  {moneda(
                    modalHistorial.total
                  )}
                </strong>

              </div>

              <div
                style={{
                  display: "flex",
                  justifyContent:
                    "space-between",
                  gap: 12,
                  marginTop: 6,
                  flexWrap: "wrap"
                }}
              >

                <span className="inv-subtle">
                  Saldo actual
                </span>

                <strong>
                  {moneda(
                    modalHistorial.saldoPendiente
                  )}
                </strong>

              </div>

            </div>

            {movimientosCuenta.length ===
            0 ? (

              <p className="inv-subtle">
                Esta cuenta todavía no tiene abonos registrados.
              </p>

            ) : (

              <div
                style={{
                  display: "grid",
                  gap: 10
                }}
              >

                {movimientosCuenta.map(
                  mov => (

                    <div
                      key={
                        mov.id
                      }
                      style={{
                        padding: 14,
                        border:
                          "1px solid var(--border)",
                        borderRadius: 14
                      }}
                    >

                      <div
                        style={{
                          display: "flex",
                          justifyContent:
                            "space-between",
                          gap: 12,
                          flexWrap: "wrap"
                        }}
                      >

                        <strong>
                          {mov.tipo ===
                          "ABONO_COBRO"
                            ? "📥 Abono recibido"
                            : "📤 Pago realizado"}
                        </strong>

                        <strong
                          style={{
                            color:
                              "#22c55e"
                          }}
                        >
                          {moneda(
                            mov.monto
                          )}
                        </strong>

                      </div>

                      <div
                        className="product-meta"
                        style={{
                          marginTop: 8
                        }}
                      >

                        <span>
                          Fecha:{" "}
                          <b>
                            {formatearFecha(
                              mov.fecha
                            )}
                          </b>
                        </span>

                        <span>
                          Antes:{" "}
                          <b>
                            {moneda(
                              mov.saldoAnterior
                            )}
                          </b>
                        </span>

                        <span>
                          Después:{" "}
                          <b>
                            {moneda(
                              mov.saldoNuevo
                            )}
                          </b>
                        </span>

                      </div>

                    </div>

                  )
                )}

              </div>

            )}

          </div>

        </div>

      )}

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
          gap: 10,
          alignItems:
            "center"
        }}
      >

        <span className="inv-subtle">
          {titulo}
        </span>

        <span
          style={{
            fontSize: 22
          }}
        >
          {icono}
        </span>

      </div>

      <div
        style={{
          fontSize: 25,
          fontWeight: 900,
          marginTop: 6,
          color
        }}
      >
        {valor}
      </div>

      <div
        className="inv-subtle"
        style={{
          marginTop: 5,
          fontSize: 12
        }}
      >
        {detalle}
      </div>

    </div>
  );
}

/* =========================================================
   CUENTA
========================================================= */

function CuentaCard({
  cuenta,
  tipo,
  onAbono,
  onHistorial
}) {
  const estado =
    estadoVisual(
      cuenta
    );

  const saldo =
    Number(
      cuenta.saldoPendiente ||
      0
    );

  const total =
    Number(
      cuenta.total ||
      0
    );

  const pagado =
    Math.max(
      0,
      total -
      saldo
    );

  const porcentaje =
    total > 0
      ? Math.min(
          100,
          (
            pagado /
            total
          ) * 100
        )
      : 0;

  const esCobrar =
    tipo === "COBRAR";

  return (
    <div
      style={{
        padding: 16,
        border:
          estado === "VENCIDA"
            ? "1px solid rgba(239,68,68,.38)"
            : "1px solid var(--border)",

        background:
          estado === "VENCIDA"
            ? "rgba(239,68,68,.035)"
            : "rgba(255,255,255,.015)",

        borderRadius: 18
      }}
    >

      {/* CABECERA */}

      <div
        style={{
          display: "flex",
          justifyContent:
            "space-between",
          gap: 14,
          alignItems:
            "flex-start",
          flexWrap: "wrap"
        }}
      >

        <div
          style={{
            minWidth: 0,
            flex: 1
          }}
        >

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
              {esCobrar
                ? cuenta.clienteNombre ||
                  "Cliente"
                : cuenta.proveedorNombre ||
                  "Proveedor"}
            </strong>

            <span
              className="badge"
              style={{
                color:
                  colorEstado(
                    estado
                  )
              }}
            >
              {iconoEstado(
                estado
              )}{" "}
              {estado}
            </span>

          </div>

          <div
            className="product-meta"
            style={{
              marginTop: 8
            }}
          >

            {esCobrar ? (

              <>
                {cuenta.clienteDocumento && (
                  <span>
                    Documento:{" "}
                    <b>
                      {cuenta.clienteDocumento}
                    </b>
                  </span>
                )}

                <span>
                  Venta:{" "}
                  <b>
                    {String(
                      cuenta.ventaId ||
                      ""
                    )
                      .slice(0, 8)
                      .toUpperCase()}
                  </b>
                </span>
              </>

            ) : (

              <>
                <span>
                  Factura:{" "}
                  <b>
                    {cuenta.numeroFactura ||
                      "—"}
                  </b>
                </span>
              </>

            )}

            <span>
              Vence:{" "}
              <b
                style={{
                  color:
                    estado ===
                    "VENCIDA"
                      ? "#ef4444"
                      : undefined
                }}
              >
                {formatearFecha(
                  cuenta.fechaVencimiento
                )}
              </b>
            </span>

          </div>

        </div>

        <div
          style={{
            textAlign: "right"
          }}
        >

          <div
            className="inv-subtle"
            style={{
              fontSize: 12
            }}
          >
            Saldo pendiente
          </div>

          <strong
            style={{
              fontSize: 22,
              color:
                saldo > 0
                  ? colorEstado(
                      estado
                    )
                  : "#22c55e"
            }}
          >
            {moneda(
              saldo
            )}
          </strong>

        </div>

      </div>

      {/* DATOS */}

      <div
        style={{
          display: "grid",
          gridTemplateColumns:
            "repeat(auto-fit, minmax(130px, 1fr))",
          gap: 10,
          marginTop: 16
        }}
      >

        <MiniDato
          titulo="Total"
          valor={
            moneda(total)
          }
        />

        <MiniDato
          titulo={
            esCobrar
              ? "Recibido"
              : "Pagado"
          }
          valor={
            moneda(pagado)
          }
        />

        <MiniDato
          titulo="Pendiente"
          valor={
            moneda(saldo)
          }
        />

        <MiniDato
          titulo="Vencimiento"
          valor={
            formatearFecha(
              cuenta.fechaVencimiento
            )
          }
        />

      </div>

      {/* PROGRESO */}

      <div
        style={{
          marginTop: 14
        }}
      >

        <div
          style={{
            height: 7,
            borderRadius: 999,
            background:
              "rgba(255,255,255,.08)",
            overflow: "hidden"
          }}
        >

          <div
            style={{
              height: "100%",
              width:
                `${porcentaje}%`,
              background:
                porcentaje >= 100
                  ? "#22c55e"
                  : "#3b82f6",
              borderRadius: 999
            }}
          />

        </div>

        <div
          className="inv-subtle"
          style={{
            marginTop: 5,
            fontSize: 11
          }}
        >
          {porcentaje.toFixed(
            0
          )}
          % pagado
        </div>

      </div>

      {/* ACCIONES */}

      <div
        style={{
          display: "flex",
          justifyContent:
            "flex-end",
          gap: 8,
          flexWrap: "wrap",
          marginTop: 14
        }}
      >

        {esCobrar &&
          cuenta.ventaId && (

          <Link
            to={`/factura/${cuenta.ventaId}`}
            className="btn btn-small"
          >
            🧾 Factura
          </Link>

        )}

        <button
          type="button"
          className="btn btn-small"
          onClick={
            onHistorial
          }
        >
          📜 Historial
        </button>

        {saldo > 0 && (

          <button
            type="button"
            className="btn btn-primary btn-small"
            onClick={
              onAbono
            }
          >
            {esCobrar
              ? "💵 Registrar abono"
              : "💸 Registrar pago"}
          </button>

        )}

      </div>

    </div>
  );
}

function MiniDato({
  titulo,
  valor
}) {
  return (
    <div
      style={{
        padding:
          "10px 12px",
        borderRadius: 12,
        background:
          "rgba(255,255,255,.025)",
        border:
          "1px solid var(--border)"
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
          marginTop: 3
        }}
      >
        {valor}
      </strong>

    </div>
  );
}