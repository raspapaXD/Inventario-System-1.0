import { Routes, Route } from "react-router-dom";
import Inventario from "./pages/Inventario.jsx";
import Ventas from "./pages/Ventas.jsx";
import Factura from "./pages/Factura.jsx"; // Asegúrate que el nombre sea Factura, no Facturas

function App() {
  return (
    <Routes>
      <Route path="/" element={<Inventario />} />
      <Route path="/ventas" element={<Ventas />} />
      <Route path="/factura/:id" element={<Factura />} />
    </Routes>
  );
}

export default App;
