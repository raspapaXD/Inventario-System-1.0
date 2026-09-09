// src/components/AppMenu.jsx

import {
  useEffect,
  useRef,
  useState
} from "react";

import {
  Link
} from "react-router-dom";

export default function AppMenu() {
  const [
    abierto,
    setAbierto
  ] = useState(false);

  const menuRef =
    useRef(null);

  useEffect(() => {
    const cerrarFuera = e => {
      if (
        menuRef.current &&
        !menuRef.current.contains(
          e.target
        )
      ) {
        setAbierto(false);
      }
    };

    const cerrarEsc = e => {
      if (
        e.key === "Escape"
      ) {
        setAbierto(false);
      }
    };

    document.addEventListener(
      "mousedown",
      cerrarFuera
    );

    document.addEventListener(
      "keydown",
      cerrarEsc
    );

    return () => {
      document.removeEventListener(
        "mousedown",
        cerrarFuera
      );

      document.removeEventListener(
        "keydown",
        cerrarEsc
      );
    };
  }, []);

  const cerrarMenu = () => {
    setAbierto(false);
  };

  return (
    <div
      ref={menuRef}
      style={{
        position: "relative"
      }}
    >

      <button
        type="button"
        className="btn"
        onClick={() =>
          setAbierto(
            actual =>
              !actual
          )
        }
        aria-expanded={
          abierto
        }
        aria-label="Abrir menú principal"
      >
        ☰ Menú
      </button>

      {abierto && (

        <div
          style={{
            position: "absolute",
            top:
              "calc(100% + 8px)",
            right: 0,

            width: 310,

            maxWidth:
              "calc(100vw - 24px)",

            maxHeight: "80vh",

            overflowY: "auto",

            padding: 10,

            borderRadius: 16,

            border:
              "1px solid var(--border)",

            background:
              "var(--card)",

            boxShadow:
              "0 20px 60px rgba(0,0,0,.35)",

            zIndex: 5000
          }}
        >

          {/* =========================================
              PRINCIPAL
          ========================================= */}

          <MenuTitle>
            PRINCIPAL
          </MenuTitle>

          <MenuItem
            to="/"
            onClick={
              cerrarMenu
            }
          >
            📦 Inventario
          </MenuItem>

          {/* =========================================
              OPERACIÓN
          ========================================= */}

          <MenuTitle>
            OPERACIÓN
          </MenuTitle>

          <MenuItem
            to="/ventas"
            onClick={
              cerrarMenu
            }
          >
            🧾 Registrar venta
          </MenuItem>

          <MenuItem
            to="/compras"
            onClick={
              cerrarMenu
            }
          >
            🛒 Registrar compra
          </MenuItem>

          {/* =========================================
              GESTIÓN
          ========================================= */}

          <MenuTitle>
            GESTIÓN
          </MenuTitle>

          <MenuItem
            to="/cartera"
            onClick={
              cerrarMenu
            }
          >
            💰 Cartera
          </MenuItem>

          <MenuItem
            to="/movimientos-inventario"
            onClick={
              cerrarMenu
            }
          >
            📜 Movimientos de inventario
          </MenuItem>

          <MenuItem
            to="/clientes"
            onClick={
              cerrarMenu
            }
          >
            👥 Clientes
          </MenuItem>

          <MenuItem
            to="/historial"
            onClick={
              cerrarMenu
            }
          >
            📋 Historial de ventas
          </MenuItem>

          <MenuItem
            to="/historial-compras"
            onClick={
              cerrarMenu
            }
          >
            📑 Historial de compras
          </MenuItem>

          <MenuItem
            to="/reportes"
            onClick={
              cerrarMenu
            }
          >
            📊 Reportes
          </MenuItem>

          {/* =========================================
              HERRAMIENTAS
          ========================================= */}

          <MenuTitle>
            HERRAMIENTAS
          </MenuTitle>

          <MenuItem
            to="/importar"
            onClick={
              cerrarMenu
            }
          >
            ⬆️ Importar productos
          </MenuItem>

          <MenuItem
            to="/configuracion"
            onClick={
              cerrarMenu
            }
          >
            ⚙️ Configuración
          </MenuItem>

        </div>

      )}

    </div>
  );
}

/* =========================================================
   TÍTULO DE SECCIÓN
========================================================= */

function MenuTitle({
  children
}) {
  return (
    <div
      style={{
        padding:
          "12px 10px 5px",

        fontSize: 11,

        fontWeight: 800,

        opacity: 0.55,

        letterSpacing: 1
      }}
    >
      {children}
    </div>
  );
}

/* =========================================================
   ITEM DEL MENÚ
========================================================= */

function MenuItem({
  to,
  onClick,
  children
}) {
  const [
    hover,
    setHover
  ] = useState(false);

  return (
    <Link
      to={to}
      onClick={
        onClick
      }
      onMouseEnter={() =>
        setHover(true)
      }
      onMouseLeave={() =>
        setHover(false)
      }
      style={{
        display: "flex",

        width: "100%",

        boxSizing:
          "border-box",

        alignItems:
          "center",

        minHeight: 42,

        padding:
          "10px 12px",

        marginBottom: 2,

        borderRadius: 10,

        color:
          "var(--text)",

        textDecoration:
          "none",

        fontWeight: 600,

        lineHeight: 1.3,

        background:
          hover
            ? "rgba(255,255,255,.07)"
            : "transparent",

        transition:
          "background .15s ease, transform .15s ease",

        transform:
          hover
            ? "translateX(2px)"
            : "translateX(0)"
      }}
    >
      {children}
    </Link>
  );
}