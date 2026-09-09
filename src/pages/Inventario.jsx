// src/pages/Inventario.jsx

import {
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";

import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  runTransaction,
  serverTimestamp,
  updateDoc
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
   NÚMEROS
========================================================= */

const numericFields = new Set([
  "minimo",
  "precio",
  "costo"
]);

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

const formatearNumero = value => {
  const limpio =
    limpiarNumero(value);

  if (!limpio) {
    return "";
  }

  return Number(limpio)
    .toLocaleString("es-CO");
};

const formatearCantidad = value =>
  Number(value || 0)
    .toLocaleString("es-CO");

const formatearMoneda = value =>
  `$${Number(value || 0).toLocaleString("es-CO", {
    maximumFractionDigits: 0
  })}`;

/* =========================================================
   PRECIO MÍNIMO
========================================================= */

function obtenerPrecioMinimo(producto) {
  const guardado =
    Number(
      producto?.precioMinimo
    );

  if (
    Number.isFinite(guardado) &&
    guardado > 0
  ) {
    return Math.round(
      guardado
    );
  }

  const costo =
    Number(
      producto?.costoPromedio ??
      producto?.costoUnitario ??
      0
    );

  const porcentaje =
    Number(
      producto?.porcentajeGananciaMinima
    );

  if (
    costo > 0 &&
    Number.isFinite(porcentaje) &&
    porcentaje >= 0
  ) {
    return Math.round(
      costo *
      (
        1 +
        porcentaje / 100
      )
    );
  }

  return Math.round(
    Number(
      producto?.precioUnitario ||
      0
    )
  );
}

/* =========================================================
   IMAGEN
========================================================= */

function dataURLtoFile(
  dataUrl,
  filename
) {
  const arr =
    dataUrl.split(",");

  const mime =
    arr[0]
      .match(/:(.*?);/)?.[1] ||
    "image/jpeg";

  const bstr =
    atob(arr[1]);

  let n =
    bstr.length;

  const u8 =
    new Uint8Array(n);

  while (n--) {
    u8[n] =
      bstr.charCodeAt(n);
  }

  return new File(
    [u8],
    filename,
    {
      type: mime
    }
  );
}

async function comprimirImagen(
  file,
  {
    maxWidth = 1200,
    maxHeight = 1200,
    quality = 0.8,
    outputType = "image/jpeg"
  } = {}
) {
  const img =
    await new Promise(
      (resolve, reject) => {
        const url =
          URL.createObjectURL(
            file
          );

        const imagen =
          new Image();

        imagen.onload = () => {
          URL.revokeObjectURL(
            url
          );

          resolve(
            imagen
          );
        };

        imagen.onerror =
          reject;

        imagen.src =
          url;
      }
    );

  const ratio =
    Math.min(
      maxWidth /
        img.width,

      maxHeight /
        img.height,

      1
    );

  const width =
    Math.round(
      img.width *
      ratio
    );

  const height =
    Math.round(
      img.height *
      ratio
    );

  const canvas =
    document.createElement(
      "canvas"
    );

  canvas.width =
    width;

  canvas.height =
    height;

  const ctx =
    canvas.getContext(
      "2d"
    );

  ctx.drawImage(
    img,
    0,
    0,
    width,
    height
  );

  const dataUrl =
    canvas.toDataURL(
      outputType,
      quality
    );

  const base =
    file.name.replace(
      /\.[^/.]+$/,
      ""
    );

  return dataURLtoFile(
    dataUrl,
    `${base}.jpg`
  );
}

function subirImagenAImgBBConProgreso(
  file,
  onProgress
) {
  const API_KEY =
    import.meta.env
      ?.VITE_IMGBB_API_KEY ||
    "";

  return new Promise(
    (resolve, reject) => {
      if (!API_KEY) {
        reject(
          new Error(
            "Falta VITE_IMGBB_API_KEY"
          )
        );

        return;
      }

      const formData =
        new FormData();

      formData.append(
        "image",
        file
      );

      const xhr =
        new XMLHttpRequest();

      xhr.open(
        "POST",
        `https://api.imgbb.com/1/upload?key=${API_KEY}`
      );

      xhr.upload.onprogress =
        event => {
          if (
            event.lengthComputable &&
            onProgress
          ) {
            onProgress(
              Math.round(
                (
                  event.loaded /
                  event.total
                ) *
                100
              )
            );
          }
        };

      xhr.onload = () => {
        try {
          const result =
            JSON.parse(
              xhr.responseText
            );

          if (
            result?.data?.url
          ) {
            resolve(
              result.data.url
            );

            return;
          }

          reject(
            new Error(
              "Respuesta ImgBB inválida."
            )
          );

        } catch (error) {
          reject(
            error
          );
        }
      };

      xhr.onerror = () =>
        reject(
          new Error(
            "Fallo de red."
          )
        );

      xhr.send(
        formData
      );
    }
  );
}

/* =========================================================
   COMPONENTE
========================================================= */

function Inventario() {
  const {
    theme,
    toggle
  } = useTheme();

  const {
    empresa,
    user
  } = useTenant();

  /* =======================================================
     DATOS
  ======================================================= */

  const [
    productos,
    setProductos
  ] = useState([]);

  const [
    categorias,
    setCategorias
  ] = useState([]);

  const [
    empresaInfo,
    setEmpresaInfo
  ] = useState(null);

  const [
    rolActual,
    setRolActual
  ] = useState(null);

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

  /* =======================================================
     FILTROS
  ======================================================= */

  const [
    busqueda,
    setBusqueda
  ] = useState("");

  const [
    filtroCategoria,
    setFiltroCategoria
  ] = useState("ALL");

  const [
    filtroEstado,
    setFiltroEstado
  ] = useState("ALL");

  /*
   * ACTIVE = productos disponibles para operar
   * INACTIVE = productos retirados temporalmente
   * ALL = ambos
   *
   * Los productos antiguos sin campo "activo"
   * se consideran activos automáticamente.
   */
  const [
    filtroActividad,
    setFiltroActividad
  ] = useState("ACTIVE");

  const [
    agrupar,
    setAgrupar
  ] = useState(false);

  /* =======================================================
     MODAL PRODUCTO
  ======================================================= */

  const [
    modalProducto,
    setModalProducto
  ] = useState(false);

  const [
    editandoId,
    setEditandoId
  ] = useState(null);

  const [
    productoForm,
    setProductoForm
  ] = useState({
    nombre: "",
    minimo: "",
    imagen: null,
    precio: "",
    costo: "",
    categoriaId: ""
  });

  /* =======================================================
     IMAGEN
  ======================================================= */

  const inputCamaraRef =
    useRef(null);

  const inputGaleriaRef =
    useRef(null);

  const objectUrlRef =
    useRef(null);

  const [
    preview,
    setPreview
  ] = useState(null);

  const [
    subiendo,
    setSubiendo
  ] = useState(false);

  const [
    uploadProgress,
    setUploadProgress
  ] = useState(0);

  /* =======================================================
     MODAL CATEGORÍA
  ======================================================= */

  const [
    modalCategoria,
    setModalCategoria
  ] = useState({
    open: false,
    nombre: ""
  });

  /* =======================================================
     MODAL AJUSTE
  ======================================================= */

  const [
    modalAjuste,
    setModalAjuste
  ] = useState({
    open: false,
    producto: null,
    nuevoStock: "",
    motivo: "",
    observacion: ""
  });

  const [
    guardandoAjuste,
    setGuardandoAjuste
  ] = useState(false);

  /* =======================================================
     MODAL ACTIVAR / DESACTIVAR
  ======================================================= */

  const [
    modalEstadoProducto,
    setModalEstadoProducto
  ] = useState({
    open: false,
    producto: null
  });

  const [
    guardandoEstadoProducto,
    setGuardandoEstadoProducto
  ] = useState(false);

  /* =======================================================
     COLECCIONES
  ======================================================= */

  const productosCol =
    useMemo(() => {
      if (!empresa?.id) {
        return null;
      }

      return collection(
        db,
        "empresas",
        empresa.id,
        "productos"
      );
    }, [
      empresa?.id
    ]);

  const categoriasCol =
    useMemo(() => {
      if (!empresa?.id) {
        return null;
      }

      return collection(
        db,
        "empresas",
        empresa.id,
        "categorias"
      );
    }, [
      empresa?.id
    ]);

  /* =======================================================
     PERMISOS INTERFAZ
  ======================================================= */

  const puedeGestionar =
    useMemo(() => {
      if (!user?.uid) {
        return false;
      }

      if (
        empresaInfo?.ownerId ===
        user.uid
      ) {
        return true;
      }

      return [
        "owner",
        "admin"
      ].includes(
        rolActual
      );
    }, [
      empresaInfo,
      rolActual,
      user?.uid
    ]);

  /* =======================================================
     LIMPIAR OBJECT URL
  ======================================================= */

  useEffect(() => {
    return () => {
      if (
        objectUrlRef.current
      ) {
        URL.revokeObjectURL(
          objectUrlRef.current
        );

        objectUrlRef.current =
          null;
      }
    };
  }, []);

  /* =======================================================
     EMPRESA + ROL
  ======================================================= */

  useEffect(() => {
    (async () => {
      if (
        !empresa?.id ||
        !user?.uid
      ) {
        return;
      }

      try {
        const empresaSnap =
          await getDoc(
            doc(
              db,
              "empresas",
              empresa.id
            )
          );

        const info =
          empresaSnap.exists()
            ? empresaSnap.data()
            : {};

        setEmpresaInfo(
          info
        );

        if (
          info?.ownerId ===
          user.uid
        ) {
          setRolActual(
            "owner"
          );

          return;
        }

        const miembroSnap =
          await getDoc(
            doc(
              db,
              "empresas",
              empresa.id,
              "miembros",
              user.uid
            )
          );

        setRolActual(
          miembroSnap.exists()
            ? miembroSnap.data()
                ?.rol ||
                "member"
            : "member"
        );

      } catch (e) {
        console.error(
          "Error cargando empresa/rol:",
          e
        );
      }
    })();
  }, [
    empresa?.id,
    user?.uid
  ]);

  /* =======================================================
     CARGAR PRODUCTOS
  ======================================================= */

  const obtenerProductos =
    async () => {
      if (!productosCol) {
        return;
      }

      const snap =
        await getDocs(
          productosCol
        );

      const lista =
        snap.docs.map(
          d => ({
            id: d.id,
            ...d.data()
          })
        );

      lista.sort(
        (a, b) =>
          (
            a.nombre ||
            ""
          ).localeCompare(
            b.nombre ||
            ""
          )
      );

      setProductos(
        lista
      );
    };

  useEffect(() => {
    if (!productosCol) {
      return;
    }

    (async () => {
      try {
        setCargando(
          true
        );

        setError(
          ""
        );

        await obtenerProductos();

      } catch (e) {
        console.error(e);

        setError(
          "No se pudieron cargar los productos."
        );

      } finally {
        setCargando(
          false
        );
      }
    })();

  }, [
    productosCol
  ]);

  /* =======================================================
     CARGAR CATEGORÍAS
  ======================================================= */

  const cargarCategorias =
    async () => {
      if (!categoriasCol) {
        return;
      }

      const snap =
        await getDocs(
          categoriasCol
        );

      const lista =
        snap.docs.map(
          d => ({
            id: d.id,
            ...d.data()
          })
        );

      lista.sort(
        (a, b) =>
          (
            a.nombre ||
            ""
          ).localeCompare(
            b.nombre ||
            ""
          )
      );

      setCategorias(
        lista
      );
    };

  useEffect(() => {
    if (!categoriasCol) {
      return;
    }

    cargarCategorias();

  }, [
    categoriasCol
  ]);

  /* =======================================================
     RESUMEN DEL INVENTARIO
  ======================================================= */

  const resumen =
    useMemo(() => {
      /*
       * Los documentos antiguos no tienen "activo".
       * Solo activo === false significa inactivo.
       */
      const activos =
        productos.filter(
          p =>
            p.activo !== false
        );

      const inactivos =
        productos.length -
        activos.length;

      const totalProductos =
        activos.length;

      const unidades =
        activos.reduce(
          (acc, p) =>
            acc +
            Number(
              p.cantidad ||
              0
            ),
          0
        );

      const stockBajo =
        activos.filter(
          p =>
            Number(
              p.cantidad ||
              0
            ) <=
            Number(
              p.minimo ||
              0
            )
        ).length;

      const sinStock =
        activos.filter(
          p =>
            Number(
              p.cantidad ||
              0
            ) <= 0
        ).length;

      const valorInventario =
        activos.reduce(
          (acc, p) => {
            const cantidad =
              Number(
                p.cantidad ||
                0
              );

            const costo =
              Number(
                p.costoPromedio ??
                p.costoUnitario ??
                0
              );

            return (
              acc +
              cantidad *
              costo
            );
          },
          0
        );

      return {
        totalProductos,
        inactivos,
        unidades,
        stockBajo,
        sinStock,
        valorInventario
      };

    }, [
      productos
    ]);

  /* =======================================================
     FILTRAR
  ======================================================= */

  const productosFiltrados =
    useMemo(() => {
      const q =
        busqueda
          .trim()
          .toLowerCase();

      return productos.filter(
        producto => {
          const activo =
            producto.activo !== false;

          if (
            filtroActividad ===
              "ACTIVE" &&
            !activo
          ) {
            return false;
          }

          if (
            filtroActividad ===
              "INACTIVE" &&
            activo
          ) {
            return false;
          }

          if (q) {
            const texto =
              `${producto.nombre || ""} ${producto.categoriaNombre || ""}`
                .toLowerCase();

            if (
              !texto.includes(q)
            ) {
              return false;
            }
          }

          if (
            filtroCategoria ===
            "NONE"
          ) {
            if (
              producto.categoriaId
            ) {
              return false;
            }
          } else if (
            filtroCategoria !==
            "ALL"
          ) {
            if (
              producto.categoriaId !==
              filtroCategoria
            ) {
              return false;
            }
          }

          const cantidad =
            Number(
              producto.cantidad ||
              0
            );

          const minimo =
            Number(
              producto.minimo ||
              0
            );

          if (
            filtroEstado ===
            "LOW"
          ) {
            return (
              cantidad > 0 &&
              cantidad <= minimo
            );
          }

          if (
            filtroEstado ===
            "OUT"
          ) {
            return (
              cantidad <= 0
            );
          }

          return true;
        }
      );

    }, [
      productos,
      busqueda,
      filtroCategoria,
      filtroEstado,
      filtroActividad
    ]);

  /* =======================================================
     AGRUPACIÓN
  ======================================================= */

  const grupos =
    useMemo(() => {
      if (!agrupar) {
        return null;
      }

      const map =
        new Map();

      for (
        const producto
        of productosFiltrados
      ) {
        const nombre =
          producto
            .categoriaNombre ||
          "Sin categoría";

        if (
          !map.has(nombre)
        ) {
          map.set(
            nombre,
            []
          );
        }

        map
          .get(nombre)
          .push(
            producto
          );
      }

      return Array
        .from(
          map.entries()
        )
        .map(
          ([
            nombre,
            items
          ]) => ({
            nombre,
            items
          })
        );

    }, [
      agrupar,
      productosFiltrados
    ]);

  /* =======================================================
     IMAGEN
  ======================================================= */

  const limpiarPreview =
    () => {
      if (
        objectUrlRef.current
      ) {
        URL.revokeObjectURL(
          objectUrlRef.current
        );

        objectUrlRef.current =
          null;
      }

      setPreview(
        null
      );

      if (
        inputCamaraRef.current
      ) {
        inputCamaraRef.current.value =
          "";
      }

      if (
        inputGaleriaRef.current
      ) {
        inputGaleriaRef.current.value =
          "";
      }
    };

  const handleFileChange =
    event => {
      const file =
        event.target.files?.[0];

      if (!file) {
        return;
      }

      if (
        objectUrlRef.current
      ) {
        URL.revokeObjectURL(
          objectUrlRef.current
        );
      }

      const url =
        URL.createObjectURL(
          file
        );

      objectUrlRef.current =
        url;

      setPreview(
        url
      );

      setProductoForm(
        prev => ({
          ...prev,
          imagen: file
        })
      );
    };

  const quitarImagen =
    () => {
      limpiarPreview();

      setProductoForm(
        prev => ({
          ...prev,
          imagen: null
        })
      );
    };

  /* =======================================================
     FORMULARIO PRODUCTO
  ======================================================= */

  const handleChange =
    event => {
      const {
        name,
        value
      } =
        event.target;

      setProductoForm(
        prev => ({
          ...prev,

          [name]:
            numericFields.has(
              name
            )
              ? formatearNumero(
                  value
                )
              : value
        })
      );
    };

  const resetProductoForm =
    () => {
      limpiarPreview();

      setEditandoId(
        null
      );

      setProductoForm({
        nombre: "",
        minimo: "",
        imagen: null,
        precio: "",
        costo: "",
        categoriaId: ""
      });

      setUploadProgress(
        0
      );

      setSubiendo(
        false
      );
    };

  const abrirNuevoProducto =
    () => {
      if (!puedeGestionar) {
        return;
      }

      setError("");
      setExito("");

      resetProductoForm();

      setModalProducto(
        true
      );
    };

  const abrirEditarProducto =
    producto => {
      if (!puedeGestionar) {
        return;
      }

      limpiarPreview();

      setEditandoId(
        producto.id
      );

      setPreview(
        producto.imagen ||
        null
      );

      setProductoForm({
        nombre:
          producto.nombre ||
          "",

        minimo:
          formatearNumero(
            producto.minimo ??
            0
          ),

        imagen:
          producto.imagen ||
          null,

        precio:
          formatearNumero(
            producto.precioUnitario ??
            0
          ),

        costo:
          formatearNumero(
            producto.costoPromedio ??
            producto.costoUnitario ??
            0
          ),

        categoriaId:
          producto.categoriaId ||
          ""
      });

      setError("");
      setExito("");

      setModalProducto(
        true
      );
    };

  const cerrarModalProducto =
    () => {
      setModalProducto(
        false
      );

      resetProductoForm();
    };

  /* =======================================================
     GUARDAR PRODUCTO
  ======================================================= */

  const guardarProducto =
    async () => {
      if (
        !productosCol ||
        !empresa?.id
      ) {
        return;
      }

      if (!puedeGestionar) {
        return setError(
          "No tienes permisos para modificar productos."
        );
      }

      const nombre =
        productoForm.nombre
          .trim();

      const minimo =
        numeroDesdeInput(
          productoForm.minimo
        );

      const precio =
        numeroDesdeInput(
          productoForm.precio
        );

      const costo =
        numeroDesdeInput(
          productoForm.costo
        );

      if (!nombre) {
        return setError(
          "Ingresa el nombre del producto."
        );
      }

      if (minimo < 0) {
        return setError(
          "El stock mínimo no puede ser negativo."
        );
      }

      if (precio < 0) {
        return setError(
          "El precio no puede ser negativo."
        );
      }

      const productoActual =
        editandoId
          ? productos.find(
              p =>
                p.id ===
                editandoId
            )
          : null;

      if (
        productoActual
      ) {
        const precioMinimo =
          obtenerPrecioMinimo(
            productoActual
          );

        if (
          precioMinimo > 0 &&
          precio <
          precioMinimo
        ) {
          return setError(
            `El precio de venta no puede quedar por debajo del precio mínimo de ${formatearMoneda(
              precioMinimo
            )}.`
          );
        }
      }

      try {
        setError("");
        setExito("");

        let urlImagen =
          typeof productoForm.imagen ===
          "string"
            ? productoForm.imagen
            : "";

        if (
          productoForm.imagen &&
          typeof productoForm.imagen !==
            "string"
        ) {
          const comprimida =
            await comprimirImagen(
              productoForm.imagen
            );

          setSubiendo(
            true
          );

          setUploadProgress(
            0
          );

          urlImagen =
            await subirImagenAImgBBConProgreso(
              comprimida,
              setUploadProgress
            );
        }

        const categoria =
          categorias.find(
            c =>
              c.id ===
              productoForm.categoriaId
          );

        const datosBase = {
          nombre,

          nombreLower:
            nombre.toLowerCase(),

          minimo,

          imagen:
            urlImagen ||
            null,

          precioUnitario:
            precio,

          categoriaId:
            productoForm.categoriaId ||
            "",

          categoriaNombre:
            categoria?.nombre ||
            null,

          actualizadoEn:
            serverTimestamp()
        };

        if (
          editandoId
        ) {
          /*
           * MUY IMPORTANTE:
           *
           * No mandamos "cantidad".
           * Editar producto jamás toca stock.
           *
           * Tampoco modificamos el costo,
           * porque ahora Compras controla el
           * costo promedio real del producto.
           */

          await updateDoc(
            doc(
              db,
              "empresas",
              empresa.id,
              "productos",
              editandoId
            ),
            datosBase
          );

          setExito(
            "Producto actualizado correctamente."
          );

        } else {
          /*
           * Un producto nuevo empieza con stock 0.
           * La existencia entra por compra o ajuste.
           */

          await addDoc(
            productosCol,
            {
              ...datosBase,

              cantidad: 0,

              costoUnitario:
                costo,

              costoPromedio:
                costo,

              /*
               * Todo producto nuevo nace activo.
               */
              activo: true
            }
          );

          setExito(
            "Producto creado correctamente. Su stock inicial es 0."
          );
        }

        await obtenerProductos();

        cerrarModalProducto();

      } catch (e) {
        console.error(e);

        setError(
          e?.message ||
          "No se pudo guardar el producto."
        );

      } finally {
        setSubiendo(
          false
        );

        setUploadProgress(
          0
        );
      }
    };

  /* =======================================================
     CATEGORÍAS
  ======================================================= */

  const abrirModalCategoria =
    () => {
      if (!puedeGestionar) {
        return;
      }

      setModalCategoria({
        open: true,
        nombre: ""
      });
    };

  const cerrarModalCategoria =
    () =>
      setModalCategoria({
        open: false,
        nombre: ""
      });

  const crearCategoria =
    async () => {
      if (
        !categoriasCol ||
        !puedeGestionar
      ) {
        return;
      }

      try {
        const nombre =
          modalCategoria.nombre
            .trim();

        if (!nombre) {
          return;
        }

        const nombreLower =
          nombre.toLowerCase();

        const existe =
          categorias.some(
            categoria =>
              (
                categoria.nombreLower ||
                categoria.nombre
                  ?.toLowerCase()
              ) ===
              nombreLower
          );

        if (existe) {
          return setError(
            "Esta categoría ya existe."
          );
        }

        await addDoc(
          categoriasCol,
          {
            nombre,

            nombreLower,

            creadoEn:
              serverTimestamp()
          }
        );

        await cargarCategorias();

        cerrarModalCategoria();

        setExito(
          "Categoría creada."
        );

      } catch (e) {
        console.error(e);

        setError(
          "No se pudo crear la categoría."
        );
      }
    };

  /* =======================================================
     ACTIVAR / DESACTIVAR PRODUCTO
  ======================================================= */

  const abrirModalEstadoProducto =
    producto => {
      if (
        !producto ||
        !empresa?.id
      ) {
        return;
      }

      if (!puedeGestionar) {
        return setError(
          "No tienes permisos para cambiar el estado del producto."
        );
      }

      setError("");
      setExito("");

      setModalEstadoProducto({
        open: true,
        producto
      });
    };

  const cerrarModalEstadoProducto =
    () => {
      if (
        guardandoEstadoProducto
      ) {
        return;
      }

      setModalEstadoProducto({
        open: false,
        producto: null
      });
    };

  const confirmarCambioEstadoProducto =
    async () => {
      const producto =
        modalEstadoProducto.producto;

      if (
        !producto ||
        !empresa?.id ||
        guardandoEstadoProducto
      ) {
        return;
      }

      if (!puedeGestionar) {
        return setError(
          "No tienes permisos para cambiar el estado del producto."
        );
      }

      const estaActivo =
        producto.activo !== false;

      try {
        setGuardandoEstadoProducto(
          true
        );

        setError("");
        setExito("");

        await updateDoc(
          doc(
            db,
            "empresas",
            empresa.id,
            "productos",
            producto.id
          ),
          {
            activo:
              !estaActivo,

            actualizadoEn:
              serverTimestamp(),

            estadoActualizadoPorId:
              user?.uid ||
              null,

            estadoActualizadoPorEmail:
              user?.email ||
              null,

            desactivadoEn:
              estaActivo
                ? serverTimestamp()
                : null,

            reactivadoEn:
              estaActivo
                ? null
                : serverTimestamp()
          }
        );

        await obtenerProductos();

        setModalEstadoProducto({
          open: false,
          producto: null
        });

        setExito(
          estaActivo
            ? `"${producto.nombre}" fue desactivado. Ya no aparecerá en Ventas ni Compras.`
            : `"${producto.nombre}" fue reactivado y vuelve a estar disponible.`
        );

      } catch (e) {
        console.error(e);

        setError(
          e?.message ||
          "No se pudo cambiar el estado del producto."
        );

      } finally {
        setGuardandoEstadoProducto(
          false
        );
      }
    };

  /* =======================================================
     AJUSTAR INVENTARIO
  ======================================================= */

  const abrirAjuste =
    producto => {
      if (!puedeGestionar) {
        return;
      }

      if (
        producto?.activo ===
        false
      ) {
        return setError(
          "Reactiva el producto antes de realizar ajustes de inventario."
        );
      }

      setError("");
      setExito("");

      setModalAjuste({
        open: true,
        producto,

        nuevoStock:
          formatearNumero(
            producto.cantidad ??
            0
          ),

        motivo: "",

        observacion: ""
      });
    };

  const cerrarAjuste =
    () => {
      setModalAjuste({
        open: false,
        producto: null,
        nuevoStock: "",
        motivo: "",
        observacion: ""
      });
    };

  const guardarAjuste =
    async () => {
      if (
        !modalAjuste.producto ||
        !empresa?.id
      ) {
        return;
      }

      if (!puedeGestionar) {
        return setError(
          "No tienes permisos para ajustar inventario."
        );
      }

      if (
        guardandoAjuste
      ) {
        return;
      }

      const nuevoStock =
        numeroDesdeInput(
          modalAjuste.nuevoStock
        );

      if (
        !Number.isInteger(
          nuevoStock
        ) ||
        nuevoStock < 0
      ) {
        return setError(
          "El nuevo stock debe ser un número entero igual o mayor que cero."
        );
      }

      if (
        !modalAjuste.motivo
      ) {
        return setError(
          "Selecciona el motivo del ajuste."
        );
      }

      if (
        modalAjuste.motivo ===
          "OTRO" &&
        !modalAjuste
          .observacion
          .trim()
      ) {
        return setError(
          "Describe el motivo del ajuste."
        );
      }

      try {
        setGuardandoAjuste(
          true
        );

        setError("");
        setExito("");

        const productoRef =
          doc(
            db,
            "empresas",
            empresa.id,
            "productos",
            modalAjuste
              .producto
              .id
          );

        await runTransaction(
          db,
          async transaction => {
            const snap =
              await transaction.get(
                productoRef
              );

            if (
              !snap.exists()
            ) {
              throw new Error(
                "El producto ya no existe."
              );
            }

            const productoActual =
              snap.data();

            if (
              productoActual.activo ===
              false
            ) {
              throw new Error(
                "El producto está inactivo. Reactívalo antes de ajustar su inventario."
              );
            }

            const stockAnterior =
              Number(
                productoActual
                  .cantidad ||
                0
              );

            if (
              stockAnterior ===
              nuevoStock
            ) {
              throw new Error(
                "El nuevo stock es igual al stock actual."
              );
            }

            const diferencia =
              nuevoStock -
              stockAnterior;

            transaction.update(
              productoRef,
              {
                cantidad:
                  nuevoStock,

                actualizadoEn:
                  serverTimestamp()
              }
            );

            const movimientoRef =
              doc(
                collection(
                  db,
                  "empresas",
                  empresa.id,
                  "movimientos"
                )
              );

            transaction.set(
              movimientoRef,
              {
                tipo:
                  "AJUSTE",

                productoId:
                  modalAjuste
                    .producto
                    .id,

                productoNombre:
                  productoActual
                    .nombre ||
                  modalAjuste
                    .producto
                    .nombre,

                /*
                 * Guardamos diferencia con signo:
                 *
                 * +3 = entraron 3
                 * -2 = salieron 2
                 */
                cantidad:
                  diferencia,

                stockAnterior,

                stockNuevo:
                  nuevoStock,

                diferencia,

                motivo:
                  modalAjuste
                    .motivo,

                observacion:
                  modalAjuste
                    .observacion
                    .trim() ||
                  null,

                usuarioId:
                  user?.uid ||
                  null,

                usuarioEmail:
                  user?.email ||
                  null,

                fecha:
                  serverTimestamp()
              }
            );
          }
        );

        await obtenerProductos();

        cerrarAjuste();

        setExito(
          "Ajuste de inventario registrado correctamente."
        );

      } catch (e) {
        console.error(e);

        setError(
          e?.message ||
          "No se pudo realizar el ajuste."
        );

      } finally {
        setGuardandoAjuste(
          false
        );
      }
    };

  /* =======================================================
     DIFERENCIA AJUSTE
  ======================================================= */

  const diferenciaAjuste =
    useMemo(() => {
      if (
        !modalAjuste.producto
      ) {
        return 0;
      }

      return (
        numeroDesdeInput(
          modalAjuste.nuevoStock
        ) -
        Number(
          modalAjuste
            .producto
            .cantidad ||
          0
        )
      );

    }, [
      modalAjuste
    ]);

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
                width: 42,
                height: 42,
                borderRadius: 10,
                objectFit: "cover",
                border:
                  "1px solid var(--border)"
              }}
            />

          )}

          <div>

            <h1
              style={{
                marginBottom: 2
              }}
            >
              📦 Inventario
            </h1>

            <p className="inv-subtle">

              {empresaInfo?.nombre
                ? `${empresaInfo.nombre} • `
                : ""}

              {empresaInfo?.nit
                ? `NIT: ${empresaInfo.nit}`
                : "Control de existencias"}

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
            onClick={toggle}
          >
            {theme === "dark"
              ? "☀️ Claro"
              : "🌙 Oscuro"}
          </button>

          <Link
            to="/ventas"
            className="btn btn-primary"
          >
            Registrar venta 🧾
          </Link>

          <AppMenu />

        </div>

      </header>

      {/* =====================================================
          RESUMEN
      ===================================================== */}

      <section
        style={{
          display: "grid",
          gridTemplateColumns:
            "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 12,
          marginBottom: 18
        }}
      >

        <ResumenCard
          icono="📦"
          titulo="Productos"
          valor={
            formatearCantidad(
              resumen.totalProductos
            )
          }
          detalle={
            resumen.inactivos > 0
              ? `${resumen.inactivos} producto(s) inactivo(s)`
              : "Referencias activas"
          }
        />

        <ResumenCard
          icono="🧮"
          titulo="Unidades"
          valor={
            formatearCantidad(
              resumen.unidades
            )
          }
          detalle="Existencias actuales"
        />

        <ResumenCard
          icono="⚠️"
          titulo="Stock bajo"
          valor={
            formatearCantidad(
              resumen.stockBajo
            )
          }
          detalle={
            resumen.sinStock > 0
              ? `${resumen.sinStock} sin stock`
              : "Sin faltantes"
          }
          color={
            resumen.stockBajo > 0
              ? "#f59e0b"
              : "#22c55e"
          }
        />

        <ResumenCard
          icono="💰"
          titulo="Valor del inventario"
          valor={
            formatearMoneda(
              resumen.valorInventario
            )
          }
          detalle="Estimado según costo promedio"
        />

      </section>

      {/* =====================================================
          CONTROLES
      ===================================================== */}

      <div
        className="card"
        style={{
          marginBottom: 18
        }}
      >

        <div
          className="card-body"
          style={{
            padding: 14
          }}
        >

          <div
            style={{
              display: "grid",
              gridTemplateColumns:
                "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 12,
              alignItems: "end"
            }}
          >

            {/* BUSCAR */}

            <div className="form-field">

              <label>
                Buscar producto
              </label>

              <div className="input-with-icon">

                <span className="icon">
                  🔎
                </span>

                <input
                  type="text"
                  placeholder="Nombre o categoría..."
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

            {/* CATEGORÍA */}

            <div className="form-field">

              <label>
                Categoría
              </label>

              <select
                value={
                  filtroCategoria
                }
                onChange={e =>
                  setFiltroCategoria(
                    e.target.value
                  )
                }
              >

                <option value="ALL">
                  Todas las categorías
                </option>

                <option value="NONE">
                  Sin categoría
                </option>

                {categorias.map(
                  categoria => (

                    <option
                      key={
                        categoria.id
                      }
                      value={
                        categoria.id
                      }
                    >
                      {categoria.nombre}
                    </option>

                  )
                )}

              </select>

            </div>

            {/* ACCIONES */}

            <div
              style={{
                display: "flex",
                gap: 8,
                flexWrap: "wrap"
              }}
            >

              {puedeGestionar && (

                <button
                  className="btn btn-primary"
                  onClick={
                    abrirNuevoProducto
                  }
                  style={{
                    flex: 1,
                    justifyContent:
                      "center",
                    minWidth: 150
                  }}
                >
                  ➕ Nuevo producto
                </button>

              )}

              {puedeGestionar && (

                <button
                  className="btn"
                  onClick={
                    abrirModalCategoria
                  }
                  title="Crear categoría"
                >
                  🏷️
                </button>

              )}

              <button
                className="btn"
                onClick={() =>
                  setAgrupar(
                    actual =>
                      !actual
                  )
                }
              >
                {agrupar
                  ? "☷ Lista"
                  : "▦ Agrupar"}
              </button>

            </div>

          </div>

          {/* FILTROS RÁPIDOS */}

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

            <span
              className="inv-subtle"
              style={{
                alignSelf: "center",
                fontSize: 12,
                fontWeight: 700
              }}
            >
              Estado:
            </span>

            <FiltroButton
              activo={
                filtroActividad ===
                "ACTIVE"
              }
              onClick={() =>
                setFiltroActividad(
                  "ACTIVE"
                )
              }
            >
              🟢 Activos
            </FiltroButton>

            <FiltroButton
              activo={
                filtroActividad ===
                "INACTIVE"
              }
              onClick={() =>
                setFiltroActividad(
                  "INACTIVE"
                )
              }
            >
              ⚫ Inactivos
            </FiltroButton>

            <FiltroButton
              activo={
                filtroActividad ===
                "ALL"
              }
              onClick={() =>
                setFiltroActividad(
                  "ALL"
                )
              }
            >
              Todos productos
            </FiltroButton>

            <span
              style={{
                width: 1,
                minHeight: 28,
                background:
                  "var(--border)",
                alignSelf: "center"
              }}
            />

            <FiltroButton
              activo={
                filtroEstado ===
                "ALL"
              }
              onClick={() =>
                setFiltroEstado(
                  "ALL"
                )
              }
            >
              Todo stock
            </FiltroButton>

            <FiltroButton
              activo={
                filtroEstado ===
                "LOW"
              }
              onClick={() =>
                setFiltroEstado(
                  "LOW"
                )
              }
            >
              🟡 Stock bajo
            </FiltroButton>

            <FiltroButton
              activo={
                filtroEstado ===
                "OUT"
              }
              onClick={() =>
                setFiltroEstado(
                  "OUT"
                )
              }
            >
              🔴 Sin stock
            </FiltroButton>

            <span
              className="inv-subtle"
              style={{
                marginLeft: "auto",
                alignSelf: "center",
                fontSize: 12
              }}
            >
              Mostrando{" "}
              <b>
                {
                  productosFiltrados.length
                }
              </b>{" "}
              de{" "}
              <b>
                {
                  productos.length
                }
              </b>
            </span>

          </div>

        </div>

      </div>

      {/* =====================================================
          MENSAJES
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

      {exito && (

        <div
          style={{
            padding: 12,
            marginBottom: 14,
            borderRadius: 12,
            border:
              "1px solid rgba(34,197,94,.35)",
            background:
              "rgba(34,197,94,.07)"
          }}
        >
          ✅ {exito}
        </div>

      )}

      {/* =====================================================
          PRODUCTOS
      ===================================================== */}

      <section className="card">

        <div className="card-header">

          <div>

            <h2
              style={{
                margin: 0
              }}
            >
              Productos
            </h2>

            <p
              className="inv-subtle"
              style={{
                margin:
                  "4px 0 0"
              }}
            >
              Las existencias cambian únicamente mediante compras, ventas o ajustes.
            </p>

          </div>

        </div>

        <div className="card-body">

          {cargando ? (

            <p className="inv-subtle">
              Cargando inventario…
            </p>

          ) : productosFiltrados.length ===
            0 ? (

            <div
              style={{
                padding:
                  "46px 20px",
                textAlign: "center"
              }}
            >

              <div
                style={{
                  fontSize: 38,
                  marginBottom: 10
                }}
              >
                📦
              </div>

              <strong>
                No encontramos productos
              </strong>

              <p className="inv-subtle">
                Prueba cambiando los filtros o registra un nuevo producto.
              </p>

            </div>

          ) : !agrupar ? (

            <div
              style={{
                display: "grid",
                gap: 12
              }}
            >

              {productosFiltrados.map(
                producto => (

                  <ProductoCard
                    key={
                      producto.id
                    }
                    producto={
                      producto
                    }
                    puedeGestionar={
                      puedeGestionar
                    }
                    onEditar={() =>
                      abrirEditarProducto(
                        producto
                      )
                    }
                    onAjustar={() =>
                      abrirAjuste(
                        producto
                      )
                    }
                    onCambiarEstado={() =>
                      abrirModalEstadoProducto(
                        producto
                      )
                    }
                  />

                )
              )}

            </div>

          ) : (

            <div
              style={{
                display: "grid",
                gap: 22
              }}
            >

              {grupos?.map(
                grupo => (

                  <div
                    key={
                      grupo.nombre
                    }
                  >

                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        marginBottom: 10
                      }}
                    >

                      <strong>
                        🏷️ {grupo.nombre}
                      </strong>

                      <span className="badge">
                        {
                          grupo.items.length
                        }
                      </span>

                    </div>

                    <div
                      style={{
                        display: "grid",
                        gap: 12
                      }}
                    >

                      {grupo.items.map(
                        producto => (

                          <ProductoCard
                            key={
                              producto.id
                            }
                            producto={
                              producto
                            }
                            puedeGestionar={
                              puedeGestionar
                            }
                            onEditar={() =>
                              abrirEditarProducto(
                                producto
                              )
                            }
                            onAjustar={() =>
                              abrirAjuste(
                                producto
                              )
                            }
                            onCambiarEstado={() =>
                              abrirModalEstadoProducto(
                                producto
                              )
                            }
                          />

                        )
                      )}

                    </div>

                  </div>

                )
              )}

            </div>

          )}

        </div>

      </section>

      {/* =====================================================
          MODAL PRODUCTO
      ===================================================== */}

      {modalProducto && (

        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
        >

          <div
            className="modal-card"
            style={{
              width: "92vw",
              maxWidth: 760,
              maxHeight: "88vh",
              overflowY: "auto",
              borderRadius: 22
            }}
          >

            <div
              style={{
                display: "flex",
                justifyContent:
                  "space-between",
                alignItems: "center",
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
                  {editandoId
                    ? "✏️ Editar producto"
                    : "➕ Nuevo producto"}
                </h3>

                <p
                  className="inv-subtle"
                  style={{
                    margin:
                      "5px 0 0"
                  }}
                >
                  {editandoId
                    ? "Los datos comerciales se pueden modificar. Las existencias no."
                    : "El producto se creará con stock inicial 0."}
                </p>

              </div>

              <button
                className="btn"
                onClick={
                  cerrarModalProducto
                }
              >
                ✕
              </button>

            </div>

            {/* STOCK PROTEGIDO */}

            <div
              style={{
                padding: 14,
                marginBottom: 16,
                borderRadius: 14,
                border:
                  "1px solid rgba(59,130,246,.25)",
                background:
                  "rgba(59,130,246,.06)"
              }}
            >

              <div
                style={{
                  display: "flex",
                  gap: 10,
                  alignItems: "center"
                }}
              >

                <span
                  style={{
                    fontSize: 22
                  }}
                >
                  🔒
                </span>

                <div>

                  <strong>
                    {editandoId
                      ? `Stock actual: ${formatearCantidad(
                          productos.find(
                            p =>
                              p.id ===
                              editandoId
                          )?.cantidad ||
                          0
                        )}`
                      : "Stock inicial: 0"}
                  </strong>

                  <div
                    className="inv-subtle"
                    style={{
                      marginTop: 3,
                      fontSize: 12
                    }}
                  >
                    El stock se modifica mediante compras, ventas o ajustes de inventario.
                  </div>

                </div>

              </div>

            </div>

            <div className="form-grid">

              <div className="form-field">

                <label>
                  Nombre *
                </label>

                <input
                  name="nombre"
                  placeholder="Ej: Camisa negra talla M"
                  value={
                    productoForm.nombre
                  }
                  onChange={
                    handleChange
                  }
                />

              </div>

              <div className="form-field">

                <label>
                  Stock mínimo
                </label>

                <input
                  type="text"
                  inputMode="numeric"
                  name="minimo"
                  placeholder="0"
                  value={
                    productoForm.minimo
                  }
                  onChange={
                    handleChange
                  }
                />

              </div>

              <div className="form-field">

                <label>
                  Precio de venta *
                </label>

                <input
                  type="text"
                  inputMode="numeric"
                  name="precio"
                  placeholder="0"
                  value={
                    productoForm.precio
                  }
                  onChange={
                    handleChange
                  }
                />

              </div>

              {/* COSTO */}

              {!editandoId ? (

                <div className="form-field">

                  <label>
                    Costo inicial
                  </label>

                  <input
                    type="text"
                    inputMode="numeric"
                    name="costo"
                    placeholder="0"
                    value={
                      productoForm.costo
                    }
                    onChange={
                      handleChange
                    }
                  />

                </div>

              ) : (

                <div className="form-field">

                  <label>
                    Costo promedio
                  </label>

                  <input
                    type="text"
                    value={
                      productoForm.costo
                    }
                    disabled
                  />

                  <span
                    className="inv-subtle"
                    style={{
                      marginTop: 5,
                      fontSize: 11
                    }}
                  >
                    🔒 Se actualiza mediante compras.
                  </span>

                </div>

              )}

              <div
                className="form-field"
                style={{
                  gridColumn:
                    "1 / -1"
                }}
              >

                <label>
                  Categoría
                </label>

                <select
                  name="categoriaId"
                  value={
                    productoForm.categoriaId
                  }
                  onChange={
                    handleChange
                  }
                >

                  <option value="">
                    Sin categoría
                  </option>

                  {categorias.map(
                    categoria => (

                      <option
                        key={
                          categoria.id
                        }
                        value={
                          categoria.id
                        }
                      >
                        {categoria.nombre}
                      </option>

                    )
                  )}

                </select>

              </div>

            </div>

            {/* IMAGEN */}

            <div
              style={{
                marginTop: 18
              }}
            >

              <label
                style={{
                  display: "block",
                  marginBottom: 8,
                  fontWeight: 600
                }}
              >
                Imagen
              </label>

              <div
                className="image-actions"
                style={{
                  display: "flex",
                  gap: 8,
                  flexWrap: "wrap"
                }}
              >

                <button
                  type="button"
                  className="btn"
                  onClick={() =>
                    inputCamaraRef
                      .current
                      ?.click()
                  }
                >
                  📷 Tomar foto
                </button>

                <button
                  type="button"
                  className="btn"
                  onClick={() =>
                    inputGaleriaRef
                      .current
                      ?.click()
                  }
                >
                  🖼️ Galería
                </button>

                {preview && (

                  <button
                    type="button"
                    className="btn"
                    onClick={
                      quitarImagen
                    }
                  >
                    Quitar imagen
                  </button>

                )}

              </div>

              <input
                ref={
                  inputCamaraRef
                }
                type="file"
                accept="image/*"
                capture="environment"
                onChange={
                  handleFileChange
                }
                style={{
                  display: "none"
                }}
              />

              <input
                ref={
                  inputGaleriaRef
                }
                type="file"
                accept="image/*"
                onChange={
                  handleFileChange
                }
                style={{
                  display: "none"
                }}
              />

              {preview && (

                <div
                  style={{
                    marginTop: 12
                  }}
                >

                  <img
                    src={
                      preview
                    }
                    alt="Producto"
                    style={{
                      width: 120,
                      height: 120,
                      objectFit: "cover",
                      borderRadius: 16,
                      border:
                        "1px solid var(--border)"
                    }}
                  />

                </div>

              )}

              {subiendo && (

                <div
                  className="progress"
                  style={{
                    marginTop: 12
                  }}
                >

                  <div className="progress-info">
                    Subiendo imagen:{" "}
                    {uploadProgress}%
                  </div>

                  <div className="progress-bar">

                    <div
                      className="progress-fill"
                      style={{
                        width:
                          `${uploadProgress}%`
                      }}
                    />

                  </div>

                </div>

              )}

            </div>

            <div
              style={{
                display: "flex",
                justifyContent:
                  "flex-end",
                gap: 8,
                flexWrap: "wrap",
                marginTop: 22
              }}
            >

              <button
                className="btn"
                onClick={
                  cerrarModalProducto
                }
              >
                Cancelar
              </button>

              <button
                className="btn btn-primary"
                onClick={
                  guardarProducto
                }
                disabled={
                  subiendo
                }
              >
                {subiendo
                  ? "Guardando..."
                  : editandoId
                    ? "✓ Guardar cambios"
                    : "✓ Crear producto"}
              </button>

            </div>

          </div>

        </div>

      )}

      {/* =====================================================
          MODAL ACTIVAR / DESACTIVAR PRODUCTO
      ===================================================== */}

      {modalEstadoProducto.open &&
        modalEstadoProducto.producto && (

        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="titulo-estado-producto"
          onMouseDown={e => {
            if (
              e.target ===
                e.currentTarget &&
              !guardandoEstadoProducto
            ) {
              cerrarModalEstadoProducto();
            }
          }}
        >

          <div
            className="modal-card"
            style={{
              width: "92vw",
              maxWidth: 520,
              borderRadius: 24,
              padding: 0,
              overflow: "hidden",
              boxShadow:
                "0 30px 100px rgba(0,0,0,.55)"
            }}
          >

            {(() => {
              const producto =
                modalEstadoProducto.producto;

              const estaActivo =
                producto.activo !== false;

              const stock =
                Number(
                  producto.cantidad ||
                  0
                );

              return (
                <>

                  {/* CABECERA */}

                  <div
                    style={{
                      padding: "22px 22px 18px",
                      borderBottom:
                        "1px solid var(--border)",
                      background:
                        estaActivo
                          ? "linear-gradient(135deg, rgba(245,158,11,.12), rgba(245,158,11,.035))"
                          : "linear-gradient(135deg, rgba(34,197,94,.12), rgba(34,197,94,.035))"
                    }}
                  >

                    <div
                      style={{
                        display: "flex",
                        gap: 14,
                        alignItems:
                          "flex-start"
                      }}
                    >

                      <div
                        style={{
                          width: 48,
                          height: 48,
                          flexShrink: 0,
                          borderRadius: 16,
                          display: "grid",
                          placeItems:
                            "center",
                          fontSize: 23,

                          color:
                            estaActivo
                              ? "#f59e0b"
                              : "#22c55e",

                          background:
                            estaActivo
                              ? "rgba(245,158,11,.13)"
                              : "rgba(34,197,94,.13)",

                          border:
                            estaActivo
                              ? "1px solid rgba(245,158,11,.28)"
                              : "1px solid rgba(34,197,94,.28)"
                        }}
                      >
                        {estaActivo
                          ? "⏸"
                          : "▶️"}
                      </div>

                      <div
                        style={{
                          flex: 1,
                          minWidth: 0
                        }}
                      >

                        <h3
                          id="titulo-estado-producto"
                          style={{
                            margin: 0,
                            fontSize: 20
                          }}
                        >
                          {estaActivo
                            ? "Desactivar producto"
                            : "Reactivar producto"}
                        </h3>

                        <p
                          className="inv-subtle"
                          style={{
                            margin:
                              "6px 0 0",
                            lineHeight: 1.5
                          }}
                        >
                          {estaActivo
                            ? "El producto dejará de estar disponible para nuevas ventas y compras."
                            : "El producto volverá a estar disponible para nuevas ventas y compras."}
                        </p>

                      </div>

                      <button
                        type="button"
                        className="btn"
                        onClick={
                          cerrarModalEstadoProducto
                        }
                        disabled={
                          guardandoEstadoProducto
                        }
                        aria-label="Cerrar"
                        style={{
                          minWidth: 40,
                          padding:
                            "8px 10px"
                        }}
                      >
                        ✕
                      </button>

                    </div>

                  </div>

                  {/* CONTENIDO */}

                  <div
                    style={{
                      padding: 22
                    }}
                  >

                    <div
                      style={{
                        display: "flex",
                        gap: 13,
                        alignItems: "center",
                        padding: 14,
                        borderRadius: 16,
                        border:
                          "1px solid var(--border)",
                        background:
                          "rgba(255,255,255,.025)"
                      }}
                    >

                      <div
                        style={{
                          width: 56,
                          height: 56,
                          flexShrink: 0,
                          borderRadius: 14,
                          overflow: "hidden",
                          border:
                            "1px solid var(--border)",
                          display: "grid",
                          placeItems:
                            "center",
                          background:
                            "rgba(255,255,255,.035)"
                        }}
                      >

                        {producto.imagen ? (

                          <img
                            src={
                              producto.imagen
                            }
                            alt={
                              producto.nombre
                            }
                            style={{
                              width: "100%",
                              height: "100%",
                              objectFit:
                                "cover"
                            }}
                          />

                        ) : (

                          <span
                            style={{
                              fontSize: 24
                            }}
                          >
                            📦
                          </span>

                        )}

                      </div>

                      <div
                        style={{
                          flex: 1,
                          minWidth: 0
                        }}
                      >

                        <strong
                          style={{
                            display: "block",
                            fontSize: 17
                          }}
                        >
                          {producto.nombre}
                        </strong>

                        <div
                          className="inv-subtle"
                          style={{
                            marginTop: 4,
                            fontSize: 12
                          }}
                        >
                          {producto.categoriaNombre ||
                            "Sin categoría"}
                        </div>

                      </div>

                      <div
                        style={{
                          textAlign:
                            "right"
                        }}
                      >

                        <div
                          className="inv-subtle"
                          style={{
                            fontSize: 10
                          }}
                        >
                          Stock actual
                        </div>

                        <strong
                          style={{
                            display: "block",
                            marginTop: 3,
                            fontSize: 17
                          }}
                        >
                          {formatearCantidad(
                            stock
                          )}
                        </strong>

                      </div>

                    </div>

                    <div
                      style={{
                        marginTop: 16,
                        padding: 15,
                        borderRadius: 15,

                        border:
                          estaActivo
                            ? "1px solid rgba(245,158,11,.25)"
                            : "1px solid rgba(34,197,94,.25)",

                        background:
                          estaActivo
                            ? "rgba(245,158,11,.055)"
                            : "rgba(34,197,94,.055)"
                      }}
                    >

                      <strong
                        style={{
                          display: "block",
                          color:
                            estaActivo
                              ? "#f59e0b"
                              : "#22c55e"
                        }}
                      >
                        {estaActivo
                          ? "El producto no será eliminado."
                          : "El historial permanecerá intacto."}
                      </strong>

                      <p
                        className="inv-subtle"
                        style={{
                          margin:
                            "6px 0 0",
                          lineHeight: 1.55
                        }}
                      >
                        {estaActivo
                          ? "Conservará su stock actual, facturas, compras, ventas y todo el historial de movimientos. Podrás reactivarlo cuando lo necesites."
                          : "Al reactivarlo conservará el mismo stock, costos, precios, facturas y movimientos que tenía antes de ser desactivado."}
                      </p>

                    </div>

                    <div
                      style={{
                        display: "flex",
                        justifyContent:
                          "flex-end",
                        gap: 9,
                        flexWrap: "wrap",
                        marginTop: 20
                      }}
                    >

                      <button
                        type="button"
                        className="btn"
                        onClick={
                          cerrarModalEstadoProducto
                        }
                        disabled={
                          guardandoEstadoProducto
                        }
                      >
                        Cancelar
                      </button>

                      <button
                        type="button"
                        className={
                          estaActivo
                            ? "btn"
                            : "btn btn-primary"
                        }
                        onClick={
                          confirmarCambioEstadoProducto
                        }
                        disabled={
                          guardandoEstadoProducto
                        }
                        style={
                          estaActivo
                            ? {
                                color:
                                  "#f59e0b",
                                borderColor:
                                  "rgba(245,158,11,.45)",
                                background:
                                  "rgba(245,158,11,.09)",
                                fontWeight: 800
                              }
                            : {
                                fontWeight: 800
                              }
                        }
                      >
                        {guardandoEstadoProducto
                          ? "Guardando..."
                          : estaActivo
                            ? "⏸ Sí, desactivar"
                            : "▶️ Sí, reactivar"}
                      </button>

                    </div>

                  </div>

                </>
              );
            })()}

          </div>

        </div>

      )}

      {/* =====================================================
          MODAL AJUSTE
      ===================================================== */}

      {modalAjuste.open &&
        modalAjuste.producto && (

        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
        >

          <div
            className="modal-card"
            style={{
              width: "92vw",
              maxWidth: 560,
              borderRadius: 22
            }}
          >

            <div
              style={{
                display: "flex",
                justifyContent:
                  "space-between",
                alignItems: "center",
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
                  📦 Ajustar inventario
                </h3>

                <p
                  className="inv-subtle"
                  style={{
                    margin:
                      "5px 0 0"
                  }}
                >
                  {
                    modalAjuste
                      .producto
                      .nombre
                  }
                </p>

              </div>

              <button
                className="btn"
                onClick={
                  cerrarAjuste
                }
              >
                ✕
              </button>

            </div>

            {/* STOCK */}

            <div
              style={{
                display: "grid",
                gridTemplateColumns:
                  "repeat(3, 1fr)",
                gap: 10,
                marginBottom: 18
              }}
            >

              <MiniDato
                titulo="Stock actual"
                valor={
                  formatearCantidad(
                    modalAjuste
                      .producto
                      .cantidad
                  )
                }
              />

              <MiniDato
                titulo="Nuevo stock"
                valor={
                  formatearCantidad(
                    numeroDesdeInput(
                      modalAjuste
                        .nuevoStock
                    )
                  )
                }
              />

              <MiniDato
                titulo="Diferencia"
                valor={
                  diferenciaAjuste >
                  0
                    ? `+${formatearCantidad(
                        diferenciaAjuste
                      )}`
                    : formatearCantidad(
                        diferenciaAjuste
                      )
                }
                color={
                  diferenciaAjuste >
                  0
                    ? "#22c55e"
                    : diferenciaAjuste <
                      0
                      ? "#ef4444"
                      : undefined
                }
              />

            </div>

            <div className="form-field">

              <label>
                Nuevo stock *
              </label>

              <input
                autoFocus
                type="text"
                inputMode="numeric"
                value={
                  modalAjuste.nuevoStock
                }
                onChange={e =>
                  setModalAjuste(
                    prev => ({
                      ...prev,

                      nuevoStock:
                        formatearNumero(
                          e.target.value
                        )
                    })
                  )
                }
              />

            </div>

            <div
              className="form-field"
              style={{
                marginTop: 12
              }}
            >

              <label>
                Motivo *
              </label>

              <select
                value={
                  modalAjuste.motivo
                }
                onChange={e =>
                  setModalAjuste(
                    prev => ({
                      ...prev,
                      motivo:
                        e.target.value
                    })
                  )
                }
              >

                <option value="">
                  Selecciona…
                </option>

                <option value="CONTEO_FISICO">
                  Conteo físico
                </option>

                <option value="PRODUCTO_DANADO">
                  Producto dañado
                </option>

                <option value="PERDIDA">
                  Pérdida / faltante
                </option>

                <option value="DEVOLUCION">
                  Devolución
                </option>

                <option value="ERROR_REGISTRO">
                  Corrección de registro
                </option>

                <option value="OTRO">
                  Otro
                </option>

              </select>

            </div>

            <div
              className="form-field"
              style={{
                marginTop: 12
              }}
            >

              <label>
                Observación
                {modalAjuste.motivo ===
                "OTRO"
                  ? " *"
                  : ""}
              </label>

              <textarea
                rows="3"
                placeholder="Explica brevemente qué ocurrió..."
                value={
                  modalAjuste.observacion
                }
                onChange={e =>
                  setModalAjuste(
                    prev => ({
                      ...prev,

                      observacion:
                        e.target.value
                    })
                  )
                }
                style={{
                  resize: "vertical"
                }}
              />

            </div>

            <div
              style={{
                marginTop: 14,
                padding: 12,
                borderRadius: 12,
                background:
                  "rgba(245,158,11,.06)",
                border:
                  "1px solid rgba(245,158,11,.22)"
              }}
            >

              <strong>
                ⚠️ Este movimiento quedará registrado.
              </strong>

              <p
                className="inv-subtle"
                style={{
                  margin:
                    "5px 0 0"
                }}
              >
                Ordexa conservará el stock anterior, el nuevo stock, la diferencia, el motivo, el usuario y la fecha.
              </p>

            </div>

            <div
              style={{
                display: "flex",
                justifyContent:
                  "flex-end",
                gap: 8,
                marginTop: 20,
                flexWrap: "wrap"
              }}
            >

              <button
                className="btn"
                onClick={
                  cerrarAjuste
                }
              >
                Cancelar
              </button>

              <button
                className="btn btn-primary"
                onClick={
                  guardarAjuste
                }
                disabled={
                  guardandoAjuste ||
                  diferenciaAjuste ===
                    0
                }
              >
                {guardandoAjuste
                  ? "Guardando..."
                  : "✓ Confirmar ajuste"}
              </button>

            </div>

          </div>

        </div>

      )}

      {/* =====================================================
          MODAL CATEGORÍA
      ===================================================== */}

      {modalCategoria.open && (

        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
        >

          <div
            className="modal-card"
            style={{
              width: "92vw",
              maxWidth: 460,
              borderRadius: 20
            }}
          >

            <h3
              style={{
                marginTop: 0
              }}
            >
              🏷️ Nueva categoría
            </h3>

            <div className="form-field">

              <label>
                Nombre
              </label>

              <input
                autoFocus
                placeholder="Ej: Ropa"
                value={
                  modalCategoria.nombre
                }
                onChange={e =>
                  setModalCategoria(
                    prev => ({
                      ...prev,

                      nombre:
                        e.target.value
                    })
                  )
                }
                onKeyDown={e => {
                  if (
                    e.key ===
                    "Enter"
                  ) {
                    crearCategoria();
                  }

                  if (
                    e.key ===
                    "Escape"
                  ) {
                    cerrarModalCategoria();
                  }
                }}
              />

            </div>

            <div
              style={{
                display: "flex",
                justifyContent:
                  "flex-end",
                gap: 8,
                marginTop: 18
              }}
            >

              <button
                className="btn"
                onClick={
                  cerrarModalCategoria
                }
              >
                Cancelar
              </button>

              <button
                className="btn btn-primary"
                onClick={
                  crearCategoria
                }
              >
                Crear
              </button>

            </div>

          </div>

        </div>

      )}

    </div>
  );
}

/* =========================================================
   RESUMEN CARD
========================================================= */

function ResumenCard({
  icono,
  titulo,
  valor,
  detalle,
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
          alignItems:
            "center",
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
          fontSize: 25,
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
   PRODUCTO CARD
========================================================= */

function ProductoCard({
  producto,
  puedeGestionar,
  onEditar,
  onAjustar,
  onCambiarEstado
}) {
  const activo =
    producto.activo !== false;
  const cantidad =
    Number(
      producto.cantidad ||
      0
    );

  const minimo =
    Number(
      producto.minimo ||
      0
    );

  const sinStock =
    cantidad <= 0;

  const stockBajo =
    !sinStock &&
    cantidad <= minimo;

  const precioMinimo =
    obtenerPrecioMinimo(
      producto
    );

  const costo =
    Number(
      producto.costoPromedio ??
      producto.costoUnitario ??
      0
    );

  let estado = {
    texto: "Disponible",
    icono: "🟢",
    color: "#22c55e"
  };

  if (sinStock) {
    estado = {
      texto: "Sin stock",
      icono: "🔴",
      color: "#ef4444"
    };
  } else if (stockBajo) {
    estado = {
      texto: "Stock bajo",
      icono: "🟡",
      color: "#f59e0b"
    };
  }

  return (
    <div
      style={{
        padding: 15,
        borderRadius: 18,
        border:
          !activo
            ? "1px solid rgba(148,163,184,.30)"
            : sinStock
              ? "1px solid rgba(239,68,68,.30)"
              : stockBajo
                ? "1px solid rgba(245,158,11,.28)"
                : "1px solid var(--border)",

        background:
          !activo
            ? "rgba(148,163,184,.035)"
            : sinStock
              ? "rgba(239,68,68,.025)"
              : stockBajo
                ? "rgba(245,158,11,.02)"
                : "rgba(255,255,255,.012)"
      }}
    >

      <div
        style={{
          display: "flex",
          gap: 15,
          alignItems:
            "flex-start"
        }}
      >

        {/* IMAGEN */}

        <div
          style={{
            width: 78,
            height: 78,
            flexShrink: 0,
            borderRadius: 16,
            overflow: "hidden",
            border:
              "1px solid var(--border)",
            background:
              "rgba(255,255,255,.035)",
            display: "grid",
            placeItems: "center"
          }}
        >

          {producto.imagen ? (

            <img
              src={
                producto.imagen
              }
              alt={
                producto.nombre
              }
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover"
              }}
            />

          ) : (

            <span
              className="inv-subtle"
              style={{
                fontSize: 10,
                textAlign: "center"
              }}
            >
              Sin imagen
            </span>

          )}

        </div>

        {/* INFORMACIÓN */}

        <div
          style={{
            flex: 1,
            minWidth: 0
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

            <div>

              <div
                style={{
                  display: "flex",
                  gap: 8,
                  alignItems:
                    "center",
                  flexWrap: "wrap"
                }}
              >

                <strong
                  style={{
                    fontSize: 17
                  }}
                >
                  {
                    producto.nombre
                  }
                </strong>

                <span
                  className="badge"
                  style={{
                    color:
                      activo
                        ? "#22c55e"
                        : "#94a3b8"
                  }}
                >
                  {activo
                    ? "🟢 Activo"
                    : "⚫ Inactivo"}
                </span>

                <span
                  className="badge"
                  style={{
                    color:
                      estado.color
                  }}
                >
                  {estado.icono}{" "}
                  {estado.texto}
                </span>

              </div>

              <div
                className="inv-subtle"
                style={{
                  marginTop: 4,
                  fontSize: 12
                }}
              >
                {producto.categoriaNombre ||
                  "Sin categoría"}
              </div>

            </div>

            {/* ACCIONES */}

            <div
              style={{
                display: "flex",
                gap: 7,
                flexWrap: "wrap"
              }}
            >

              {puedeGestionar && (

                <button
                  className="btn btn-small"
                  onClick={
                    onEditar
                  }
                >
                  ✏️ Editar
                </button>

              )}

              {puedeGestionar &&
                activo && (

                <button
                  className="btn btn-small"
                  onClick={
                    onAjustar
                  }
                >
                  📦 Ajustar
                </button>

              )}

              <Link
                to={`/movimientos-inventario?producto=${encodeURIComponent(
                  producto.id
                )}`}
                className="btn btn-small"
                title="Ver historial de movimientos del producto"
              >
                📜 Historial
              </Link>

              {puedeGestionar && (

                <button
                  type="button"
                  className="btn btn-small"
                  onClick={
                    onCambiarEstado
                  }
                  style={{
                    color:
                      activo
                        ? "#f59e0b"
                        : "#22c55e"
                  }}
                >
                  {activo
                    ? "⏸ Desactivar"
                    : "▶️ Reactivar"}
                </button>

              )}

            </div>

          </div>

          {/* MÉTRICAS */}

          <div
            style={{
              display: "grid",
              gridTemplateColumns:
                "repeat(auto-fit, minmax(110px, 1fr))",
              gap: 9,
              marginTop: 14
            }}
          >

            <MiniDato
              titulo="Stock"
              valor={
                formatearCantidad(
                  cantidad
                )
              }
              color={
                estado.color
              }
            />

            <MiniDato
              titulo="Mínimo"
              valor={
                formatearCantidad(
                  minimo
                )
              }
            />

            <MiniDato
              titulo="Precio"
              valor={
                formatearMoneda(
                  producto.precioUnitario
                )
              }
            />

            <MiniDato
              titulo="Precio mínimo"
              valor={
                formatearMoneda(
                  precioMinimo
                )
              }
            />

            <MiniDato
              titulo="Costo prom."
              valor={
                formatearMoneda(
                  costo
                )
              }
            />

          </div>

        </div>

      </div>

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
    <div
      style={{
        padding:
          "9px 11px",
        borderRadius: 11,
        border:
          "1px solid var(--border)",
        background:
          "rgba(255,255,255,.02)"
      }}
    >

      <div
        className="inv-subtle"
        style={{
          fontSize: 10,
          marginBottom: 3
        }}
      >
        {titulo}
      </div>

      <strong
        style={{
          color:
            color ||
            "var(--text)",
          fontSize: 13
        }}
      >
        {valor}
      </strong>

    </div>
  );
}

export default Inventario;