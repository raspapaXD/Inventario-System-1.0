import { useEffect, useState, useRef, useMemo } from "react";
import { db } from "../../firebase";
import {
  collection, getDocs, addDoc, deleteDoc, doc, updateDoc, getDoc,
  query, orderBy, startAt, endAt
} from "firebase/firestore";
import { Link } from "react-router-dom";
import "./inventario.css";

// Estilos mínimos para el botón flotante (solo móvil)
const FabStyles = () => (
  <style>
    {`
    .fab {
      position: fixed;
      right: 16px;
      bottom: 16px;
      z-index: 50;
      border: none;
      border-radius: 999px;
      padding: 14px 18px;
      background: var(--primary);
      color: #001018;
      font-weight: 700;
      box-shadow: 0 10px 18px rgba(0,0,0,.25);
      cursor: pointer;
    }
    .fab:active { transform: translateY(1px); }
    /* Ocultar en pantallas medianas/grandes */
    @media (min-width: 768px){
      .fab { display: none; }
    }
    `}
  </style>
);

// === util para tema (persistencia en localStorage) ===
function useTheme() {
  const [theme, setTheme] = useState(() => localStorage.getItem("theme") || "dark");
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("theme", theme);
  }, [theme]);
  const toggle = () => setTheme(t => (t === "dark" ? "light" : "dark"));
  return { theme, toggle };
}

