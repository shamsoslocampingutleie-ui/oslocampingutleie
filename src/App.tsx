// Oslo Camping Utleie — the whole app lives in src/app.html and is loaded here.
// "?raw" imports the file as plain text (so its inline <script> regex etc. stay intact).
import appHtml from "./app.html?raw";
import "./App.css";

export default function App() {
  return (
    <iframe
      className="app-frame"
      title="Oslo Camping Utleie"
      srcDoc={appHtml}
      allow="geolocation; clipboard-write"
    />
  );
}
