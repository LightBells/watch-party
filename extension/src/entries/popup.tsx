import { createRoot } from "react-dom/client";
import "../styles.css";
import PopupApp from "../features/popup/PopupApp";

const container = document.getElementById("root");

if (!container) {
  throw new Error("Popup root element not found");
}

const root = createRoot(container);
root.render(<PopupApp />);