function Inventario() {
  const { theme, toggle } = useTheme();

  // ---------- Estado principal ----------
  const [productos, setProductos] = useState([]);
  const [nuevoProducto, setNuevoProducto] = useState({
    nombre: "", cantidad: "", minimo: "", imagen: null, precio: "",
    categoriaId: ""   // "" = sin categoría
  });
  const [editandoId, setEditandoId] = useState(null);

  // Buscador
  const [busqueda, setBusqueda] = useState("");
  const [debounced, setDebounced] = useState("");
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState(null);
  const [soloAlertas, setSoloAlertas] = useState(false);

  // Categorías
  const [categorias, setCategorias] = useState([]);
  const [filtroCategoria, setFiltroCategoria] = useState("ALL"); // ALL | NONE | <categoriaId>
  const [agrupar, setAgrupar] = useState(false);

  // Modal: nueva categoría
  const [modalCategoria, setModalCategoria] = useState({ open: false, nombre: "" });

  // Empresa (logo/nombre/NIT)
  const [empresa, setEmpresa] = useState(null);

  // Imagenes / upload
  const inputCamaraRef = useRef(null);
  const inputGaleriaRef = useRef(null);
  const [preview, setPreview] = useState(null);
  const objectUrlRef = useRef(null);
  const [subiendo, setSubiendo] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  // Confirmación de eliminación
  const [confirmDelete, setConfirmDelete] = useState({ open: false, id: null, nombre: "" });

  // Ref del formulario (para scroll desde el FAB)
  const formRef = useRef(null);
  const scrollToForm = () => formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });

  // ---------- Efectos ----------
  // Debounce buscador
  useEffect(() => {
    const id = setTimeout(() => setDebounced(busqueda), 300);
    return () => clearTimeout(id);
  }, [busqueda]);

  // Limpieza de objectURL del preview
  useEffect(() => {
    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, []);

  // Cargar empresa
  useEffect(() => {
    (async () => {
      try {
        const snap = await getDoc(doc(db, "empresas", "empresa"));
        if (snap.exists()) setEmpresa(snap.data());
      } catch {}
    })();
  }, []);

  // Cargar categorías
  const cargarCategorias = async () => {
    const snap = await getDocs(collection(db, "categorias"));
    const lista = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    lista.sort((a,b) => (a.nombre || "").localeCompare(b.nombre || ""));
    setCategorias(lista);
  };
  useEffect(() => { cargarCategorias(); }, []);

  // Cargar productos
  const obtenerProductos = async () => {
    const snapshot = await getDocs(collection(db, "productos"));
    setProductos(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
  };
  const buscarPorPrefijo = async (texto) => {
    const t = (texto || "").trim().toLowerCase();
    if (!t) return [];
    const qy = query(
      collection(db, "productos"),
      orderBy("nombreLower"),
      startAt(t),
      endAt(t + "\uf8ff")
    );
    const snap = await getDocs(qy);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  };
  useEffect(()=>{ setCargando(true); obtenerProductos().finally(()=>setCargando(false)); },[]);
  useEffect(()=>{ (async()=>{ setCargando(true); setError(null);
    try { debounced.trim() ? setProductos(await buscarPorPrefijo(debounced)) : await obtenerProductos(); }
    catch(e){ console.error(e); setError("No se pudieron cargar los productos."); }
    finally{ setCargando(false); }
  })(); },[debounced]);

  // ---------- Handlers de formulario ----------
  const handleChange = (e) => setNuevoProducto({ ...nuevoProducto, [e.target.name]: e.target.value });

  const handleFileChange = (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    if (objectUrlRef.current) { URL.revokeObjectURL(objectUrlRef.current); objectUrlRef.current = null; }
    const url = URL.createObjectURL(file); objectUrlRef.current = url; setPreview(url);
    setNuevoProducto({ ...nuevoProducto, imagen: file });
  };

  const quitarImagen = () => {
    if (objectUrlRef.current) { URL.revokeObjectURL(objectUrlRef.current); objectUrlRef.current = null; }
    setPreview(null); setNuevoProducto({ ...nuevoProducto, imagen: null });
    if (inputCamaraRef.current) inputCamaraRef.current.value = "";
    if (inputGaleriaRef.current) inputGaleriaRef.current.value = "";
  };

  // ---------- Utilidades imagen ----------
  function dataURLtoFile(dataUrl, filename) {
    const arr = dataUrl.split(","), mime = arr[0].match(/:(.*?);/)[1], bstr = atob(arr[1]);
    let n = bstr.length; const u8 = new Uint8Array(n); while(n--) u8[n] = bstr.charCodeAt(n);
    return new File([u8], filename, { type: mime });
  }
  async function comprimirImagen(file, { maxWidth=1200, maxHeight=1200, quality=0.8, outputType="image/jpeg" } = {}) {
    const img = await new Promise((res, rej) => {
      const u = URL.createObjectURL(file); const im = new Image();
      im.onload = () => { URL.revokeObjectURL(u); res(im); }; im.onerror = rej; im.src = u;
    });
    const ratio = Math.min(maxWidth/img.width, maxHeight/img.height, 1);
    const w = Math.round(img.width*ratio), h = Math.round(img.height*ratio);
    const canvas = document.createElement("canvas"); canvas.width=w; canvas.height=h; const ctx=canvas.getContext("2d");
    ctx.drawImage(img,0,0,w,h); const dataUrl = canvas.toDataURL(outputType, quality);
    const base = file.name.replace(/\.[^/.]+$/, ""); return dataURLtoFile(dataUrl, `${base}.jpg`);
  }
  function subirImagenAImgBBConProgreso(file, onProgress) {
    return new Promise((resolve, reject) => {
      const fd = new FormData(); fd.append("image", file);
      const xhr = new XMLHttpRequest();
      xhr.open("POST","https://api.imgbb.com/1/upload?key=46bbab2f0ec657f928ab05ac5d78c37b");
      xhr.upload.onprogress = (e)=>{ if(e.lengthComputable&&onProgress){ onProgress(Math.round((e.loaded/e.total)*100)); } };
      xhr.onload = ()=>{ try{ const j = JSON.parse(xhr.responseText); j?.data?.url ? resolve(j.data.url) : reject(new Error("Respuesta imgbb inválida")); } catch(err){ reject(err); } };
      xhr.onerror = ()=>reject(new Error("Fallo de red")); xhr.send(fd);
    });
  }

  // ---------- Guardar producto ----------
  const agregarOActualizarProducto = async () => {
    try {
      setError(null);
      let urlImagen = "";

      if (nuevoProducto.imagen && typeof nuevoProducto.imagen !== "string") {
        const toUpload = await comprimirImagen(nuevoProducto.imagen);
        setSubiendo(true); setUploadProgress(0);
        urlImagen = await subirImagenAImgBBConProgreso(toUpload, setUploadProgress);
        setSubiendo(false); setUploadProgress(100);
      } else if (typeof nuevoProducto.imagen === "string") {
        urlImagen = nuevoProducto.imagen;
      }

      const cat = categorias.find(c => c.id === nuevoProducto.categoriaId);
      const categoriaNombre = cat?.nombre || null;

      const productoData = {
        nombre: nuevoProducto.nombre,
        nombreLower: (nuevoProducto.nombre || "").trim().toLowerCase(),
        cantidad: parseInt(nuevoProducto.cantidad),
        minimo: parseInt(nuevoProducto.minimo),
        imagen: urlImagen || null,
        precioUnitario: parseFloat(nuevoProducto.precio),
        categoriaId: nuevoProducto.categoriaId || "",
        categoriaNombre: categoriaNombre || null
      };

      if (editandoId) {
        await updateDoc(doc(db,"productos",editandoId), productoData);
        setEditandoId(null);
      } else {
        await addDoc(collection(db,"productos"), productoData);
      }

      quitarImagen();
      setNuevoProducto({ nombre:"", cantidad:"", minimo:"", imagen:null, precio:"", categoriaId:"" });
      setUploadProgress(0); setSubiendo(false);

      if (debounced.trim()) setProductos(await buscarPorPrefijo(debounced));
      else await obtenerProductos();
    } catch (err) {
      console.error(err); setError("No se pudo guardar el producto."); setSubiendo(false);
    }
  };

  // ---------- Eliminar producto (con modal) ----------
  const ejecutarEliminarProducto = async (id) => {
    try {
      setError(null);
      await deleteDoc(doc(db,"productos",id));
      setConfirmDelete({ open: false, id: null, nombre: "" });
      if (debounced.trim()) setProductos(await buscarPorPrefijo(debounced));
      else await obtenerProductos();
    } catch (err) { console.error(err); setError("No se pudo eliminar el producto."); }
  };

  const solicitarEliminar = (id, nombre) => setConfirmDelete({ open: true, id, nombre });
  const cancelarEliminar = () => setConfirmDelete({ open: false, id: null, nombre: "" });
  const eliminarProducto = (id) => {
    const p = productos.find(x => x.id === id);
    solicitarEliminar(id, p?.nombre || "");
  };

  // ---------- Editar ----------
  const cargarProductoParaEditar = (p) => {
    if (objectUrlRef.current) { URL.revokeObjectURL(objectUrlRef.current); objectUrlRef.current = null; }
    setPreview(p.imagen || null);
    setNuevoProducto({
      nombre:p.nombre, cantidad:p.cantidad, minimo:p.minimo,
      imagen:p.imagen || null, precio:p.precioUnitario || "",
      categoriaId: p.categoriaId || ""
    });
    setEditandoId(p.id);
    window.scrollTo(0,0);
  };

  // ---------- Categorías: modal crear ----------
  const normalizar = (s) => (s || "").trim();
  const lower = (s) => normalizar(s).toLowerCase();

  const abrirModalCategoria = () => setModalCategoria({ open: true, nombre: "" });
  const cerrarModalCategoria = () => setModalCategoria({ open: false, nombre: "" });

  const crearCategoria = async () => {
    try {
      const nombre = normalizar(modalCategoria.nombre);
      if (!nombre) return;

      // Evitar duplicados por nombreLower
      const existe = categorias.some(c => (c.nombreLower || lower(c.nombre)) === lower(nombre));
      if (existe) { cerrarModalCategoria(); return; }

      const cat = { nombre, nombreLower: lower(nombre), creadoEn: new Date().toISOString() };
      const ref = await addDoc(collection(db, "categorias"), cat);

      await cargarCategorias();
      setFiltroCategoria(ref.id); // opcional: selecciona la nueva en el filtro
      cerrarModalCategoria();
    } catch (e) {
      console.error(e);
      setError("No se pudo crear la categoría.");
    }
  };

  // Enter/Esc en modal
  const onKeyDownModal = (e) => {
    if (!modalCategoria.open) return;
    if (e.key === "Enter") { e.preventDefault(); crearCategoria(); }
    if (e.key === "Escape") { e.preventDefault(); cerrarModalCategoria(); }
  };

  // ---------- Filtrado y agrupado en pantalla ----------
  const productosFiltrados = useMemo(() => {
    let list = productos.filter(p => !soloAlertas || Number(p.cantidad) <= Number(p.minimo));

    if (filtroCategoria === "NONE") {
      list = list.filter(p => !p.categoriaId);
    } else if (filtroCategoria !== "ALL") {
      list = list.filter(p => (p.categoriaId || "") === filtroCategoria);
    }

    return list;
  }, [productos, soloAlertas, filtroCategoria]);

  const grupos = useMemo(() => {
    if (!agrupar) return null;
    const map = new Map();
    for (const p of productosFiltrados) {
      const key = p.categoriaNombre || "Sin categoría";
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(p);
    }
    for (const arr of map.values()) {
      arr.sort((a,b) => (a.nombre || "").localeCompare(b.nombre || ""));
    }
    return Array.from(map.entries()).map(([nombre, items]) => ({ nombre, items }));
  }, [agrupar, productosFiltrados]);

  return (
    <div className="inv-root" onKeyDown={onKeyDownModal}>
      <FabStyles />

      {/* Header */}
      <header className="inv-header">
        <div style={{ display:"flex", alignItems:"center", gap:12 }}>
          {empresa?.logoUrl ? (
            <img
              src={empresa.logoUrl}
              alt="Logo"
              style={{ width:36, height:36, borderRadius:8, objectFit:"cover", border:"1px solid var(--border)" }}
            />
          ) : null}
          <div>
            <h1>{empresa?.nombre || "Inventario de Ordex"}</h1>
            <p className="inv-subtle">
              {empresa?.nit ? `NIT: ${empresa.nit} • ` : ""}
              {busqueda ? `Resultados: ${productosFiltrados.length}` : `Productos: ${productosFiltrados.length}`}
              {cargando ? " • Cargando..." : ""}
            </p>
          </div>
        </div>

        <div className="header-actions" style={{ gap: 8, flexWrap: "wrap" }}>
          <button className="btn theme-toggle" onClick={toggle} aria-label="Cambiar tema">
            {theme === "dark" ? "☀️ Claro" : "🌙 Oscuro"}
          </button>
          <Link to="/ventas" className="btn btn-primary">Registrar venta 🧾</Link>
          <Link to="/clientes" className="btn">👥 Clientes</Link>
          <Link to="/configuracion" className="btn">⚙️ Configuración</Link>
        </div>
      </header>

      {/* Toolbar */}
      <section className="inv-toolbar" style={{ rowGap: 10 }}>
        {/* Buscador */}
        <div className="input-with-icon">
          <span className="icon">🔎</span>
          <input
            type="text"
            placeholder="Buscar producto por nombre…"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
          />
        </div>

        {/* Filtro categoría */}
        <div className="form-field" style={{ minWidth: 200 }}>
          <label style={{ marginBottom: 4 }}>Categoría</label>
          <select
            value={filtroCategoria}
            onChange={(e) => setFiltroCategoria(e.target.value)}
          >
            <option value="ALL">Todas</option>
            <option value="NONE">Sin categoría</option>
            {categorias.map(c => (
              <option key={c.id} value={c.id}>{c.nombre}</option>
            ))}
          </select>
        </div>

        {/* Agrupar */}
        <label className="checkbox">
          <input type="checkbox" checked={agrupar} onChange={e => setAgrupar(e.target.checked)} />
          <span>Agrupar por categoría</span>
        </label>

        {/* Botón para crear categoría (abre modal) */}
        <button className="btn" onClick={abrirModalCategoria}>➕ Añadir</button>

        {/* Stock bajo */}
        <label className="checkbox">
          <input type="checkbox" checked={soloAlertas} onChange={(e)=>setSoloAlertas(e.target.checked)} />
          <span>Solo stock bajo</span>
        </label>
      </section>

      {/* Grid principal */}
      <section className="inv-grid">
        {/* Card formulario */}
        <div className="card" ref={formRef}>
          <div className="card-header"><h2>{editandoId ? "Editar producto" : "Nuevo producto"}</h2></div>
          <div className="card-body">
            <div className="form-grid">
              <div className="form-field">
                <label>Nombre</label>
                <input type="text" name="nombre" placeholder="Ej: Arroz Diana 1kg" value={nuevoProducto.nombre} onChange={handleChange} />
              </div>
              <div className="form-field">
                <label>Cantidad</label>
                <input type="number" name="cantidad" placeholder="0" value={nuevoProducto.cantidad} onChange={handleChange} />
              </div>
              <div className="form-field">
                <label>Stock mínimo</label>
                <input type="number" name="minimo" placeholder="0" value={nuevoProducto.minimo} onChange={handleChange} />
              </div>
              <div className="form-field">
                <label>Precio unitario</label>
                <input type="number" name="precio" placeholder="0" value={nuevoProducto.precio} onChange={handleChange} />
              </div>

              {/* Selector de categoría del producto */}
              <div className="form-field" style={{ gridColumn: "1 / -1" }}>
                <label>Categoría</label>
                <select
                  name="categoriaId"
                  value={nuevoProducto.categoriaId}
                  onChange={handleChange}
                >
                  <option value="">Sin categoría</option>
                  {categorias.map(c => (
                    <option key={c.id} value={c.id}>{c.nombre}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="image-actions">
              <button type="button" className="btn" onClick={()=>inputCamaraRef.current?.click()}>📷 Tomar foto</button>
              <button type="button" className="btn" onClick={()=>inputGaleriaRef.current?.click()}>🖼️ Elegir de galería</button>
            </div>

            <input ref={inputCamaraRef} type="file" accept="image/*" capture="environment" onChange={handleFileChange} style={{display:"none"}} />
            <input ref={inputGaleriaRef} type="file" accept="image/*" onChange={handleFileChange} style={{display:"none"}} />

            {preview && (
              <div className="preview-row">
                <img src={preview} alt="Vista previa" className="preview-img" />
                <button type="button" className="btn btn-muted" onClick={quitarImagen}>Quitar imagen</button>
              </div>
            )}

            {subiendo && (
              <div className="progress">
                <div className="progress-info">Subiendo imagen: {uploadProgress}%</div>
                <div className="progress-bar"><div className="progress-fill" style={{width:`${uploadProgress}%`}}/></div>
              </div>
            )}
          </div>
          <div className="card-footer">
            <button className="btn btn-primary" onClick={agregarOActualizarProducto} disabled={subiendo}>
              {editandoId ? "Actualizar producto" : "Agregar producto"}
            </button>
          </div>
        </div>

        {/* Card lista */}
        <div className="card">
          <div className="card-header"><h2>Productos</h2></div>
          <div className="card-body">
            {productosFiltrados.length === 0 && !cargando ? (
              <p className="inv-subtle">{busqueda ? "No hay productos que coincidan con tu búsqueda." : "Aún no hay productos registrados."}</p>
            ) : (
              <>
                {!agrupar ? (
                  <ul className="product-list">
                    {productosFiltrados.map((p) => (
                      <li className="product-item" key={p.id}>
                        <div className="product-thumb">
                          {p.imagen ? <img src={p.imagen} alt={p.nombre} /> : <div className="placeholder">Sin imagen</div>}
                        </div>
                        <div className="product-info">
                          <div className="product-title-row">
                            <strong>{p.nombre}</strong>
                            {p.categoriaNombre && <span className="badge">{p.categoriaNombre}</span>}
                            {Number(p.cantidad) <= Number(p.minimo) && <span className="badge-danger">Stock bajo</span>}
                          </div>
                          <div className="product-meta">
                            <span>Cant: <b>{p.cantidad}</b></span>
                            <span>Mín: <b>{p.minimo}</b></span>
                            <span>Precio: <b>${p.precioUnitario?.toLocaleString() || "N/D"}</b></span>
                          </div>
                        </div>
                        <div className="product-actions">
                          <button className="btn btn-small" onClick={()=>cargarProductoParaEditar(p)}>Editar</button>
                          <button className="btn btn-small btn-danger" onClick={()=>eliminarProducto(p.id)}>Eliminar</button>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="category-groups">
                    {grupos?.map(g => (
                      <div key={g.nombre} className="category-block">
                        <div className="category-title">{g.nombre}</div>
                        <ul className="product-list">
                          {g.items.map(p => (
                            <li className="product-item" key={p.id}>
                              <div className="product-thumb">
                                {p.imagen ? <img src={p.imagen} alt={p.nombre} /> : <div className="placeholder">Sin imagen</div>}
                              </div>
                              <div className="product-info">
                                <div className="product-title-row">
                                  <strong>{p.nombre}</strong>
                                  {Number(p.cantidad) <= Number(p.minimo) && <span className="badge-danger">Stock bajo</span>}
                                </div>
                                <div className="product-meta">
                                  <span>Cant: <b>{p.cantidad}</b></span>
                                  <span>Mín: <b>{p.minimo}</b></span>
                                  <span>Precio: <b>${p.precioUnitario?.toLocaleString() || "N/D"}</b></span>
                                </div>
                              </div>
                              <div className="product-actions">
                                <button className="btn btn-small" onClick={()=>cargarProductoParaEditar(p)}>Editar</button>
                                <button className="btn btn-small btn-danger" onClick={()=>eliminarProducto(p.id)}>Eliminar</button>
                              </div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </section>

      {error && <div className="toast toast-error">{error}</div>}

      {/* FAB móvil: Nuevo producto */}
      <button className="fab" onClick={scrollToForm} aria-label="Nuevo producto">
        ➕ Nuevo
      </button>

      {/* Modal de confirmación de eliminación */}
      {confirmDelete.open && (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal-card">
            <h3>¿Eliminar producto?</h3>
            <p>Estás a punto de eliminar <strong>{confirmDelete.nombre}</strong>. Esta acción no se puede deshacer.</p>
            <div className="modal-actions">
              <button className="btn" onClick={cancelarEliminar}>Cancelar</button>
              <button className="btn btn-danger" onClick={() => ejecutarEliminarProducto(confirmDelete.id)}>Eliminar</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Nueva categoría */}
      {modalCategoria.open && (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal-card">
            <h3>Nueva categoría</h3>
            <p style={{ marginBottom: 10 }}>Escribe el nombre de la categoría.</p>
            <input
              autoFocus
              type="text"
              placeholder="Ej: Bebidas"
              value={modalCategoria.nombre}
              onChange={(e)=>setModalCategoria(s => ({...s, nombre: e.target.value}))}
              style={{
                width:"100%", padding:"10px 12px", borderRadius:10,
                background:"var(--card)", border:"1px solid var(--border)", color:"var(--text)", outline:"none", marginBottom:12
              }}
            />
            <div className="modal-actions">
              <button className="btn" onClick={cerrarModalCategoria}>Cancelar (Esc)</button>
              <button className="btn btn-primary" onClick={crearCategoria}>Crear (Enter)</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Inventario;