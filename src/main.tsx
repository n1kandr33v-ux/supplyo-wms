import { StrictMode, useState, useEffect, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import "./styles/controls.css";
import "./styles/notifications.css";
import "./styles/skeleton.css";
import "./styles/motion.css";
import App from "./App.tsx";
import { Landing } from "./landing";
import { Auth } from "./auth";
import { LiveRoot } from "./live";
const MobileApp=lazy(()=>import('./mobile').then(m=>({default:m.MobileApp})));
const mobileMode=new URLSearchParams(location.search).get('mobile')==='1'||location.hash.startsWith('#mobile');
function Root() {
  const [route, setRoute] = useState(window.location.hash);
  useEffect(() => {
    const change = () => {
      setRoute(window.location.hash);
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  if (route === "#login" || route === "#register")
    return <Auth key={route} register={route === "#register"} />;
  return [
    "#welcome",
    "#features",
    "#workflow",
    "#questions",
    "#pricing",
  ].includes(route) ? (
    <Landing />
  ) : (
    <App />
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {mobileMode ? <Suspense fallback={<p style={{padding:24,color:'#ddd'}}>Загружаем supply…</p>}><MobileApp/></Suspense> : import.meta.env.VITE_LIVE_MODE === "true" ? <LiveRoot /> : <Root />}
  </StrictMode>,
);
