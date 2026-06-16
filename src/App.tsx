import { useEffect, useRef } from "react";
import appHtml from "./app.html?raw";
import "./App.css";

export default function App() {
  const ref = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    function onPop() {
      const view = window.location.pathname.replace(/^\//, "") || "home";
      ref.current?.contentWindow?.postMessage({ type: "route", view }, "*");
    }
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  return (
    <iframe
      ref={ref}
      className="app-frame"
      title="Oslo Camping Utleie"
      srcDoc={appHtml}
      allow="geolocation; clipboard-write"
    />
  );
}
