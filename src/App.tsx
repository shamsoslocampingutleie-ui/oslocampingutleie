import { useEffect, useRef } from "react";
import "./App.css";

export default function App() {
  const ref = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.data?.type === "_ocuNav") {
        const view = e.data.view as string;
        const path = "/" + (view === "home" ? "" : view);
        window.history.pushState({ view }, "", path);
      }
    }
    window.addEventListener("message", onMessage);

    function onPop() {
      const view = window.location.pathname.replace(/^\//, "") || "home";
      ref.current?.contentWindow?.postMessage({ type: "route", view }, "*");
    }
    window.addEventListener("popstate", onPop);

    function onLoad() {
      const initialView = window.location.pathname.replace(/^\//, "") || "home";
      if (initialView !== "home") {
        ref.current?.contentWindow?.postMessage({ type: "route", view: initialView }, "*");
      }
    }
    const iframe = ref.current;
    iframe?.addEventListener("load", onLoad);

    return () => {
      window.removeEventListener("message", onMessage);
      window.removeEventListener("popstate", onPop);
      iframe?.removeEventListener("load", onLoad);
    };
  }, []);

  return (
    <iframe
      ref={ref}
      src="/app.html"
      className="app-frame"
      title="Oslo Camping Utleie"
      allow="geolocation; clipboard-write"
    />
  );
}
