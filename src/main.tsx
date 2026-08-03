import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import AgentsApp from "@/components/organisms/AgentsApp";
import ErrorBoundary from "@/components/atoms/ErrorBoundary";
import "./vendor/tabler-icons/tabler-icons.min.css";
import "./globals.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <AgentsApp />
    </ErrorBoundary>
  </StrictMode>
);
