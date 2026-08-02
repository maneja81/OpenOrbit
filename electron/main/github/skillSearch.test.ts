import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchRawFile, findSkillFilesInRepo, findTopSkillMatches, looksRisky, searchRepos } from "./skillSearch";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("looksRisky", () => {
  it("flags paths containing malware/exploit-style terms", () => {
    expect(looksRisky("Dataset/Skills/malware/project-astrology-tarot-divination/SKILL.md")).toBe(true);
    expect(looksRisky("skills/exploit-dev/SKILL.md")).toBe(true);
  });

  it("does not flag ordinary skill paths", () => {
    expect(looksRisky("skills/vedic-astrology/SKILL.md")).toBe(false);
    expect(looksRisky("SKILL.md")).toBe(false);
  });
});

describe("searchRepos", () => {
  it("never sorts by stars (verified this hurts relevance) and requests a quoted-phrase query", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers(),
      json: async () => ({ items: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await searchRepos("budget management");

    const requestedUrl = fetchMock.mock.calls[0][0] as string;
    expect(requestedUrl).not.toContain("sort=");
    expect(decodeURIComponent(requestedUrl)).toContain('"budget management skill"');
  });

  it("maps search hits into RepoHit shape", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers(),
        json: async () => ({
          items: [
            {
              name: "openclaw-budget-skill",
              owner: { login: "benminer" },
              stargazers_count: 5,
              description: "Budget tracking skill",
              default_branch: "main",
              html_url: "https://github.com/benminer/openclaw-budget-skill",
            },
          ],
        }),
      })
    );

    const results = await searchRepos("budget");
    expect(results).toEqual([
      {
        owner: "benminer",
        repo: "openclaw-budget-skill",
        stars: 5,
        description: "Budget tracking skill",
        defaultBranch: "main",
        htmlUrl: "https://github.com/benminer/openclaw-budget-skill",
      },
    ]);
  });

  it("throws a descriptive error on a non-OK response (e.g. rate limited)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        statusText: "Forbidden",
        headers: new Headers(),
        text: async () => "rate limit exceeded",
      })
    );

    await expect(searchRepos("budget")).rejects.toThrow(/GitHub request failed \(403\)/);
  });
});

describe("findSkillFilesInRepo", () => {
  it("filters the recursive tree for SKILL.md paths, case-insensitively", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers(),
        json: async () => ({
          tree: [
            { path: "README.md", type: "blob" },
            { path: "SKILL.md", type: "blob" },
            { path: "skills/nested/skill.md", type: "blob" },
            { path: "src/index.ts", type: "blob" },
          ],
        }),
      })
    );

    const paths = await findSkillFilesInRepo("owner", "repo", "main");
    expect(paths).toEqual(["SKILL.md", "skills/nested/skill.md"]);
  });
});

describe("fetchRawFile", () => {
  it("downloads via raw.githubusercontent.com rather than the contents API", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => "---\nname: test\n---\nBody" });
    vi.stubGlobal("fetch", fetchMock);

    const content = await fetchRawFile("owner", "repo", "main", "SKILL.md");

    expect(fetchMock.mock.calls[0][0]).toBe("https://raw.githubusercontent.com/owner/repo/main/SKILL.md");
    expect(content).toBe("---\nname: test\n---\nBody");
  });
});

