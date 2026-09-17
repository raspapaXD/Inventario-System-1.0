import { useMemo, useState } from "react";
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
import { useTenant } from "../tenant/TenantProvider";
import "../pages/inventario.css";

const moneda = value =>
  `$${Number(value || 0).toLocaleString("es-CO", {
    maximumFractionDigits: 0
  })}`;

const soloDigitos = value =>
  String(value ?? "").replace(/[^0-9]/g, "");

const numero = value => {
  const limpio = soloDigitos(value);
  return limpio ? Number(limpio) : 0;
};

const formatearMiles = value => {
  const limpio = soloDigitos(value);
  if (!limpio) return "";
  return Number(limpio).toLocaleString("es-CO");
};

const slug = value =>
  String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "consumidor-final";

function toDate(value) {
  if (!value) return null;
  if (typeof value?.toDate === "function") return value.toDate();
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
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
  return Timestamp.fromDate(new Date(`${value}T12:00:00`));
}

function normalizarItem(item) {
  return {
    productoId: item.productoId,
    nombre: item.nombre || item.productoNombre || "Producto",
    codigo: item.codigo || item.productoCodigo || null,
    cantidad: Number(item.cantidad || 0),
    precioUnitario: Number(item.precioUnitario || item.precioVenta || 0),
    precioLista: Number(item.precioLista || item.precioUnitario || 0),
    precioMinimo: Number(item.precioMinimo || 0),
    costoUnitario: Number(item.costoUnitario || 0)
  };
}

