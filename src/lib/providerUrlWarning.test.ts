import { describe, expect, it } from "vitest";
import { providerUrlWarning } from "./providerUrlWarning";

const warns = (url: string) => providerUrlWarning(url) !== null;

describe("providerUrlWarning", () => {
  it("says nothing for https", () => {
    expect(providerUrlWarning("https://api.openai.com/v1")).toBeNull();
    expect(providerUrlWarning("https://openrouter.ai/api/v1")).toBeNull();
  });

  it("says nothing when the field is empty or unparseable", () => {
    // Empty means "use the default"; an unparseable value is already refused at the write
    // boundary, so warning here would be noise on top of a rejection.
    expect(providerUrlWarning("")).toBeNull();
    expect(providerUrlWarning("   ")).toBeNull();
    expect(providerUrlWarning("not a url")).toBeNull();
  });

  describe("plain http", () => {
    it("warns when the traffic would leave the machine", () => {
      expect(warns("http://api.example.com/v1")).toBe(true);
      expect(warns("http://93.184.216.34/v1")).toBe(true);
      expect(providerUrlWarning("http://api.example.com/v1")).toMatch(/unencrypted/i);
    });

    it("stays quiet for loopback, which is the self-hosted case the app invites", () => {
      for (const url of [
        "http://localhost:11434/v1",
        "http://127.0.0.1:8080/v1",
        "http://[::1]:8080/v1",
        "http://ollama.localhost/v1",
      ]) {
        expect(warns(url), url).toBe(false);
      }
    });

    it("stays quiet on a private network, where a self-hosted server also lives", () => {
      for (const url of [
        "http://10.0.0.5/v1",
        "http://192.168.1.20:11434/v1",
        "http://172.16.4.9/v1",
        "http://172.31.255.1/v1",
        "http://nas.local:8080/v1",
      ]) {
        expect(warns(url), url).toBe(false);
      }
    });

    it("still warns for addresses that only look private", () => {
      // 172.32 is outside RFC1918, and 11.x is public space that starts like 10.x doesn't.
      expect(warns("http://172.32.0.1/v1")).toBe(true);
      expect(warns("http://11.0.0.1/v1")).toBe(true);
      expect(warns("http://notlocalhost.com/v1")).toBe(true);
    });

    it("is not fooled by case or a trailing dot in the scheme host", () => {
      expect(warns("http://LOCALHOST:11434/v1")).toBe(false);
      expect(warns("HTTP://Api.Example.Com/v1")).toBe(true);
    });
  });
});