describe("findTopSkillMatches", () => {
  function mockSequence(responses: unknown[]) {
    const fetchMock = vi.fn();
    for (const response of responses) fetchMock.mockResolvedValueOnce(response);
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("stops at `limit` valid matches rather than scanning every candidate", async () => {
    const searchResponse = {
      ok: true,
      headers: new Headers(),
      json: async () => ({
        items: [1, 2, 3, 4].map((n) => ({
          name: `repo${n}`,
          owner: { login: "owner" },
          stargazers_count: 10 - n,
          description: "",
          default_branch: "main",
          html_url: `https://github.com/owner/repo${n}`,
        })),
      }),
    };
    const treeResponse = {
      ok: true,
      headers: new Headers(),
      json: async () => ({ tree: [{ path: "SKILL.md", type: "blob" }] }),
    };
    const rawResponse = { ok: true, text: async () => "raw content" };

    // 1 search call, then (tree, raw) per candidate until `limit` matches collected.
    mockSequence([searchResponse, treeResponse, rawResponse, treeResponse, rawResponse]);

    const matches = await findTopSkillMatches("budget", 2);
    expect(matches).toHaveLength(2);
    expect(matches[0].rawMarkdown).toBe("raw content");
  });

  it("skips risky matches and candidates with no SKILL.md, without throwing", async () => {
    const searchResponse = {
      ok: true,
      headers: new Headers(),
      json: async () => ({
        items: [
          { name: "malicious", owner: { login: "a" }, stargazers_count: 1, description: "", default_branch: "main", html_url: "" },
          { name: "no-skill", owner: { login: "b" }, stargazers_count: 1, description: "", default_branch: "main", html_url: "" },
          { name: "good", owner: { login: "c" }, stargazers_count: 1, description: "", default_branch: "main", html_url: "" },
        ],
      }),
    };
    const riskyTree = { ok: true, headers: new Headers(), json: async () => ({ tree: [{ path: "malware/SKILL.md", type: "blob" }] }) };
    const emptyTree = { ok: true, headers: new Headers(), json: async () => ({ tree: [{ path: "README.md", type: "blob" }] }) };
    const goodTree = { ok: true, headers: new Headers(), json: async () => ({ tree: [{ path: "SKILL.md", type: "blob" }] }) };
    const rawResponse = { ok: true, text: async () => "good content" };

    mockSequence([searchResponse, riskyTree, emptyTree, goodTree, rawResponse]);

    const matches = await findTopSkillMatches("budget", 3);
    expect(matches).toHaveLength(1);
    expect(matches[0].repo).toBe("good");
  });

  it("returns an empty array when nothing matches, even after the unquoted-fallback retry", async () => {
    const emptySearch = { ok: true, headers: new Headers(), json: async () => ({ items: [] }) };
    const fetchMock = mockSequence([emptySearch, emptySearch]);
    const matches = await findTopSkillMatches("nonexistent-domain-xyz");
    expect(matches).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries with an unquoted (AND-terms) search when the quoted-phrase search matches nothing", async () => {
    const emptySearch = { ok: true, headers: new Headers(), json: async () => ({ items: [] }) };
    const fallbackSearch = {
      ok: true,
      headers: new Headers(),
      json: async () => ({
        items: [
          {
            name: "astro-skill",
            owner: { login: "someone" },
            stargazers_count: 3,
            description: "",
            default_branch: "main",
            html_url: "https://github.com/someone/astro-skill",
          },
        ],
      }),
    };
    const treeResponse = { ok: true, headers: new Headers(), json: async () => ({ tree: [{ path: "SKILL.md", type: "blob" }] }) };
    const rawResponse = { ok: true, text: async () => "astrology content" };

    const fetchMock = mockSequence([emptySearch, fallbackSearch, treeResponse, rawResponse]);

    const matches = await findTopSkillMatches("astrology personal horoscopes birth charts");

    expect(matches).toHaveLength(1);
    expect(matches[0].repo).toBe("astro-skill");
    // First call quoted, second (fallback) call unquoted — same terms, no literal quotes.
    const firstUrl = decodeURIComponent(fetchMock.mock.calls[0][0] as string);
    const secondUrl = decodeURIComponent(fetchMock.mock.calls[1][0] as string);
    expect(firstUrl).toContain('"astrology personal horoscopes birth charts skill"');
    expect(secondUrl).not.toContain('"');
  });

  it("falls back to just the query's first word when even the AND-of-all-terms search matches nothing", async () => {
    // Verified live against GitHub's real API: "astrology personal horoscopes skill"
    // (quoted or unquoted) matches 0 repos, but "astrology skill" alone matches 77 —
    // real skill repos are named/described around the core domain noun, not every
    // qualifier word a caller might add alongside it.
    const emptySearch = { ok: true, headers: new Headers(), json: async () => ({ items: [] }) };
    const firstWordSearch = {
      ok: true,
      headers: new Headers(),
      json: async () => ({
        items: [
          {
            name: "astro-skill",
            owner: { login: "someone" },
            stargazers_count: 3,
            description: "",
            default_branch: "main",
            html_url: "https://github.com/someone/astro-skill",
          },
        ],
      }),
    };
    const treeResponse = { ok: true, headers: new Headers(), json: async () => ({ tree: [{ path: "SKILL.md", type: "blob" }] }) };
    const rawResponse = { ok: true, text: async () => "astrology content" };

    const fetchMock = mockSequence([emptySearch, emptySearch, firstWordSearch, treeResponse, rawResponse]);

    const matches = await findTopSkillMatches("astrology personal horoscopes");

    expect(matches).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(5);
    const thirdUrl = decodeURIComponent(fetchMock.mock.calls[2][0] as string);
    expect(thirdUrl).toContain("astrology skill");
    expect(thirdUrl).not.toContain("personal");
  });
});
