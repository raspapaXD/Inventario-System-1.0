import {
  useMemo,
  useState
} from "react";

import {
  collection,
  doc,
  getDocs,
  limit,
  query,
  runTransaction,
  serverTimestamp,
  Timestamp,
  where
} from "firebase/firestore";

import { db } from "../../firebaseClient.js";
import { useTenant } from "../tenant/TenantProvider.jsx";

const moneda = value =>
  `$${Number(value || 0).toLocaleString("es-CO", {
    maximumFractionDigits: 0
  })}`;

const cantidad = value =>
  Number(value || 0).toLocaleString("es-CO");

/*
 * Campos monetarios amigables:
 * 16000 -> 16.000
 * 1500000 -> 1.500.000
 *
 * Internamente seguimos trabajando con números reales.
 */
const soloDigitos = value =>
  String(value ?? "")
    .replace(/[^0-9]/g, "");

const formatearMilesInput = value => {
  const limpio =
    soloDigitos(value);

  if (!limpio) {
    return "";
  }

  return Number(limpio)
    .toLocaleString("es-CO");
};

const numero = value => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  const limpio = String(value ?? "")
    .trim()
    .replace(/\./g, "")
    .replace(/,/g, ".");

  const n = Number(limpio);
  return Number.isFinite(n) ? n : 0;
};

const slug = value =>
  String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "proveedor";

