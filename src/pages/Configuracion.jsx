// src/pages/Configuracion.jsx

import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useTenant } from "../tenant/TenantProvider";
import InstallPWA from "../components/InstallPWA.jsx";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../../firebaseClient.js";
import InviteLinkCard from "../components/InviteLinkCard.jsx";
import CompanyProfileCard from "../components/CompanyProfileCard.jsx";

import "./inventario.css";

function useTheme() {
  const [theme, setTheme] = useState(
    () => localStorage.getItem("theme") || "dark"
  );

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("theme", theme);
  }, [theme]);

  const toggle = () =>
    setTheme((t) => (t === "dark" ? "light" : "dark"));

  return { theme, toggle };
}

export default function Configuracion() {
  const { theme, toggle } = useTheme();

  const {
    empresa,
    user,
    logout,
    unlinkCurrentDevice,
    deviceError
  } = useTenant();

  const navigate = useNavigate();

  const [empresaData, setEmpresaData] = useState(null);
  const [freeing, setFreeing] = useState(false);
  const [msg, setMsg] = useState(null);

  const [modalLogout, setModalLogout] = useState(false);
  const [cerrandoSesion, setCerrandoSesion] = useState(false);

  useEffect(() => {
    (async () => {
      if (!empresa?.id) return;

      try {
        const snap = await getDoc(
          doc(db, "empresas", empresa.id)
        );

        setEmpresaData(
          snap.exists()
            ? snap.data()
            : null
        );
      } catch (e) {
        console.error("Error cargando empresa:", e);
      }
    })();
  }, [empresa?.id]);

  const handleFreeDevice = async () => {
    if (!empresa?.id) return;

    try {
      setFreeing(true);
      setMsg(null);

      await unlinkCurrentDevice(empresa.id);

      setMsg(
        "Este dispositivo fue desvinculado. Cierra sesión e inicia de nuevo si deseas volver a registrarlo."
      );
    } catch (e) {
      console.error(e);

      setMsg(
        "No se pudo desvincular este dispositivo."
      );
    } finally {
      setFreeing(false);
    }
  };

  const handleLogout = async () => {
    if (cerrandoSesion) return;

    try {
      setCerrandoSesion(true);
      setMsg(null);

      await logout();

      navigate("/login", {
        replace: true
      });
    } catch (e) {
      console.error("Error cerrando sesión:", e);

      setMsg(
        "No se pudo cerrar la sesión. Intenta nuevamente."
      );

      setModalLogout(false);
    } finally {
      setCerrandoSesion(false);
    }
  };

  const used = Number(
    empresaData?.devicesCount ?? 0
  );

  const max = Number(
    empresaData?.maxDispositivos ?? 3
  );

  return (
    <div className="inv-root">

      <header className="inv-header">
        <div>
          <h1>Configuración</h1>

          <p className="inv-subtle">
            {empresa?.nombre || "Empresa"} — {user?.email}
          </p>
        </div>

        <div className="header-actions">
          <button
            className="btn theme-toggle"
            onClick={toggle}
          >
            {theme === "dark"
              ? "☀️ Claro"
              : "🌙 Oscuro"}
          </button>

          <Link
            to="/"
            className="btn"
          >
            ← Inventario
          </Link>
        </div>
      </header>

      <section
        className="inv-grid"
        style={{
          gridTemplateColumns: "1fr"
        }}
      >
        <CompanyProfileCard />

        <InviteLinkCard />

        <div className="card">
          <div className="card-header">
            <h2>Dispositivos</h2>
          </div>

          <div className="card-body">
            <p className="inv-subtle">
              Cupo de dispositivos por empresa.
            </p>

            <p>
              <strong>Ocupados:</strong>{" "}
              {used} / {max}
            </p>

            {deviceError && (
              <div
                className="toast toast-error"
                style={{
                  position: "static",
                  marginTop: 12
                }}
              >
                {deviceError}
              </div>
            )}

            {msg && (
              <div
                className="toast"
                style={{
                  position: "static",
                  marginTop: 12
                }}
              >
                {msg}
              </div>
            )}

            <div
              style={{
                marginTop: 12
              }}
            >
              <button
                className="btn btn-muted"
                onClick={handleFreeDevice}
                disabled={freeing}
              >
                {freeing
                  ? "Desvinculando..."
                  : "Desvincular este dispositivo"}
              </button>

              <p
                className="inv-subtle"
                style={{
                  marginTop: 8
                }}
              >
                Úsalo si necesitas liberar un cupo.
                No cierra sesión automáticamente.
              </p>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h2>Instalar aplicación</h2>
          </div>

          <div className="card-body">
            <p>
              Puedes instalar esta aplicación en tu dispositivo
              para usarla como si fuera una app nativa.
              En Android aparecerá un diálogo; en iPhone usa
              “Compartir → Añadir a pantalla de inicio”.
            </p>

            <InstallPWA className="btn btn-primary" />
          </div>
        </div>

        <div
          className="card"
          style={{
            borderColor:
              "rgba(239,68,68,.28)"
          }}
        >
          <div className="card-header">
            <div>
              <h2>Sesión</h2>

              <p
                className="inv-subtle"
                style={{
                  marginTop: 4
                }}
              >
                Administra el acceso de este usuario a Ordexa.
              </p>
            </div>
          </div>

          <div
            className="card-body"
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 16,
              flexWrap: "wrap"
            }}
          >
            <div>
              <strong>
                {user?.email || "Usuario"}
              </strong>

              <p
                className="inv-subtle"
                style={{
                  marginTop: 4
                }}
              >
                Al cerrar sesión tendrás que ingresar nuevamente
                con tu correo y contraseña.
              </p>
            </div>

            <button
              type="button"
              className="btn btn-danger"
              onClick={() =>
                setModalLogout(true)
              }
            >
              🚪 Cerrar sesión
            </button>
          </div>
        </div>
      </section>

      {modalLogout && (
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          onMouseDown={(e) => {
            if (
              e.target === e.currentTarget &&
              !cerrandoSesion
            ) {
              setModalLogout(false);
            }
          }}
        >
          <div
            className="modal-card"
            style={{
              maxWidth: 480
            }}
          >
            <div
              style={{
                display: "flex",
                gap: 14,
                alignItems: "flex-start"
              }}
            >
              <div
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 14,
                  display: "grid",
                  placeItems: "center",
                  flexShrink: 0,
                  fontSize: 22,
                  background:
                    "rgba(239,68,68,.10)",
                  border:
                    "1px solid rgba(239,68,68,.22)"
                }}
              >
                🚪
              </div>

              <div>
                <h3>
                  ¿Cerrar sesión?
                </h3>

                <p>
                  Se cerrará tu sesión de Ordexa en este dispositivo.
                  Después podrás volver a ingresar normalmente con tu
                  correo y contraseña.
                </p>
              </div>
            </div>

            <div className="modal-actions">
              <button
                type="button"
                className="btn"
                disabled={cerrandoSesion}
                onClick={() =>
                  setModalLogout(false)
                }
              >
                Cancelar
              </button>

              <button
                type="button"
                className="btn btn-danger"
                disabled={cerrandoSesion}
                onClick={handleLogout}
              >
                {cerrandoSesion
                  ? "Cerrando..."
                  : "Sí, cerrar sesión"}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
