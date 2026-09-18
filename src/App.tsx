import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import Hud from "./windows/Hud";
import Revision from "./windows/Revision";
import Settings from "./windows/Settings";

/** Qué ventana se pinta lo dice su etiqueta: las tres comparten un solo bundle. */
export default function App() {
  switch (getCurrentWebviewWindow().label) {
    case "hud":
      return <Hud />;
    case "revision":
      return <Revision />;
    default:
      return <Settings />;
  }
}
