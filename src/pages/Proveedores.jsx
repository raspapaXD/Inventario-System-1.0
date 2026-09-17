// src/pages/Proveedores.jsx

import {
  useEffect,
  useMemo,
  useState
} from "react";

import {
  collection,
  documentId,
  endAt,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  startAt
} from "firebase/firestore";

import {
  Link
} from "react-router-dom";

import {
  db
} from "../../firebaseClient.js";

import {
  useTenant
} from "../tenant/TenantProvider";

import AppMenu from "../components/AppMenu.jsx";

import "./inventario.css";

const PAGE_SIZE = 30;
const SEARCH_LIMIT = 25;

/* =========================================================
   HELPERS
========================================================= */

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

export default function Proveedores() {
  const {
    empresa
  } = useTenant();

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

  const [
    proveedores,
    setProveedores
  ] = useState([]);

  const [
    qStr,
    setQStr
  ] = useState("");

  const [
    resultadosBusqueda,
    setResultadosBusqueda
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
    cargando,
    setCargando
  ] = useState(false);

  const [
    buscando,
    setBuscando
  ] = useState(false);

  const [
    error,
    setError
  ] = useState("");

  const normalizarSnap =
    snapDoc => ({
      id:
        snapDoc.id,
      ...snapDoc.data()
    });

  /* =======================================================
     LISTADO PAGINADO
  ======================================================= */

  const cargarPrimeraPagina =
    async () => {
      if (!proveedoresCol) {
        return;
      }

      try {
        setCargando(
          true
        );

        setError(
          ""
        );

        /*
         * Ordenamos por ID para incluir también proveedores
         * antiguos que todavía no tengan nombreBusqueda.
         */
        const snap =
          await getDocs(
            query(
              proveedoresCol,
              orderBy(
                documentId()
              ),
              limit(
                PAGE_SIZE
              )
            )
          );

        setProveedores(
          snap.docs.map(
            normalizarSnap
          )
        );

        setUltimoDoc(
          snap.docs[
            snap.docs.length - 1
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
          "No se pudieron cargar los proveedores."
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
        !proveedoresCol ||
        !ultimoDoc ||
        cargando
      ) {
        return;
      }

      try {
        setCargando(
          true
        );

        setError(
          ""
        );

        const snap =
          await getDocs(
            query(
              proveedoresCol,
              orderBy(
                documentId()
              ),
              startAfter(
                ultimoDoc
              ),
              limit(
                PAGE_SIZE
              )
            )
          );

        setProveedores(
          prev => [
            ...prev,
            ...snap.docs.map(
              normalizarSnap
            )
          ]
        );

        setUltimoDoc(
          snap.docs[
            snap.docs.length - 1
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
          "No se pudieron cargar más proveedores."
        );

      } finally {
        setCargando(
          false
        );
      }
    };

  useEffect(() => {
    cargarPrimeraPagina();
  }, [
    proveedoresCol
  ]);

  /* =======================================================
     BÚSQUEDA REMOTA
  ======================================================= */

  const buscarPrefijo =
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
              SEARCH_LIMIT
            )
          )
        );

      return snap.docs.map(
        normalizarSnap
      );
    };

  const buscarRemoto =
    async texto => {
      const limpio =
        String(texto || "")
          .trim();

      if (
        limpio.length < 2
      ) {
        return [];
      }

      const porDocumento =
        esBusquedaDocumento(
          limpio
        );

      const consultas =
        porDocumento
          ? [
              buscarPrefijo(
                "documentoNormalizado",
                normalizarDocumento(
                  limpio
                )
              ),

              buscarPrefijo(
                "documento",
                limpio
              )
            ]
          : [
              buscarPrefijo(
                "nombreBusqueda",
                normalizarNombreBusqueda(
                  limpio
                )
              ),

              /*
               * Compatibilidad con proveedores
               * creados antes de esta mejora.
               */
              buscarPrefijo(
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
        SEARCH_LIMIT
      );
    };

  useEffect(() => {
    const texto =
      qStr.trim();

    if (
      texto.length < 2
    ) {
      setResultadosBusqueda(
        []
      );

      setBuscando(
        false
      );

      return;
    }

    let cancelado =
      false;

    const timer =
      setTimeout(
        async () => {
          try {
            setBuscando(
              true
            );

            setError(
              ""
            );

            const lista =
              await buscarRemoto(
                texto
              );

            if (!cancelado) {
              setResultadosBusqueda(
                lista
              );
            }

          } catch (e) {
            console.error(e);

            if (!cancelado) {
              setResultadosBusqueda(
                []
              );

              setError(
                "No se pudo completar la búsqueda."
              );
            }

          } finally {
            if (!cancelado) {
              setBuscando(
                false
              );
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
    qStr,
    proveedoresCol
  ]);

  const usandoBusqueda =
    qStr.trim().length >= 2;

  const listaMostrada =
    usandoBusqueda
      ? resultadosBusqueda
      : proveedores;

  /* =======================================================
     EMPRESA
  ======================================================= */

  if (!empresa?.id) {
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

      {/* HEADER */}

      <header className="inv-header">

        <div>

          <h1>
            🏢 Proveedores
          </h1>

          <p className="inv-subtle">
            Consulta proveedores sin descargar toda la base de datos.
          </p>

        </div>

        <div
          className="header-actions"
          style={{
            gap: 8,
            flexWrap: "wrap"
          }}
        >
          <Link
            to="/compras"
            className="btn btn-primary"
          >
            🛒 Nueva compra
          </Link>

          <Link
            to="/"
            className="btn"
          >
            ← Inventario
          </Link>

          <AppMenu />
        </div>

      </header>

      {/* BUSCADOR */}

      <section className="inv-toolbar">

        <div
          className="input-with-icon"
          style={{
            maxWidth: 520
          }}
        >
          <span className="icon">
            🔎
          </span>

          <input
            placeholder="Buscar por nombre o NIT / documento…"
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

        <span
          className="inv-subtle"
          style={{
            fontSize: 12
          }}
        >
          {usandoBusqueda
            ? buscando
              ? "Buscando…"
              : `${listaMostrada.length} resultado(s)`
            : `${proveedores.length} cargado(s)`}
        </span>

      </section>

      {/* LISTADO */}

      <section
        className="inv-grid"
        style={{
          gridTemplateColumns:
            "1fr"
        }}
      >

        <div className="card">

          <div className="card-header">

            <div>
              <h2>
                {usandoBusqueda
                  ? "Resultados"
                  : "Listado"}
              </h2>

              {!usandoBusqueda && (
                <p
                  className="inv-subtle"
                  style={{
                    margin:
                      "4px 0 0",
                    fontSize: 11
                  }}
                >
                  Se cargan {PAGE_SIZE} proveedores por página para mantener Ordexa rápida con bases grandes.
                </p>
              )}
            </div>

          </div>

          <div className="card-body">

            {error && (

              <div
                className="toast toast-error"
                style={{
                  position:
                    "static",
                  marginBottom: 12
                }}
              >
                {error}
              </div>

            )}

            {qStr.trim().length === 1 && (

              <p className="inv-subtle">
                Escribe al menos 2 caracteres para buscar.
              </p>

            )}

            {!buscando &&
            listaMostrada.length === 0 ? (

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
                    marginBottom: 9
                  }}
                >
                  🏢
                </div>

                <strong>
                  Sin proveedores coincidentes
                </strong>

                <p className="inv-subtle">
                  Prueba con el nombre o el NIT / documento.
                </p>
              </div>

            ) : (

              <ul className="product-list">

                {listaMostrada.map(
                  proveedor => (

                    <li
                      key={
                        proveedor.id
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
                            {proveedor.nombre ||
                              "Proveedor sin nombre"}
                          </strong>

                        </div>

                        <div className="product-meta">

                          <span>
                            NIT / Documento:{" "}

                            <b>
                              {proveedor.documento ||
                                "—"}
                            </b>
                          </span>

                          <span>
                            ID:{" "}

                            <b>
                              {proveedor.id}
                            </b>
                          </span>

                        </div>

                      </div>

                      <div className="product-actions">

                        <Link
                          className="btn btn-small"
                          to={`/historial-compras?proveedor=${encodeURIComponent(
                            proveedor.id
                          )}&nombre=${encodeURIComponent(
                            proveedor.nombre ||
                            "Proveedor"
                          )}`}
                        >
                          📑 Ver compras
                        </Link>

                      </div>

                    </li>

                  )
                )}

              </ul>

            )}

            {!usandoBusqueda &&
              hayMas && (

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
                    : "Cargar más proveedores"}
                </button>
              </div>

            )}

          </div>

        </div>

      </section>

    </div>
  );
}