function toDate(value) {
  if (!value) return null;
  if (typeof value?.toDate === "function") return value.toDate();

  if (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    return new Date(`${value}T12:00:00`);
  }

  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function fechaInput(value) {
  const d = toDate(value);
  if (!d) return "";

  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dia}`;
}

function fechaTimestamp(value) {
  if (!value) return null;
  return Timestamp.fromDate(
    new Date(`${value}T12:00:00`)
  );
}

function normalizarItem(item) {
  const qty = Number(item.cantidad || 0);
  const costo = Number(
    item.costoUnitario ??
    item.costoCompra ??
    0
  );

  return {
    productoId: item.productoId,
    codigo:
      item.codigo ||
      item.productoCodigo ||
      null,
    nombre:
      item.nombre ||
      item.productoNombre ||
      "Producto",
    cantidad: qty,
    costoUnitario: costo,
    subtotal:
      Number(item.subtotal || 0) ||
      qty * costo,
    porcentajeGanancia:
      Number(
        item.porcentajeGanancia ??
        item.gananciaObjetivo ??
        0
      ),
    porcentajeGananciaMinima:
      Number(
        item.porcentajeGananciaMinima ??
        item.gananciaMinima ??
        0
      ),
    precioVenta:
      Number(
        item.precioVenta ??
        item.precioUnitario ??
        0
      )
  };
}

export default function EditarFacturaCompraModal({
  compra,
  cuenta,
  onClose,
  onSaved
}) {
  const {
    empresa,
    user
  } = useTenant();

  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const [paso, setPaso] = useState("editar");

  const [form, setForm] = useState({
    numeroFactura: compra?.numeroFactura || "",
    fecha: fechaInput(compra?.fechaFactura),
    proveedorNombre: compra?.proveedorNombre || "",
    proveedorDocumento: compra?.proveedorDocumento || "",
    tipoPago: compra?.tipoPago || "CONTADO",
    fechaVencimiento: fechaInput(
      cuenta?.fechaVencimiento ??
      compra?.fechaVencimiento
    )
  });

  const [items, setItems] = useState(
    (compra?.items || []).map(item => {
      const n = normalizarItem(item);
      return {
        ...n,
        cantidad: String(n.cantidad),
        costoUnitario: String(n.costoUnitario)
      };
    })
  );

  const [motivo, setMotivo] = useState("");

  const originales = useMemo(
    () =>
      (compra?.items || []).map(
        normalizarItem
      ),
    [compra]
  );

  const totalAnterior = Number(
    compra?.total || 0
  );

  const saldoAnterior =
    compra?.tipoPago === "CREDITO"
      ? Number(
          cuenta?.saldoPendiente ??
          compra?.saldoPendiente ??
          totalAnterior
        )
      : 0;

  const pagadoAnterior =
    compra?.tipoPago === "CREDITO"
      ? Math.max(
          0,
          totalAnterior - saldoAnterior
        )
      : 0;

  const totalNuevo = useMemo(
    () =>
      items.reduce(
        (acc, item) =>
          acc +
          numero(item.cantidad) *
          numero(item.costoUnitario),
        0
      ),
    [items]
  );

  const resumenCambios = useMemo(() => {
    const oldMap = new Map(
      originales.map(item => [
        item.productoId,
        item
      ])
    );

    const newMap = new Map(
      items.map(item => [
        item.productoId,
        {
          ...item,
          cantidad: numero(item.cantidad),
          costoUnitario: numero(item.costoUnitario)
        }
      ])
    );

    const ids = new Set([
      ...oldMap.keys(),
      ...newMap.keys()
    ]);

    const cambiosProductos = [];

    for (const productoId of ids) {
      const anterior = oldMap.get(productoId);
      const nuevo = newMap.get(productoId);

      const qtyAnterior = Number(
        anterior?.cantidad || 0
      );
      const qtyNueva = Number(
        nuevo?.cantidad || 0
      );
      const costoAnterior = Number(
        anterior?.costoUnitario || 0
      );
      const costoNuevo = Number(
        nuevo?.costoUnitario || 0
      );

      if (
        qtyAnterior !== qtyNueva ||
        costoAnterior !== costoNuevo
      ) {
        cambiosProductos.push({
          productoId,
          nombre:
            nuevo?.nombre ||
            anterior?.nombre ||
            "Producto",
          cantidadAnterior: qtyAnterior,
          cantidadNueva: qtyNueva,
          diferencia: qtyNueva - qtyAnterior,
          costoAnterior,
          costoNuevo
        });
      }
    }

    const cabeceraCambiada =
      form.numeroFactura.trim() !==
        String(compra?.numeroFactura || "").trim() ||
      form.fecha !==
        fechaInput(compra?.fechaFactura) ||
      form.proveedorNombre.trim() !==
        String(compra?.proveedorNombre || "").trim() ||
      form.proveedorDocumento.trim() !==
        String(compra?.proveedorDocumento || "").trim() ||
      form.tipoPago !==
        (compra?.tipoPago || "CONTADO") ||
      form.fechaVencimiento !==
        fechaInput(
          cuenta?.fechaVencimiento ??
          compra?.fechaVencimiento
        );

    return {
      cabeceraCambiada,
      cambiosProductos,
      hayCambios:
        cabeceraCambiada ||
        cambiosProductos.length > 0,
      diferenciaTotal:
        totalNuevo - totalAnterior
    };
  }, [
    compra,
    cuenta,
    form,
    items,
    originales,
    totalAnterior,
    totalNuevo
  ]);

  const actualizarItem = (
    productoId,
    campo,
    value
  ) => {
    setItems(prev =>
      prev.map(item =>
        item.productoId === productoId
          ? {
              ...item,
              [campo]: value
            }
          : item
      )
    );
  };

  const validar = () => {
    if (!form.numeroFactura.trim()) {
      return "Ingresa el número de factura.";
    }

    if (!form.fecha) {
      return "Selecciona la fecha de la factura.";
    }

    if (!form.proveedorNombre.trim()) {
      return "Ingresa el proveedor.";
    }

    if (items.length === 0) {
      return "La factura debe tener al menos un producto.";
    }

    for (const item of items) {
      const qty = numero(item.cantidad);
      const costo = numero(item.costoUnitario);

      if (!Number.isInteger(qty) || qty < 0) {
        return `${item.nombre}: la cantidad debe ser un entero igual o mayor que cero.`;
      }

      if (qty > 0 && costo <= 0) {
        return `${item.nombre}: el costo debe ser mayor que cero.`;
      }
    }

    const itemsConCantidad = items.filter(
      item => numero(item.cantidad) > 0
    );

    if (itemsConCantidad.length === 0) {
      return "Todas las cantidades quedaron en 0. Si se devolvió toda la mercancía, usa ‘Anular factura’ para conservar correctamente el historial.";
    }

    if (
      form.tipoPago === "CREDITO" &&
      !form.fechaVencimiento
    ) {
      return "Una factura a crédito necesita fecha de vencimiento.";
    }

    if (!motivo.trim()) {
      return "Escribe el motivo de la modificación.";
    }

    if (!resumenCambios.hayCambios) {
      return "No hay cambios para guardar.";
    }

    if (
      compra?.tipoPago === "CREDITO" &&
      form.tipoPago === "CONTADO" &&
      pagadoAnterior > 0
    ) {
      return "Esta factura ya tiene abonos. No puede cambiarse de crédito a contado.";
    }

    if (
      form.tipoPago === "CREDITO" &&
      totalNuevo < pagadoAnterior
    ) {
      return `El nuevo total no puede ser menor que lo ya pagado (${moneda(
        pagadoAnterior
      )}).`;
    }

    return "";
  };

  const revisar = () => {
    const mensaje = validar();

    if (mensaje) {
      setError(mensaje);
      return;
    }

    setError("");
    setPaso("confirmar");
  };

  const guardar = async () => {
    const mensaje = validar();

    if (mensaje) {
      setError(mensaje);
      setPaso("editar");
      return;
    }

    if (!empresa?.id || !compra?.id || !user?.uid) {
      return;
    }

    try {
      setGuardando(true);
      setError("");

      let cuentaRef = null;

      const cuentaQuery = await getDocs(
        query(
          collection(
            db,
            "empresas",
            empresa.id,
            "cuentasPorPagar"
          ),
          where(
            "compraId",
            "==",
            compra.id
          ),
          limit(1)
        )
      );

      if (!cuentaQuery.empty) {
        cuentaRef = cuentaQuery.docs[0].ref;
      } else if (form.tipoPago === "CREDITO") {
        cuentaRef = doc(
          collection(
            db,
            "empresas",
            empresa.id,
            "cuentasPorPagar"
          )
        );
      }

      const compraRef = doc(
        db,
        "empresas",
        empresa.id,
        "compras",
        compra.id
      );

      const proveedorId =
        form.proveedorDocumento.trim() ||
        slug(form.proveedorNombre);

      const proveedorRef = doc(
        db,
        "empresas",
        empresa.id,
        "proveedores",
        proveedorId
      );

      await runTransaction(
        db,
        async transaction => {
          const compraSnap =
            await transaction.get(compraRef);

          if (!compraSnap.exists()) {
            throw new Error(
              "La factura ya no existe."
            );
          }

          const compraActual =
            compraSnap.data();

          const versionVista = Number(
            compra.version || 1
          );

          const versionActual = Number(
            compraActual.version || 1
          );

          if (versionVista !== versionActual) {
            throw new Error(
              "Esta factura fue modificada desde otro dispositivo. Recarga la página."
            );
          }

          let cuentaActual = null;

          if (cuentaRef) {
            const cuentaSnap =
              await transaction.get(cuentaRef);

            if (cuentaSnap.exists()) {
              cuentaActual = cuentaSnap.data();
            }
          }

          const oldMap = new Map(
            (compraActual.items || []).map(item => {
              const n = normalizarItem(item);
              return [n.productoId, n];
            })
          );

          const newMap = new Map(
            items.map(item => [
              item.productoId,
              {
                ...item,
                cantidad: numero(item.cantidad),
                costoUnitario: numero(item.costoUnitario)
              }
            ])
          );

          const productoIds = Array.from(
            new Set([
              ...oldMap.keys(),
              ...newMap.keys()
            ])
          );

          const productosTx = new Map();

          /* Todas las lecturas antes de las escrituras. */
          for (const productoId of productoIds) {
            const ref = doc(
              db,
              "empresas",
              empresa.id,
              "productos",
              productoId
            );

            const snap = await transaction.get(ref);

            if (!snap.exists()) {
              throw new Error(
                "Uno de los productos de la factura ya no existe."
              );
            }

            productosTx.set(productoId, {
              ref,
              data: snap.data()
            });
          }

          const totalAnteriorTx = Number(
            compraActual.total || 0
          );

          const saldoAnteriorTx =
            compraActual.tipoPago === "CREDITO"
              ? Number(
                  cuentaActual?.saldoPendiente ??
                  compraActual.saldoPendiente ??
                  totalAnteriorTx
                )
              : 0;

          const pagadoTx =
            compraActual.tipoPago === "CREDITO"
              ? Math.max(
                  0,
                  totalAnteriorTx - saldoAnteriorTx
                )
              : 0;

          const totalNuevoTx = items.reduce(
            (acc, item) =>
              acc +
              numero(item.cantidad) *
              numero(item.costoUnitario),
            0
          );

          if (
            form.tipoPago === "CONTADO" &&
            compraActual.tipoPago === "CREDITO" &&
            pagadoTx > 0
          ) {
            throw new Error(
              "La factura tiene abonos y no puede cambiarse a contado."
            );
          }

          if (
            form.tipoPago === "CREDITO" &&
            totalNuevoTx < pagadoTx
          ) {
            throw new Error(
              `El total corregido no puede ser menor que lo ya pagado (${moneda(
                pagadoTx
              )}).`
            );
          }

          const itemsActualizados = [];

          for (const productoId of productoIds) {
            const anterior = oldMap.get(productoId);
            const nuevo = newMap.get(productoId);
            const info = productosTx.get(productoId);
            const p = info.data;

            const qtyAnterior = Number(
              anterior?.cantidad || 0
            );
            const qtyNueva = Number(
              nuevo?.cantidad || 0
            );
            const costoAnteriorFactura = Number(
              anterior?.costoUnitario || 0
            );
            const costoNuevoFactura = Number(
              nuevo?.costoUnitario || 0
            );

            const diferenciaStock =
              qtyNueva - qtyAnterior;

            const valorAnteriorFactura =
              qtyAnterior * costoAnteriorFactura;
            const valorNuevoFactura =
              qtyNueva * costoNuevoFactura;
            const diferenciaValor =
              valorNuevoFactura - valorAnteriorFactura;

            const stockActual = Number(
              p.cantidad || 0
            );
            const stockNuevo =
              stockActual + diferenciaStock;

            if (stockNuevo < 0) {
              throw new Error(
                `${p.nombre}: la corrección dejaría el stock negativo.`
              );
            }

            const costoPromedioActual = Number(
              p.costoPromedio ??
              p.costoUnitario ??
              0
            );

            const valorInventarioActual =
              stockActual * costoPromedioActual;

            const valorInventarioNuevo =
              valorInventarioActual + diferenciaValor;

            if (
              stockNuevo > 0 &&
              valorInventarioNuevo < 0
            ) {
              throw new Error(
                `${p.nombre}: la corrección del costo no puede aplicarse de forma segura al inventario actual.`
              );
            }

            const costoPromedioNuevo =
              stockNuevo > 0
                ? Math.max(
                    0,
                    valorInventarioNuevo / stockNuevo
                  )
                : 0;

            const porcentajeObjetivo = Number(
              p.porcentajeGanancia ??
              nuevo?.porcentajeGanancia ??
              anterior?.porcentajeGanancia ??
              0
            );

            const porcentajeMinimo = Number(
              p.porcentajeGananciaMinima ??
              nuevo?.porcentajeGananciaMinima ??
              anterior?.porcentajeGananciaMinima ??
              0
            );

            const precioSugerido =
              costoPromedioNuevo *
              (1 + porcentajeObjetivo / 100);

            const precioMinimo =
              costoPromedioNuevo *
              (1 + porcentajeMinimo / 100);

            const huboCambio =
              diferenciaStock !== 0 ||
              diferenciaValor !== 0;

            if (huboCambio) {
              transaction.update(info.ref, {
                cantidad: stockNuevo,
                costoPromedio: costoPromedioNuevo,
                costoUnitario: costoPromedioNuevo,
                precioSugerido:
                  Math.round(precioSugerido),
                precioMinimo:
                  Math.round(precioMinimo),
                actualizadoEn: serverTimestamp()
              });

              const movimientoRef = doc(
                collection(
                  db,
                  "empresas",
                  empresa.id,
                  "movimientos"
                )
              );

              transaction.set(movimientoRef, {
                tipo: "AJUSTE",
                origen: "EDICION_FACTURA_COMPRA",
                motivo: "EDICION_FACTURA_COMPRA",
                observacion: motivo.trim(),
                compraId: compra.id,
                numeroFacturaAnterior:
                  compraActual.numeroFactura || null,
                numeroFacturaNuevo:
                  form.numeroFactura.trim(),
                productoId,
                productoNombre:
                  p.nombre ||
                  nuevo?.nombre ||
                  anterior?.nombre ||
                  "Producto",
                productoCodigo:
                  p.codigo ||
                  nuevo?.codigo ||
                  anterior?.codigo ||
                  null,
                cantidad: diferenciaStock,
                diferencia: diferenciaStock,
                stockAnterior: stockActual,
                stockNuevo,
                costoPromedioAnterior:
                  costoPromedioActual,
                costoPromedioNuevo,
                costoAnteriorFactura,
                costoNuevoFactura,
                valorAnteriorFactura,
                valorNuevoFactura,
                ajusteValorInventario:
                  diferenciaValor,
                usuarioId: user.uid,
                usuarioEmail:
                  user.email || null,
                fecha: serverTimestamp()
              });
            }

            if (nuevo && qtyNueva > 0) {
              itemsActualizados.push({
                productoId,
                codigo:
                  p.codigo ||
                  nuevo.codigo ||
                  null,
                nombre:
                  p.nombre || nuevo.nombre,
                cantidad: qtyNueva,
                costoUnitario:
                  costoNuevoFactura,
                subtotal:
                  qtyNueva * costoNuevoFactura,
                stockAnterior: stockActual,
                stockNuevo,
                diferencia: diferenciaStock,
                costoPromedioNuevo,
                porcentajeGanancia:
                  porcentajeObjetivo,
                porcentajeGananciaMinima:
                  porcentajeMinimo,
                precioSugerido:
                  Math.round(precioSugerido),
                precioMinimo:
                  Math.round(precioMinimo),
                precioVenta: Number(
                  p.precioUnitario ||
                  nuevo.precioVenta ||
                  0
                )
              });
            }
          }

          const esCreditoNuevo =
            form.tipoPago === "CREDITO";

          const saldoNuevo = esCreditoNuevo
            ? Math.max(
                0,
                totalNuevoTx - pagadoTx
              )
            : 0;

          const estadoNuevo = !esCreditoNuevo
            ? "PAGADA"
            : saldoNuevo <= 0
              ? "PAGADA"
              : pagadoTx > 0
                ? "PARCIAL"
                : "PENDIENTE";

          transaction.set(
            proveedorRef,
            {
              nombre:
                form.proveedorNombre.trim(),
              nombreLower:
                form.proveedorNombre
                  .trim()
                  .toLowerCase(),
              documento:
                form.proveedorDocumento.trim() ||
                null,
              updatedAt: serverTimestamp()
            },
            { merge: true }
          );

          if (esCreditoNuevo) {
            if (!cuentaRef) {
              throw new Error(
                "No fue posible preparar la cuenta por pagar."
              );
            }

            transaction.set(
              cuentaRef,
              {
                compraId: compra.id,
                numeroFactura:
                  form.numeroFactura.trim(),
                proveedorId,
                proveedorNombre:
                  form.proveedorNombre.trim(),
                total: totalNuevoTx,
                saldoPendiente: saldoNuevo,
                estado: estadoNuevo,
                fechaFactura:
                  fechaTimestamp(form.fecha),
                fechaVencimiento:
                  fechaTimestamp(
                    form.fechaVencimiento
                  ),
                updatedAt: serverTimestamp(),
                ...(cuentaActual
                  ? {}
                  : {
                      createdAt:
                        serverTimestamp()
                    })
              },
              { merge: true }
            );
          } else if (cuentaRef && cuentaActual) {
            transaction.delete(cuentaRef);
          }

          transaction.update(compraRef, {
            numeroFactura:
              form.numeroFactura.trim(),
            proveedorId,
            proveedorNombre:
              form.proveedorNombre.trim(),
            proveedorDocumento:
              form.proveedorDocumento.trim() ||
              null,
            tipoPago: form.tipoPago,
            fechaFactura:
              fechaTimestamp(form.fecha),
            fechaVencimiento:
              esCreditoNuevo
                ? fechaTimestamp(
                    form.fechaVencimiento
                  )
                : null,
            items: itemsActualizados,
            total: totalNuevoTx,
            saldoPendiente: saldoNuevo,
            estadoPago: estadoNuevo,
            version: versionActual + 1,
            modificadoEn: serverTimestamp(),
            modificadoPorId: user.uid,
            modificadoPorEmail:
              user.email || null,
            motivoUltimaEdicion:
              motivo.trim()
          });
        }
      );

      onSaved?.();
    } catch (e) {
      console.error(e);
      setError(
        e?.message ||
        "No se pudo modificar la factura."
      );
      setPaso("editar");
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
    >
      <div
        className="modal-card"
        style={{
          width: "94vw",
          maxWidth: 980,
          maxHeight: "92vh",
          overflowY: "auto",
          borderRadius: 22
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 12,
            marginBottom: 18
          }}
        >
          <div>
            <h3 style={{ margin: 0, fontSize: 20 }}>
              {paso === "editar"
                ? "✏️ Editar factura de compra"
                : "🔎 Revisar modificación"}
            </h3>

            <p
              className="inv-subtle"
              style={{ margin: "5px 0 0" }}
            >
              {paso === "editar"
                ? "Solo puedes corregir los productos que ya pertenecen a esta factura. Ordexa aplicará las diferencias y conservará el historial."
                : "Confirma cuidadosamente los cambios antes de aplicarlos."}
            </p>
          </div>

          <button
            type="button"
            className="btn"
            onClick={onClose}
            disabled={guardando}
          >
            ✕
          </button>
        </div>

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

        {paso === "editar" ? (
          <>
            <div
              style={{
                padding: 13,
                borderRadius: 13,
                border:
                  "1px solid rgba(59,130,246,.25)",
                background:
                  "rgba(59,130,246,.055)",
                marginBottom: 18
              }}
            >
              <strong style={{ color: "#3b82f6" }}>
                🛡️ Edición segura
              </strong>
              <p
                className="inv-subtle"
                style={{ margin: "5px 0 0" }}
              >
                Ejemplo: si la factura decía 10 unidades y la corriges a 8, Ordexa registra una corrección de -2; no vuelve a sumar la compra.
              </p>
            </div>

            <h4 style={{ margin: "0 0 10px" }}>
              Datos de la factura
            </h4>

            <div className="form-grid">
              <Campo
                label="Número de factura *"
                value={form.numeroFactura}
                onChange={value =>
                  setForm(prev => ({
                    ...prev,
                    numeroFactura: value
                  }))
                }
              />

              <Campo
                label="Fecha *"
                type="date"
                value={form.fecha}
                onChange={value =>
                  setForm(prev => ({
                    ...prev,
                    fecha: value
                  }))
                }
              />

              <Campo
                label="Proveedor *"
                value={form.proveedorNombre}
                onChange={value =>
                  setForm(prev => ({
                    ...prev,
                    proveedorNombre: value
                  }))
                }
              />

              <Campo
                label="NIT / Documento"
                value={form.proveedorDocumento}
                onChange={value =>
                  setForm(prev => ({
                    ...prev,
                    proveedorDocumento: value
                  }))
                }
              />

              <div className="form-field">
                <label>Forma de pago *</label>
                <select
                  value={form.tipoPago}
                  onChange={e =>
                    setForm(prev => ({
                      ...prev,
                      tipoPago: e.target.value,
                      fechaVencimiento:
                        e.target.value === "CONTADO"
                          ? ""
                          : prev.fechaVencimiento
                    }))
                  }
                >
                  <option value="CONTADO">Contado</option>
                  <option value="CREDITO">Crédito</option>
                </select>
              </div>

              {form.tipoPago === "CREDITO" && (
                <Campo
                  label="Fecha vencimiento *"
                  type="date"
                  value={form.fechaVencimiento}
                  onChange={value =>
                    setForm(prev => ({
                      ...prev,
                      fechaVencimiento: value
                    }))
                  }
                />
              )}
            </div>

            <div style={{ marginTop: 22 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 10,
                  marginBottom: 10
                }}
              >
                <h4 style={{ margin: 0 }}>Productos</h4>
                <span className="badge">
                  {items.length} referencia(s)
                </span>
              </div>

              <div style={{ display: "grid", gap: 9 }}>
                {items.map(item => (
                  <div
                    key={item.productoId}
                    style={{
                      display: "grid",
                      gridTemplateColumns:
                        "minmax(180px, 1fr) 120px 150px 48px",
                      gap: 9,
                      alignItems: "end",
                      padding: 11,
                      borderRadius: 12,
                      border:
                        "1px solid var(--border)",
                      background:
                        "rgba(255,255,255,.018)"
                    }}
                  >
                    <div>
                      <strong>{item.nombre}</strong>
                      {item.codigo && (
                        <div
                          className="inv-subtle"
                          style={{
                            marginTop: 3,
                            fontSize: 10
                          }}
                        >
                          SKU: {item.codigo}
                        </div>
                      )}
                    </div>

                    <div>
                      <Campo
                        label="Cantidad"
                        type="number"
                        value={item.cantidad}
                        onChange={value =>
                          actualizarItem(
                            item.productoId,
                            "cantidad",
                            value
                          )
                        }
                      />
                      <div className="inv-subtle" style={{ fontSize: 10, marginTop: 4 }}>
                        Puedes usar 0 si esta referencia fue devuelta por completo.
                      </div>
                    </div>

                    <CampoMoneda
                      label="Costo unitario"
                      value={item.costoUnitario}
                      onChange={value =>
                        actualizarItem(
                          item.productoId,
                          "costoUnitario",
                          value
                        )
                      }
                    />

                    <button
                      type="button"
                      className="btn btn-danger"
                      onClick={() =>
                        setItems(prev =>
                          prev.filter(
                            x =>
                              x.productoId !==
                              item.productoId
                          )
                        )
                      }
                      title="Quitar producto"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>

            </div>

            <div
              className="form-field"
              style={{ marginTop: 20 }}
            >
              <label>Motivo de la modificación *</label>
              <textarea
                rows="3"
                placeholder="Ej: la factura física decía 8 unidades y se registraron 10 por error."
                value={motivo}
                onChange={e => setMotivo(e.target.value)}
                style={{
                  width: "100%",
                  resize: "vertical"
                }}
              />
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
                padding: 14,
                marginTop: 16,
                borderRadius: 13,
                border:
                  "1px solid var(--border)",
                flexWrap: "wrap"
              }}
            >
              <span className="inv-subtle">
                Nuevo total calculado
              </span>
              <strong style={{ fontSize: 22 }}>
                {moneda(totalNuevo)}
              </strong>
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: 8,
                flexWrap: "wrap",
                marginTop: 20
              }}
            >
              <button
                type="button"
                className="btn"
                onClick={onClose}
              >
                Cancelar
              </button>

              <button
                type="button"
                className="btn btn-primary"
                onClick={revisar}
              >
                Revisar cambios →
              </button>
            </div>
          </>
        ) : (
          <>
            <div
              style={{
                display: "grid",
                gridTemplateColumns:
                  "repeat(3, 1fr)",
                gap: 10,
                marginBottom: 18
              }}
            >
              <Resumen
                titulo="Total anterior"
                valor={moneda(totalAnterior)}
              />
              <Resumen
                titulo="Nuevo total"
                valor={moneda(totalNuevo)}
              />
              <Resumen
                titulo="Diferencia"
                valor={`${
                  resumenCambios.diferenciaTotal >= 0
                    ? "+"
                    : ""
                }${moneda(
                  resumenCambios.diferenciaTotal
                )}`}
                color={
                  resumenCambios.diferenciaTotal > 0
                    ? "#22c55e"
                    : resumenCambios.diferenciaTotal < 0
                      ? "#ef4444"
                      : undefined
                }
              />
            </div>

            {resumenCambios.cabeceraCambiada && (
              <div
                style={{
                  padding: 12,
                  borderRadius: 12,
                  border:
                    "1px solid rgba(59,130,246,.25)",
                  background:
                    "rgba(59,130,246,.055)",
                  marginBottom: 14
                }}
              >
                🧾 También cambiaste datos generales de la factura o del proveedor.
              </div>
            )}

            <h4 style={{ margin: "0 0 10px" }}>
              Correcciones de productos
            </h4>

            {resumenCambios.cambiosProductos.length === 0 ? (
              <p className="inv-subtle">
                No hay cambios de cantidad o costo.
              </p>
            ) : (
              <div style={{ display: "grid", gap: 9 }}>
                {resumenCambios.cambiosProductos.map(
                  cambio => (
                    <div
                      key={cambio.productoId}
                      style={{
                        padding: 12,
                        borderRadius: 12,
                        border:
                          "1px solid var(--border)"
                      }}
                    >
                      <strong>{cambio.nombre}</strong>
                      <div
                        className="product-meta"
                        style={{ marginTop: 7 }}
                      >
                        <span>
                          Cantidad: <b>
                            {cantidad(
                              cambio.cantidadAnterior
                            )} → {cantidad(
                              cambio.cantidadNueva
                            )}
                          </b>
                        </span>
                        <span>
                          Ajuste stock: <b
                            style={{
                              color:
                                cambio.diferencia > 0
                                  ? "#22c55e"
                                  : cambio.diferencia < 0
                                    ? "#ef4444"
                                    : "var(--text)"
                            }}
                          >
                            {cambio.diferencia > 0
                              ? "+"
                              : ""}
                            {cantidad(cambio.diferencia)}
                          </b>
                        </span>
                        <span>
                          Costo: <b>
                            {moneda(
                              cambio.costoAnterior
                            )} → {moneda(
                              cambio.costoNuevo
                            )}
                          </b>
                        </span>
                      </div>
                    </div>
                  )
                )}
              </div>
            )}

            <div
              style={{
                marginTop: 16,
                padding: 13,
                borderRadius: 13,
                border:
                  "1px solid rgba(245,158,11,.25)",
                background:
                  "rgba(245,158,11,.055)"
              }}
            >
              <strong style={{ color: "#f59e0b" }}>
                ⚠️ Esta acción afecta datos reales
              </strong>
              <p
                className="inv-subtle"
                style={{ margin: "5px 0 0" }}
              >
                Se actualizarán factura, inventario, costo promedio, Kardex y cuenta por pagar según corresponda.
              </p>
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: 8,
                flexWrap: "wrap",
                marginTop: 20
              }}
            >
              <button
                type="button"
                className="btn"
                onClick={() => setPaso("editar")}
                disabled={guardando}
              >
                ← Volver a editar
              </button>

              <button
                type="button"
                className="btn btn-primary"
                onClick={guardar}
                disabled={guardando}
              >
                {guardando
                  ? "Aplicando corrección..."
                  : "✓ Confirmar modificación"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Campo({
  label,
  type = "text",
  value,
  onChange
}) {
  return (
    <div className="form-field">
      <label>{label}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
      />
    </div>
  );
}

function CampoMoneda({
  label,
  value,
  onChange
}) {
  return (
    <div className="form-field">
      <label>{label}</label>

      <input
        type="text"
        inputMode="numeric"
        value={
          formatearMilesInput(
            value
          )
        }
        placeholder="0"
        onChange={e =>
          onChange(
            soloDigitos(
              e.target.value
            )
          )
        }
      />
    </div>
  );
}

function Resumen({
  titulo,
  valor,
  color
}) {
  return (
    <div
      style={{
        padding: 12,
        borderRadius: 12,
        border:
          "1px solid var(--border)"
      }}
    >
      <div
        className="inv-subtle"
        style={{ fontSize: 10 }}
      >
        {titulo}
      </div>
      <strong
        style={{
          display: "block",
          marginTop: 4,
          color: color || "var(--text)"
        }}
      >
        {valor}
      </strong>
    </div>
  );
}
