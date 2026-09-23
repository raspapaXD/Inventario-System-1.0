import { useEffect, useMemo, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../../firebaseClient.js";
import { useTenant } from "../tenant/TenantProvider.jsx";
import "../pages/inventario.css";

const numero = value => {
  const limpio = String(value || "")
    .replace(/\s/g, "")
    .replace(/\.(?=\d{3}(?:\D|$))/g, "")
    .replace(/,/g, ".");
  const resultado = Number(limpio);
  return Number.isFinite(resultado) ? resultado : 0;
};

const fechaISO = value => {
  const match = String(value || "").match(/(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})/);
  if (!match) return "";
  const year = match[3].length === 2 ? `20${match[3]}` : match[3];
  return `${year}-${String(match[2]).padStart(2, "0")}-${String(match[1]).padStart(2, "0")}`;
};

const normalizarTexto = value => String(value || "")
  .toLowerCase()
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/[^a-z0-9\s]/g, " ")
  .replace(/\s+/g, " ")
  .trim();

const PALABRAS_GENERALES = new Set([
  "power",
  "bank",
  "cable",
  "case",
  "silicon",
  "funda",
  "para",
  "the",
  "de",
  "el",
  "la"
]);

const similitud = (a, b) => {
  const textoA = normalizarTexto(a);
  const textoB = normalizarTexto(b);
  if (!textoA || !textoB) return 0;
  if (textoA === textoB) return 1;
  if (textoA.includes(textoB) || textoB.includes(textoA)) return 0.96;

  const izquierda = new Set(textoA.split(" ").filter(Boolean));
  const derecha = new Set(textoB.split(" ").filter(Boolean));
  if (!izquierda.size || !derecha.size) return 0;
  const comunes = [...izquierda].filter(palabra => derecha.has(palabra));
  const distintivas = comunes.filter(palabra => !PALABRAS_GENERALES.has(palabra) && palabra.length >= 3);
  if (!distintivas.length) return 0;
  return (distintivas.length / Math.max(izquierda.size, derecha.size)) + (distintivas.length >= 2 ? 0.25 : 0);
};

