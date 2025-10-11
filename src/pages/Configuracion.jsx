// src/pages/Configuracion.jsx
import { useEffect, useState } from "react";
import { useTenant } from "../tenant/TenantProvider";
import { Link } from "react-router-dom";
import InstallPWA from "../components/InstallPWA.jsx";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../../firebaseClient.js";

import "./inventario.css";

function useTheme() {
  const [theme, setTheme] = useState(() => localStorage.getItem("theme") || "dark");
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("theme", theme);
  }, [theme]);
  const toggle = () => setTheme((t) => (t === "dark" ? "light" : "dark"));
  return { theme, toggle };
}

export default function Configuracion() {
  const { theme, toggle } = useTheme();
  const { empresa, user, unlinkCurrentDevice, deviceError } = useTenant();
  const [empresaData, setEmpresaData] = useState(null);
  const [freeing, setFreeing] = useState(false);
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    (async () => {
      if (!empresa?.id) return;
      const snap = await getDoc(doc(db, "empresas", empresa.id));
      setEmpresaData(snap.exists() ? snap.data() : null);
    })();
  }, [empresa]);

  const handleFreeDevice = async () => {
    if (!empresa?.id) return;
    try {
      setFreeing(true);
      setMsg(null);
      await unlinkCurrentDevice(empresa.id);
      setMsg("Este dispositivo fue desvinculado. Cierra sesión e inicia de nuevo si deseas volver a registrarlo.");
    } catch (e) {
      console.error(e);
      setMsg("No se pudo desvincular este dispositivo.");
    } finally {
      setFreeing(false);
    }
  };

  const used = Number(empresaData?.devicesCount ?? 0);
  const max  = Number(empresaData?.maxDispositivos ?? 3);

  return (
    <div className="inv-root">
      {/* Header */}
      <header className="inv-header">
        <div>
          <h1>Configuración</h1>
          <p className="inv-subtle">
            {empresa?.nombre || "Empresa"} — {user?.email}
          </p>
        </div>
        <div className="header-actions">
          <button className="btn theme-toggle" onClick={toggle}>
            {theme === "dark" ? "☀️ Claro" : "🌙 Oscuro"}
          </button>
          <Link to="/" className="btn">← Inventario</Link>
        </div>
      </header>

      {/* Contenido */}
      <section className="inv-grid" style={{ gridTemplateColumns: "1fr" }}>
        <div className="card">
          <div className="card-header"><h2>Opciones de la empresa</h2></div>
          <div className="card-body">
            <p><strong>Nombre:</strong> {empresa?.nombre || "—"}</p>
            <p><strong>NIT:</strong> {empresa?.nit || "—"}</p>
            <p><strong>Correo administrador:</strong> {user?.email}</p>
          </div>
        </div>

        <div className="card">
          <div className="card-header"><h2>Dispositivos</h2></div>
          <div className="card-body">
            <p className="inv-subtle">Cupo de dispositivos por empresa.</p>
            <p><strong>Ocupados:</strong> {used} / {max}</p>

            {deviceError && (
              <div className="toast toast-error" style={{ position: "static", marginTop: 12 }}>
                {deviceError}
              </div>
            )}

            {msg && (
              <div className="toast" style={{ position: "static", marginTop: 12 }}>
                {msg}
              </div>
            )}

            <div style={{ marginTop: 12 }}>
              <button className="btn btn-muted" onClick={handleFreeDevice} disabled={freeing}>
                {freeing ? "Desvinculando..." : "Desvincular este dispositivo"}
              </button>
              <p className="inv-subtle" style={{ marginTop: 8 }}>
                Úsalo si necesitas liberar un cupo. (No cierra sesión automáticamente.)
              </p>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-header"><h2>Instalar aplicación</h2></div>
          <div className="card-body">
            <p>
              Puedes instalar esta aplicación en tu dispositivo para usarla como
              si fuera una app nativa. En Android aparecerá un diálogo; en iPhone
              usa “Compartir → Añadir a pantalla de inicio”.
            </p>
            <InstallPWA className="btn btn-primary" />
          </div>
        </div>
      </section>
    </div>
  );
}
