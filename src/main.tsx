import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "yakuhanjp/dist/css/yakuhanjp_s.css";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
