import React from "react";
import ReactDOM from "react-dom/client";

// Self-hosted, bundled fonts — the interface never depends on the network.
// Bricolage Grotesque and DM Sans are loaded by app.css; Inter is a
// bundled fallback and JetBrains Mono is used for code.
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";

import "./styles/app.css";
import App from "./App";
import {StudioErrorBoundary} from "./components/StudioErrorBoundary";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <StudioErrorBoundary><App /></StudioErrorBoundary>
  </React.StrictMode>,
);