export default function EditarFacturaVentaModal({
  venta,
  cuenta,
  ventaId,
  onClose,
  onSaved
}) {
  const { empresa, user } = useTenant();
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const [paso, setPaso] = useState("editar");
  const [motivo, setMotivo] = useState("");

  const clienteInicial =
    venta?.cliente && typeof venta.cliente === "object"
      ? venta.cliente
      : {
          nombre: venta?.clienteNombre || venta?.cliente || "Consumidor final",
          documento: venta?.documento || ""
        };

  const [form, setForm] = useState({
    fecha: fechaInput(venta?.fecha),
    clienteNombre: clienteInicial?.nombre || "Consumidor final",
    clienteDocumento:
      clienteInicial?.documento && clienteInicial.documento !== "-"
        ? clienteInicial.documento
        : "",
    tipoPago: venta?.tipoPago === "CREDITO" ? "CREDITO" : "CONTADO",
    fechaVencimiento: fechaInput(
      cuenta?.fechaVencimiento ?? venta?.fechaVencimiento
    )
  });

  const originales = useMemo(
    () => (venta?.items || venta?.productos || []).map(normalizarItem),
    [venta]
  );

  const [items, setItems] = useState(
    originales.map(item => ({
      ...item,
      cantidad: String(item.cantidad),
      precioUnitario: String(item.precioUnitario)
    }))
  );

  const totalAnterior = Number(venta?.total || 0);
  const saldoAnterior =
    venta?.tipoPago === "CREDITO"
      ? Number(cuenta?.saldoPendiente ?? venta?.saldoPendiente ?? totalAnterior)
      : 0;
  const pagadoAnterior =
    venta?.tipoPago === "CREDITO"
      ? Math.max(0, totalAnterior - saldoAnterior)
      : 0;

  const totalNuevo = useMemo(
    () =>
      items.reduce(
        (acc, item) =>
          acc + numero(item.cantidad) * numero(item.precioUnitario),
        0
      ),
    [items]
  );

  const resumen = useMemo(() => {
    const oldMap = new Map(originales.map(item => [item.productoId, item]));
    const cambios = [];

    for (const item of items) {
      const anterior = oldMap.get(item.productoId);
      if (!anterior) continue;

      const qtyNueva = numero(item.cantidad);
      const precioNuevo = numero(item.precioUnitario);

      if (
        qtyNueva !== Number(anterior.cantidad || 0) ||
        precioNuevo !== Number(anterior.precioUnitario || 0)
      ) {
        cambios.push({
          productoId: item.productoId,
          nombre: item.nombre,
          cantidadAnterior: Number(anterior.cantidad || 0),
          cantidadNueva: qtyNueva,
          ajusteStock: Number(anterior.cantidad || 0) - qtyNueva,
          precioAnterior: Number(anterior.precioUnitario || 0),
          precioNuevo
        });
      }
    }

    const cabeceraCambiada =
      form.fecha !== fechaInput(venta?.fecha) ||
      form.clienteNombre.trim() !== String(clienteInicial?.nombre || "").trim() ||
      form.clienteDocumento.trim() !==
        String(
          clienteInicial?.documento && clienteInicial.documento !== "-"
            ? clienteInicial.documento
            : ""
        ).trim() ||
      form.tipoPago !== (venta?.tipoPago === "CREDITO" ? "CREDITO" : "CONTADO") ||
      form.fechaVencimiento !==
        fechaInput(cuenta?.fechaVencimiento ?? venta?.fechaVencimiento);

    return {
      cambios,
      cabeceraCambiada,
      hayCambios: cabeceraCambiada || cambios.length > 0,
      diferenciaTotal: totalNuevo - totalAnterior
    };
  }, [items, originales, form, venta, cuenta, clienteInicial, totalNuevo, totalAnterior]);

  const actualizarItem = (productoId, campo, value) => {
    setItems(prev =>
      prev.map(item =>
        item.productoId === productoId
          ? { ...item, [campo]: value }
          : item
      )
    );
  };

  const validar = () => {
    if (!form.fecha) return "Selecciona la fecha de la factura.";
    if (!form.clienteNombre.trim()) return "Ingresa el nombre del cliente.";

    for (const item of items) {
      const qty = numero(item.cantidad);
      const precio = numero(item.precioUnitario);

      if (!Number.isInteger(qty) || qty < 0) {
        return `${item.nombre}: la cantidad debe ser un entero igual o mayor que cero.`;
      }

      if (qty > 0 && precio <= 0) {
        return `${item.nombre}: el precio debe ser mayor que cero.`;
      }
    }

    if (items.every(item => numero(item.cantidad) === 0)) {
      return "Todas las cantidades quedaron en 0. Si se canceló toda la venta, usa ‘Anular factura’.";
    }

    if (form.tipoPago === "CREDITO" && !form.fechaVencimiento) {
      return "Una venta a crédito necesita fecha de vencimiento.";
    }

    if (!motivo.trim()) return "Escribe el motivo de la modificación.";
    if (!resumen.hayCambios) return "No hay cambios para guardar.";

    if (
      form.tipoPago === "CONTADO" &&
      venta?.tipoPago === "CREDITO" &&
      pagadoAnterior > 0
    ) {
      return "La venta tiene abonos registrados y no puede cambiarse a contado.";
    }

    if (form.tipoPago === "CREDITO" && totalNuevo < pagadoAnterior) {
      return `El nuevo total no puede ser menor que lo ya abonado (${moneda(
        pagadoAnterior
      )}).`;
    }

    return "";
  };

  const revisar = () => {
    const mensaje = validar();
    if (mensaje) return setError(mensaje);
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

    if (!empresa?.id || !ventaId || !user?.uid) return;

    try {
      setGuardando(true);
      setError("");

      let cuentaRef = cuenta?.id
        ? doc(
            db,
            "empresas",
            empresa.id,
            "cuentasPorCobrar",
            cuenta.id
          )
        : null;

      if (!cuentaRef && venta?.tipoPago === "CREDITO") {
        const snap = await getDocs(
          query(
            collection(db, "empresas", empresa.id, "cuentasPorCobrar"),
            where("ventaId", "==", ventaId),
            limit(1)
          )
        );
        if (!snap.empty) cuentaRef = snap.docs[0].ref;
      }

      if (!cuentaRef && form.tipoPago === "CREDITO") {
        cuentaRef = doc(
          collection(db, "empresas", empresa.id, "cuentasPorCobrar")
        );
      }

      const ventaRef = doc(db, "empresas", empresa.id, "ventas", ventaId);

      const nombreCliente = form.clienteNombre.trim();
      const documentoCliente = form.clienteDocumento.trim();
      const clienteId = documentoCliente || slug(nombreCliente);
      const clienteRef = doc(
        db,
        "empresas",
        empresa.id,
        "clientes",
        clienteId
      );

      await runTransaction(db, async transaction => {
        const ventaSnap = await transaction.get(ventaRef);
        if (!ventaSnap.exists()) throw new Error("La venta ya no existe.");

        const ventaActual = ventaSnap.data();
        if (ventaActual.anulada === true) {
          throw new Error("Una factura anulada ya no puede modificarse.");
        }

        const versionVista = Number(venta?.version || 1);
        const versionActual = Number(ventaActual.version || 1);
        if (versionVista !== versionActual) {
          throw new Error(
            "Esta factura fue modificada desde otro dispositivo. Recarga la página antes de editarla."
          );
        }

        let cuentaActual = null;
        if (cuentaRef) {
          const cuentaSnap = await transaction.get(cuentaRef);
          if (cuentaSnap.exists()) cuentaActual = cuentaSnap.data();
        }

        const totalAnteriorTx = Number(ventaActual.total || 0);
        const saldoAnteriorTx =
          ventaActual.tipoPago === "CREDITO"
            ? Number(
                cuentaActual?.saldoPendiente ??
                ventaActual.saldoPendiente ??
                totalAnteriorTx
              )
            : 0;
        const pagadoTx =
          ventaActual.tipoPago === "CREDITO"
            ? Math.max(0, totalAnteriorTx - saldoAnteriorTx)
            : 0;

        if (
          form.tipoPago === "CONTADO" &&
          ventaActual.tipoPago === "CREDITO" &&
          pagadoTx > 0
        ) {
          throw new Error(
            "La venta tiene abonos registrados y no puede cambiarse a contado."
          );
        }

        if (form.tipoPago === "CREDITO" && totalNuevo < pagadoTx) {
          throw new Error(
            `El total corregido no puede ser menor que lo ya abonado (${moneda(
              pagadoTx
            )}).`
          );
        }

        const oldMap = new Map(
          (ventaActual.items || ventaActual.productos || [])
            .map(normalizarItem)
            .map(item => [item.productoId, item])
        );

        const productoIds = Array.from(oldMap.keys());
        const productosTx = new Map();

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
            throw new Error("Uno de los productos de la factura ya no existe.");
          }
          productosTx.set(productoId, { ref, data: snap.data() });
        }

        const itemsActualizados = [];
        let descuentoTotal = 0;

        for (const item of items) {
          const anterior = oldMap.get(item.productoId);
          if (!anterior) continue;

          const qtyAnterior = Number(anterior.cantidad || 0);
          const qtyNueva = numero(item.cantidad);
          const precioNuevo = numero(item.precioUnitario);
          const ajusteStock = qtyAnterior - qtyNueva;

          const info = productosTx.get(item.productoId);
          const producto = info.data;
          const stockAnterior = Number(producto.cantidad || 0);
          const stockNuevo = stockAnterior + ajusteStock;

          if (stockNuevo < 0) {
            throw new Error(
              `${item.nombre}: no hay suficiente stock para aumentar la venta. Disponible actualmente: ${stockAnterior}.`
            );
          }

          const huboCambio =
            ajusteStock !== 0 ||
            precioNuevo !== Number(anterior.precioUnitario || 0);

          if (ajusteStock !== 0) {
            transaction.update(info.ref, {
              cantidad: stockNuevo,
              actualizadoEn: serverTimestamp()
            });
          }

          if (huboCambio) {
            const movimientoRef = doc(
              collection(db, "empresas", empresa.id, "movimientos")
            );

            transaction.set(movimientoRef, {
              tipo: "AJUSTE",
              origen: "EDICION_FACTURA_VENTA",
              motivo: "EDICION_FACTURA_VENTA",
              observacion: motivo.trim(),
              ventaId,
              productoId: item.productoId,
              productoNombre: producto.nombre || item.nombre,
              productoCodigo: producto.codigo || item.codigo || null,
              cantidad: ajusteStock,
              diferencia: ajusteStock,
              stockAnterior,
              stockNuevo,
              cantidadVentaAnterior: qtyAnterior,
              cantidadVentaNueva: qtyNueva,
              precioVentaAnterior: Number(anterior.precioUnitario || 0),
              precioVentaNuevo: precioNuevo,
              usuarioId: user.uid,
              usuarioEmail: user.email || null,
              fecha: serverTimestamp()
            });
          }

          if (qtyNueva > 0) {
            const precioLista = Number(anterior.precioLista || precioNuevo);
            const descuentoLinea =
              Math.max(0, precioLista - precioNuevo) * qtyNueva;
            descuentoTotal += descuentoLinea;

            itemsActualizados.push({
              ...anterior,
              cantidad: qtyNueva,
              precioUnitario: precioNuevo,
              precioLista,
              descuento: descuentoLinea,
              subtotal: qtyNueva * precioNuevo
            });
          }
        }

        const esCreditoNuevo = form.tipoPago === "CREDITO";
        const saldoNuevo = esCreditoNuevo
          ? Math.max(0, totalNuevo - pagadoTx)
          : 0;
        const estadoNuevo = !esCreditoNuevo
          ? "PAGADA"
          : saldoNuevo <= 0
            ? "PAGADA"
            : pagadoTx > 0
              ? "PARCIAL"
              : "PENDIENTE";

        transaction.set(
          clienteRef,
          {
            nombre: nombreCliente,
            nombreLower: slug(nombreCliente),
            documento: documentoCliente || null,
            updatedAt: serverTimestamp()
          },
          { merge: true }
        );

        if (esCreditoNuevo) {
          if (!cuentaRef) throw new Error("No fue posible preparar la cuenta por cobrar.");

          transaction.set(
            cuentaRef,
            {
              ventaId,
              clienteId,
              clienteNombre: nombreCliente,
              clienteDocumento: documentoCliente,
              total: totalNuevo,
              saldoPendiente: saldoNuevo,
              estado: estadoNuevo,
              fechaVencimiento: form.fechaVencimiento,
              updatedAt: serverTimestamp(),
              ...(cuentaActual ? {} : { createdAt: serverTimestamp() })
            },
            { merge: true }
          );
        } else if (cuentaRef && cuentaActual) {
          transaction.delete(cuentaRef);
        }

        transaction.update(ventaRef, {
          clienteId,
          cliente: {
            nombre: nombreCliente,
            documento: documentoCliente || "-"
          },
          items: itemsActualizados,
          total: totalNuevo,
          descuentoTotal,
          tipoPago: form.tipoPago,
          estadoPago: estadoNuevo,
          saldoPendiente: saldoNuevo,
          fechaVencimiento: esCreditoNuevo ? form.fechaVencimiento : null,
          fecha: fechaTimestamp(form.fecha),
          version: versionActual + 1,
          modificadoEn: serverTimestamp(),
          modificadoPorId: user.uid,
          modificadoPorEmail: user.email || null,
          motivoUltimaEdicion: motivo.trim()
        });
      });

      onSaved?.();
    } catch (e) {
      console.error(e);
      setError(e?.message || "No se pudo modificar la factura.");
      setPaso("editar");
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div
        className="modal-card"
        style={{
          width: "94vw",
          maxWidth: 920,
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
            gap: 12
          }}
        >
          <div>
            <h3 style={{ margin: 0 }}>
              {paso === "editar" ? "✏️ Editar factura de venta" : "🔎 Revisar modificación"}
            </h3>
            <p className="inv-subtle" style={{ margin: "5px 0 0" }}>
              {paso === "editar"
                ? "Solo aparecen los productos que pertenecen a esta factura."
                : "Ordexa aplicará únicamente las diferencias al inventario y cartera."}
            </p>
          </div>

          <button className="btn" onClick={onClose} disabled={guardando}>✕</button>
        </div>

        {error && (
          <div className="toast toast-error" style={{ position: "static", marginTop: 14 }}>
            {error}
          </div>
        )}

        {paso === "editar" ? (
          <>
            <div className="form-grid" style={{ marginTop: 18 }}>
              <Campo label="Fecha *" type="date" value={form.fecha} onChange={value => setForm(prev => ({ ...prev, fecha: value }))} />
              <Campo label="Cliente *" value={form.clienteNombre} onChange={value => setForm(prev => ({ ...prev, clienteNombre: value }))} />
              <Campo label="Documento" value={form.clienteDocumento} onChange={value => setForm(prev => ({ ...prev, clienteDocumento: value }))} />

              <div className="form-field">
                <label>Forma de pago *</label>
                <select
                  value={form.tipoPago}
                  onChange={e =>
                    setForm(prev => ({
                      ...prev,
                      tipoPago: e.target.value,
                      fechaVencimiento:
                        e.target.value === "CONTADO" ? "" : prev.fechaVencimiento
                    }))
                  }
                >
                  <option value="CONTADO">Contado</option>
                  <option value="CREDITO">Crédito</option>
                </select>
              </div>

              {form.tipoPago === "CREDITO" && (
                <Campo
                  label="Fecha de vencimiento *"
                  type="date"
                  value={form.fechaVencimiento}
                  onChange={value => setForm(prev => ({ ...prev, fechaVencimiento: value }))}
                />
              )}
            </div>

            <div style={{ marginTop: 22 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                <h4 style={{ margin: 0 }}>Productos</h4>
                <span className="badge">{items.length} referencia(s)</span>
              </div>

              <div style={{ display: "grid", gap: 9, marginTop: 10 }}>
                {items.map(item => (
                  <div
                    key={item.productoId}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "minmax(180px,1fr) 120px 160px",
                      gap: 9,
                      alignItems: "end",
                      padding: 11,
                      border: "1px solid var(--border)",
                      borderRadius: 12
                    }}
                  >
                    <div>
                      <strong>{item.nombre}</strong>
                      {item.codigo && <div className="inv-subtle" style={{ fontSize: 10, marginTop: 3 }}>SKU: {item.codigo}</div>}
                    </div>

                    <div>
                      <Campo
                        label="Cantidad"
                        type="number"
                        value={item.cantidad}
                        onChange={value => actualizarItem(item.productoId, "cantidad", value)}
                      />
                      <div className="inv-subtle" style={{ fontSize: 10, marginTop: 4 }}>
                        Usa 0 si este producto fue devuelto por completo.
                      </div>
                    </div>

                    <CampoMoneda
                      label="Precio unitario"
                      value={item.precioUnitario}
                      onChange={value => actualizarItem(item.productoId, "precioUnitario", value)}
                    />
                  </div>
                ))}
              </div>
            </div>

            <div className="form-field" style={{ marginTop: 18 }}>
              <label>Motivo de la modificación *</label>
              <textarea
                rows="3"
                value={motivo}
                onChange={e => setMotivo(e.target.value)}
                placeholder="Ej: El cliente devolvió 1 unidad y se corrigió la factura."
                style={{ width: "100%", resize: "vertical" }}
              />
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: 14, border: "1px solid var(--border)", borderRadius: 13, marginTop: 16 }}>
              <span className="inv-subtle">Nuevo total calculado</span>
              <strong style={{ fontSize: 22 }}>{moneda(totalNuevo)}</strong>
            </div>

            <div className="modal-actions" style={{ marginTop: 18 }}>
              <button className="btn" onClick={onClose}>Cancelar</button>
              <button className="btn btn-primary" onClick={revisar}>Revisar cambios →</button>
            </div>
          </>
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginTop: 18 }}>
              <Resumen titulo="Total anterior" valor={moneda(totalAnterior)} />
              <Resumen titulo="Nuevo total" valor={moneda(totalNuevo)} />
              <Resumen
                titulo="Diferencia"
                valor={`${resumen.diferenciaTotal >= 0 ? "+" : ""}${moneda(resumen.diferenciaTotal)}`}
                color={resumen.diferenciaTotal > 0 ? "#22c55e" : resumen.diferenciaTotal < 0 ? "#ef4444" : undefined}
              />
            </div>

            <h4 style={{ margin: "18px 0 10px" }}>Correcciones de productos</h4>
            {resumen.cambios.length === 0 ? (
              <p className="inv-subtle">No hay cambios de cantidad o precio.</p>
            ) : (
              <div style={{ display: "grid", gap: 9 }}>
                {resumen.cambios.map(cambio => (
                  <div key={cambio.productoId} style={{ padding: 12, border: "1px solid var(--border)", borderRadius: 12 }}>
                    <strong>{cambio.nombre}</strong>
                    <div className="product-meta" style={{ marginTop: 6 }}>
                      <span>Cantidad: <b>{cambio.cantidadAnterior} → {cambio.cantidadNueva}</b></span>
                      <span>Ajuste stock: <b style={{ color: cambio.ajusteStock > 0 ? "#22c55e" : cambio.ajusteStock < 0 ? "#ef4444" : "var(--text)" }}>{cambio.ajusteStock > 0 ? "+" : ""}{cambio.ajusteStock}</b></span>
                      <span>Precio: <b>{moneda(cambio.precioAnterior)} → {moneda(cambio.precioNuevo)}</b></span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div style={{ marginTop: 16, padding: 13, borderRadius: 13, border: "1px solid rgba(245,158,11,.25)", background: "rgba(245,158,11,.055)" }}>
              <strong style={{ color: "#f59e0b" }}>⚠️ Esta acción afecta datos reales</strong>
              <p className="inv-subtle" style={{ margin: "5px 0 0" }}>
                Se actualizarán factura, inventario, Kardex y cuenta por cobrar según corresponda.
              </p>
            </div>

            <div className="modal-actions" style={{ marginTop: 18 }}>
              <button className="btn" onClick={() => setPaso("editar")} disabled={guardando}>← Volver a editar</button>
              <button className="btn btn-primary" onClick={guardar} disabled={guardando}>
                {guardando ? "Aplicando corrección..." : "✓ Confirmar modificación"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Campo({ label, type = "text", value, onChange }) {
  return (
    <div className="form-field">
      <label>{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} />
    </div>
  );
}

function CampoMoneda({ label, value, onChange }) {
  return (
    <div className="form-field">
      <label>{label}</label>
      <input
        type="text"
        inputMode="numeric"
        value={formatearMiles(value)}
        onChange={e => onChange(soloDigitos(e.target.value))}
        placeholder="0"
      />
    </div>
  );
}

function Resumen({ titulo, valor, color }) {
  return (
    <div style={{ padding: 13, border: "1px solid var(--border)", borderRadius: 13 }}>
      <div className="inv-subtle" style={{ fontSize: 10 }}>{titulo}</div>
      <strong style={{ display: "block", marginTop: 4, fontSize: 16, color: color || "var(--text)" }}>{valor}</strong>
    </div>
  );
}
