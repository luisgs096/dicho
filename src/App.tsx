import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import Hud from "./windows/Hud";
import Settings from "./windows/Settings";

export default function App() {
  const label = getCurrentWebviewWindow().label;
  return label === "hud" ? <Hud /> : <Settings />;
}
