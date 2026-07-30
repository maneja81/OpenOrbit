# OpenOrbit

> **Status: idea phase.** There's no code in this repo yet — just the shape of the thing.
> The initial version will land here once it's ready. Dates aren't promised.

A desktop app that runs a team of AI agents on your own machine — a central orchestrator
that delegates to specialist sub-agents, each with its own tools, connected to your files,
apps, and Google account.

## The idea

Instead of one chatbot, you get a roster of agents visualized as nodes orbiting a central
"OpenOrbit" orchestrator. It reads your message and routes it to the right specialist, or
you address one directly with a slash command like `/research`.

The roster isn't fixed. You build new agents by chatting with Orbit itself — describe what
you need, and it creates one with its own skills, tools, and slice of your knowledge base.

What makes it useful is what the agents can actually reach:

- **Your machine** — local files and folders, and launching apps
- **The web** — live search
- **A knowledge base** you build by dropping in PDF/Word/Excel/PowerPoint docs, or by
  crawling a site's sitemap
- **Your Google account** — OAuth connectors for Gmail, Calendar, Drive, and Contacts
- **Anything else** — plug in any MCP server, or wire up your own API tools

Everything stays local. Chat history, memory, and knowledge live in a SQLite database on
your machine, and you bring your own API key.

## Planned stack

TypeScript throughout.

| Layer | Choice |
| --- | --- |
| Shell | Electron 43 |
| Renderer | Vite + React 19 |
| Orchestration | OpenAI Agents SDK |
| Persistence | better-sqlite3 |
| Packaging | electron-builder (macOS / Windows / Linux) |

## Details worth keeping

- The orbit UI isn't decoration — agent nodes show live status (active / standby /
  sleeping / error), and you watch steps stream as an agent works.
- Voice in and out — dictate with a hotkey, and it can speak back.
- Widget cards over an animated starfield: system status, token usage, folders, tasks,
  weekly activity.
- Guided tour on first run (driver.js) that walks through the whole interface.

## How it's being built

Every part of OpenOrbit is being built with [Claude Code](https://claude.com/claude-code) —
from the initial scaffold through to feature work, and the development process around it.

The plan is a repeatable loop rather than ad-hoc prompting: purpose-built skills and
workflows that take a feature from spec to implementation, validate it, raise the PR, run
the review cycle, and merge.

That's partly the point. Building an agent orchestrator *through* an agentic workflow is a
direct way to find out where these tools genuinely hold up and where they don't — and
whatever that turns up should feed back into OpenOrbit's own design.

## Following along

This is a personal side project — built evenings and weekends, around a full-time job.
No support, no roadmap commitments, no guarantees.

If you want to talk about it, [Discussions](https://github.com/maneja81/OpenOrbit/discussions)
is the place. I read everything that gets posted, but replies land when they land — often
a few days.

## License

See [LICENSE](LICENSE).
