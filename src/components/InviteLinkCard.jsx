import { useState, useMemo } from "react";
import { useTenant } from "../tenant/TenantProvider";

export default function InviteLinkCard() {
  const { empresa, canManage } = useTenant();
  const [msg, setMsg] = useState("");

  // 👇 Llama a useMemo ANTES de cualquier return condicional para mantener el orden de hooks
  const inviteUrl = useMemo(() => {
    return empresa?.id ? `${window.location.origin}/registro/${empresa.id}` : "";
  }, [empresa?.id]);

  // Guard de render (después de los hooks)
  if (!empresa?.id || !canManage) return null;

  const copy = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      setMsg("Copiado ✅");
      setTimeout(() => setMsg(""), 1800);
    } catch {
      setMsg("No se pudo copiar");
      setTimeout(() => setMsg(""), 1800);
    }
  };

  return (
    <div className="card" style={{ border: "1px solid var(--border)", marginTop: 16 }}>
      <div className="card-header">
        <h3>Invitar usuarios</h3>
        <p className="inv-subtle">Comparte el link o el código para que se unan como miembros.</p>
      </div>

      <div className="card-body" style={{ display: "grid", gap: 12 }}>
        <div>
          <label>Link de invitación</label>
          <div style={{ display: "flex", gap: 8 }}>
            <input type="text" readOnly value={inviteUrl} style={{ flex: 1 }} />
            <button className="btn" onClick={() => copy(inviteUrl)}>Copiar link</button>
          </div>
        </div>

        <div>
          <label>Código de empresa</label>
          <div style={{ display: "flex", gap: 8 }}>
            <input type="text" readOnly value={empresa.id} style={{ flex: 1 }} />
            <button className="btn" onClick={() => copy(empresa.id)}>Copiar código</button>
          </div>
        </div>

        {!!msg && <div className="toast" style={{ position: "static" }}>{msg}</div>}
      </div>
    </div>
  );
}
