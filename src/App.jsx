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
import SinEmpresa from "./pages/SinEmpresa.jsx";
import CrearEmpresa from "./pages/CrearEmpresa.jsx";

// Tenant / Auth
import TenantProvider, { useTenant } from "./tenant/TenantProvider";

import "./pages/inventario.css";

/** Protegida (requiere sesión, email verificado y empresa) */
function Protected({ children }) {
  const { user, empresa } = useTenant();
  if (!user) return <Navigate to="/login" replace />;
  if (!user.emailVerified) return <Navigate to="/verificar" replace />;
  if (!empresa?.id) return <Navigate to="/sin-empresa" replace />;
  return children;
}

/** Protegida pero permite no tener empresa (para /sin-empresa y /crear-empresa) */
function ProtectedAllowNoEmpresa({ children }) {
  const { user } = useTenant();
  if (!user) return <Navigate to="/login" replace />;
  if (!user.emailVerified) return <Navigate to="/verificar" replace />;
  return children;
}

/** Solo para rutas públicas si NO hay sesión */
function PublicOnly({ children }) {
  const { user } = useTenant();
  if (user) return <Navigate to="/" replace />;
  return children;
}

/** Banner offline (opcional) */
import OfflineBanner from "./components/OfflineBanner.jsx";

export default function App() {
  return (
    <TenantProvider>
      <Routes>
        {/* Públicas */}
        <Route path="/login" element={<PublicOnly><Login /></PublicOnly>} />
        <Route path="/registro" element={<PublicOnly><SignUp /></PublicOnly>} />
        <Route path="/registro/:empresaId" element={<PublicOnly><SignUp /></PublicOnly>} />
        <Route path="/verificar" element={<VerifyEmail />} />

        {/* Accesibles con sesión pero sin empresa */}
        <Route
          path="/sin-empresa"
          element={
            <ProtectedAllowNoEmpresa>
              <SinEmpresa />
            </ProtectedAllowNoEmpresa>
          }
        />
        <Route
          path="/crear-empresa"
          element={
            <ProtectedAllowNoEmpresa>
              <CrearEmpresa />
            </ProtectedAllowNoEmpresa>
          }
        />

        {/* Protegidas (requiere empresa) */}
        <Route path="/" element={<Protected><Inventario /></Protected>} />
        <Route path="/ventas" element={<Protected><Ventas /></Protected>} />
        <Route path="/factura/:id" element={<Protected><Factura /></Protected>} />
        <Route path="/configuracion" element={<Protected><Configuracion /></Protected>} />
        <Route path="/clientes" element={<Protected><Clientes /></Protected>} />
        <Route path="/clientes/:id" element={<Protected><ClienteDetalle /></Protected>} />
        <Route path="/importar" element={<Protected><Importar /></Protected>} />
        <Route path="/registro-ventas" element={<Protected><RegistroVentas /></Protected>} />

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      <OfflineBanner />
    </TenantProvider>
  );
}
