// src/pages/SinEmpresa.jsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTenant } from "../tenant/TenantProvider";
import "./inventario.css";

export default function SinEmpresa() {
  const { logout } = useTenant();        // <-- usamos el logout del provider
  const navigate = useNavigate();

  const [inv, setInv] = useState("");    // input para enlace/ID de invitación

  const irALogin = async () => {
    try {
      await logout();                    // <-- cerramos sesión
    } finally {
      navigate("/login", { replace: true }); // <-- y ahora sí vamos al login
    }
  };

  const irACrear = () => navigate("/crear-empresa");

  // si ya implementaste “unirme con invitación”, úsalo aquí:
  const unirme = async () => {
    // TODO: procesa `inv` (enlace o empresaId)
    // por ahora solo navega a crear-empresa si está vacío
    if (!inv.trim()) irACrear();
  };

  return (
    <div className="inv-root" style={{ display: "grid", placeItems: "center" }}>
      <div className="card" style={{ maxWidth: 680, width: "100%" }}>
        <div className="card-header">
          <h2>Sin empresa asignada</h2>
          <p className="inv-subtle">
            Tu usuario no está asociado a ninguna empresa todavía.
          </p>
        </div>

        <div className="card-body">
          <div className="form-field" style={{ gridColumn: "1 / -1" }}>
            <label>Tengo un enlace de invitación</label>
            <input
              placeholder="Pega aquí el enlace o el ID de la empresa"
              value={inv}
              onChange={(e) => setInv(e.target.value)}
            />
          </div>

          <div className="card-footer" style={{ gap: 8 }}>
            <button className="btn btn-primary" onClick={unirme}>
              Crear mi empresa
            </button>

            <button type="button" className="btn" onClick={irALogin}>
              ← Volver al login
            </button>
          </div>
        </div>

        <div className="card-footer" style={{ borderTop: "1px solid var(--border)" }}>
          <p className="inv-subtle">
            Si eres administrador, también puedes generar invitaciones desde{" "}
            <strong>Configuración → Invitar a tu equipo</strong>.
          </p>
        </div>
      </div>
    </div>
  );
}
