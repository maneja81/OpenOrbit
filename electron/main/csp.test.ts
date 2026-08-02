import { describe, expect, it } from "vitest";
import { contentSecurityPolicy } from "./csp";

function directives(policy: string): Record<string, string> {
  return Object.fromEntries(
    policy.split("; ").map((d) => {
      const [name, ...rest] = d.split(" ");
      return [name, rest.join(" ")];
    })
  );
}

describe("contentSecurityPolicy", () => {
  const prod = directives(contentSecurityPolicy(false));
  const dev = directives(contentSecurityPolicy(true));

  it("denies everything not explicitly allowed", () => {
    expect(prod["default-src"]).toBe("'none'");
  });

  it("gives the renderer no network reach of its own", () => {
    // Every API call, tool run and connector lives in the main process and arrives over IPC.
    // Nothing in src/ calls fetch or opens a socket, so this costs nothing and removes the
    // most useful primitive an injected script would have.
    expect(prod["connect-src"]).toBe("'none'");
  });

  it("allows no inline or eval'd script in production", () => {
    expect(prod["script-src"]).toBe("'self'");
  });

  it("closes the embedding and form-post escape hatches", () => {
    expect(prod["object-src"]).toBe("'none'");
    expect(prod["frame-src"]).toBe("'none'");
    expect(prod["base-uri"]).toBe("'none'");
    expect(prod["form-action"]).toBe("'none'");
  });

  it("permits remote images, because consent is what gates them", () => {
    // A CSP cannot distinguish a chart from a tracking pixel. ChatImage refusing to emit an
    // <img> until the user clicks is the control; this directive just has to not forbid the
    // legitimate case. See ChatImage.test.tsx for the guarantee itself.
    expect(prod["img-src"]).toBe("'self' data: https:");
  });

  it("keeps local fonts, the background video, and synthesized TTS audio loadable", () => {
    // TTS audio is played as `new Audio('data:audio/mp3;base64,...')` — the bytes come from
    // the Voice API over IPC, so media-src needs data: alongside the bundled video's 'self'.
    expect(prod["font-src"]).toBe("'self'");
    expect(prod["media-src"]).toBe("'self' data:");
  });

  it("allows the inline styles React writes for computed values", () => {
    expect(prod["style-src"]).toBe("'self' 'unsafe-inline'");
  });

  it("relaxes only script-src and connect-src in dev", () => {
    // Vite injects an inline React-Refresh preamble, evals for HMR, and opens a websocket.
    // Everything else must match production, or dev stops catching real violations.
    const relaxed = Object.keys(prod).filter((k) => prod[k] !== dev[k]);
    expect(relaxed.sort()).toEqual(["connect-src", "script-src"]);
  });

  it("never ships the dev relaxations to production", () => {
    const policy = contentSecurityPolicy(false);
    expect(policy).not.toContain("unsafe-eval");
    expect(policy).not.toContain("ws:");
    expect(policy).not.toContain("localhost");
    // 'unsafe-inline' is still present for style-src, and only there.
    expect(policy.match(/'unsafe-inline'/g)).toHaveLength(1);
  });
});
