import { createContext, RefObject } from "react";

/** Shared ref to the Knowledge widget's dropzone element, so a window-level drop
 * handler elsewhere in the tree can read its live position for the fly-to-widget
 * animation. Null when the widget isn't currently mounted (e.g. hidden layout state). */
export const KnowledgeWidgetAnchorContext = createContext<RefObject<HTMLDivElement | null> | null>(null);
