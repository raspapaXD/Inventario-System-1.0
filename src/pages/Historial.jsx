// src/pages/Historial.jsx

import {
  useEffect,
  useMemo,
  useState
} from "react";

import {
  Link
} from "react-router-dom";

import {
  db
} from "../../firebaseClient.js";

import {
  useTenant
} from "../tenant/TenantProvider";

import {
  collection,
  getDocs,
  query,
  orderBy,
  limit,
  startAfter
} from "firebase/firestore";

import AppMenu from "../components/AppMenu.jsx";

import "./inventario.css";

/* =========================================================
   HELPERS
========================================================= */

const formatearNumeroFactura =
  (
    numeroFactura,
    idLegacy = ""
  ) => {
    const numero =
      Number(
        numeroFactura
      );

    if (
      Number.isInteger(
        numero
      ) &&
      numero > 0
    ) {
      return String(
        numero
      ).padStart(
        6,
        "0"
      );
    }

    /*
     * Las ventas antiguas todavía pueden no tener
     * numeroFactura. Conservamos su folio anterior
     * para no perder compatibilidad histórica.
     */
    return String(
      idLegacy || ""
    )
      .slice(
        0,
        8
      )
      .toUpperCase();
  };

/* =========================================================
   COMPONENTE
========================================================= */

