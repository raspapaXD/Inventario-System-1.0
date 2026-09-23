// src/pages/Clientes.jsx

import {
  useEffect,
  useMemo,
  useState
} from "react";

import {
  collection,
  doc,
  documentId,
  endAt,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  startAt,
  updateDoc,
  serverTimestamp,
  where
} from "firebase/firestore";

import { db } from "../../firebaseClient.js";
import { Link } from "react-router-dom";
import { useTenant } from "../tenant/TenantProvider";
import AppMenu from "../components/AppMenu.jsx";

import "./inventario.css";

const PAGE_SIZE = 30;
const SEARCH_LIMIT = 25;

/* =========================================================
   HELPERS
========================================================= */

const norm = value =>
  String(value || "")
    .trim();

const slug = value =>
  norm(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

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

/* =========================================================
   COMPONENTE
========================================================= */

export default function Clientes() {
  const {
    empresa
  } = useTenant();

  const clientesCol =
    useMemo(() => {
      if (!empresa?.id) {
        return null;
      }

      return collection(
        db,
        "empresas",
        empresa.id,
        "clientes"
      );
    }, [
      empresa?.id
    ]);

  const [
    clientes,
    setClientes
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

  const [
    clienteEditando,
    setClienteEditando
  ] = useState(null);

  const [
    formularioEdicion,
    setFormularioEdicion
  ] = useState({
    nombre: "",
    documento: ""
  });

  const [
    guardandoEdicion,
    setGuardandoEdicion
  ] = useState(false);

  /* =======================================================
     LISTADO PAGINADO
  ======================================================= */

  const normalizarSnap =
    snapDoc => ({
      id:
        snapDoc.id,
      ...snapDoc.data()
    });

  const cargarPrimeraPagina =
    async () => {
      if (!clientesCol) {
        return;
      }

      try {
        setCargando(true);
        setError("");

        /*
         * Usamos el ID del documento para poder
         * incluir clientes antiguos aunque todavía
         * no tengan nombreBusqueda.
         */
        const snap =
          await getDocs(
            query(
              clientesCol,
              orderBy(
                documentId()
              ),
              limit(
                PAGE_SIZE
              )
            )
          );

        setClientes(
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
          "No se pudieron cargar los clientes."
        );

      } finally {
        setCargando(false);
      }
    };

  const cargarMas =
    async () => {
      if (
        !clientesCol ||
        !ultimoDoc ||
        cargando
      ) {
        return;
      }

      try {
        setCargando(true);
        setError("");

        const snap =
          await getDocs(
            query(
              clientesCol,
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

        setClientes(
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
          "No se pudieron cargar más clientes."
        );

      } finally {
        setCargando(false);
      }
    };

  useEffect(() => {
    cargarPrimeraPagina();
  }, [
    clientesCol
  ]);

  /* =======================================================
     BÚSQUEDA REMOTA ESCALABLE
  ======================================================= */

  const buscarPrefijo =
    async (
      campo,
      prefijo
    ) => {
      if (
        !clientesCol ||
        !prefijo
      ) {
        return [];
      }

      const snap =
        await getDocs(
          query(
            clientesCol,
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
      if (
        !texto ||
        texto.trim().length < 2
      ) {
        return [];
      }

      const porDocumento =
        esBusquedaDocumento(
          texto
        );

      const consultas =
        porDocumento
          ? [
              buscarPrefijo(
                "documentoNormalizado",
                normalizarDocumento(
                  texto
                )
              ),

              /*
               * Compatibilidad con clientes viejos.
               */
              buscarPrefijo(
                "documento",
                norm(
                  texto
                )
              )
            ]
          : [
              buscarPrefijo(
                "nombreBusqueda",
                normalizarNombreBusqueda(
                  texto
                )
              ),

              /*
               * Compatibilidad con la estructura
               * anterior de Ordexa.
               */
              buscarPrefijo(
                "nombreLower",
                slug(
                  texto
                )
              )
            ];

      const resultados =
        await Promise.allSettled(
          consultas
        );

      const map =
        new Map();

      for (
        const resultado
        of resultados
      ) {
        if (
          resultado.status ===
          "fulfilled"
        ) {
          for (
            const cliente
            of resultado.value
          ) {
            map.set(
              cliente.id,
              cliente
            );
          }
        }
      }

      return Array.from(
        map.values()
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
      setResultadosBusqueda([]);
      setBuscando(false);
      return;
    }

    let cancelado =
      false;

    const timer =
      setTimeout(
        async () => {
          try {
            setBuscando(true);
            setError("");

            const resultados =
              await buscarRemoto(
                texto
              );

            if (!cancelado) {
              setResultadosBusqueda(
                resultados
              );
            }

          } catch (e) {
            console.error(e);

            if (!cancelado) {
              setResultadosBusqueda([]);
              setError(
                "No se pudo completar la búsqueda."
              );
            }

          } finally {
            if (!cancelado) {
              setBuscando(false);
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
    clientesCol
  ]);

  const usandoBusqueda =
    qStr.trim().length >= 2;

  const listaMostrada =
    usandoBusqueda
      ? resultadosBusqueda
      : clientes;

  const abrirEdicion = cliente => {
    setClienteEditando(cliente);
    setFormularioEdicion({
      nombre: cliente.nombre || "",
      documento: cliente.documento || ""
    });
    setError("");
  };

  const guardarEdicion = async () => {
    const nombre = norm(formularioEdicion.nombre);
    const documento = norm(formularioEdicion.documento);

    if (!nombre) {
      setError("Ingresa el nombre del cliente.");
      return;
    }

    try {
      setGuardandoEdicion(true);
      const documentoNormalizado = normalizarDocumento(documento);

      if (documentoNormalizado) {
        const consultas = await Promise.allSettled([
          getDocs(
            query(
              clientesCol,
              where("documentoNormalizado", "==", documentoNormalizado),
              limit(5)
            )
          ),
          getDocs(
            query(
              clientesCol,
              where("documento", "==", documento),
              limit(5)
            )
          )
        ]);

        const duplicado = consultas
          .filter(resultado => resultado.status === "fulfilled")
          .flatMap(resultado => resultado.value.docs)
          .find(cliente => cliente.id !== clienteEditando.id);

        if (duplicado) {
          setError("Ya existe otro cliente con ese documento.");
          return;
        }
      }

      const referencia = doc(clientesCol, clienteEditando.id);
      const cambios = {
        nombre,
        nombreLower: slug(nombre),
        nombreBusqueda: normalizarNombreBusqueda(nombre),
        documento: documento || null,
        documentoNormalizado: normalizarDocumento(documento) || null,
        updatedAt: serverTimestamp()
      };

      await updateDoc(referencia, cambios);
      const actualizado = { ...clienteEditando, ...cambios, updatedAt: new Date() };
      const reemplazar = lista =>
        lista.map(cliente => cliente.id === actualizado.id ? actualizado : cliente);
      setClientes(reemplazar);
      setResultadosBusqueda(reemplazar);
      setClienteEditando(null);
    } catch (e) {
      console.error(e);
      setError("No se pudo actualizar el cliente.");
    } finally {
      setGuardandoEdicion(false);
    }
  };

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
            Clientes
          </h1>

          <p className="inv-subtle">
            Consulta clientes e historial sin descargar toda la base de datos.
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
            className="btn"
            to="/"
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
            placeholder="Buscar por nombre o documento…"
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
            : `${clientes.length} cargado(s)`}
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
                  Se cargan {PAGE_SIZE} clientes por página para mantener Ordexa rápida incluso con bases grandes.
                </p>
              )}
            </div>

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
                    "38px 20px"
                }}
              >
                <div
                  style={{
                    fontSize: 32,
                    marginBottom: 8
                  }}
                >
                  👤
                </div>

                <strong>
                  Sin clientes coincidentes
                </strong>

                <p className="inv-subtle">
                  Prueba con el nombre o el documento.
                </p>
              </div>

            ) : (

              <ul className="product-list">

                {listaMostrada.map(
                  c => (

                    <li
                      className="product-item"
                      key={
                        c.id
                      }
                      style={{
                        gridTemplateColumns:
                          "1fr auto"
                      }}
                    >

                      <div className="product-info">

                        <div className="product-title-row">
                          <strong>
                            {c.nombre ||
                              "Cliente sin nombre"}
                          </strong>
                        </div>

                        <div className="product-meta">

                          <span>
                            Documento:{" "}

                            <b>
                              {c.documento ||
                                "—"}
                            </b>
                          </span>

                          <span>
                            ID:{" "}

                            <b>
                              {c.id}
                            </b>
                          </span>

                        </div>

                      </div>

                      <div className="product-actions">

                        <Link
                          className="btn btn-small"
                          to={`/clientes/${c.id}`}
                        >
                          Ver historial
                        </Link>

                        <button
                          type="button"
                          className="btn btn-small"
                          onClick={() => abrirEdicion(c)}
                        >
                          ✏️ Editar
                        </button>

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
                    : "Cargar más clientes"}
                </button>
              </div>

            )}

          </div>

        </div>

      </section>

      {clienteEditando && (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal-card" style={{ maxWidth: 520 }}>
            <h3>Editar cliente</h3>
            <div className="form-grid">
              <CampoEdicion
                label="Nombre *"
                value={formularioEdicion.nombre}
                onChange={value => setFormularioEdicion(prev => ({ ...prev, nombre: value }))}
              />
              <CampoEdicion
                label="Documento"
                value={formularioEdicion.documento}
                onChange={value => setFormularioEdicion(prev => ({ ...prev, documento: value }))}
              />
            </div>
            <div className="modal-actions" style={{ marginTop: 18 }}>
              <button type="button" className="btn" onClick={() => setClienteEditando(null)} disabled={guardandoEdicion}>Cancelar</button>
              <button type="button" className="btn btn-primary" onClick={guardarEdicion} disabled={guardandoEdicion}>
                {guardandoEdicion ? "Guardando..." : "Guardar cambios"}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

function CampoEdicion({ label, value, onChange }) {
  return (
    <div className="form-field">
      <label>{label}</label>
      <input value={value} onChange={e => onChange(e.target.value)} />
    </div>
  );
}
