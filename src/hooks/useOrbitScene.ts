import { RefObject, useEffect, useRef, useState } from "react";
import { AgentId, AgentLayoutItem } from "@/lib/agents";

interface Star {
  x: number;
  y: number;
  r: number;
  a: number;
  speed: number;
  drift: number;
}

interface Nebula {
  x: number;
  y: number;
  rx: number;
  ry: number;
  hue: number;
  a: number;
}

interface AgentRuntime {
  id: AgentId;
  angle: number;
  orbitTime: number;
  band: "inner" | "outer";
  /** container top-left position (drives DOM placement of the node) */
  containerX: number;
  containerY: number;
  /** exact hub point the connector line terminates at (circle center) */
  circleX: number;
  circleY: number;
  /** Anchor this agent is easing toward — recomputed whenever the roster or viewport
   * size changes; containerX/Y and circleX/Y above ease toward these each frame rather
   * than jumping straight to them, so surviving agents reflow smoothly instead of
   * snapping when another agent is added/removed (which shifts everyone's ring angle). */
  targetContainerX: number;
  targetContainerY: number;
  targetCircleX: number;
  targetCircleY: number;
}

export interface RingGeometry {
  cx: number;
  cy: number;
  rInner: number;
  rOuter: number;
}

const DRIFT_AMP = 7;
const DRIFT_SPEED = 0.0028;
const AGENT_CIRCLE_R = 22;
const AGENT_NODE_WIDTH = 150;
const AGENT_NODE_HEIGHT = AGENT_CIRCLE_R * 2;
const BAND_GAP = 92;
// Fraction of the remaining distance to the target closed per frame — not a fixed
// duration, but converges to visually "settled" within a few hundred ms at 60fps.
const REFLOW_EASE = 0.12;

interface UseOrbitSceneOptions {
  containerRef: RefObject<HTMLDivElement | null>;
  bgCanvasRef: RefObject<HTMLCanvasElement | null>;
  orchestratorRef: RefObject<HTMLDivElement | null>;
  agentRefs: RefObject<Record<AgentId, HTMLDivElement | null>>;
  activeAgent: AgentId | null;
  agents: AgentLayoutItem[];
  /** Whether the DOM nodes behind the refs above are actually mounted (e.g. false while
   * the onboarding screen is showing instead of the orbit scene). Ref objects never change
   * identity, so without this in the effect's deps, the scene never gets a second chance to
   * initialize once its elements exist — it would only ever see them on the very first run. */
  ready: boolean;
}