export default function Historial() {
  const {
    empresa
  } = useTenant();

  const ventasCol =
    useMemo(() => {
      if (
        !empresa?.id
      ) {
        return null;
      }

      return collection(
        db,
        "empresas",
        empresa.id,
        "ventas"
      );
    }, [
      empresa?.id
    ]);

  const [
    ventas,
    setVentas
  ] = useState([]);

  const [
    cargando,
    setCargando
  ] = useState(false);

  const [
    error,
    setError
  ] = useState(null);

  const [
    ultimoDoc,
    setUltimoDoc
  ] = useState(null);

  const [
    hayMas,
    setHayMas
  ] = useState(true);

  const [
    qStr,
    setQStr
  ] = useState("");

  const pageSize =
    20;

  const fmtFecha =
    f => {
      if (!f) {
        return "—";
      }

      if (
        typeof f?.toDate ===
        "function"
      ) {
        return f
          .toDate()
          .toLocaleString(
            "es-CO"
          );
      }

      if (
        typeof f ===
        "number"
      ) {
        return new Date(
          f
        ).toLocaleString(
          "es-CO"
        );
      }

      if (
        typeof f ===
        "string"
      ) {
        return new Date(
          f
        ).toLocaleString(
          "es-CO"
        );
      }

      return "—";
    };

  const cargarPrimeraPagina =
    async () => {
      if (
        !ventasCol
      ) {
        return;
      }

      try {
        setCargando(
          true
        );

        setError(
          null
        );

        const qy =
          query(
            ventasCol,
            orderBy(
              "fecha",
              "desc"
            ),
            limit(
              pageSize
            )
          );

        const snap =
          await getDocs(
            qy
          );

        const lista =
          snap.docs.map(
            d => ({
              id:
                d.id,
              ...d.data(),
              _doc:
                d
            })
          );

        setVentas(
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
          pageSize
        );

      } catch (e) {
        console.error(
          e
        );

        setError(
          "No se pudieron cargar las ventas."
        );

      } finally {
        setCargando(
          false
        );
      }
    };

  const cargarMas =
    async () => {
      if (
        !ventasCol ||
        !ultimoDoc
      ) {
        return;
      }

      try {
        setCargando(
          true
        );

        setError(
          null
        );

        const qy =
          query(
            ventasCol,
            orderBy(
              "fecha",
              "desc"
            ),
            startAfter(
              ultimoDoc
            ),
            limit(
              pageSize
            )
          );

        const snap =
          await getDocs(
            qy
          );

        const lista =
          snap.docs.map(
            d => ({
              id:
                d.id,
              ...d.data(),
              _doc:
                d
            })
          );

        setVentas(
          v => [
            ...v,
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
          pageSize
        );

      } catch (e) {
        console.error(
          e
        );

        setError(
          "No se pudieron cargar más ventas."
        );

      } finally {
        setCargando(
          false
        );
      }
    };

  useEffect(() => {
    cargarPrimeraPagina();

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    ventasCol
  ]);

  /* =======================================================
     FILTRO
  ======================================================= */

  const filtradas =
    useMemo(() => {
      const t =
        qStr
          .trim()
          .toLowerCase();

      if (!t) {
        return ventas;
      }

      return ventas.filter(
        v => {
          const nombre =
            (
              v.cliente?.nombre ||
              v.clienteNombre ||
              ""
            ).toLowerCase();

          const documento =
            (
              v.cliente?.documento ||
              v.documento ||
              ""
            ).toLowerCase();

          const folioVisible =
            formatearNumeroFactura(
              v.numeroFactura,
              v.id
            ).toLowerCase();

          const numeroSinCeros =
            v.numeroFactura
              ? String(
                  Number(
                    v.numeroFactura
                  )
                )
              : "";

          const idTecnico =
            String(
              v.id || ""
            ).toLowerCase();

          return (
            nombre.includes(
              t
            ) ||
            documento.includes(
              t
            ) ||
            folioVisible.includes(
              t
            ) ||
            numeroSinCeros.includes(
              t
            ) ||
            idTecnico.includes(
              t
            )
          );
        }
      );
    }, [
      ventas,
      qStr
    ]);

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

  return (
    <div className="inv-root">

      <header className="inv-header">

        <div>

          <h1>
            Historial de ventas
          </h1>

          <p className="inv-subtle">
            Empresa:{" "}
            {empresa?.nombre ||
              empresa?.id}{" "}
            • Registros:{" "}
            {filtradas.length}
            {cargando
              ? " • Cargando..."
              : ""}
          </p>

        </div>

        <div
          className="header-actions"
          style={{
            gap: 8,
            flexWrap:
              "wrap"
          }}
        >

          <Link
            className="btn"
            to="/"
          >
            ← Inventario
          </Link>

          <AppMenu />

        </div>

      </header>

      <section className="inv-toolbar">

        <div
          className="input-with-icon"
          style={{
            maxWidth: 420
          }}
        >

          <span className="icon">
            🔎
          </span>

          <input
            placeholder="Buscar por cliente, documento o factura…"
            value={
              qStr
            }
            onChange={e =>
              setQStr(
                e.target.value
              )
            }
          />

        </div>

      </section>

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
              Ventas
            </h2>
          </div>

          <div className="card-body">

            {error && (

              <div
                className="toast toast-error"
                style={{
                  position:
                    "static",
                  marginBottom:
                    12
                }}
              >
                {error}
              </div>

            )}

            {filtradas.length ===
              0 &&
            !cargando ? (

              <p className="inv-subtle">
                No hay ventas registradas.
              </p>

            ) : (

              <ul className="product-list">

                {filtradas.map(
                  v => {
                    const anulada =
                      v.anulada ===
                        true ||
                      v.estadoPago ===
                        "ANULADA";

                    const modificada =
                      Number(
                        v.version ||
                        1
                      ) >
                        1 &&
                      !anulada;

                    const folio =
                      formatearNumeroFactura(
                        v.numeroFactura,
                        v.id
                      );

                    return (

                      <li
                        className="product-item"
                        key={
                          v.id
                        }
                        style={{
                          gridTemplateColumns:
                            "1fr auto",

                          opacity:
                            anulada
                              ? .78
                              : 1,

                          borderColor:
                            anulada
                              ? "rgba(239,68,68,.30)"
                              : undefined,

                          background:
                            anulada
                              ? "rgba(239,68,68,.025)"
                              : undefined
                        }}
                      >

                        <div className="product-info">

                          <div className="product-title-row">

                            <strong
                              style={{
                                textDecoration:
                                  anulada
                                    ? "line-through"
                                    : "none"
                              }}
                            >
                              Factura #{folio}
                            </strong>

                            {anulada && (

                              <span
                                className="badge"
                                style={{
                                  color:
                                    "#ef4444",

                                  borderColor:
                                    "rgba(239,68,68,.30)",

                                  background:
                                    "rgba(239,68,68,.08)"
                                }}
                              >
                                🚫 ANULADA
                              </span>

                            )}

                            {modificada && (

                              <span
                                className="badge"
                                style={{
                                  color:
                                    "#3b82f6"
                                }}
                              >
                                ✏️ Modificada · v{v.version}
                              </span>

                            )}

                          </div>

                          <div className="product-meta">

                            <span>
                              Fecha:{" "}
                              <b>
                                {fmtFecha(
                                  v.fecha
                                )}
                              </b>
                            </span>

                            <span>
                              Total:{" "}
                              <b>
                                ${Number(
                                  v.total ||
                                  0
                                ).toLocaleString(
                                  "es-CO"
                                )}
                              </b>
                            </span>

                            <span>
                              Ítems:{" "}
                              <b>
                                {(v.items ||
                                  []).length}
                              </b>
                            </span>

                            <span>
                              Cliente:{" "}
                              <b>
                                {v.cliente?.nombre ||
                                  v.clienteNombre ||
                                  "-"}
                              </b>
                            </span>

                            <span>
                              Documento:{" "}
                              <b>
                                {v.cliente?.documento ||
                                  v.documento ||
                                  "-"}
                              </b>
                            </span>

                            {anulada &&
                              v.motivoAnulacion && (

                              <span>
                                Motivo:{" "}
                                <b>
                                  {v.motivoAnulacion}
                                </b>
                              </span>

                            )}

                          </div>

                        </div>

                        <div className="product-actions">

                          <Link
                            className="btn btn-small"
                            to={`/factura/${v.id}`}
                          >
                            Ver factura
                          </Link>

                        </div>

                      </li>

                    );
                  }
                )}

              </ul>

            )}

            {hayMas && (

              <div
                style={{
                  marginTop:
                    12
                }}
              >
                <button
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
