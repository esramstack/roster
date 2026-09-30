import "./styles.css";
import { initApp } from "./render";

initApp().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error || "Failed to start app");
  const root = document.getElementById("view") || document.body;
  root.innerHTML = `<div class="card">${message}</div>`;
});
