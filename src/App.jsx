// src/App.jsx
import { Routes, Route, Navigate } from "react-router-dom";

// Páginas
import Inventario from "./pages/Inventario.jsx";
import Ventas from "./pages/Ventas.jsx";
import Factura from "./pages/Factura.jsx";
import Configuracion from "./pages/Configuracion.jsx";
import Clientes from "./pages/Clientes.jsx";
import ClienteDetalle from "./pages/ClienteDetalle.jsx";
import Login from "./pages/Login.jsx";
import SignUp from "./pages/SignUp.jsx";
import VerifyEmail from "./pages/VerifyEmail.jsx";
import RegistroVentas from "./pages/RegistroVentas.jsx";
import Importar from "./pages/Importar.jsx";
import Onboarding from "./pages/Onboarding.jsx";
import Reset from "./pages/Reset.jsx";
import Historial from "./pages/Historial.jsx"; // 👈 FALTABA
import Reportes from "./pages/Reportes.jsx";

// Tenant / Auth
import TenantProvider, { useTenant } from "./tenant/TenantProvider";

// Offline banner
import OfflineBanner from "./components/OfflineBanner.jsx";

import "./pages/inventario.css";

const ENABLE_ONBOARDING =
  String(import.meta.env.VITE_ENABLE_ONBOARDING ?? "true") !== "false";

// ----- Rutas auxiliares -----
function Protected({ children }) {
  const { user, empresa } = useTenant();
  if (!user) return <Navigate to="/login" replace />;
  if (!user.emailVerified) return <Navigate to="/verificar" replace />;
  if (ENABLE_ONBOARDING && !empresa?.id) {
    return <Navigate to="/onboarding" replace />;
  }
  return children;
}

function ProtectedBasic({ children }) {
  const { user } = useTenant();
  if (!user) return <Navigate to="/login" replace />;
  if (!user.emailVerified) return <Navigate to="/verificar" replace />;
  return children;
}

function PublicOnly({ children }) {
  const { user } = useTenant();
  if (user) return <Navigate to="/" replace />;
  return children;
}

// ----- App -----
export default function App() {
  return (
    <TenantProvider>
      <>
        <Routes>
          {/* Públicas */}
          <Route path="/login" element={<PublicOnly><Login /></PublicOnly>} />
          <Route path="/registro" element={<PublicOnly><SignUp /></PublicOnly>} />
          <Route path="/registro/:empresaId" element={<PublicOnly><SignUp /></PublicOnly>} />
          <Route path="/verificar" element={<VerifyEmail />} />

          {/* Onboarding */}
          <Route path="/onboarding" element={<ProtectedBasic><Onboarding /></ProtectedBasic>} />

          {/* Protegidas */}
          <Route path="/" element={<Protected><Inventario /></Protected>} />
          <Route path="/ventas" element={<Protected><Ventas /></Protected>} />
          <Route path="/factura/:id" element={<Protected><Factura /></Protected>} />
          <Route path="/configuracion" element={<Protected><Configuracion /></Protected>} />
          <Route path="/clientes" element={<Protected><Clientes /></Protected>} />
          <Route path="/clientes/:id" element={<Protected><ClienteDetalle /></Protected>} />
          <Route path="/importar" element={<Protected><Importar /></Protected>} />
          <Route path="/registro-ventas" element={<Protected><RegistroVentas /></Protected>} />
          <Route path="/reset" element={<PublicOnly><Reset /></PublicOnly>} />
          <Route path="/historial" element={<Protected><Historial /></Protected>} />
          <Route path="/reportes" element={<Protected><Reportes /></Protected>} />



          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>

        <OfflineBanner />
      </>
    </TenantProvider>
  );
}
