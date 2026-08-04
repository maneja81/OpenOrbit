// Minimal ambient declaration for page.evaluate() callbacks, which run in the renderer and can
// reference window.agentsAPI. The full contextBridge surface is typed in src/vite-env.d.ts, but
// that file lives in the web tsconfig project — e2e specs only need to know the property exists,
// not its full shape, since they drive the UI rather than call the bridge directly.
interface Window {
  agentsAPI?: unknown;
}
