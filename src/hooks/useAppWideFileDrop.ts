import { useCallback, useEffect, useState, RefObject } from "react";
import { hasAgentsAPI } from "@/lib/agentsApi";

export interface FileDropGhost {
  id: string;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  hasTarget: boolean;
}

const FLIGHT_DURATION_MS = 500;

/** Window-level drop handler so files can be dropped anywhere in the app, not just on
 * the Knowledge widget's own dropzone. Renders short-lived "ghost" markers that fly
 * (or fade, if the widget isn't currently mounted) toward the widget's live position,
 * then adds the files via the same addFiles() the widget itself uses. */
export function useAppWideFileDrop(
  anchorRef: RefObject<HTMLDivElement | null>,
  addFiles: (filePaths: string[]) => Promise<void>
) {
  const [ghosts, setGhosts] = useState<FileDropGhost[]>([]);

  const removeGhost = useCallback((id: string) => {
    setGhosts((prev) => prev.filter((g) => g.id !== id));
  }, []);

  useEffect(() => {
    const onDragOver = (e: DragEvent) => e.preventDefault();

    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      if (!hasAgentsAPI() || !e.dataTransfer) return;
      const files = Array.from(e.dataTransfer.files);
      const paths = files.map((file) => window.agentsAPI.knowledgebase.getPathForFile(file)).filter(Boolean);
      if (paths.length === 0) return;

      const rect = anchorRef?.current?.getBoundingClientRect() ?? null;
      const startX = e.clientX;
      const startY = e.clientY;
      const endX = rect ? rect.left + rect.width / 2 : startX;
      const endY = rect ? rect.top + rect.height / 2 : startY;

      const newGhosts: FileDropGhost[] = paths.map((_, i) => ({
        id: `${Date.now()}-${i}-${Math.random()}`,
        startX,
        startY,
        endX,
        endY,
        hasTarget: rect !== null,
      }));
      setGhosts((prev) => [...prev, ...newGhosts]);

      window.setTimeout(() => {
        newGhosts.forEach((g) => removeGhost(g.id));
        void addFiles(paths);
        const el = anchorRef?.current;
        if (el) {
          el.classList.add("pulse");
          setTimeout(() => el.classList.remove("pulse"), 600);
        }
      }, FLIGHT_DURATION_MS);
    };

    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
    };
  }, [anchorRef, addFiles, removeGhost]);

  return { ghosts };
}
