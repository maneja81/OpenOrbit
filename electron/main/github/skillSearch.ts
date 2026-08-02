/**
 * Unauthenticated GitHub skill discovery — no `gh` CLI, no GitHub token.
 *
 * GitHub's `/search/code` endpoint requires authentication unconditionally (verified:
 * a bare unauthenticated request returns 401 "Requires authentication"), so finding a
 * `SKILL.md` by filename across all of GitHub isn't possible without a token. Instead
 * this searches repositories by keyword (works unauthenticated) and then tree-scans
 * each candidate for an actual `SKILL.md` file.
 *
 * Also verified: sorting `/search/repositories` by `stars` actively hurts relevance —
 * it surfaces huge unrelated mega-repos that merely mention the query terms somewhere,
 * drowning out small purpose-built skill repos. Default relevance ranking with a
 * quoted phrase query works much better, so `sort` is deliberately never set here.
 *
 * File content is downloaded via raw.githubusercontent.com rather than the
 * `/repos/.../contents/...` API — verified this is not subject to the 60/hr core
 * rate limit at all (CDN-served, no `x-ratelimit-*` headers), so only the search and
 * tree-scan steps below consume the shared quota.
 */

const GITHUB_API = "https://api.github.com";
const ACCEPT_HEADER = "application/vnd.github+json";

// Bounds how many repo-search hits get tree-scanned per find_skill call, to keep the
// unauthenticated 60/hr core rate limit from being exhausted by a single search.
const MAX_CANDIDATES_SCANNED = 8;

const RISKY_PATH_TERMS = ["malware", "exploit", "ransomware", "virus", "payload", "backdoor"];

export interface RepoHit {
  owner: string;
  repo: string;
  stars: number;
  description: string;
  defaultBranch: string;
  htmlUrl: string;
}

export interface SkillMatch {
  owner: string;
  repo: string;
  path: string;
  htmlUrl: string;
  stars: number;
  description: string;
  rawMarkdown: string;
}

interface GithubRepoSearchItem {
  name: string;
  owner?: { login?: string };
  stargazers_count?: number;
  description?: string | null;
  default_branch?: string;
  html_url: string;
}

async function githubFetch(url: string): Promise<Response> {
  const res = await fetch(url, { headers: { Accept: ACCEPT_HEADER } });
  if (!res.ok) {
    const reset = res.headers.get("x-ratelimit-reset");
    const resetNote = reset ? ` GitHub's rate limit resets at ${new Date(Number(reset) * 1000).toLocaleTimeString()}.` : "";
    const detail = await res.text().catch(() => "");
    throw new Error(`GitHub request failed (${res.status}): ${detail || res.statusText}.${resetNote}`);
  }
  return res;
}

/** Pure heuristic, not a security guarantee — flags paths whose name suggests
 * malicious/offensive content (e.g. a malware-skill benchmark dataset) so callers can
 * skip them, same judgment call made manually when a MalSkillBench hit was found. */
export function looksRisky(path: string): boolean {
  const lower = path.toLowerCase();
  return RISKY_PATH_TERMS.some((term) => lower.includes(term));
}

/** `quoted: true` (the default, and the only mode covered by the existing "beats
 * sort-by-stars" verification) requires the exact phrase to appear verbatim, which
 * only works for genuinely short queries — a compound multi-concept query (e.g. one
 * joining several related-but-distinct terms) can fail to match anything even when
 * relevant repos exist, since no repo is likely to contain that exact long phrase.
 * `quoted: false` ANDs the individual terms instead (all must appear, any order/position)
 * — used by findTopSkillMatches as a fallback, not the default, since the quoted-phrase
 * mode is deliberately more precise when it does match. */
export async function searchRepos(query: string, quoted = true): Promise<RepoHit[]> {
  const q = encodeURIComponent(quoted ? `"${query} skill"` : `${query} skill`);
  const res = await githubFetch(`${GITHUB_API}/search/repositories?q=${q}&per_page=${MAX_CANDIDATES_SCANNED}`);
  const data = (await res.json()) as { items?: GithubRepoSearchItem[] };
  return (data.items ?? []).map((item) => ({
    owner: item.owner?.login ?? "",
    repo: item.name,
    stars: item.stargazers_count ?? 0,
    description: item.description ?? "",
    defaultBranch: item.default_branch ?? "main",
    htmlUrl: item.html_url,
  }));
}

export async function findSkillFilesInRepo(owner: string, repo: string, branch: string): Promise<string[]> {
  const res = await githubFetch(`${GITHUB_API}/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`);
  const data = (await res.json()) as { tree?: { path: string; type: string }[] };
  return (data.tree ?? []).filter((entry) => /skill\.md$/i.test(entry.path)).map((entry) => entry.path);
}

export async function fetchRawFile(owner: string, repo: string, branch: string, path: string): Promise<string> {
  const res = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`);
  if (!res.ok) {
    throw new Error(`Failed to download ${owner}/${repo}/${path} (${res.status}: ${res.statusText}).`);
  }
  return res.text();
}

/** Scans relevance-ranked repo-search candidates in order, tree-scanning each for a
 * real (non-risky) SKILL.md, until `limit` valid matches are collected or candidates
 * run out. This is a "first N valid candidates" search, not an exhaustive
 * best-of-all-candidates ranking — a deliberate tradeoff to bound the number of
 * tree-scan requests spent against the shared 60/hr rate limit. */
export async function findTopSkillMatches(query: string, limit = 3): Promise<SkillMatch[]> {
  let candidates = await searchRepos(query);
  // A long/compound query (several concepts joined together) can fail the exact-phrase
  // search even when relevant repos exist, since no repo is likely to contain that whole
  // phrase verbatim — retry once with the individual terms ANDed instead of matched as
  // one literal phrase, before concluding nothing exists for this domain.
  if (candidates.length === 0) {
    candidates = await searchRepos(query, false);
  }
  // Even ANDing every word can still fail: a query like "astrology personal horoscopes"
  // requires "personal" and "horoscopes" to also appear in a repo's name/description,
  // but real skill repos are usually named/described around just the core domain noun
  // ("astrology") — verified live: "astrology personal horoscopes skill" matches nothing,
  // "astrology skill" alone matches 77 repos. Falling back to the query's first word
  // catches this without needing the model to always phrase things perfectly.
  const firstWord = query.trim().split(/\s+/)[0];
  if (candidates.length === 0 && firstWord && firstWord !== query.trim()) {
    candidates = await searchRepos(firstWord, false);
  }
  const matches: SkillMatch[] = [];

  for (const candidate of candidates) {
    if (matches.length >= limit) break;

    let paths: string[];
    try {
      paths = await findSkillFilesInRepo(candidate.owner, candidate.repo, candidate.defaultBranch);
    } catch {
      continue;
    }

    const validPath = paths.find((path) => !looksRisky(path));
    if (!validPath) continue;

    let rawMarkdown: string;
    try {
      rawMarkdown = await fetchRawFile(candidate.owner, candidate.repo, candidate.defaultBranch, validPath);
    } catch {
      continue;
    }

    matches.push({
      owner: candidate.owner,
      repo: candidate.repo,
      path: validPath,
      htmlUrl: `https://github.com/${candidate.owner}/${candidate.repo}/blob/${candidate.defaultBranch}/${validPath}`,
      stars: candidate.stars,
      description: candidate.description,
      rawMarkdown,
    });
  }

  return matches;
}
