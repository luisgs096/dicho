import { useCallback, useEffect, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { invoke } from "@tauri-apps/api/core";

/// Fases del ciclo de actualización. `alDia` sólo se muestra cuando el usuario
/// pulsó el botón: en el arranque una comprobación sin novedad debe ser muda.
export type EstadoUpdate =
  | { fase: "inactivo" }
  | { fase: "buscando" }
  | { fase: "alDia" }
  | { fase: "disponible"; version: string; notas: string }
  | { fase: "descargando"; version: string; hechos: number; total: number }
  | { fase: "listo"; version: string }
  | { fase: "error"; mensaje: string };

export function useUpdater() {
  const [estado, setEstado] = useState<EstadoUpdate>({ fase: "inactivo" });
  const [versionActual, setVersionActual] = useState<string | null>(null);
  // El objeto Update trae el handle de descarga; no cabe en el estado de React
  // porque no es serializable ni debe disparar re-render.
  const pendiente = useRef<Update | null>(null);

  const buscar = useCallback(async (manual: boolean) => {
    if (manual) setEstado({ fase: "buscando" });
    try {
      const update = await check();
      if (update) {
        pendiente.current = update;
        setEstado({
          fase: "disponible",
          version: update.version,
          notas: update.body ?? "",
        });
      } else if (manual) {
        setEstado({ fase: "alDia" });
      }
    } catch (e) {
      // Sin internet o sin release publicada todavía: en el arranque se calla,
      // que el usuario no tiene nada que hacer al respecto.
      if (manual) setEstado({ fase: "error", mensaje: String(e) });
      else console.warn("comprobación de actualizaciones falló:", e);
    }
  }, []);

  const instalar = useCallback(async () => {
    const update = pendiente.current;
    if (!update) return;
    let hechos = 0;
    let total = 0;
    setEstado({ fase: "descargando", version: update.version, hechos: 0, total: 0 });
    try {
      // Antes de nada, dejar programado el relanzamiento: el instalador mata
      // Dicho y por ese camino su propio `/R` no vuelve a abrirlo.
      await invoke("programar_relanzamiento").catch(console.warn);
      await update.downloadAndInstall((ev) => {
        switch (ev.event) {
          case "Started":
            total = ev.data.contentLength ?? 0;
            setEstado({ fase: "descargando", version: update.version, hechos: 0, total });
            break;
          case "Progress":
            hechos += ev.data.chunkLength;
            setEstado({ fase: "descargando", version: update.version, hechos, total });
            break;
          case "Finished":
            setEstado({ fase: "listo", version: update.version });
            break;
        }
      });
      // Si el proceso llega vivo hasta aquí, este es el camino limpio; si no,
      // el relanzamiento programado arriba se encarga.
      await relaunch();
    } catch (e) {
      setEstado({ fase: "error", mensaje: String(e) });
    }
  }, []);

  useEffect(() => {
    getVersion().then(setVersionActual).catch(console.error);
    // Una comprobación silenciosa al abrir la ventana…
    buscar(false);
    // …y otra cada vez que la ventana vuelve al frente. Antes se miraba **sólo**
    // al abrirla: con la ventana abierta de fondo durante horas, la campanita de
    // "hay versión nueva" no se encendía nunca aunque la hubiera. Volver a mirar
    // al recuperar el foco es el momento exacto en que el usuario va a verla.
    // No se vuelve a mirar si ya hay una esperando o se está instalando: sería
    // pisar el estado en mitad de la descarga.
    const alVolver = () => {
      if (document.visibilityState !== "visible") return;
      setEstado((e) => {
        if (e.fase === "inactivo" || e.fase === "alDia") buscar(false);
        return e;
      });
    };
    window.addEventListener("focus", alVolver);
    document.addEventListener("visibilitychange", alVolver);
    return () => {
      window.removeEventListener("focus", alVolver);
      document.removeEventListener("visibilitychange", alVolver);
    };
  }, [buscar]);

  return { estado, versionActual, buscar, instalar };
}
