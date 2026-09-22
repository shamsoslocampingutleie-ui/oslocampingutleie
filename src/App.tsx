import { useEffect, useRef } from "react";
import "./App.css";

export default function App() {
  const ref = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.origin !== window.location.origin) return;
      if (e.data?.type === "_ocuNav") {
        const view = e.data.view as string;
        const path = "/" + (view === "home" ? "" : view);
        window.history.pushState({ view }, "", path);
      }
    }
    window.addEventListener("message", onMessage);

    function onPop() {
      const view = window.location.pathname.replace(/^\//, "") || "home";
      ref.current?.contentWindow?.postMessage({ type: "route", view }, window.location.origin);
    }
    window.addEventListener("popstate", onPop);

    function onLoad() {
      const params = new URLSearchParams(window.location.search);
      const listingId = params.get("listing");
      if (listingId) {
        ref.current?.contentWindow?.postMessage({ type: "route", view: "listing/" + listingId }, "*");
        return;
      }
      // cat/loc let SEO landing pages deep-link straight into a pre-filtered
      // search (e.g. /?cat=trailer&loc=Oslo) instead of dumping visitors on
      // the unfiltered homepage.
      const cat = params.get("cat") || undefined;
      const loc = params.get("loc") || undefined;
      const initialView = window.location.pathname.replace(/^\//, "") || "home";
      if (initialView !== "home" || cat || loc) {
        ref.current?.contentWindow?.postMessage({ type: "route", view: initialView, cat, loc }, "*");
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
      title="Leieplattform"
      allow="geolocation; clipboard-write"
    />
  );
}
