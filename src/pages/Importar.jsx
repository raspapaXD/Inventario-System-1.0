// src/pages/Importar.jsx

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  addDoc,
  collection,
  doc,
  getDocs,
  runTransaction,
  serverTimestamp,
  writeBatch
} from "firebase/firestore";
import { db } from "../../firebaseClient";
import { useTenant } from "../tenant/TenantProvider";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import "./inventario.css";

/* =========================================================
   TEMA
========================================================= */

function useTheme() {
  const [theme, setTheme] = useState(
    () => localStorage.getItem("theme") || "dark"
  );

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("theme", theme);
  }, [theme]);

  const toggle = () =>
    setTheme(t => (t === "dark" ? "light" : "dark"));

  return { theme, toggle };
}

/* =========================================================
   CAMPOS DEL ARCHIVO
========================================================= */

const REQUIRED_FIELDS = [
  "nombre",
  "cantidad",
  "precioUnitario"
];

const OPTIONAL_FIELDS = [
  "codigo",
  "minimo",
  "costoUnitario",
  "categoria",
  "imagen"
];

const SUGGESTIONS = {
  nombre: [
    "nombre",
    "producto",
    "item",
    "descripcion",
    "descripción"
  ],

  cantidad: [
    "cantidad",
    "stock",
    "existencias",
    "existencia",
    "cant"
  ],

  precioUnitario: [
    "precio",
    "precio_venta",
    "precio venta",
    "precio unitario",
    "venta"
  ],

  codigo: [
    "codigo",
    "código",
    "sku",
    "referencia",
    "ref",
    "codigo producto",
    "código producto"
  ],

  minimo: [
    "minimo",
    "mínimo",
    "stock_minimo",
    "stock mínimo"
  ],

  costoUnitario: [
    "costo",
    "costo_unitario",
    "costo unitario",
    "coste",
    "compra"
  ],

  categoria: [
    "categoria",
    "categoría",
    "rubro",
    "grupo"
  ],

  imagen: [
    "imagen",
    "url_imagen",
    "image",
    "image_url",
    "foto"
  ]
};

const EMPTY_MAPPING = {
  nombre: "",
  cantidad: "",
  precioUnitario: "",
  codigo: "",
  minimo: "",
  costoUnitario: "",
  categoria: "",
  imagen: ""
};

/* =========================================================
   HELPERS
========================================================= */

function normalize(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "-")
    .replace(/[^A-Z0-9_-]/g, "");
}

function generatedCode(number) {
  return `PROD-${String(number).padStart(6, "0")}`;
}

function generatedCodeNumber(code) {
  const match = String(code || "")
    .toUpperCase()
    .match(/^PROD-(\d+)$/);

  return match ? Number(match[1]) : 0;
}

function autoGuess(field, headers) {
  const cands = (SUGGESTIONS[field] || []).map(normalize);

  for (const h of headers) {
    const hn = normalize(h);

    if (cands.includes(hn)) {
      return h;
    }

    if (cands.some(c => hn.includes(c))) {
      return h;
    }
  }

  return "";
}

function getVal(row, col) {
  if (!col) return "";
  return row[col];
}

/*
 * Interpreta correctamente formatos habituales de Colombia:
 *
 * 5.000      -> 5000
 * 25.500     -> 25500
 * 1.250.000  -> 1250000
 * 5,5        -> 5.5
 * 5.000,50   -> 5000.50
 *
 * Esto corrige el problema anterior donde parseFloat("5.000")
 * terminaba convirtiendo $5.000 en $5.
 */
function parseFlexibleNumber(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  let s = String(value ?? "")
    .trim()
    .replace(/\s/g, "")
    .replace(/[^0-9,.-]/g, "");

  if (!s) return 0;

  const hasDot = s.includes(".");
  const hasComma = s.includes(",");

  if (hasDot && hasComma) {
    const lastDot = s.lastIndexOf(".");
    const lastComma = s.lastIndexOf(",");

    if (lastComma > lastDot) {
      // 1.250.000,50
      s = s.replace(/\./g, "").replace(",", ".");
    } else {
      // 1,250,000.50
      s = s.replace(/,/g, "");
    }
  } else if (hasDot) {
    if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) {
      // 5.000 / 1.250.000
      s = s.replace(/\./g, "");
    }
  } else if (hasComma) {
    if (/^-?\d{1,3}(,\d{3})+$/.test(s)) {
      // 5,000 / 1,250,000
      s = s.replace(/,/g, "");
    } else {
      // 5,5
      s = s.replace(",", ".");
    }
  }

  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function toInt(value) {
  return Math.max(0, Math.round(parseFlexibleNumber(value)));
}

function toMoney(value) {
  return Math.max(0, Math.round(parseFlexibleNumber(value)));
}

function money(value) {
  return `$${Number(value || 0).toLocaleString("es-CO", {
    maximumFractionDigits: 0
  })}`;
}

function number(value) {
  return Number(value || 0).toLocaleString("es-CO", {
    maximumFractionDigits: 0
  });
}

/* =========================================================
   COMPONENTE
========================================================= */

