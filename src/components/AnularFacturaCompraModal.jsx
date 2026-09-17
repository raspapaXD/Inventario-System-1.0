import { useState } from "react";
import {
  collection,
  doc,
  getDocs,
  limit,
  query,
  runTransaction,
  serverTimestamp,
  where
} from "firebase/firestore";

import { db } from "../../firebaseClient.js";
import { useTenant } from "../tenant/TenantProvider";

import "../pages/inventario.css";

const moneda = value =>
  `$${Number(value || 0).toLocaleString("es-CO", {
    maximumFractionDigits: 0
  })}`;

const normalizarItem = item => ({
  productoId: item.productoId,
  nombre:
    item.nombre ||
    item.productoNombre ||
    "Producto",
  codigo:
    item.codigo ||
    item.productoCodigo ||
    null,
  cantidad: Number(item.cantidad || 0),
  costoUnitario: Number(
    item.costoUnitario ??
    item.costoCompra ??
    0
  )
});

export default function AnularFacturaCompraModal({
  compra,
  cuenta,
  onClose,
  onSaved
}) {
  const { empresa, user } = useTenant();

  const [motivo, setMotivo] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  const total = Number(compra?.total || 0);

  const saldo =
    compra?.tipoPago === "CREDITO"
      ? Number(
          cuenta?.saldoPendiente ??
          compra?.saldoPendiente ??
          total
        )
      : 0;

  const pagado =
    compra?.tipoPago === "CREDITO"
      ? Math.max(0, total - saldo)
      : 0;

  const anular = async () => {
    if (!empresa?.id || !compra?.id || !user?.uid) return;

    if (!motivo.trim()) {
      return setError("Escribe el motivo de la anulación.");
    }

    if (pagado > 0) {
      return setError(
        `La factura tiene ${moneda(pagado)} en pagos registrados. Antes de anularla se necesita gestionar esa devolución en cartera.`
      );
    }

    try {
      setGuardando(true);
      setError("");

      let cuentaRef = cuenta?.id
        ? doc(
            db,
            "empresas",
            empresa.id,
            "cuentasPorPagar",
            cuenta.id
          )
        : null;

      if (!cuentaRef && compra.tipoPago === "CREDITO") {
        const snap = await getDocs(
          query(
            collection(
              db,
              "empresas",
              empresa.id,
              "cuentasPorPagar"
            ),
            where("compraId", "==", compra.id),
            limit(1)
          )
        );

        if (!snap.empty) {
          cuentaRef = snap.docs[0].ref;
        }
      }

      const compraRef = doc(
        db,
        "empresas",
        empresa.id,
        "compras",
        compra.id
      );

      await runTransaction(db, async transaction => {
        const compraSnap = await transaction.get(compraRef);

        if (!compraSnap.exists()) {
          throw new Error("La factura ya no existe.");
        }

        const compraActual = compraSnap.data();

        if (compraActual.anulada === true) {
          throw new Error("Esta factura ya está anulada.");
        }

        const versionVista = Number(compra.version || 1);
        const versionActual = Number(compraActual.version || 1);

        if (versionVista !== versionActual) {
          throw new Error(
            "La factura fue modificada desde otro dispositivo. Recarga la página antes de anularla."
          );
        }

        let cuentaActual = null;

        if (cuentaRef) {
          const cuentaSnap = await transaction.get(cuentaRef);
          if (cuentaSnap.exists()) {
            cuentaActual = cuentaSnap.data();
          }
        }

        const totalActual = Number(compraActual.total || 0);
        const saldoActual =
          compraActual.tipoPago === "CREDITO"
            ? Number(
                cuentaActual?.saldoPendiente ??
                compraActual.saldoPendiente ??
                totalActual
              )
            : 0;

        const pagadoActual =
          compraActual.tipoPago === "CREDITO"
            ? Math.max(0, totalActual - saldoActual)
            : 0;

        if (pagadoActual > 0) {
          throw new Error(
            `La factura tiene ${moneda(pagadoActual)} en pagos registrados y no puede anularse todavía.`
          );
        }

        const items = (compraActual.items || [])
          .map(normalizarItem)
          .filter(item => item.productoId && item.cantidad > 0);

        const lecturas = [];

        for (const item of items) {
          const productoRef = doc(
            db,
            "empresas",
            empresa.id,
            "productos",
            item.productoId
          );

          const productoSnap = await transaction.get(productoRef);

          if (!productoSnap.exists()) {
            throw new Error(
              `El producto “${item.nombre}” ya no existe.`
            );
          }

          lecturas.push({
            item,
            productoRef,
            producto: productoSnap.data()
          });
        }

        for (const { item, productoRef, producto } of lecturas) {
          const stockAnterior = Number(producto.cantidad || 0);
          const diferencia = -Number(item.cantidad || 0);
          const stockNuevo = stockAnterior + diferencia;

          if (stockNuevo < 0) {
            throw new Error(
              `${item.nombre}: no se puede anular porque actualmente hay ${stockAnterior} unidad(es) y habría que retirar ${item.cantidad}. Parte de esa mercancía ya pudo haberse vendido o ajustado.`
            );
          }

          const costoPromedioAnterior = Number(
            producto.costoPromedio ??
            producto.costoUnitario ??
            0
          );

          const valorInventarioAnterior =
            stockAnterior * costoPromedioAnterior;

          const valorAReversar =
            Number(item.cantidad || 0) *
            Number(item.costoUnitario || 0);

          const valorInventarioNuevo =
            valorInventarioAnterior - valorAReversar;

          if (stockNuevo > 0 && valorInventarioNuevo < 0) {
            throw new Error(
              `${item.nombre}: la anulación no puede recalcularse de forma segura con el inventario actual.`
            );
          }

          const costoPromedioNuevo =
            stockNuevo > 0
              ? Math.max(0, valorInventarioNuevo / stockNuevo)
              : 0;

          const porcentajeObjetivo = Number(
            producto.porcentajeGanancia || 0
          );

          const porcentajeMinimo = Number(
            producto.porcentajeGananciaMinima || 0
          );

          transaction.update(productoRef, {
            cantidad: stockNuevo,
            costoPromedio: costoPromedioNuevo,
            costoUnitario: costoPromedioNuevo,
            precioSugerido: Math.round(
              costoPromedioNuevo *
              (1 + porcentajeObjetivo / 100)
            ),
            precioMinimo: Math.round(
              costoPromedioNuevo *
              (1 + porcentajeMinimo / 100)
            ),
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
            origen: "ANULACION_FACTURA_COMPRA",
            motivo: "ANULACION_FACTURA_COMPRA",
            observacion: motivo.trim(),
            compraId: compra.id,
            numeroFactura: compraActual.numeroFactura || null,
            productoId: item.productoId,
            productoNombre: producto.nombre || item.nombre,
            productoCodigo: producto.codigo || item.codigo || null,
            cantidad: diferencia,
            diferencia,
            stockAnterior,
            stockNuevo,
            costoPromedioAnterior,
            costoPromedioNuevo,
            costoFacturaAnulada: Number(item.costoUnitario || 0),
            usuarioId: user.uid,
            usuarioEmail: user.email || null,
            fecha: serverTimestamp()
          });
        }

        if (cuentaRef && cuentaActual) {
          transaction.delete(cuentaRef);
        }

        transaction.update(compraRef, {
          anulada: true,
          anuladaEn: serverTimestamp(),
          anuladaPorId: user.uid,
          anuladaPorEmail: user.email || null,
          motivoAnulacion: motivo.trim(),
          estadoPago: "ANULADA",
          saldoPendiente: 0,
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
      setError(
        e?.message ||
        "No se pudo anular la factura."
      );
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
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
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 12
          }}
        >
          <div>
            <h3 style={{ margin: 0 }}>🚫 Anular factura de compra</h3>
            <p className="inv-subtle" style={{ margin: "6px 0 0" }}>
              La factura conservará su historial, pero Ordexa revertirá la entrada de inventario y cerrará la cuenta por pagar si no existen abonos.
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

        <div
          style={{
            marginTop: 16,
            padding: 14,
            borderRadius: 14,
            border: "1px solid rgba(239,68,68,.28)",
            background: "rgba(239,68,68,.06)"
          }}
        >
          <strong style={{ color: "#ef4444" }}>
            Factura {compra?.numeroFactura || "—"} · {moneda(total)}
          </strong>

          <p className="inv-subtle" style={{ margin: "6px 0 0" }}>
            Esta acción no elimina el documento ni los movimientos originales. Se registrarán movimientos de reversión para mantener la auditoría.
          </p>
        </div>

        {pagado > 0 && (
          <div
            className="toast toast-error"
            style={{ position: "static", marginTop: 14 }}
          >
            Esta factura tiene {moneda(pagado)} pagados. Primero debe resolverse esa devolución en cartera.
          </div>
        )}

        {error && (
          <div
            className="toast toast-error"
            style={{ position: "static", marginTop: 14 }}
          >
            {error}
          </div>
        )}

        <div className="form-field" style={{ marginTop: 16 }}>
          <label>Motivo de la anulación *</label>
          <textarea
            rows="4"
            value={motivo}
            onChange={e => setMotivo(e.target.value)}
            placeholder="Ej: Se devolvió toda la mercancía al proveedor y la factura fue cancelada."
            style={{ width: "100%", resize: "vertical" }}
          />
        </div>

        <div className="modal-actions" style={{ marginTop: 18 }}>
          <button
            type="button"
            className="btn"
            onClick={onClose}
            disabled={guardando}
          >
            Cancelar
          </button>

          <button
            type="button"
            className="btn btn-danger"
            onClick={anular}
            disabled={guardando || pagado > 0}
          >
            {guardando
              ? "Anulando..."
              : "🚫 Confirmar anulación"}
          </button>
        </div>
      </div>
    </div>
  );
}
