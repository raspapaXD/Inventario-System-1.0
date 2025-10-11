import { useEffect, useState } from "react";

export default function InstallPWA({ className = "btn" }) {
  const [deferred, setDeferred] = useState(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    const onBeforeInstall = (e) => {
      e.preventDefault();
      setDeferred(e);
    };
    const onInstalled = () => setInstalled(true);

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const install = async () => {
    if (!deferred) return;
    deferred.prompt();
    const { outcome } = await deferred.userChoice;
    setDeferred(null);
    // outcome: 'accepted' | 'dismissed'
    // puedes registrar analytics si quieres
  };

  if (installed) return null;            // ya instalada
  if (!deferred) return null;            // el navegador aún no ofrece instalar

  return (
    <button className={className} onClick={install}>
      📲 Instalar app
    </button>
  );
}
