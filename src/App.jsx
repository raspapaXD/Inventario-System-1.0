import { Routes, Route } from "react-router-dom";
import Inventario from "./pages/Inventario.jsx";
import Ventas from "./pages/Ventas.jsx";
import Factura from "./pages/Factura.jsx";
import Configuracion from "./pages/Configuracion.jsx";
import Clientes from "./pages/Clientes.jsx";
import ClienteDetalle from "./pages/ClienteDetalle.jsx";

function App() {
  return (
    <Routes>
      <Route path="/" element={<Inventario />} />
      <Route path="/ventas" element={<Ventas />} />
      <Route path="/factura/:id" element={<Factura />} />
      <Route path="/configuracion" element={<Configuracion />} />
      <Route path="/clientes" element={<Clientes />} />
      <Route path="/clientes/:id" element={<ClienteDetalle />} />
    </Routes>
  );
}

export default App;
