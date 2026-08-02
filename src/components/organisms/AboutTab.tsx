import { useCallback, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import TablerIcon from "@/components/atoms/TablerIcon";
import SettingsAccordion from "@/components/molecules/SettingsAccordion";
import { hasAgentsAPI } from "@/lib/agentsApi";
import { formatHumanizedError, humanizeError } from "@/lib/humanizeError";
import { formatBytes, formatCount, formatPlatformName, formatReleaseDate, formatUptime } from "@/lib/aboutFormat";
import { APP_LICENSE } from "@/lib/appLicense";
import { APP_LINKS, isPlaceholderLink } from "@/lib/appLinks";
import { THIRD_PARTY_NOTICES } from "@/lib/thirdPartyNotices";
import { isUpdateAvailable } from "@/lib/semver";

interface AboutTabProps {
  /** Milliseconds since this session started, from the once-a-minute interval AgentsApp
   * already runs. Passed in rather than timed here: the React Compiler lint this project
   * enforces rejects `Date.now()` and ref reads during render. */
  sessionElapsedMs: number;
}

/** Every value below is empty on a build made offline or before the first release was
 * published, so each consumer hides its row rather than showing a blank. */
const RELEASE = {
  version: __APP_RELEASE_VERSION__,
  date: __APP_RELEASE_DATE__,
  notes: __APP_RELEASE_NOTES__,
  url: __APP_RELEASE_URL__,
  commit: __APP_COMMIT__,
};

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="row">
      <span className="row-label">
        {label}
        {hint && <small>{hint}</small>}
      </span>
      {children}
    </div>
  );
}

