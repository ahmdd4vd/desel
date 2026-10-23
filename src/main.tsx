import React from "react";
import ReactDOM from "react-dom/client";

// Self-hosted, bundled fonts — the interface never depends on the network.
// Two families only: Inter for the product, JetBrains Mono for code.
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";

import "./styles/app.css";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
