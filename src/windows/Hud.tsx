import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import type { RecordingState } from "../types";

const BAR_COUNT = 21;

export default function Hud() {
  const [rec, setRec] = useState<RecordingState>({ state: "idle" });
  const [levels, setLevels] = useState<number[]>(Array(BAR_COUNT).fill(0.05));
  const levelsRef = useRef(levels);
  levelsRef.current = levels;

  useEffect(() => {
    const unState = listen<RecordingState>("recording-state", (e) => {
      setRec(e.payload);
      if (e.payload.state === "recording") {
        setLevels(Array(BAR_COUNT).fill(0.05));
      }
    });
    const unLevel = listen<{ level: number }>("audio-level", (e) => {
      // Escala logarítmica aproximada para que la voz normal se vea viva.
      const v = Math.min(1, Math.pow(e.payload.level * 14, 0.8));
      setLevels([...levelsRef.current.slice(1), Math.max(0.06, v)]);
    });
    return () => {
      unState.then((f) => f());
      unLevel.then((f) => f());
    };
  }, []);

  return (
    <div className="flex h-screen w-screen items-center justify-center">
      <div className="flex h-[64px] w-[336px] items-center gap-3 rounded-full border border-white/10 bg-neutral-950/92 px-5 shadow-2xl">
        {rec.state === "recording" && (
          <>
            <span className="relative flex h-3 w-3 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-60" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-red-500" />
            </span>
            <div className="flex h-8 flex-1 items-center justify-center gap-[3px]">
              {levels.map((l, i) => (
                <span
                  key={i}
                  className="w-[4px] rounded-full bg-emerald-400"
                  style={{ height: `${Math.round(6 + l * 26)}px` }}
                />
              ))}
            </div>
            <span className="shrink-0 text-xs font-medium text-neutral-400">
              Escuchando…
            </span>
          </>
        )}

        {rec.state === "processing" && (
          <>
            <div className="flex flex-1 items-center justify-center gap-2">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="h-2.5 w-2.5 rounded-full bg-emerald-400"
                  style={{
                    animation: "mike-bar 0.9s ease-in-out infinite",
                    animationDelay: `${i * 0.15}s`,
                  }}
                />
              ))}
            </div>
            <span className="shrink-0 text-xs font-medium text-neutral-400">
              Transcribiendo…
            </span>
          </>
        )}

        {rec.state === "done" && (
          <>
            <span className="shrink-0 text-emerald-400">✓</span>
            <p className="flex-1 truncate text-sm text-neutral-200">{rec.text}</p>
          </>
        )}

        {rec.state === "error" && (
          <>
            <span className="shrink-0 text-red-400">!</span>
            <p className="flex-1 truncate text-xs text-red-300">{rec.message}</p>
          </>
        )}

        {rec.state === "idle" && (
          <p className="flex-1 text-center text-xs text-neutral-500">Mike</p>
        )}
      </div>
    </div>
  );
}
