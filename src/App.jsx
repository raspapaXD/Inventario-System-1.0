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
import ResetPassword from "./pages/ResetPassword.jsx"; // 👈 NUEVA

// Tenant / Auth
import TenantProvider, { useTenant } from "./tenant/TenantProvider";

// (opcional) estilos base
import "./pages/inventario.css";

/** RUTA PROTEGIDA
 *  - Requiere usuario logueado
 *  - Requiere email verificado
 *  - Requiere empresa asignada
 */
function Protected({ children }) {
  const { user, empresa } = useTenant();

  // Aún sin sesión -> a Login
  if (!user) return <Navigate to="/login" replace />;

  // Sesión pero sin verificar email -> a Verificar
  if (!user.emailVerified) return <Navigate to="/verificar" replace />;

  // Verificado pero sin empresa asignada -> mensaje
  if (!empresa) {
    return (
      <div className="inv-root">
        <h2>Sin empresa asignada</h2>
        <p className="inv-subtle">
          Tu usuario no está asociado a ninguna empresa aún. Pide a un
          administrador que te añada al array <code>usuarios</code> de su documento en
          <code> empresas/{"{empresaId}"} </code>.
        </p>
        <p className="inv-subtle" style={{ marginTop: 8 }}>
          (Si estás probando, crea la colección <code>empresas</code> y añade tu <code>uid</code> al campo
          <code> usuarios </code> en un documento de empresa)
        </p>
      </div>
    );
  }

  return children;
}

/** SOLO PÚBLICAS
 * - Si ya hay sesión, redirige al Home
 */
function PublicOnly({ children }) {
  const { user } = useTenant();
  if (user) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  return (
    <TenantProvider>
      <Routes>
        {/* Rutas públicas */}
        <Route
          path="/login"
          element={
            <PublicOnly>
              <Login />
            </PublicOnly>
          }
        />
        <Route
          path="/registro"
          element={
            <PublicOnly>
              <SignUp />
            </PublicOnly>
          }
        />
        <Route
          path="/reset"
          element={
            <PublicOnly>
              <ResetPassword />
            </PublicOnly>
          }
        />
        {/* Nota: /verificar debe estar accesible aunque NO haya sesión o no esté verificado */}
        <Route path="/verificar" element={<VerifyEmail />} />

        {/* Rutas protegidas */}
        <Route
          path="/"
          element={
            <Protected>
              <Inventario />
            </Protected>
          }
        />
        <Route
          path="/ventas"
          element={
            <Protected>
              <Ventas />
            </Protected>
          }
        />
        <Route
          path="/factura/:id"
          element={
            <Protected>
              <Factura />
            </Protected>
          }
        />
        <Route
          path="/configuracion"
          element={
            <Protected>
              <Configuracion />
            </Protected>
          }
        />
        <Route
          path="/clientes"
          element={
            <Protected>
              <Clientes />
            </Protected>
          }
        />
        <Route
          path="/clientes/:id"
          element={
            <Protected>
              <ClienteDetalle />
            </Protected>
          }
        />

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </TenantProvider>
  );
}
