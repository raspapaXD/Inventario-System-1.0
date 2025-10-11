import { useEffect, useState } from "react";

export default function OfflineBanner() {
  const [online, setOnline] = useState(navigator.onLine);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  if (online) return null;
  return (
    <div style={{
      position:"fixed", left:0, right:0, bottom:0, zIndex:9999,
      background:"#8b2635", color:"white", padding:"8px 12px",
      textAlign:"center", boxShadow:"0 -2px 8px rgba(0,0,0,.2)"
    }}>
      Estás sin conexión. Los cambios se guardarán y se sincronizarán al volver Internet.
    </div>
  );
}