export function useOrbitScene({
  containerRef,
  bgCanvasRef,
  orchestratorRef,
  agentRefs,
  activeAgent,
  agents,
  ready,
}: UseOrbitSceneOptions) {
  const activeAgentRef = useRef(activeAgent);
  useEffect(() => {
    activeAgentRef.current = activeAgent;
  }, [activeAgent]);

  const [ringGeometry, setRingGeometry] = useState<RingGeometry>({ cx: 0, cy: 0, rInner: 0, rOuter: 0 });
  const [lineGeometry, setLineGeometry] = useState<Record<AgentId, string>>({});

  // Persistent across `agents` changes — rebuilding this on every add/remove is exactly
  // what used to force the whole scene (stars, loop, resize listener) to tear down and
  // restart, causing a visible background flash and snapping every agent to its new spot.
  const runtimeAgentsRef = useRef<Map<AgentId, AgentRuntime>>(new Map());
  const sizesRef = useRef({ orchestratorHalf: 70, innerRadius: 210, outerRadius: 210 + BAND_GAP });

  function getCenter(container: HTMLDivElement) {
    return { x: container.clientWidth / 2, y: container.clientHeight * 0.41 };
  }

  function updateSizes(container: HTMLDivElement, orchestratorEl: HTMLDivElement) {
    const orchestratorHalf = orchestratorEl.offsetWidth / 2;
    const vmin = Math.min(container.clientWidth, container.clientHeight);
    const gap = Math.max(56, vmin * 0.09);
    const bandGap = Math.max(BAND_GAP, vmin * 0.16);
    const innerRadius = orchestratorHalf + AGENT_CIRCLE_R + gap;
    const outerRadius = innerRadius + bandGap;
    sizesRef.current = { orchestratorHalf, innerRadius, outerRadius };
  }

  /** (Re)computes every tracked agent's target anchor from its angle/band — called on
   * resize and whenever the roster changes. Existing agents keep easing from wherever
   * they currently are; only the target moves. */
  function updateAnchorTargets(container: HTMLDivElement) {
    const c = getCenter(container);
    const { innerRadius, outerRadius } = sizesRef.current;
    runtimeAgentsRef.current.forEach((ag) => {
      const radius = ag.band === "inner" ? innerRadius : outerRadius;
      const circleX = c.x + Math.cos(ag.angle) * radius;
      const circleY = c.y + Math.sin(ag.angle) * radius;
      const onRight = Math.cos(ag.angle) >= 0;
      ag.targetCircleX = circleX;
      ag.targetCircleY = circleY;
      ag.targetContainerX = onRight ? circleX - AGENT_CIRCLE_R : circleX - (AGENT_NODE_WIDTH - AGENT_CIRCLE_R);
      ag.targetContainerY = circleY - AGENT_NODE_HEIGHT / 2;
    });
  }

  function lineDForAgent(circleX: number, circleY: number, c: { x: number; y: number }) {
    const cpx = c.x + (circleX - c.x) * 0.3 + (circleY - c.y) * 0.22;
    const cpy = c.y + (circleY - c.y) * 0.3 - (circleX - c.x) * 0.22;
    return `M ${c.x} ${c.y} Q ${cpx} ${cpy} ${circleX} ${circleY}`;
  }

  // Mount-once scene setup: stars/nebula, resize handling, and the render loop. Does NOT
  // depend on `agents` — the roster is read live off runtimeAgentsRef every frame instead,
  // so adding/removing an agent never restarts this effect or the background.
  useEffect(() => {
    if (!ready) return;
    const container = containerRef.current;
    const bgCanvas = bgCanvasRef.current;
    const orchestratorEl = orchestratorRef.current;
    if (!container || !bgCanvas || !orchestratorEl) return;

    const bx = bgCanvas.getContext("2d");
    if (!bx) return;

    const stars: Star[] = [];
    const nebula: Nebula[] = [];
    const pathEls: Partial<Record<AgentId, SVGPathElement | null>> = {};
    let animationFrame = 0;
    let t = 0;

    function initStars() {
      stars.length = 0;
      nebula.length = 0;
      const w = bgCanvas!.width;
      const h = bgCanvas!.height;
      for (let i = 0; i < 180; i++) {
        stars.push({
          x: Math.random() * w,
          y: Math.random() * h,
          r: Math.random() * 1.3 + 0.15,
          a: Math.random() * 0.8 + 0.1,
          speed: Math.random() * 0.12 + 0.02,
          drift: Math.random() * 0.15 - 0.075,
        });
      }
      for (let i = 0; i < 6; i++) {
        nebula.push({
          x: Math.random() * w,
          y: Math.random() * h * 0.7,
          rx: Math.random() * 120 + 60,
          ry: Math.random() * 60 + 30,
          hue: Math.random() > 0.5 ? 210 : 195,
          a: Math.random() * 0.04 + 0.015,
        });
      }
    }

    function updateSvgGeometry() {
      const c = getCenter(container!);
      const { innerRadius, outerRadius } = sizesRef.current;
      setRingGeometry({ cx: c.x, cy: c.y, rInner: innerRadius, rOuter: outerRadius });
      setLineGeometry(
        Object.fromEntries(
          [...runtimeAgentsRef.current.values()].map((ag) => [
            ag.id,
            lineDForAgent(ag.targetCircleX, ag.targetCircleY, c),
          ])
        ) as Record<AgentId, string>
      );
    }

    function resize() {
      const w = container!.clientWidth;
      const h = container!.clientHeight;
      bgCanvas!.width = w;
      bgCanvas!.height = h;
      initStars();
      updateSizes(container!, orchestratorEl!);
      updateAnchorTargets(container!);
      // A resize recomputes targets, but agents should settle at the new geometry
      // immediately rather than visibly drifting across the screen after every resize.
      runtimeAgentsRef.current.forEach((ag) => {
        ag.containerX = ag.targetContainerX;
        ag.containerY = ag.targetContainerY;
        ag.circleX = ag.targetCircleX;
        ag.circleY = ag.targetCircleY;
      });
      updateSvgGeometry();
    }

    function drawBg() {
      const w = bgCanvas!.width;
      const h = bgCanvas!.height;
      bx!.clearRect(0, 0, w, h);
      nebula.forEach((n) => {
        const g = bx!.createRadialGradient(n.x, n.y, 0, n.x, n.y, n.rx);
        g.addColorStop(0, `hsla(${n.hue},85%,55%,${n.a})`);
        g.addColorStop(1, "rgba(0,0,0,0)");
        bx!.save();
        bx!.scale(1, n.ry / n.rx);
        bx!.fillStyle = g;
        bx!.beginPath();
        bx!.arc(n.x, n.y * (n.rx / n.ry), n.rx, 0, Math.PI * 2);
        bx!.fill();
        bx!.restore();
      });
      stars.forEach((s) => {
        bx!.beginPath();
        bx!.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        bx!.fillStyle = `rgba(180,220,255,${s.a})`;
        bx!.fill();
      });
    }

    function animateAgents() {
      t += DRIFT_SPEED;
      const activeId = activeAgentRef.current;
      const c = getCenter(container!);
      runtimeAgentsRef.current.forEach((ag) => {
        const el = agentRefs.current?.[ag.id];

        // Ease current position toward target (smooth reflow) regardless of whether
        // the node is currently mounted — keeps the math consistent even across a
        // frame where the ref briefly isn't attached yet (e.g. mid-enter-animation).
        ag.containerX += (ag.targetContainerX - ag.containerX) * REFLOW_EASE;
        ag.containerY += (ag.targetContainerY - ag.containerY) * REFLOW_EASE;
        ag.circleX += (ag.targetCircleX - ag.circleX) * REFLOW_EASE;
        ag.circleY += (ag.targetCircleY - ag.circleY) * REFLOW_EASE;

        if (!el) return;
        const driftX = Math.sin(t * 3.1 + ag.orbitTime) * DRIFT_AMP;
        const driftY = Math.cos(t * 2.7 + ag.orbitTime + 0.5) * DRIFT_AMP * 0.8;
        const isActive = activeId === ag.id;
        // Delegation no longer pulls the orb toward the orchestrator — it stays at its
        // resting anchor (plus the constant idle drift wobble) and communicates "active"
        // purely through the CSS state on AgentOrb (size/glow/heartbeat) instead.
        const offsetX = driftX;
        const offsetY = driftY;
        el.style.left = `${ag.containerX + offsetX}px`;
        el.style.top = `${ag.containerY + offsetY}px`;

        // Keep the connector line's endpoint glued to the orb's animated position
        // (not just its resting anchor), otherwise the line visibly detaches from
        // the orb as it slides toward the orchestrator during a handover.
        const pathEl = pathEls[ag.id] ?? (pathEls[ag.id] = container!.querySelector<SVGPathElement>(`#oc-line-${ag.id}`));
        if (pathEl) {
          pathEl.setAttribute("d", lineDForAgent(ag.circleX + offsetX, ag.circleY + offsetY, c));
        }
        if (isActive) {
          const dotEl = document.getElementById("oc-pulse-dot") as SVGCircleElement | null;
          if (dotEl) {
            dotEl.style.offsetPath = `path("${lineDForAgent(ag.circleX + offsetX, ag.circleY + offsetY, c)}")`;
          }
        }
      });
    }

    function animateStars() {
      stars.forEach((s) => {
        s.x -= s.speed;
        s.y += s.drift;
        s.a += Math.random() * 0.06 - 0.03;
        s.a = Math.max(0.05, Math.min(0.95, s.a));
        if (s.x < 0) {
          s.x = bgCanvas!.width;
          s.y = Math.random() * bgCanvas!.height;
        }
      });
      nebula.forEach((n) => {
        n.x -= 0.08;
      });
      drawBg();
    }

    function loop() {
      animateStars();
      animateAgents();
      animationFrame = requestAnimationFrame(loop);
    }

    resize();
    window.addEventListener("resize", resize);
    loop();

    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(animationFrame);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerRef, bgCanvasRef, orchestratorRef, agentRefs, ready]);

  // Roster sync: runs whenever the agent list changes (add/remove/reorder), independent
  // of the mount-once effect above. New agents' current position is initialized directly
  // at their target (they fade/scale in via AnimatePresence at their resting spot, rather
  // than flying in from elsewhere); survivors keep their current position and just get a
  // new target, so animateAgents' per-frame easing carries them smoothly to it.
  useEffect(() => {
    if (!ready) return;
    const container = containerRef.current;
    const orchestratorEl = orchestratorRef.current;
    if (!container || !orchestratorEl) return;

    const map = runtimeAgentsRef.current;
    const nextIds = new Set(agents.map((a) => a.id));
    for (const id of [...map.keys()]) {
      if (!nextIds.has(id)) map.delete(id);
    }

    updateSizes(container, orchestratorEl);
    const c = getCenter(container);
    const { innerRadius, outerRadius } = sizesRef.current;

    agents.forEach((a) => {
      const existing = map.get(a.id);
      if (existing) {
        existing.angle = a.angle;
        existing.orbitTime = a.orbitTime;
        existing.band = a.band;
        return;
      }
      const radius = a.band === "inner" ? innerRadius : outerRadius;
      const circleX = c.x + Math.cos(a.angle) * radius;
      const circleY = c.y + Math.sin(a.angle) * radius;
      const onRight = Math.cos(a.angle) >= 0;
      const containerX = onRight ? circleX - AGENT_CIRCLE_R : circleX - (AGENT_NODE_WIDTH - AGENT_CIRCLE_R);
      const containerY = circleY - AGENT_NODE_HEIGHT / 2;
      map.set(a.id, {
        id: a.id,
        angle: a.angle,
        orbitTime: a.orbitTime,
        band: a.band,
        containerX,
        containerY,
        circleX,
        circleY,
        targetContainerX: containerX,
        targetContainerY: containerY,
        targetCircleX: circleX,
        targetCircleY: circleY,
      });
    });

    updateAnchorTargets(container);

    // Refreshes React-rendered `d` for any brand-new <path> immediately, rather than
    // leaving it without a `d` attribute until the animation loop's next frame patches
    // it in imperatively — that gap is only ~16ms either way, but this avoids relying
    // on it entirely.
    setLineGeometry(
      Object.fromEntries([...map.values()].map((ag) => [ag.id, lineDForAgent(ag.targetCircleX, ag.targetCircleY, c)])) as Record<
        AgentId,
        string
      >
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agents, ready]);

  return { ringGeometry, lineGeometry };
}
