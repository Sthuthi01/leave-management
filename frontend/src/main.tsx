import React from "react";
import ReactDOM from "react-dom/client";
import "antd/dist/reset.css";
import { App } from "./App";
import { primeCsrfCookie } from "./lib/api-client";

// Must resolve before any mutating request (login, set-password, employee create) — those all
// send X-CSRFToken read from the cookie this call sets. A failure here just means Django's own
// CSRF middleware will reject the first mutating request with a clear 403, not a silent bug.
primeCsrfCookie().catch(() => undefined);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
