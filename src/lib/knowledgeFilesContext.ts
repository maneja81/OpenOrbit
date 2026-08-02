import { createContext } from "react";
import type { useKnowledgeFiles } from "@/hooks/useKnowledgeFiles";

/** Shared knowledge-files state so the widget, its expanded modal, and the app-wide
 * drop handler all read/write the same list — a single useKnowledgeFiles() call in
 * AgentsApp, provided here, instead of each consumer holding its own independent copy
 * that only a remount would pick up other consumers' changes. */
export type KnowledgeFilesContextValue = ReturnType<typeof useKnowledgeFiles>;

export const KnowledgeFilesContext = createContext<KnowledgeFilesContextValue | null>(null);