export default function AboutTab({ sessionElapsedMs }: AboutTabProps) {
  const bridgeReady = hasAgentsAPI();
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [storage, setStorage] = useState<AppStorageInfo | null>(null);
  const [stats, setStats] = useState<AppStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openLicense, setOpenLicense] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!hasAgentsAPI()) return;
    let cancelled = false;
    Promise.all([
      window.agentsAPI.appInfo.get(),
      window.agentsAPI.appInfo.storage(),
      window.agentsAPI.appInfo.stats(),
    ])
      .then(([nextInfo, nextStorage, nextStats]) => {
        if (cancelled) return;
        setInfo(nextInfo);
        setStorage(nextStorage);
        setStats(nextStats);
      })
      .catch((e) => {
        if (!cancelled) setError(formatHumanizedError(humanizeError(e)));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const reveal = useCallback((target: string) => {
    void window.agentsAPI.fs.revealInFolder(target);
  }, []);

  const openLink = useCallback((url: string) => {
    // Unlike the rows above, the More section renders with or without the bridge, so this
    // is the one caller here that has to check for itself — under `dev:web` there is no
    // window.agentsAPI at all.
    if (!hasAgentsAPI()) return;
    // fs:openExternal throws on any non-http(s) URL, so an unconfigured link must never
    // reach it — those render disabled, and this is the second line of defence.
    if (isPlaceholderLink(url)) return;
    void window.agentsAPI.fs.openExternal(url);
  }, []);

  const clearCache = useCallback(async () => {
    setClearing(true);
    try {
      const remaining = await window.agentsAPI.appInfo.clearCache();
      setStorage((prev) => (prev ? { ...prev, cacheBytes: remaining } : prev));
    } catch (e) {
      setError(formatHumanizedError(humanizeError(e)));
    } finally {
      setClearing(false);
    }
  }, []);

  const copyDiagnostics = useCallback(async () => {
    if (!info) return;
    const lines = [
      `${info.name} ${info.packageVersion}${RELEASE.commit ? ` (build ${RELEASE.commit})` : ""}`,
      `Electron ${info.electronVersion} / Node ${info.nodeVersion} / Chrome ${info.chromeVersion}`,
      `${formatPlatformName(info.platform)} ${info.osVersion} (${info.arch}) — kernel ${info.osRelease}`,
    ];
    if (storage) {
      lines.push(
        `Knowledge base: ${storage.knowledgeFileCount} files, ${formatBytes(storage.knowledgeBytes)} · ` +
          `Database: ${formatBytes(storage.databaseBytes)} · Cache: ${formatBytes(storage.cacheBytes)}`
      );
    }
    if (stats) lines.push(`Messages: ${formatCount(stats.messageCount)}`);

    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopied(true);
    } catch (e) {
      setError(formatHumanizedError(humanizeError(e)));
    }
  }, [info, storage, stats]);

  // Resets the "Copied" label two seconds after a successful copy. An effect rather than a
  // setTimeout in the callback above so closing the settings panel inside that window
  // cancels the timer instead of leaving it to fire against an unmounted component.
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const toggleLicense = useCallback((key: string) => {
    setOpenLicense((prev) => (prev === key ? null : key));
  }, []);

  const releaseDate = formatReleaseDate(RELEASE.date);
  const updateAvailable = info ? isUpdateAvailable(RELEASE.version, info.packageVersion) : false;
  const pending = bridgeReady && !info && !error;

  return (
    <section className="settings-section">
      {error && <p className="settings-error">{error}</p>}
      {!bridgeReady && (
        <p className="settings-hint">Build and storage details are only available in the desktop app.</p>
      )}

      <div className="agent-accordion-list">
        {/* Open by default: the version is the single most-wanted fact on this screen, so it
            shouldn't need a click. Every other section starts collapsed. */}
        <SettingsAccordion icon="ti-info-circle" title="Identity & Build" defaultOpen>
          <div className="group">
            <div className="card" id="settings-app-identity">
              <Row label="App">
                <span className="about-value">{info?.name ?? (pending ? "…" : "OpenOrbit")}</span>
              </Row>
              <Row label="Version" hint="This build">
                <span className="about-value">{info?.packageVersion ?? "…"}</span>
              </Row>
              {RELEASE.version !== "0.0.0" && (
                <Row label="Latest release">
                  <span className="about-value">
                    {RELEASE.version}
                    {releaseDate && <small> · {releaseDate}</small>}
                    {updateAvailable && <span className="about-badge">Update available</span>}
                  </span>
                </Row>
              )}
              {RELEASE.commit && (
                <Row label="Build">
                  <span className="about-value about-value-mono">{RELEASE.commit}</span>
                </Row>
              )}
              {info && (
                <>
                  <Row label="Runtime">
                    <span className="about-value">
                      Electron {info.electronVersion} · Node {info.nodeVersion} · Chrome {info.chromeVersion}
                    </span>
                  </Row>
                  <Row label="Platform" hint={`kernel ${info.osRelease}`}>
                    <span className="about-value">
                      {formatPlatformName(info.platform)} {info.osVersion} ({info.arch})
                    </span>
                  </Row>
                  <Row label="Data folder">
                    <button className="settings-action-btn-sm" onClick={() => reveal(info.dataPath)}>
                      <TablerIcon name="ti-folder" />
                      <span>Reveal</span>
                    </button>
                  </Row>
                </>
              )}
            </div>
          </div>
        </SettingsAccordion>

        {info && storage && (
          <SettingsAccordion icon="ti-database" title="Storage & System">
            <div className="group">
              <div className="card" id="settings-app-storage">
                <Row label="Knowledge base">
                  <span className="about-value">
                    {storage.knowledgeFileCount} {storage.knowledgeFileCount === 1 ? "file" : "files"} ·{" "}
                    {formatBytes(storage.knowledgeBytes)}
                  </span>
                </Row>
                <Row label="Database" hint={formatBytes(storage.databaseBytes)}>
                  <button className="settings-action-btn-sm" onClick={() => reveal(info.databasePath)}>
                    <TablerIcon name="ti-folder" />
                    <span>Reveal</span>
                  </button>
                </Row>
                <Row label="Cache" hint={formatBytes(storage.cacheBytes)}>
                  <button className="settings-action-btn-sm" onClick={clearCache} disabled={clearing}>
                    <TablerIcon name="ti-trash" />
                    <span>{clearing ? "Clearing…" : "Clear"}</span>
                  </button>
                </Row>
                <Row label="Messages" hint="Stored across all sessions">
                  <span className="about-value">{stats ? formatCount(stats.messageCount) : "…"}</span>
                </Row>
                <Row label="Session uptime">
                  <span className="about-value">{formatUptime(sessionElapsedMs)}</span>
                </Row>
              </div>
            </div>
          </SettingsAccordion>
        )}

        {RELEASE.notes && (
          <SettingsAccordion
            icon="ti-sparkles"
            title={`What's new in ${RELEASE.version}`}
            headerActions={
              RELEASE.url ? (
                <button className="settings-action-btn-sm" onClick={() => openLink(RELEASE.url)}>
                  <span>View on GitHub</span>
                  <TablerIcon name="ti-external-link" />
                </button>
              ) : undefined
            }
          >
            <div className="about-notes">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{RELEASE.notes}</ReactMarkdown>
            </div>
          </SettingsAccordion>
        )}

        <SettingsAccordion icon="ti-license" title="Legal & Attribution">
          <div className="group">
            <div className="card" id="settings-app-legal">
              <Row label="License" hint={APP_LICENSE.copyright}>
                <button className="settings-action-btn-sm" onClick={() => toggleLicense("app")}>
                  <span>{openLicense === "app" ? "Hide" : APP_LICENSE.spdx}</span>
                </button>
              </Row>
              {openLicense === "app" && (
                <div className="row">
                  <pre className="about-license-text">{APP_LICENSE.text}</pre>
                </div>
              )}
            </div>

            <div className="card">
              {THIRD_PARTY_NOTICES.map((notice) => (
                <div key={notice.name}>
                  <Row
                    label={`${notice.name}${notice.version === "—" ? "" : ` ${notice.version}`}`}
                    hint={`${notice.license} · ${notice.copyright} · ${notice.path}`}
                  >
                    <button className="settings-action-btn-sm" onClick={() => toggleLicense(notice.name)}>
                      <span>{openLicense === notice.name ? "Hide" : "License"}</span>
                    </button>
                  </Row>
                  {openLicense === notice.name && (
                    <div className="row">
                      <pre className="about-license-text">{notice.licenseText}</pre>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </SettingsAccordion>

        <SettingsAccordion icon="ti-external-link" title="More">
          <div className="group">
            <div className="card" id="settings-app-links">
              <Row label="Documentation">
                <button className="settings-action-btn-sm" onClick={() => openLink(APP_LINKS.docs)}>
                  <span>Open</span>
                  <TablerIcon name="ti-external-link" />
                </button>
              </Row>
              <Row label="Report a bug">
                <button className="settings-action-btn-sm" onClick={() => openLink(APP_LINKS.bug)}>
                  <span>Open</span>
                  <TablerIcon name="ti-external-link" />
                </button>
              </Row>
              <Row
                label="Privacy policy"
                hint={isPlaceholderLink(APP_LINKS.privacy) ? "Not published yet" : undefined}
              >
                <button
                  className="settings-action-btn-sm"
                  onClick={() => openLink(APP_LINKS.privacy)}
                  disabled={isPlaceholderLink(APP_LINKS.privacy)}
                >
                  <span>Open</span>
                </button>
              </Row>
              <Row label="Terms" hint={isPlaceholderLink(APP_LINKS.terms) ? "Not published yet" : undefined}>
                <button
                  className="settings-action-btn-sm"
                  onClick={() => openLink(APP_LINKS.terms)}
                  disabled={isPlaceholderLink(APP_LINKS.terms)}
                >
                  <span>Open</span>
                </button>
              </Row>
              <Row label="Diagnostics" hint="Version and system details, for a bug report">
                <button className="settings-action-btn-sm" onClick={copyDiagnostics} disabled={!info}>
                  <TablerIcon name="ti-clipboard" />
                  <span>{copied ? "Copied" : "Copy"}</span>
                </button>
              </Row>
            </div>
          </div>
        </SettingsAccordion>
      </div>
    </section>
  );
}
