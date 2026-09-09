// src/App.jsx

import {
  Routes,
  Route,
  Navigate
} from "react-router-dom";

// Páginas
import Inventario from "./pages/Inventario.jsx";
import Ventas from "./pages/Ventas.jsx";
import Compras from "./pages/Compras.jsx";
import HistorialCompras from "./pages/HistorialCompras.jsx";
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
import Historial from "./pages/Historial.jsx";
import Reportes from "./pages/Reportes.jsx";
import Cartera from "./pages/Cartera.jsx";
import MovimientosInventario from "./pages/MovimientosInventario.jsx";
import FacturaCompra from "./pages/FacturaCompra.jsx";

// Tenant / Auth
import TenantProvider, {
  useTenant
} from "./tenant/TenantProvider";

// Offline banner
import OfflineBanner from "./components/OfflineBanner.jsx";

import "./pages/inventario.css";

const ENABLE_ONBOARDING =
  String(
    import.meta.env
      .VITE_ENABLE_ONBOARDING ??
    "true"
  ) !== "false";

/* =========================================================
   PROTECCIÓN COMPLETA
========================================================= */

function Protected({
  children
}) {
  const {
    user,
    empresa
  } = useTenant();

  if (!user) {
    return (
      <Navigate
        to="/login"
        replace
      />
    );
  }

  if (
    !user.emailVerified
  ) {
    return (
      <Navigate
        to="/verificar"
        replace
      />
    );
  }

  if (
    ENABLE_ONBOARDING &&
    !empresa?.id
  ) {
    return (
      <Navigate
        to="/onboarding"
        replace
      />
    );
  }

  return children;
}

/* =========================================================
   PROTECCIÓN BÁSICA
========================================================= */

function ProtectedBasic({
  children
}) {
  const {
    user
  } = useTenant();

  if (!user) {
    return (
      <Navigate
        to="/login"
        replace
      />
    );
  }

  if (
    !user.emailVerified
  ) {
    return (
      <Navigate
        to="/verificar"
        replace
      />
    );
  }

  return children;
}

/* =========================================================
   SOLO PÚBLICO
========================================================= */

function PublicOnly({
  children
}) {
  const {
    user
  } = useTenant();

  if (user) {
    return (
      <Navigate
        to="/"
        replace
      />
    );
  }

  return children;
}

/* =========================================================
   APP
========================================================= */

export default function App() {
  return (
    <TenantProvider>

      <>

        <Routes>

          {/* PÚBLICAS */}

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
            path="/registro/:empresaId"
            element={
              <PublicOnly>
                <SignUp />
              </PublicOnly>
            }
          />

          <Route
            path="/verificar"
            element={
              <VerifyEmail />
            }
          />

          <Route
            path="/reset"
            element={
              <PublicOnly>
                <Reset />
              </PublicOnly>
            }
          />

          {/* ONBOARDING */}

          <Route
            path="/onboarding"
            element={
              <ProtectedBasic>
                <Onboarding />
              </ProtectedBasic>
            }
          />

          {/* INVENTARIO */}

          <Route
            path="/"
            element={
              <Protected>
                <Inventario />
              </Protected>
            }
          />
          <Route
            path="/movimientos-inventario"
            element={
              <Protected>
                <MovimientosInventario />
              </Protected>
            }
          />
          {/* VENTAS */}

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
            path="/historial"
            element={
              <Protected>
                <Historial />
              </Protected>
            }
          />

          <Route
            path="/registro-ventas"
            element={
              <Protected>
                <RegistroVentas />
              </Protected>
            }
          />

          {/* COMPRAS */}

         <Route
  path="/compras"
  element={
    <Protected>
      <Compras />
    </Protected>
  }
/>

<Route
  path="/historial-compras"
  element={
    <Protected>
      <HistorialCompras />
    </Protected>
  }
/>

<Route
  path="/factura-compra/:id"
  element={
    <Protected>
      <FacturaCompra />
    </Protected>
  }
/>

          {/* CARTERA */}

          <Route
            path="/cartera"
            element={
              <Protected>
                <Cartera />
              </Protected>
            }
          />

          {/* CLIENTES */}

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

          {/* REPORTES */}

          <Route
            path="/reportes"
            element={
              <Protected>
                <Reportes />
              </Protected>
            }
          />

          {/* HERRAMIENTAS */}

          <Route
            path="/importar"
            element={
              <Protected>
                <Importar />
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

          {/* FALLBACK */}

          <Route
            path="*"
            element={
              <Navigate
                to="/"
                replace
              />
            }
          />

        </Routes>

        <OfflineBanner />

      </>

    </TenantProvider>
  );
}