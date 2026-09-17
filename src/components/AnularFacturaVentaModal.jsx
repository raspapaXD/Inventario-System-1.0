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
  nombre: item.nombre || item.productoNombre || "Producto",
  codigo: item.codigo || item.productoCodigo || null,
  cantidad: Number(item.cantidad || 0),
  precioUnitario: Number(item.precioUnitario || item.precioVenta || 0)
});

export default function AnularFacturaVentaModal({
  venta,
  cuenta,
  ventaId,
  onClose,
  onSaved
}) {
  const { empresa, user } = useTenant();
  const [motivo, setMotivo] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  const total = Number(venta?.total || 0);
  const saldo =
    venta?.tipoPago === "CREDITO"
      ? Number(cuenta?.saldoPendiente ?? venta?.saldoPendiente ?? total)
      : 0;
  const abonado =
    venta?.tipoPago === "CREDITO"
      ? Math.max(0, total - saldo)
      : 0;

  const anular = async () => {
    if (!empresa?.id || !ventaId || !user?.uid) return;
    if (!motivo.trim()) return setError("Escribe el motivo de la anulación.");

    if (abonado > 0) {
      return setError(
        `La factura tiene ${moneda(abonado)} en abonos registrados. Primero debe gestionarse esa devolución en cartera.`
      );
    }

    try {
      setGuardando(true);
      setError("");

      let cuentaRef = cuenta?.id
        ? doc(db, "empresas", empresa.id, "cuentasPorCobrar", cuenta.id)
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

      const ventaRef = doc(db, "empresas", empresa.id, "ventas", ventaId);

      await runTransaction(db, async transaction => {
        const ventaSnap = await transaction.get(ventaRef);
        if (!ventaSnap.exists()) throw new Error("La venta ya no existe.");

        const ventaActual = ventaSnap.data();
        if (ventaActual.anulada === true) throw new Error("Esta factura ya está anulada.");

        const versionVista = Number(venta?.version || 1);
        const versionActual = Number(ventaActual.version || 1);
        if (versionVista !== versionActual) {
          throw new Error(
            "La factura fue modificada desde otro dispositivo. Recarga la página antes de anularla."
          );
        }

        let cuentaActual = null;
        if (cuentaRef) {
          const cuentaSnap = await transaction.get(cuentaRef);
          if (cuentaSnap.exists()) cuentaActual = cuentaSnap.data();
        }

        const totalActual = Number(ventaActual.total || 0);
        const saldoActual =
          ventaActual.tipoPago === "CREDITO"
            ? Number(
                cuentaActual?.saldoPendiente ??
                ventaActual.saldoPendiente ??
                totalActual
              )
            : 0;
        const abonadoActual =
          ventaActual.tipoPago === "CREDITO"
            ? Math.max(0, totalActual - saldoActual)
            : 0;

        if (abonadoActual > 0) {
          throw new Error(
            `La factura tiene ${moneda(abonadoActual)} abonados y no puede anularse todavía.`
          );
        }

        const items = (ventaActual.items || ventaActual.productos || [])
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
            throw new Error(`El producto “${item.nombre}” ya no existe.`);
          }
          lecturas.push({ item, productoRef, producto: productoSnap.data() });
        }

        for (const { item, productoRef, producto } of lecturas) {
          const stockAnterior = Number(producto.cantidad || 0);
          const diferencia = Number(item.cantidad || 0);
          const stockNuevo = stockAnterior + diferencia;

          transaction.update(productoRef, {
            cantidad: stockNuevo,
            actualizadoEn: serverTimestamp()
          });

          const movimientoRef = doc(
            collection(db, "empresas", empresa.id, "movimientos")
          );

          transaction.set(movimientoRef, {
            tipo: "AJUSTE",
            origen: "ANULACION_FACTURA_VENTA",
            motivo: "ANULACION_FACTURA_VENTA",
            observacion: motivo.trim(),
            ventaId,
            productoId: item.productoId,
            productoNombre: producto.nombre || item.nombre,
            productoCodigo: producto.codigo || item.codigo || null,
            cantidad: diferencia,
            diferencia,
            stockAnterior,
            stockNuevo,
            cantidadVentaAnulada: item.cantidad,
            precioVentaAnulado: item.precioUnitario,
            usuarioId: user.uid,
            usuarioEmail: user.email || null,
            fecha: serverTimestamp()
          });
        }

        if (cuentaRef && cuentaActual) {
          transaction.delete(cuentaRef);
        }

        transaction.update(ventaRef, {
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
      setError(e?.message || "No se pudo anular la factura.");
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal-card" style={{ width: "92vw", maxWidth: 560, borderRadius: 22 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div>
            <h3 style={{ margin: 0 }}>🚫 Anular factura de venta</h3>
            <p className="inv-subtle" style={{ margin: "6px 0 0" }}>
              Ordexa devolverá las unidades al inventario y conservará la venta original como documento anulado.
            </p>
          </div>
          <button className="btn" onClick={onClose} disabled={guardando}>✕</button>
        </div>

        <div style={{ marginTop: 16, padding: 14, borderRadius: 14, border: "1px solid rgba(239,68,68,.28)", background: "rgba(239,68,68,.06)" }}>
          <strong style={{ color: "#ef4444" }}>Factura #{String(ventaId).slice(0, 8).toUpperCase()} · {moneda(total)}</strong>
          <p className="inv-subtle" style={{ margin: "6px 0 0" }}>
            Los movimientos originales no se borran. Se crearán movimientos de reversión para mantener la auditoría.
          </p>
        </div>

        {abonado > 0 && (
          <div className="toast toast-error" style={{ position: "static", marginTop: 14 }}>
            Esta factura tiene {moneda(abonado)} abonados. Primero debe resolverse esa devolución en cartera.
          </div>
        )}

        {error && (
          <div className="toast toast-error" style={{ position: "static", marginTop: 14 }}>{error}</div>
        )}

        <div className="form-field" style={{ marginTop: 16 }}>
          <label>Motivo de la anulación *</label>
          <textarea
            rows="4"
            value={motivo}
            onChange={e => setMotivo(e.target.value)}
            placeholder="Ej: El cliente devolvió toda la compra y la venta fue cancelada."
            style={{ width: "100%", resize: "vertical" }}
          />
        </div>

        <div className="modal-actions" style={{ marginTop: 18 }}>
          <button className="btn" onClick={onClose} disabled={guardando}>Cancelar</button>
          <button className="btn btn-danger" onClick={anular} disabled={guardando || abonado > 0}>
            {guardando ? "Anulando..." : "🚫 Confirmar anulación"}
          </button>
        </div>
      </div>
    </div>
  );
}
