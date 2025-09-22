import { useEffect, useState, useRef } from "react";
import { db } from "../../firebase";
import {
  collection, getDocs, addDoc, deleteDoc, doc, updateDoc,
  query, orderBy, startAt, endAt
} from "firebase/firestore";
import { Link } from "react-router-dom";
import "./inventario.css";

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

  const [productos, setProductos] = useState([]);
  const [nuevoProducto, setNuevoProducto] = useState({
    nombre: "", cantidad: "", minimo: "", imagen: null, precio: ""
  });
  const [editandoId, setEditandoId] = useState(null);

  const [busqueda, setBusqueda] = useState("");
  const [debounced, setDebounced] = useState("");
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState(null);
  const [soloAlertas, setSoloAlertas] = useState(false);

  const inputCamaraRef = useRef(null);
  const inputGaleriaRef = useRef(null);
  const [preview, setPreview] = useState(null);
  const objectUrlRef = useRef(null);

  const [subiendo, setSubiendo] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  useEffect(() => { const id = setTimeout(() => setDebounced(busqueda), 300); return () => clearTimeout(id); }, [busqueda]);
  useEffect(() => () => { if (objectUrlRef.current) { URL.revokeObjectURL(objectUrlRef.current); objectUrlRef.current = null; } }, []);

  const obtenerProductos = async () => {
    const snapshot = await getDocs(collection(db, "productos"));
    setProductos(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
  };
  const buscarPorPrefijo = async (texto) => {
    const t = (texto || "").trim().toLowerCase();
    if (!t) return [];
    const qy = query(collection(db, "productos"), orderBy("nombreLower"), startAt(t), endAt(t + "\uf8ff"));
    const snap = await getDocs(qy);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  };

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

      const productoData = {
        nombre: nuevoProducto.nombre,
        nombreLower: (nuevoProducto.nombre || "").trim().toLowerCase(),
        cantidad: parseInt(nuevoProducto.cantidad),
        minimo: parseInt(nuevoProducto.minimo),
        imagen: urlImagen || null,
        precioUnitario: parseFloat(nuevoProducto.precio)
      };

      if (editandoId) { await updateDoc(doc(db,"productos",editandoId), productoData); setEditandoId(null); }
      else { await addDoc(collection(db,"productos"), productoData); }

      quitarImagen();
      setNuevoProducto({ nombre:"", cantidad:"", minimo:"", imagen:null, precio:"" });
      setUploadProgress(0); setSubiendo(false);

      if (debounced.trim()) setProductos(await buscarPorPrefijo(debounced));
      else await obtenerProductos();
    } catch (err) {
      console.error(err); setError("No se pudo guardar el producto."); setSubiendo(false);
    }
  };

  const eliminarProducto = async (id) => {
    try {
      setError(null);
      await deleteDoc(doc(db,"productos",id));
      if (debounced.trim()) setProductos(await buscarPorPrefijo(debounced));
      else await obtenerProductos();
    } catch (err) { console.error(err); setError("No se pudo eliminar el producto."); }
  };

  const cargarProductoParaEditar = (p) => {
    if (objectUrlRef.current) { URL.revokeObjectURL(objectUrlRef.current); objectUrlRef.current = null; }
    setPreview(p.imagen || null);
    setNuevoProducto({ nombre:p.nombre, cantidad:p.cantidad, minimo:p.minimo, imagen:p.imagen || null, precio:p.precioUnitario || "" });
    setEditandoId(p.id);
    window.scrollTo(0,0);
  };

  useEffect(()=>{ setCargando(true); obtenerProductos().finally(()=>setCargando(false)); },[]);
  useEffect(()=>{ (async()=>{ setCargando(true); setError(null);
    try { debounced.trim() ? setProductos(await buscarPorPrefijo(debounced)) : await obtenerProductos(); }
    catch(e){ console.error(e); setError("No se pudieron cargar los productos."); }
    finally{ setCargando(false); }
  })(); },[debounced]);

  const productosVisibles = productos.filter(p => !soloAlertas || Number(p.cantidad) <= Number(p.minimo));

  return (
    <div className="inv-root">
      {/* Header con toggle de tema */}
      <header className="inv-header">
        <div>
          <h1>Inventario de TEK</h1>
          <p className="inv-subtle">
            {busqueda ? `Resultados: ${productosVisibles.length}` : `Productos: ${productosVisibles.length}`}
            {cargando ? " • Cargando..." : ""}
          </p>
        </div>
        <div className="header-actions">
          <button className="btn theme-toggle" onClick={toggle} aria-label="Cambiar tema">
            {theme === "dark" ? "☀️ Claro" : "🌙 Oscuro"}
          </button>
          <Link to="/ventas" className="btn btn-primary">Registrar venta 🧾</Link>
        </div>
      </header>

      {/* Toolbar */}
      <section className="inv-toolbar">
        <div className="input-with-icon">
          <span className="icon">🔎</span>
          <input
            type="text"
            placeholder="Buscar producto por nombre…"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
          />
        </div>

        <label className="checkbox">
          <input type="checkbox" checked={soloAlertas} onChange={(e)=>setSoloAlertas(e.target.checked)} />
          <span>Solo stock bajo</span>
        </label>
      </section>

      {/* Grid principal */}
      <section className="inv-grid">
        {/* Card formulario */}
        <div className="card">
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
            {productosVisibles.length === 0 && !cargando ? (
              <p className="inv-subtle">{busqueda ? "No hay productos que coincidan con tu búsqueda." : "Aún no hay productos registrados."}</p>
            ) : (
              <ul className="product-list">
                {productosVisibles.map((p) => (
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
            )}
          </div>
        </div>
      </section>

      {error && <div className="toast toast-error">{error}</div>}
    </div>
  );
}

export default Inventario;