function analizarTexto(texto) {
  const lineas = texto.split(/\r?\n/).map(linea => linea.trim()).filter(Boolean);
  const fecha = fechaISO(texto);
  const numeroFactura = (texto.match(/(?:factura|fact\.?|no\.?|n[°ºo])\s*[:#-]?\s*([A-Z0-9-]+)/i) || [])[1] || "";
  const documento = (texto.match(/(?:nit|documento|cc|c\.c\.?)[\s:#-]*([0-9 .-]{5,})/i) || [])[1]?.trim() || "";
  const nombre = (texto.match(/(?:cliente|proveedor|raz[oó]n social)[\s:#-]*([^\n]+)/i) || [])[1]?.trim() || "";
  const totalTexto = (texto.match(/(?:total|a pagar|total a pagar)[^\d]*([\d.,]+)/i) || [])[1] || "";
  const items = lineas
    .map(linea => {
      const numeros = linea.match(/\d[\d.,]*/g) || [];
      if (!numeros.length || /total|subtotal|iva|impuesto|descuento|cambio/i.test(linea)) return null;
      const cantidad = numero(numeros[0]);
      const nombre = linea.replace(/^\s*\d[\d.,]*\s*/, "").replace(/[$%]/g, " ").replace(/\s+/g, " ").trim();
      if (!nombre || cantidad <= 0) return null;
      return { nombre, cantidad: Math.round(cantidad) };
    })
    .filter(Boolean)
    .slice(0, 40);

  return { texto, numeroFactura, fecha, nombre, documento, total: numero(totalTexto), items };
}

async function extraerTexto(archivo, actualizarProgreso) {
  if (archivo.type === "application/pdf") {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const datos = new Uint8Array(await archivo.arrayBuffer());
    const pdf = await pdfjs.getDocument({ data: datos, disableWorker: true }).promise;
    const paginas = [];
    for (let indice = 1; indice <= pdf.numPages; indice += 1) {
      const pagina = await pdf.getPage(indice);
      const contenido = await pagina.getTextContent();
      paginas.push(contenido.items.map(item => item.str).join(" "));
      actualizarProgreso(Math.round((indice / pdf.numPages) * 100));
    }
    return paginas.join("\n");
  }

  const Tesseract = await import("tesseract.js");
  const resultado = await Tesseract.recognize(archivo, "spa", {
    logger: evento => {
      if (evento.status === "recognizing text") actualizarProgreso(Math.round((evento.progress || 0) * 100));
    }
  });
  return resultado.data.text;
}

export default function ImportarComprobanteModal({ tipo, productos, onClose, onApply }) {
  const { empresa } = useTenant();
  const [archivo, setArchivo] = useState(null);
  const [procesando, setProcesando] = useState(false);
  const [progreso, setProgreso] = useState(0);
  const [error, setError] = useState("");
  const [datos, setDatos] = useState(null);
  const [entidades, setEntidades] = useState([]);
  const [entidadBusqueda, setEntidadBusqueda] = useState("");
  const [modoEntidad, setModoEntidad] = useState("nuevo");
  const [lineaProducto, setLineaProducto] = useState(null);
  const [busquedaProducto, setBusquedaProducto] = useState("");

  const esCompra = tipo === "compra";

  useEffect(() => {
    if (!empresa?.id) return;
    getDocs(collection(db, "empresas", empresa.id, esCompra ? "proveedores" : "clientes"))
      .then(snap => setEntidades(snap.docs.map(doc => ({ id: doc.id, ...doc.data() }))))
      .catch(errorEntidades => console.error("No se pudieron cargar los registros.", errorEntidades));
  }, [empresa?.id, esCompra]);

  const productosFiltrados = useMemo(() => {
    const busqueda = normalizarTexto(busquedaProducto);
    return productos.filter(producto => !busqueda || normalizarTexto(`${producto.codigo || ""} ${producto.nombre}`).includes(busqueda));
  }, [productos, busquedaProducto]);

  const entidadSugerida = useMemo(() => {
    const texto = `${datos?.nombre || ""} ${datos?.documento || ""}`;
    return entidades
      .map(entidad => ({ entidad, puntaje: similitud(texto, `${entidad.nombre || ""} ${entidad.documento || ""}`) }))
      .sort((a, b) => b.puntaje - a.puntaje)[0];
  }, [datos, entidades]);

  const sugerenciaProducto = item => productos
    .map(producto => ({ producto, puntaje: similitud(item.nombre, `${producto.codigo || ""} ${producto.nombre}`) }))
    .sort((a, b) => b.puntaje - a.puntaje)[0];
  const actualizarDato = (campo, valor) => setDatos(prev => ({ ...prev, [campo]: valor }));
  const actualizarItem = (indice, campo, valor) => setDatos(prev => ({
    ...prev,
    items: prev.items.map((item, posicion) => posicion === indice ? { ...item, [campo]: valor } : item)
  }));

  const seleccionarEntidad = entidad => {
    actualizarDato("nombre", entidad.nombre || "");
    actualizarDato("documento", entidad.documento || "");
    setEntidadBusqueda(entidad.nombre || entidad.documento || "");
    setModoEntidad("existente");
  };

  const seleccionarProducto = (producto, indice = lineaProducto) => {
    if (indice === null || indice === undefined) return;
    actualizarItem(indice, "productoId", producto.id);
    setLineaProducto(null);
    setBusquedaProducto("");
  };

  const analizar = async () => {
    if (!archivo) return setError("Selecciona una imagen o PDF.");
    try {
      setProcesando(true);
      setError("");
      setProgreso(0);
      const texto = await extraerTexto(archivo, setProgreso);
      const resultado = analizarTexto(texto);
      setDatos(resultado);
      if (!resultado.items.length) setError("No se detectaron productos. Puedes agregarlos manualmente en el formulario después de importar.");
    } catch (e) {
      console.error(e);
      setError("No se pudo leer el documento. Prueba con una imagen más clara o un PDF con texto.");
    } finally {
      setProcesando(false);
    }
  };

  const aplicar = () => {
    onApply({
      ...datos,
      items: datos.items.filter(item => item.productoId && Number(item.cantidad) > 0)
    });
    onClose();
  };

  const asignados = datos?.items.filter(item => item.productoId).length || 0;

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal-card" style={{ width: "min(94vw, 1120px)", maxWidth: 1120, maxHeight: "94vh", overflowY: "auto", padding: 24, borderRadius: 22 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
          <div>
            <h3>Importar {esCompra ? "compra" : "venta"}</h3>
            <p>Revisa y corrige la información antes de cargarla al formulario.</p>
          </div>
          <button type="button" className="btn" onClick={onClose}>✕</button>
        </div>

        {!datos && (
          <>
            <div className="form-field" style={{ marginTop: 16 }}>
              <label>Foto o PDF de la factura</label>
              <input type="file" accept="image/*,.pdf,application/pdf" onChange={e => setArchivo(e.target.files?.[0] || null)} />
            </div>
            {procesando && <p className="inv-subtle">Leyendo documento... {progreso}%</p>}
            <button type="button" className="btn btn-primary" onClick={analizar} disabled={procesando || !archivo}>
              {procesando ? "Analizando..." : "Analizar documento"}
            </button>
          </>
        )}

        {error && <div className="toast toast-error" style={{ position: "static", marginTop: 12 }}>{error}</div>}

        {datos && (
          <>
            <div className="form-grid" style={{ marginTop: 16 }}>
              <div className="form-field">
                <label>{esCompra ? "Proveedor" : "Cliente"}</label>
                <div style={{ display: "flex", gap: 6, marginBottom: 7 }}>
                  <button type="button" className={`btn btn-small ${modoEntidad === "nuevo" ? "btn-primary" : ""}`} onClick={() => setModoEntidad("nuevo")}>Nuevo</button>
                  <button type="button" className={`btn btn-small ${modoEntidad === "existente" ? "btn-primary" : ""}`} onClick={() => setModoEntidad("existente")}>Existente</button>
                </div>
                {modoEntidad === "nuevo" ? (
                  <input value={datos.nombre || ""} onChange={e => { actualizarDato("nombre", e.target.value); setEntidadBusqueda(e.target.value); }} />
                ) : (
                  <div style={{ position: "relative" }}>
                    <input placeholder={`Buscar ${esCompra ? "proveedor" : "cliente"}...`} value={entidadBusqueda} onChange={e => setEntidadBusqueda(e.target.value)} />
                    <div style={{ position: "absolute", zIndex: 3, left: 0, right: 0, top: "calc(100% + 4px)", display: "grid", gap: 4, maxHeight: 170, overflowY: "auto", padding: 6, border: "1px solid var(--border)", borderRadius: 10, background: "var(--card)", boxShadow: "0 12px 30px rgba(0,0,0,.25)" }}>
                      {entidades.filter(entidad => normalizarTexto(`${entidad.nombre || ""} ${entidad.documento || ""}`).includes(normalizarTexto(entidadBusqueda))).slice(0, 8).map(entidad => (
                        <button key={entidad.id} type="button" className="btn btn-small" style={{ justifyContent: "space-between" }} onClick={() => seleccionarEntidad(entidad)}><span>{entidad.nombre || "Sin nombre"}</span><span>{entidad.documento || ""}</span></button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <Campo label={esCompra ? "NIT / Documento" : "Documento"} value={datos.documento} onChange={value => actualizarDato("documento", value)} />
              {esCompra && (
                <Campo label="Número de factura del proveedor" value={datos.numeroFactura} onChange={value => actualizarDato("numeroFactura", value)} />
              )}
              <Campo label="Fecha" type="date" value={datos.fecha} onChange={value => actualizarDato("fecha", value)} />
              <Campo label="Total detectado" value={datos.total || ""} onChange={value => actualizarDato("total", numero(value))} />
            </div>

            {modoEntidad === "nuevo" && entidadSugerida?.puntaje >= 0.5 && entidadSugerida.entidad.nombre !== datos.nombre && (
              <button type="button" className="btn btn-small" style={{ marginTop: 8 }} onClick={() => seleccionarEntidad(entidadSugerida.entidad)}>
                Usar cliente sugerido: {entidadSugerida.entidad.nombre}
              </button>
            )}

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, margin: "20px 0 10px" }}>
              <div>
                <h4 style={{ margin: 0 }}>Productos detectados</h4>
                <p className="inv-subtle" style={{ margin: "4px 0 0", fontSize: 11 }}>Confirma la coincidencia de cada línea con tu inventario.</p>
              </div>
              <span className="badge">{asignados}/{datos.items.length} asignados</span>
            </div>

            <div style={{ display: "grid", gap: 10 }}>
              {datos.items.map((item, indice) => {
                const productoAsignado = productos.find(producto => producto.id === item.productoId);
                const sugerencia = sugerenciaProducto(item);
                const confianza = Math.min(99, Math.round((sugerencia?.puntaje || 0) * 100));

                return (
                  <div key={`${indice}-${item.nombre}`} style={{ padding: 12, border: `1px solid ${item.productoId ? "rgba(34,197,94,.35)" : "var(--border)"}`, borderRadius: 14, background: item.productoId ? "rgba(34,197,94,.045)" : "rgba(255,255,255,.018)" }}>
                    <div style={{ display: "grid", gridTemplateColumns: esCompra ? "minmax(210px, 1fr) 130px 120px" : "minmax(210px, 1fr) 130px", gap: 9, alignItems: "end" }}>
                      <Campo label="Nombre leído" value={item.nombre} onChange={value => actualizarItem(indice, "nombre", value)} />
                      <Campo label="Cantidad" type="number" value={item.cantidad} onChange={value => actualizarItem(indice, "cantidad", value)} />
                      {esCompra && <Campo label="Costo" value={item.precio} onChange={value => actualizarItem(indice, "precio", numero(value))} />}
                    </div>

                    {productoAsignado ? (
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 9, padding: "9px 10px", borderRadius: 10, background: "rgba(34,197,94,.08)" }}>
                        <div><strong>✓ {productoAsignado.nombre}</strong><div className="inv-subtle" style={{ fontSize: 10, marginTop: 2 }}>{productoAsignado.codigo ? `Código: ${productoAsignado.codigo} · ` : ""}Stock: {productoAsignado.cantidad ?? 0}</div></div>
                        <button type="button" className="btn btn-small" onClick={() => setLineaProducto(indice)}>Cambiar</button>
                      </div>
                    ) : (
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginTop: 9, padding: "9px 10px", borderRadius: 10, border: sugerencia?.puntaje >= 0.35 ? "1px solid rgba(59,130,246,.3)" : "1px dashed var(--border)", background: sugerencia?.puntaje >= 0.35 ? "rgba(59,130,246,.06)" : "transparent" }}>
                        {sugerencia?.puntaje >= 0.35 ? (
                          <div><div className="inv-subtle" style={{ fontSize: 10 }}>COINCIDENCIA SUGERIDA · {confianza}%</div><strong>{sugerencia.producto.nombre}</strong><div className="inv-subtle" style={{ fontSize: 10, marginTop: 2 }}>{sugerencia.producto.codigo ? `Código: ${sugerencia.producto.codigo} · ` : ""}Stock: {sugerencia.producto.cantidad ?? 0}</div></div>
                        ) : <span className="inv-subtle">No encontramos una coincidencia clara.</span>}
                        <div style={{ display: "flex", gap: 6 }}>
                          {sugerencia?.puntaje >= 0.35 && <button type="button" className="btn btn-primary btn-small" onClick={() => seleccionarProducto(sugerencia.producto, indice)}>✓ Usar sugerencia</button>}
                          <button type="button" className="btn btn-small" onClick={() => setLineaProducto(indice)}>Buscar</button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {lineaProducto !== null && (
              <div className="modal-overlay" style={{ zIndex: 1400 }} onMouseDown={event => { if (event.target === event.currentTarget) setLineaProducto(null); }}>
                <div className="modal-card" style={{ width: "min(92vw, 760px)", maxHeight: "78vh", overflow: "hidden", borderRadius: 20, boxShadow: "0 24px 80px rgba(0,0,0,.45)" }} onMouseDown={event => event.stopPropagation()}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                    <div>
                      <h3 style={{ margin: 0 }}>Seleccionar producto</h3>
                      <p style={{ margin: "5px 0 0" }}>Busca por nombre, código o referencia del inventario.</p>
                    </div>
                    <button type="button" className="btn" onClick={() => setLineaProducto(null)}>✕</button>
                  </div>
                  <input autoFocus placeholder="🔎 Buscar producto..." value={busquedaProducto} onChange={e => setBusquedaProducto(e.target.value)} style={{ marginTop: 14, minHeight: 42 }} />
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: 10, marginTop: 14, maxHeight: "54vh", overflowY: "auto", paddingRight: 4 }}>
                    {productosFiltrados.map(producto => (
                      <button key={producto.id} type="button" className="btn" style={{ minHeight: 54, textAlign: "left", justifyContent: "flex-start", alignItems: "flex-start", flexDirection: "column", gap: 3 }} onClick={() => seleccionarProducto(producto)}>
                        <strong>{producto.nombre}</strong>
                        <span className="inv-subtle">{producto.codigo ? `Código: ${producto.codigo} · ` : ""}Stock: {producto.cantidad ?? 0}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            <div className="modal-actions" style={{ marginTop: 18 }}>
              <button type="button" className="btn" onClick={() => setDatos(null)}>Volver a seleccionar</button>
              <button type="button" className="btn btn-primary" onClick={aplicar} disabled={!datos.items.some(item => item.productoId && Number(item.cantidad) > 0)}>Usar información en el formulario</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Campo({ label, type = "text", value, onChange }) {
  return <div className="form-field"><label>{label}</label><input type={type} value={value ?? ""} onChange={e => onChange(e.target.value)} /></div>;
}
