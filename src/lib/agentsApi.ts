/** True once the Electron preload bridge has injected window.agentsAPI. */
export function hasAgentsAPI(): boolean {
  return typeof window !== "undefined" && "agentsAPI" in window && !!window.agentsAPI;
}
