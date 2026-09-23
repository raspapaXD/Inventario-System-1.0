// src/components/AppLayout.jsx

import {
  useEffect,
  useState
} from "react";

import {
  useLocation
} from "react-router-dom";

import AppSidebar from "./AppSidebar.jsx";

const STORAGE_KEY =
  "ordexa_sidebar_hidden";

function detectarMobile() {
  if (
    typeof window ===
    "undefined"
  ) {
    return false;
  }

  return window.matchMedia(
    "(max-width: 900px)"
  ).matches;
}

export default function AppLayout({
  children
}) {
  const location =
    useLocation();

  const [
    esMobile,
    setEsMobile
  ] = useState(
    detectarMobile
  );

  const [
    sidebarOcultaDesktop,
    setSidebarOcultaDesktop
  ] = useState(
    () =>
      localStorage.getItem(
        STORAGE_KEY
      ) === "1"
  );

  const [
    sidebarMobileAbierta,
    setSidebarMobileAbierta
  ] = useState(false);

  /* =======================================================
     RESPONSIVE
  ======================================================= */

  useEffect(() => {
    const media =
      window.matchMedia(
        "(max-width: 900px)"
      );

    const onChange =
      event => {
        setEsMobile(
          event.matches
        );

        if (
          !event.matches
        ) {
          setSidebarMobileAbierta(
            false
          );
        }
      };

    setEsMobile(
      media.matches
    );

    media.addEventListener(
      "change",
      onChange
    );

    return () => {
      media.removeEventListener(
        "change",
        onChange
      );
    };
  }, []);

  /* =======================================================
     CERRAR DRAWER AL CAMBIAR DE PÁGINA
  ======================================================= */

  useEffect(() => {
    if (
      esMobile
    ) {
      setSidebarMobileAbierta(
        false
      );
    }
  }, [
    location.pathname,
    location.search,
    esMobile
  ]);

  /* =======================================================
     ACCIONES
  ======================================================= */

  const ocultarSidebar =
    () => {
      if (
        esMobile
      ) {
        setSidebarMobileAbierta(
          false
        );

        return;
      }

      setSidebarOcultaDesktop(
        true
      );

      localStorage.setItem(
        STORAGE_KEY,
        "1"
      );
    };

  const mostrarSidebar =
    () => {
      if (
        esMobile
      ) {
        setSidebarMobileAbierta(
          true
        );

        return;
      }

      setSidebarOcultaDesktop(
        false
      );

      localStorage.setItem(
        STORAGE_KEY,
        "0"
      );
    };

  const sidebarVisible =
    esMobile
      ? sidebarMobileAbierta
      : !sidebarOcultaDesktop;

  return (
    <div
      className="ordexa-app-shell"
      data-sidebar-visible={sidebarVisible ? "true" : "false"}
    >

      <AppSidebar
        visible={
          sidebarVisible
        }
        esMobile={
          esMobile
        }
        onClose={
          ocultarSidebar
        }
      />

      {esMobile &&
        sidebarVisible && (

        <button
          type="button"
          className="ordexa-sidebar-overlay"
          aria-label="Cerrar navegación"
          onClick={
            ocultarSidebar
          }
        />

      )}

      {/* BOTÓN GLOBAL MÓVIL
          Ya no vive dentro de cada página. */}
      {esMobile &&
        !sidebarVisible && (

        <button
          type="button"
          className="ordexa-mobile-menu-trigger"
          onClick={
            mostrarSidebar
          }
          title="Abrir navegación"
          aria-label="Abrir navegación"
        >
          ☰
        </button>

      )}

      {/* BOTÓN GLOBAL DESKTOP
          Solo aparece cuando la barra fue escondida. */}
      {!esMobile &&
        !sidebarVisible && (

        <button
          type="button"
          className="ordexa-sidebar-reopen"
          onClick={
            mostrarSidebar
          }
          title="Mostrar barra lateral"
          aria-label="Mostrar barra lateral"
        >
          ☰
        </button>

      )}

      <main
        className={
          sidebarVisible &&
          !esMobile
            ? "ordexa-main ordexa-main--sidebar-open"
            : "ordexa-main ordexa-main--sidebar-hidden"
        }
      >
        {children}
      </main>

    </div>
  );
}
