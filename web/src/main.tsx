import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./styles/global.css";
import "./styles/tokens.css";

const root = document.querySelector("#app");
if (!root) throw new Error("找不到应用挂载点");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
