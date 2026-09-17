// src/components/AppSidebar.jsx

import {
  Link,
  useLocation
} from "react-router-dom";

const SECCIONES = [
  {
    titulo: "Principal",
    items: [
      {
        to: "/",
        icono: "📦",
        texto: "Inventario",
        exacta: true
      }
    ]
  },
  {
    titulo: "Operación",
    items: [
      {
        to: "/ventas",
        icono: "🧾",
        texto: "Registrar venta"
      },
      {
        to: "/compras",
        icono: "🛒",
        texto: "Registrar compra"
      }
    ]
  },
  {
    titulo: "Gestión",
    items: [
      {
        to: "/cartera",
        icono: "💰",
        texto: "Cartera"
      },
      {
        to: "/clientes",
        icono: "👥",
        texto: "Clientes"
      },
      {
        to: "/proveedores",
        icono: "🏢",
        texto: "Proveedores"
      },
      {
        to: "/movimientos-inventario",
        icono: "📜",
        texto: "Movimientos"
      },
      {
        to: "/historial",
        icono: "📋",
        texto: "Historial de ventas"
      },
      {
        to: "/historial-compras",
        icono: "📑",
        texto: "Historial de compras"
      },
      {
        to: "/reportes",
        icono: "📊",
        texto: "Reportes"
      }
    ]
  },
  {
    titulo: "Herramientas",
    items: [
      {
        to: "/importar",
        icono: "⬆️",
        texto: "Importar productos"
      }
    ]
  }
];

export default function AppSidebar({
  visible,
  esMobile,
  onClose
}) {
  const location =
    useLocation();

  const activo =
    item => {
      if (
        item.exacta
      ) {
        return location.pathname ===
          item.to;
      }

      return (
        location.pathname ===
          item.to ||
        location.pathname.startsWith(
          `${item.to}/`
        )
      );
    };

  return (
    <aside
      className={
        visible
          ? "ordexa-sidebar"
          : "ordexa-sidebar ordexa-sidebar--hidden"
      }
      aria-hidden={
        !visible
      }
    >

      <div className="ordexa-sidebar-header">

        <div className="ordexa-sidebar-brand">

          <div className="ordexa-sidebar-logo">
            O
          </div>

          <div className="ordexa-sidebar-brand-text">

            <span className="ordexa-sidebar-brand-name">
              Ordexa
            </span>

            <span className="ordexa-sidebar-brand-sub">
              Inventario y ventas
            </span>

          </div>

        </div>

        <button
          type="button"
          className="ordexa-sidebar-collapse"
          onClick={
            onClose
          }
          title={
            esMobile
              ? "Cerrar menú"
              : "Ocultar barra lateral"
          }
          aria-label={
            esMobile
              ? "Cerrar menú"
              : "Ocultar barra lateral"
          }
        >
          {esMobile
            ? "✕"
            : "⇤"}
        </button>

      </div>

      <div className="ordexa-sidebar-scroll">

        {SECCIONES.map(
          seccion => (

            <nav
              className="ordexa-sidebar-section"
              key={
                seccion.titulo
              }
            >

              <div className="ordexa-sidebar-section-title">
                {seccion.titulo}
              </div>

              {seccion.items.map(
                item => {

                  const seleccionado =
                    activo(
                      item
                    );

                  return (
                    <Link
                      key={
                        item.to
                      }
                      to={
                        item.to
                      }
                      className={
                        seleccionado
                          ? "ordexa-sidebar-link ordexa-sidebar-link--active"
                          : "ordexa-sidebar-link"
                      }
                    >
                      <span className="ordexa-sidebar-link-icon">
                        {item.icono}
                      </span>

                      <span className="ordexa-sidebar-link-label">
                        {item.texto}
                      </span>
                    </Link>
                  );
                }
              )}

            </nav>

          )
        )}

      </div>

      <div className="ordexa-sidebar-footer">

        <Link
          to="/configuracion"
          className={
            location.pathname.startsWith(
              "/configuracion"
            )
              ? "ordexa-sidebar-link ordexa-sidebar-link--active"
              : "ordexa-sidebar-link"
          }
        >
          <span className="ordexa-sidebar-link-icon">
            ⚙️
          </span>

          <span className="ordexa-sidebar-link-label">
            Configuración
          </span>
        </Link>

      </div>

    </aside>
  );
}
