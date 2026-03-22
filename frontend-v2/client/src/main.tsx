import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// Force light mode — remove any dark class the browser/OS may inject
document.documentElement.classList.remove("dark");

createRoot(document.getElementById("root")!).render(<App />);