export default function Importar() {
  const { theme, toggle } = useTheme();
  const { empresa, user } = useTenant();

  const [file, setFile] = useState(null);
  const [rawRows, setRawRows] = useState([]);
  const [headers, setHeaders] = useState([]);
  const [mapping, setMapping] = useState(EMPTY_MAPPING);

  const [productosExistentes, setProductosExistentes] = useState([]);
  const [cargandoProductos, setCargandoProductos] = useState(false);

  const [modoStock, setModoStock] = useState("REEMPLAZAR");

  const [error, setError] = useState(null);
  const [step, setStep] = useState("upload");
  const [creating, setCreating] = useState(false);

  const [importStats, setImportStats] = useState({
    total: 0,
    ok: 0,
    fail: 0,
    nuevos: 0,
    actualizados: 0,
    sinCambios: 0
  });

  /* =======================================================
     PRODUCTOS EXISTENTES
  ======================================================= */

  const cargarProductosExistentes = async () => {
    if (!empresa?.id) return [];

    try {
      setCargandoProductos(true);

      const snap = await getDocs(
        collection(
          db,
          "empresas",
          empresa.id,
          "productos"
        )
      );

      const lista = snap.docs.map(d => ({
        id: d.id,
        ...d.data()
      }));

      setProductosExistentes(lista);
      return lista;
    } finally {
      setCargandoProductos(false);
    }
  };

  useEffect(() => {
    if (!empresa?.id) return;

    cargarProductosExistentes().catch(e => {
      console.error(e);
      setError("No se pudieron cargar los productos existentes.");
    });
  }, [empresa?.id]);

  /* =======================================================
     1) CARGAR ARCHIVO
  ======================================================= */

  const onFile = async event => {
    setError(null);

    const selectedFile = event.target.files?.[0];
    if (!selectedFile) return;

    setFile(selectedFile);

    const ext = (
      selectedFile.name.split(".").pop() || ""
    ).toLowerCase();

    try {
      let rows = [];

      if (ext === "csv") {
        rows = await parseCSV(selectedFile);
      } else if (ext === "xlsx" || ext === "xls") {
        rows = await parseXLSX(selectedFile);
      } else {
        throw new Error(
          "Formato no soportado. Usa .csv, .xlsx o .xls"
        );
      }

      if (!rows.length) {
        throw new Error("El archivo no contiene filas.");
      }

      const hdrs = Object.keys(rows[0] || {});
      setHeaders(hdrs);

      setMapping({
        nombre: autoGuess("nombre", hdrs),
        cantidad: autoGuess("cantidad", hdrs),
        precioUnitario: autoGuess("precioUnitario", hdrs),
        codigo: autoGuess("codigo", hdrs),
        minimo: autoGuess("minimo", hdrs),
        costoUnitario: autoGuess("costoUnitario", hdrs),
        categoria: autoGuess("categoria", hdrs),
        imagen: autoGuess("imagen", hdrs)
      });

      setRawRows(rows);
      setStep("map");
    } catch (e) {
      console.error(e);

      setError(
        e?.message || "No se pudo leer el archivo."
      );

      setFile(null);
      setRawRows([]);
      setHeaders([]);
    }
  };

  const parseCSV = fileToParse => {
    return new Promise((resolve, reject) => {
      Papa.parse(fileToParse, {
        header: true,
        skipEmptyLines: true,
        complete: res => resolve(res.data),
        error: err => reject(err)
      });
    });
  };

  const parseXLSX = async fileToParse => {
    const buf = await fileToParse.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];

    return XLSX.utils.sheet_to_json(ws, {
      defval: ""
    });
  };

  /* =======================================================
     2) VALIDACIÓN MAPPING
  ======================================================= */

  const canContinue = useMemo(() => {
    if (!headers.length) return false;

    for (const req of REQUIRED_FIELDS) {
      const col = mapping[req];

      if (!col || !headers.includes(col)) {
        return false;
      }
    }

    return true;
  }, [headers, mapping]);

  /* =======================================================
     3) NORMALIZAR FILAS
  ======================================================= */

  const previewRows = useMemo(() => {
    if (!rawRows.length || !headers.length) {
      return [];
    }

    return rawRows.map((row, idx) => {
      const nombre = String(
        getVal(row, mapping.nombre) || ""
      ).trim();

      const codigo = mapping.codigo
        ? normalizeCode(getVal(row, mapping.codigo))
        : "";

      const cantidad = toInt(
        getVal(row, mapping.cantidad)
      );

      const precioUnitario = toMoney(
        getVal(row, mapping.precioUnitario)
      );

      const minimo = mapping.minimo
        ? toInt(getVal(row, mapping.minimo))
        : 0;

      const costoUnitario = mapping.costoUnitario
        ? toMoney(getVal(row, mapping.costoUnitario))
        : 0;

      const categoria = mapping.categoria
        ? String(getVal(row, mapping.categoria) || "").trim()
        : "";

      const imagen = mapping.imagen
        ? String(getVal(row, mapping.imagen) || "").trim()
        : "";

      return {
        __row: idx + 1,
        __rows: [idx + 1],

        codigo,
        nombre,
        nombreLower: normalize(nombre),

        cantidad,
        minimo,
        precioUnitario,
        costoUnitario,

        categoriaNombre: categoria || null,
        imagen: imagen || null,

        valid:
          Boolean(nombre) &&
          Number.isFinite(cantidad) &&
          Number.isFinite(precioUnitario) &&
          cantidad >= 0 &&
          precioUnitario >= 0
      };
    });
  }, [rawRows, headers, mapping]);

  /* =======================================================
     4) CONSOLIDAR REPETIDOS DENTRO DEL MISMO EXCEL

     Si el conteo físico trae el mismo producto varias veces
     porque está almacenado en diferentes zonas, Ordexa suma
     esas filas antes de comparar contra Firestore.
  ======================================================= */

  const filasConsolidadas = useMemo(() => {
    const map = new Map();

    for (const row of previewRows) {
      if (!row.valid) {
        map.set(
          `INVALID-${row.__row}`,
          { ...row }
        );
        continue;
      }

      const key = row.codigo
        ? `CODE:${normalizeCode(row.codigo)}`
        : `NAME:${row.nombreLower}`;

      if (!map.has(key)) {
        map.set(key, { ...row });
        continue;
      }

      const current = map.get(key);

      map.set(key, {
        ...current,
        cantidad:
          Number(current.cantidad || 0) +
          Number(row.cantidad || 0),
        __rows: [
          ...(current.__rows || []),
          ...(row.__rows || [])
        ],

        // Conservamos los primeros datos válidos y completamos
        // campos opcionales que estuvieran vacíos.
        codigo: current.codigo || row.codigo,
        minimo: current.minimo || row.minimo,
        precioUnitario:
          current.precioUnitario || row.precioUnitario,
        costoUnitario:
          current.costoUnitario || row.costoUnitario,
        categoriaNombre:
          current.categoriaNombre || row.categoriaNombre,
        imagen: current.imagen || row.imagen
      });
    }

    return Array.from(map.values());
  }, [previewRows]);

  /* =======================================================
     5) COMPARAR CONTRA INVENTARIO ACTUAL
  ======================================================= */

  const analisisImportacion = useMemo(() => {
    const byCode = new Map();
    const byName = new Map();

    const pushMap = (map, key, product) => {
      if (!key) return;

      if (!map.has(key)) {
        map.set(key, []);
      }

      map.get(key).push(product);
    };

    for (const product of productosExistentes) {
      pushMap(
        byCode,
        normalizeCode(product.codigo),
        product
      );

      pushMap(
        byName,
        normalize(product.nombre),
        product
      );
    }

    return filasConsolidadas.map(row => {
      if (!row.valid) {
        return {
          ...row,
          importable: false,
          problema: "Fila inválida",
          accion: "IGNORAR",
          existente: null,
          stockActual: 0,
          stockNuevo: row.cantidad,
          diferencia: row.cantidad
        };
      }

      let existing = null;
      let problema = "";

      const code = normalizeCode(row.codigo);
      const name = normalize(row.nombre);

      if (code) {
        const codeMatches = byCode.get(code) || [];

        if (codeMatches.length > 1) {
          problema =
            "Hay varios productos existentes con este mismo código.";
        } else if (codeMatches.length === 1) {
          existing = codeMatches[0];
        } else {
          const nameMatches = byName.get(name) || [];

          if (nameMatches.length > 1) {
            problema =
              "Hay varios productos existentes con este mismo nombre.";
          } else if (nameMatches.length === 1) {
            const candidate = nameMatches[0];
            const candidateCode = normalizeCode(candidate.codigo);

            if (candidateCode && candidateCode !== code) {
              problema =
                `El nombre coincide con un producto cuyo código es ${candidate.codigo}.`;
            } else {
              existing = candidate;
            }
          }
        }
      } else {
        const nameMatches = byName.get(name) || [];

        if (nameMatches.length > 1) {
          problema =
            "Hay varios productos existentes con este mismo nombre. Agrega código/SKU para identificarlo sin ambigüedad.";
        } else if (nameMatches.length === 1) {
          existing = nameMatches[0];
        }
      }

      if (problema) {
        return {
          ...row,
          importable: false,
          problema,
          accion: "REVISAR",
          existente: null,
          stockActual: 0,
          stockNuevo: row.cantidad,
          diferencia: row.cantidad
        };
      }

      const stockActual = existing
        ? Number(existing.cantidad || 0)
        : 0;

      const stockNuevo = existing
        ? modoStock === "SUMAR"
          ? stockActual + Number(row.cantidad || 0)
          : Number(row.cantidad || 0)
        : Number(row.cantidad || 0);

      const diferencia = stockNuevo - stockActual;

      return {
        ...row,
        importable: true,
        problema: "",
        existente: existing,
        stockActual,
        stockNuevo,
        diferencia,
        accion: existing
          ? diferencia === 0
            ? "SIN_CAMBIO"
            : "ACTUALIZAR"
          : "CREAR"
      };
    });
  }, [
    filasConsolidadas,
    productosExistentes,
    modoStock
  ]);

  const resumenPreview = useMemo(() => {
    const importables = analisisImportacion.filter(r => r.importable);

    return {
      total: analisisImportacion.length,
      crear: importables.filter(r => r.accion === "CREAR").length,
      actualizar: importables.filter(r => r.accion === "ACTUALIZAR").length,
      sinCambios: importables.filter(r => r.accion === "SIN_CAMBIO").length,
      revisar: analisisImportacion.filter(r => !r.importable).length,
      filasOriginales: previewRows.length,
      consolidadas: filasConsolidadas.length
    };
  }, [analisisImportacion, previewRows, filasConsolidadas]);

  /* =======================================================
     RESERVAR CÓDIGOS AUTOMÁTICOS
  ======================================================= */

  const reservarCodigosAutomaticos = async cantidad => {
    if (!empresa?.id || cantidad <= 0) {
      return [];
    }

    const counterRef = doc(
      db,
      "empresas",
      empresa.id,
      "contadores",
      "productos"
    );

    const maxCodigoExistente = Math.max(
      0,
      ...productosExistentes.map(p =>
        generatedCodeNumber(p.codigo)
      ),
      ...analisisImportacion.map(r =>
        generatedCodeNumber(r.codigo)
      )
    );

    return runTransaction(db, async transaction => {
      const counterSnap = await transaction.get(counterRef);

      const ultimoGuardado = counterSnap.exists()
        ? Number(counterSnap.data()?.ultimo || 0)
        : 0;

      const base = Math.max(
        ultimoGuardado,
        maxCodigoExistente
      );

      const nuevoUltimo = base + cantidad;

      transaction.set(
        counterRef,
        {
          ultimo: nuevoUltimo,
          actualizadoEn: serverTimestamp()
        },
        { merge: true }
      );

      return Array.from(
        { length: cantidad },
        (_, index) => generatedCode(base + index + 1)
      );
    });
  };

  /* =======================================================
     6) IMPORTAR
  ======================================================= */

  const startImport = async () => {
    try {
      if (!empresa?.id) {
        setError("No hay empresa activa.");
        return;
      }

      const rows = analisisImportacion.filter(r => r.importable);

      if (!rows.length) {
        setError("No hay filas válidas para importar.");
        return;
      }

      setCreating(true);
      setError(null);
      setStep("importing");

      setImportStats({
        total: rows.length,
        ok: 0,
        fail: 0,
        nuevos: 0,
        actualizados: 0,
        sinCambios: 0
      });

      /* ---------------------------------------------------
         Categorías existentes
      --------------------------------------------------- */

      const catCol = collection(
        db,
        "empresas",
        empresa.id,
        "categorias"
      );

      const catSnap = await getDocs(catCol);
      const catMapByLower = new Map();

      catSnap.docs.forEach(d => {
        const data = d.data();
        const lower = normalize(data.nombre || "");

        if (lower) {
          catMapByLower.set(lower, {
            id: d.id,
            nombre: data.nombre
          });
        }
      });

      /* ---------------------------------------------------
         Crear categorías faltantes
      --------------------------------------------------- */

      const missingCategories = new Map();

      for (const row of rows) {
        const lower = row.categoriaNombre
          ? normalize(row.categoriaNombre)
          : "";

        if (
          lower &&
          !catMapByLower.has(lower) &&
          !missingCategories.has(lower)
        ) {
          missingCategories.set(lower, row.categoriaNombre);
        }
      }

      for (const [lower, nombre] of missingCategories.entries()) {
        const ref = await addDoc(catCol, {
          nombre,
          nombreLower: normalize(nombre),
          creadoEn: serverTimestamp()
        });

        catMapByLower.set(lower, {
          id: ref.id,
          nombre
        });
      }

      /* ---------------------------------------------------
         Asignar códigos automáticos donde falten
      --------------------------------------------------- */

      const necesitanCodigo = rows.filter(row => {
        const existingCode = normalizeCode(row.existente?.codigo);
        const fileCode = normalizeCode(row.codigo);
        return !existingCode && !fileCode;
      });

      const codigosAutomaticos = await reservarCodigosAutomaticos(
        necesitanCodigo.length
      );

      let codigoIndex = 0;

      const rowsPreparadas = rows.map(row => {
        const existingCode = normalizeCode(row.existente?.codigo);
        const fileCode = normalizeCode(row.codigo);

        let codigo = existingCode || fileCode;

        if (!codigo) {
          codigo = codigosAutomaticos[codigoIndex];
          codigoIndex += 1;
        }

        return {
          ...row,
          codigoFinal: codigo,
          codigoNormalizado: normalizeCode(codigo)
        };
      });

      /* ---------------------------------------------------
         Productos + movimientos en lotes

         Máximo práctico: 200 productos por lote porque cada
         producto puede generar 2 escrituras:
         producto + movimiento.
      --------------------------------------------------- */

      const prodCol = collection(
        db,
        "empresas",
        empresa.id,
        "productos"
      );

      const movCol = collection(
        db,
        "empresas",
        empresa.id,
        "movimientos"
      );

      const CHUNK = 200;

      let ok = 0;
      let fail = resumenPreview.revisar;
      let nuevos = 0;
      let actualizados = 0;
      let sinCambios = 0;

      for (let i = 0; i < rowsPreparadas.length; i += CHUNK) {
        const chunk = rowsPreparadas.slice(i, i + CHUNK);
        const batch = writeBatch(db);

        let chunkNuevos = 0;
        let chunkActualizados = 0;
        let chunkSinCambios = 0;

        for (const row of chunk) {
          const categoriaInfo = row.categoriaNombre
            ? catMapByLower.get(normalize(row.categoriaNombre))
            : null;

          if (row.existente) {
            const product = row.existente;

            const productRef = doc(
              db,
              "empresas",
              empresa.id,
              "productos",
              product.id
            );

            /*
             * Para productos ya existentes NO pisamos el costo
             * promedio ni el precio comercial con un conteo físico.
             * El objetivo del importador aquí es conciliar stock.
             */
            batch.update(productRef, {
              codigo: row.codigoFinal,
              codigoNormalizado: row.codigoNormalizado,

              nombre: product.nombre || row.nombre,
              nombreLower: normalize(product.nombre || row.nombre),

              cantidad: Number(row.stockNuevo || 0),

              minimo: Number(
                product.minimo ?? row.minimo ?? 0
              ),

              precioUnitario: Number(
                product.precioUnitario ?? row.precioUnitario ?? 0
              ),

              costoUnitario: Number(
                product.costoUnitario ??
                product.costoPromedio ??
                row.costoUnitario ??
                0
              ),

              actualizadoEn: serverTimestamp()
            });

            if (row.diferencia !== 0) {
              const movementRef = doc(movCol);

              batch.set(movementRef, {
                tipo: "AJUSTE",

                productoId: product.id,
                productoNombre: product.nombre || row.nombre,
                productoCodigo: row.codigoFinal,

                cantidad: Number(row.diferencia),
                stockAnterior: Number(row.stockActual),
                stockNuevo: Number(row.stockNuevo),
                diferencia: Number(row.diferencia),

                motivo:
                  modoStock === "REEMPLAZAR"
                    ? "CONTEO_FISICO"
                    : "IMPORTACION_SUMA",

                observacion:
                  modoStock === "REEMPLAZAR"
                    ? `Conteo físico importado desde ${file?.name || "archivo"}.`
                    : `Cantidad sumada mediante importación desde ${file?.name || "archivo"}.`,

                origen: "IMPORTACION",
                archivo: file?.name || null,

                usuarioId: user?.uid || null,
                usuarioEmail: user?.email || null,

                fecha: serverTimestamp()
              });

              chunkActualizados += 1;
            } else {
              chunkSinCambios += 1;
            }
          } else {
            const productRef = doc(prodCol);

            batch.set(productRef, {
              codigo: row.codigoFinal,
              codigoNormalizado: row.codigoNormalizado,

              nombre: row.nombre,
              nombreLower: row.nombreLower,

              cantidad: Number(row.cantidad || 0),
              minimo: Number(row.minimo || 0),

              precioUnitario: Number(row.precioUnitario || 0),
              costoUnitario: Number(row.costoUnitario || 0),
              costoPromedio: Number(row.costoUnitario || 0),

              imagen: row.imagen || null,

              categoriaId: categoriaInfo?.id || "",
              categoriaNombre: categoriaInfo?.nombre || null,

              activo: true,
              creadoEn: serverTimestamp(),
              actualizadoEn: serverTimestamp()
            });

            if (Number(row.cantidad || 0) !== 0) {
              const movementRef = doc(movCol);

              batch.set(movementRef, {
                tipo: "INVENTARIO_INICIAL",

                productoId: productRef.id,
                productoNombre: row.nombre,
                productoCodigo: row.codigoFinal,

                cantidad: Number(row.cantidad || 0),
                stockAnterior: 0,
                stockNuevo: Number(row.cantidad || 0),
                diferencia: Number(row.cantidad || 0),

                motivo: "IMPORTACION_INICIAL",
                observacion:
                  `Inventario inicial importado desde ${file?.name || "archivo"}.`,

                origen: "IMPORTACION",
                archivo: file?.name || null,

                usuarioId: user?.uid || null,
                usuarioEmail: user?.email || null,

                fecha: serverTimestamp()
              });
            }

            chunkNuevos += 1;
          }
        }

        try {
          await batch.commit();

          ok += chunk.length;
          nuevos += chunkNuevos;
          actualizados += chunkActualizados;
          sinCambios += chunkSinCambios;
        } catch (batchError) {
          console.error("Error lote importación:", batchError);
          fail += chunk.length;
        }

        setImportStats({
          total: rowsPreparadas.length + resumenPreview.revisar,
          ok,
          fail,
          nuevos,
          actualizados,
          sinCambios
        });
      }

      await cargarProductosExistentes();

      setCreating(false);
      setStep("done");
    } catch (e) {
      console.error(e);

      setError(
        e?.message || "No se pudo completar la importación."
      );

      setCreating(false);
      setStep("preview");
    }
  };

  /* =======================================================
     RESET
  ======================================================= */

  const resetImport = () => {
    setFile(null);
    setRawRows([]);
    setHeaders([]);
    setMapping(EMPTY_MAPPING);
    setError(null);
    setModoStock("REEMPLAZAR");
    setImportStats({
      total: 0,
      ok: 0,
      fail: 0,
      nuevos: 0,
      actualizados: 0,
      sinCambios: 0
    });
    setStep("upload");
  };

  /* =======================================================
     RENDER
  ======================================================= */

  return (
    <div className="inv-root">

      <header className="inv-header">
        <div>
          <h1>Importar productos (Excel/CSV)</h1>

          <p className="inv-subtle">
            1) Sube archivo • 2) Mapea columnas • 3) Revisa • 4) Importa
          </p>
        </div>

        <div className="header-actions">
          <button
            className="btn theme-toggle"
            onClick={toggle}
          >
            {theme === "dark" ? "☀️ Claro" : "🌙 Oscuro"}
          </button>

          <Link to="/" className="btn">
            ← Inventario
          </Link>
        </div>
      </header>

      {/* ===================================================
          SUBIR
      =================================================== */}

      {step === "upload" && (
        <section
          className="inv-grid"
          style={{ gridTemplateColumns: "1fr" }}
        >
          <div className="card">
            <div className="card-header">
              <h2>Subir archivo</h2>
            </div>

            <div className="card-body">
              <p>
                Formatos soportados: <b>.csv</b>, <b>.xlsx</b>, <b>.xls</b>
              </p>

              <div
                style={{
                  padding: 14,
                  borderRadius: 14,
                  border: "1px solid rgba(59,130,246,.24)",
                  background: "rgba(59,130,246,.06)",
                  marginBottom: 16
                }}
              >
                <strong>🧠 Importación inteligente</strong>
                <p
                  className="inv-subtle"
                  style={{ margin: "5px 0 0", lineHeight: 1.55 }}
                >
                  Ordexa identifica productos por código/SKU y, si el archivo no trae código,
                  usa el nombre como respaldo. Ya no crea automáticamente un producto nuevo
                  cada vez que encuentra un nombre repetido.
                </p>
              </div>

              <input
                type="file"
                accept=".csv,.xlsx,.xls"
                onChange={onFile}
              />

              {error && (
                <div
                  className="toast toast-error"
                  style={{ position: "static", marginTop: 12 }}
                >
                  {error}
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* ===================================================
          MAPEAR
      =================================================== */}

      {step === "map" && (
        <section
          className="inv-grid"
          style={{ gridTemplateColumns: "1fr" }}
        >
          <div className="card">
            <div className="card-header">
              <h2>Mapear columnas</h2>
            </div>

            <div className="card-body">
              <p className="inv-subtle">
                Selecciona a qué columna de tu archivo corresponde cada campo.
                Código/SKU es opcional: si no viene, Ordexa puede generarlo.
              </p>

              <div
                className="form-grid"
                style={{ gridTemplateColumns: "repeat(3, 1fr)" }}
              >
                {[...REQUIRED_FIELDS, ...OPTIONAL_FIELDS].map(field => (
                  <div key={field} className="form-field">
                    <label>
                      {field}
                      {REQUIRED_FIELDS.includes(field) ? " *" : ""}
                    </label>

                    <select
                      value={mapping[field]}
                      onChange={event =>
                        setMapping(current => ({
                          ...current,
                          [field]: event.target.value
                        }))
                      }
                    >
                      <option value="">— Sin asignar —</option>

                      {headers.map(header => (
                        <option key={header} value={header}>
                          {header}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>

              {!canContinue && (
                <div
                  className="toast toast-error"
                  style={{ position: "static", marginTop: 12 }}
                >
                  Campos requeridos sin asignar:{" "}
                  {REQUIRED_FIELDS
                    .filter(field => !mapping[field])
                    .join(", ")}
                </div>
              )}

              <div
                className="card-footer"
                style={{ justifyContent: "space-between" }}
              >
                <span className="inv-subtle">
                  Filas detectadas: <b>{rawRows.length}</b>
                </span>

                <div
                  style={{
                    display: "flex",
                    gap: 8,
                    flexWrap: "wrap"
                  }}
                >
                  <button
                    className="btn"
                    onClick={resetImport}
                  >
                    ← Cambiar archivo
                  </button>

                  <button
                    className="btn btn-primary"
                    onClick={async () => {
                      if (!productosExistentes.length) {
                        await cargarProductosExistentes();
                      }

                      setStep("preview");
                    }}
                    disabled={!canContinue || cargandoProductos}
                  >
                    {cargandoProductos
                      ? "Cargando inventario..."
                      : "Siguiente: Previsualizar"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ===================================================
          PREVIEW
      =================================================== */}

      {step === "preview" && (
        <section
          className="inv-grid"
          style={{ gridTemplateColumns: "1fr" }}
        >
          <div className="card">
            <div className="card-header">
              <div>
                <h2>Previsualización inteligente</h2>
                <p
                  className="inv-subtle"
                  style={{ margin: "4px 0 0" }}
                >
                  Revisa qué hará Ordexa antes de escribir en el inventario.
                </p>
              </div>
            </div>

            <div className="card-body">

              {/* MODO STOCK */}

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
                  gap: 12,
                  marginBottom: 16
                }}
              >
                <button
                  type="button"
                  className={
                    modoStock === "REEMPLAZAR"
                      ? "btn btn-primary"
                      : "btn"
                  }
                  onClick={() => setModoStock("REEMPLAZAR")}
                  style={{
                    minHeight: 92,
                    textAlign: "left",
                    padding: 14
                  }}
                >
                  <strong>📋 Conteo físico: reemplazar stock</strong>
                  <div
                    style={{
                      marginTop: 6,
                      fontSize: 12,
                      opacity: .82,
                      lineHeight: 1.5
                    }}
                  >
                    Actual 11 + Excel 8 → resultado 8. Recomendado cuando el archivo
                    representa lo que realmente contaron en el local.
                  </div>
                </button>

                <button
                  type="button"
                  className={
                    modoStock === "SUMAR"
                      ? "btn btn-primary"
                      : "btn"
                  }
                  onClick={() => setModoStock("SUMAR")}
                  style={{
                    minHeight: 92,
                    textAlign: "left",
                    padding: 14
                  }}
                >
                  <strong>➕ Sumar cantidades</strong>
                  <div
                    style={{
                      marginTop: 6,
                      fontSize: 12,
                      opacity: .82,
                      lineHeight: 1.5
                    }}
                  >
                    Actual 11 + Excel 8 → resultado 19. Úsalo solo cuando el archivo
                    representa unidades adicionales.
                  </div>
                </button>
              </div>

              {/* RESUMEN */}

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
                  gap: 10,
                  marginBottom: 16
                }}
              >
                <PreviewStat
                  titulo="Productos"
                  valor={resumenPreview.total}
                  detalle={`${resumenPreview.filasOriginales} filas originales`}
                />

                <PreviewStat
                  titulo="Nuevos"
                  valor={resumenPreview.crear}
                  detalle="Se crearán"
                  color="#22c55e"
                />

                <PreviewStat
                  titulo="Actualizar"
                  valor={resumenPreview.actualizar}
                  detalle="Cambiarán stock"
                  color="#f59e0b"
                />

                <PreviewStat
                  titulo="Sin cambios"
                  valor={resumenPreview.sinCambios}
                  detalle="Ya coinciden"
                />

                <PreviewStat
                  titulo="Revisar"
                  valor={resumenPreview.revisar}
                  detalle="No se importarán"
                  color={resumenPreview.revisar ? "#ef4444" : "#22c55e"}
                />
              </div>

              {resumenPreview.filasOriginales > resumenPreview.consolidadas && (
                <div
                  style={{
                    padding: 12,
                    marginBottom: 14,
                    borderRadius: 12,
                    border: "1px solid rgba(34,197,94,.25)",
                    background: "rgba(34,197,94,.06)"
                  }}
                >
                  ✅ El archivo tenía productos repetidos dentro del mismo Excel.
                  Ordexa los consolidó antes de calcular el stock.
                </div>
              )}

              <div
                style={{
                  overflowX: "auto",
                  border: "1px solid var(--border)",
                  borderRadius: 12
                }}
              >
                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    minWidth: 980
                  }}
                >
                  <thead>
                    <tr>
                      <th style={th}>Filas</th>
                      <th style={th}>Código</th>
                      <th style={th}>Producto</th>
                      <th style={th}>Excel</th>
                      <th style={th}>Actual</th>
                      <th style={th}>Resultado</th>
                      <th style={th}>Acción</th>
                      <th style={th}>Estado</th>
                    </tr>
                  </thead>

                  <tbody>
                    {analisisImportacion.slice(0, 60).map(row => (
                      <tr
                        key={`${row.__row}-${row.codigo}-${row.nombre}`}
                        style={{
                          borderTop: "1px solid var(--border)"
                        }}
                      >
                        <td style={td}>
                          {(row.__rows || []).join(", ")}
                        </td>

                        <td style={td}>
                          {row.existente?.codigo || row.codigo || (
                            <span className="inv-subtle">Automático</span>
                          )}
                        </td>

                        <td style={td}>
                          <strong>{row.nombre}</strong>

                          {(row.__rows || []).length > 1 && (
                            <div
                              className="inv-subtle"
                              style={{ marginTop: 3, fontSize: 11 }}
                            >
                              {(row.__rows || []).length} filas del archivo sumadas
                            </div>
                          )}
                        </td>

                        <td style={tdRight}>
                          {number(row.cantidad)}
                        </td>

                        <td style={tdRight}>
                          {row.existente ? number(row.stockActual) : "—"}
                        </td>

                        <td style={tdRight}>
                          <strong>{number(row.stockNuevo)}</strong>

                          {row.existente && row.diferencia !== 0 && (
                            <div
                              style={{
                                marginTop: 2,
                                fontSize: 11,
                                color:
                                  row.diferencia > 0
                                    ? "#22c55e"
                                    : "#ef4444"
                              }}
                            >
                              {row.diferencia > 0 ? "+" : ""}
                              {number(row.diferencia)}
                            </div>
                          )}
                        </td>

                        <td style={td}>
                          <ActionBadge accion={row.accion} />
                        </td>

                        <td style={td}>
                          {row.importable ? (
                            "✅"
                          ) : (
                            <span
                              style={{
                                color: "#ef4444",
                                fontSize: 12
                              }}
                            >
                              ⚠️ {row.problema}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div
                style={{
                  marginTop: 14,
                  padding: 12,
                  borderRadius: 12,
                  border: "1px solid rgba(59,130,246,.22)",
                  background: "rgba(59,130,246,.05)"
                }}
              >
                <strong>🔐 Importante</strong>
                <p
                  className="inv-subtle"
                  style={{ margin: "5px 0 0", lineHeight: 1.55 }}
                >
                  Los productos existentes conservan su precio y costo promedio.
                  El importador solo concilia el stock y registra el cambio en el Kardex.
                  Los productos nuevos sí toman precio, costo, mínimo, categoría e imagen del archivo.
                </p>
              </div>

              {error && (
                <div
                  className="toast toast-error"
                  style={{ position: "static", marginTop: 12 }}
                >
                  {error}
                </div>
              )}
            </div>

            <div
              className="card-footer"
              style={{ justifyContent: "space-between" }}
            >
              <button
                className="btn"
                onClick={() => setStep("map")}
              >
                ← Volver
              </button>

              <button
                className="btn btn-primary"
                onClick={startImport}
                disabled={
                  creating ||
                  !analisisImportacion.some(row => row.importable)
                }
              >
                {modoStock === "REEMPLAZAR"
                  ? "✓ Importar y conciliar inventario"
                  : "✓ Importar y sumar cantidades"}
              </button>
            </div>
          </div>
        </section>
      )}

      {/* ===================================================
          IMPORTANDO
      =================================================== */}

      {step === "importing" && (
        <section
          className="inv-grid"
          style={{ gridTemplateColumns: "1fr" }}
        >
          <div className="card">
            <div className="card-header">
              <h2>Importando…</h2>
            </div>

            <div className="card-body">
              <p className="inv-subtle">
                No cierres esta pestaña.
              </p>

              <p>
                Total: <b>{importStats.total}</b> •{" "}
                OK: <b>{importStats.ok}</b> •{" "}
                Fallidos: <b>{importStats.fail}</b>
              </p>

              <p>
                Nuevos: <b>{importStats.nuevos}</b> •{" "}
                Ajustados: <b>{importStats.actualizados}</b> •{" "}
                Sin cambios: <b>{importStats.sinCambios}</b>
              </p>

              {creating && (
                <p>
                  Creando categorías, asignando códigos y registrando movimientos…
                </p>
              )}

              {error && (
                <div
                  className="toast toast-error"
                  style={{ position: "static", marginTop: 12 }}
                >
                  {error}
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* ===================================================
          TERMINADO
      =================================================== */}

      {step === "done" && (
        <section
          className="inv-grid"
          style={{ gridTemplateColumns: "1fr" }}
        >
          <div className="card">
            <div className="card-header">
              <h2>✅ Importación completa</h2>
            </div>

            <div className="card-body">
              <p>Total revisado: <b>{importStats.total}</b></p>
              <p>Procesados correctamente: <b>{importStats.ok}</b></p>
              <p>Productos nuevos: <b>{importStats.nuevos}</b></p>
              <p>Productos con cambio de stock: <b>{importStats.actualizados}</b></p>
              <p>Productos sin cambio de stock: <b>{importStats.sinCambios}</b></p>
              <p>Filas que requieren revisión: <b>{importStats.fail}</b></p>

              <div
                className="card-footer"
                style={{
                  padding: 0,
                  marginTop: 12,
                  justifyContent: "flex-start"
                }}
              >
                <Link to="/" className="btn btn-primary">
                  ← Ir al Inventario
                </Link>

                <button
                  className="btn"
                  onClick={resetImport}
                >
                  Importar otro archivo
                </button>
              </div>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

/* =========================================================
   PEQUEÑOS COMPONENTES
========================================================= */

function PreviewStat({ titulo, valor, detalle, color }) {
  return (
    <div
      style={{
        padding: 12,
        borderRadius: 12,
        border: "1px solid var(--border)",
        background: "rgba(255,255,255,.02)"
      }}
    >
      <div className="inv-subtle" style={{ fontSize: 11 }}>
        {titulo}
      </div>

      <strong
        style={{
          display: "block",
          marginTop: 4,
          fontSize: 21,
          color: color || "var(--text)"
        }}
      >
        {number(valor)}
      </strong>

      <div
        className="inv-subtle"
        style={{ marginTop: 3, fontSize: 10 }}
      >
        {detalle}
      </div>
    </div>
  );
}

function ActionBadge({ accion }) {
  const config = {
    CREAR: {
      text: "🆕 Crear",
      color: "#22c55e"
    },
    ACTUALIZAR: {
      text: "🔄 Actualizar",
      color: "#f59e0b"
    },
    SIN_CAMBIO: {
      text: "✓ Sin cambio",
      color: "#94a3b8"
    },
    REVISAR: {
      text: "⚠️ Revisar",
      color: "#ef4444"
    },
    IGNORAR: {
      text: "✕ Ignorar",
      color: "#ef4444"
    }
  };

  const selected = config[accion] || config.REVISAR;

  return (
    <span
      className="badge"
      style={{
        color: selected.color,
        whiteSpace: "nowrap"
      }}
    >
      {selected.text}
    </span>
  );
}

/* =========================================================
   ESTILOS TABLA
========================================================= */

const th = {
  textAlign: "left",
  padding: "10px 12px",
  borderBottom: "1px solid var(--border)",
  background: "var(--card)",
  whiteSpace: "nowrap"
};

const td = {
  padding: "9px 12px",
  verticalAlign: "top"
};

const tdRight = {
  ...td,
  textAlign: "right",
  fontVariantNumeric: "tabular-nums"
};
