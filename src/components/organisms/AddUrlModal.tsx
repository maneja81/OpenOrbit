import { useState } from "react";
import Modal from "@/components/atoms/Modal";
import TablerIcon from "@/components/atoms/TablerIcon";
import { useSharedKnowledgeFiles } from "@/hooks/useKnowledgeFiles";
import { hasAgentsAPI } from "@/lib/agentsApi";
import { formatHumanizedError, humanizeError } from "@/lib/humanizeError";

interface AddUrlModalProps {
  open: boolean;
  onClose: () => void;
}

export default function AddUrlModal({ open, onClose }: AddUrlModalProps) {
  const { addUrls } = useSharedKnowledgeFiles();
  const [url, setUrl] = useState("");
  const [discovering, setDiscovering] = useState(false);
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  const [discovered, setDiscovered] = useState<DiscoveredLinks | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const reset = () => {
    setUrl("");
    setDiscovering(false);
    setDiscoverError(null);
    setDiscovered(null);
    setSelected(new Set());
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleDiscover = async () => {
    if (!hasAgentsAPI() || url.trim().length === 0) return;
    setDiscoverError(null);
    setDiscovering(true);
    try {
      const result = await window.agentsAPI.knowledgebase.discoverLinks(url.trim());
      setDiscovered(result);
      setSelected(new Set([result.seedUrl]));
    } catch (e) {
      setDiscoverError(formatHumanizedError(humanizeError(e)));
    } finally {
      setDiscovering(false);
    }
  };

  const toggle = (linkUrl: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(linkUrl)) next.delete(linkUrl);
      else next.add(linkUrl);
      return next;
    });
  };

  const selectAll = (urls: string[]) => {
    setSelected((prev) => new Set([...prev, ...urls]));
  };

  // Deliberately doesn't await addUrls — the fetch/save runs in the background while the
  // widget's existing loading animation (shared KnowledgeFilesContext state) surfaces
  // progress, and an OS notification announces completion once it's done. Don't "fix"
  // this back to awaiting; that's the blocking-modal behavior this replaced.
  const handleConfirm = () => {
    void addUrls(Array.from(selected));
    handleClose();
  };

  return (
    <Modal open={open} onClose={handleClose} label="Add from URL">
      <div className="km-header">
        <span className="km-title">Add from URL</span>
        <button className="widget-icon-btn" aria-label="Close" onClick={handleClose}>
          <TablerIcon name="ti-x" />
        </button>
      </div>
      <div className="km-body">
        {!discovered ? (
          <>
            <div className="au-field">
              <span>URL</span>
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com/docs"
                autoComplete="off"
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleDiscover();
                }}
              />
            </div>
            <button
              className="au-primary-btn"
              onClick={() => void handleDiscover()}
              disabled={discovering || url.trim().length === 0}
            >
              {discovering && <TablerIcon name="ti-loader-2" className="spin-icon" />}
              {discovering ? "Fetching page…" : "Fetch page"}
            </button>
            {discoverError && <p className="widget-error">{discoverError}</p>}
          </>
        ) : (
          <>
            <div className="au-section">
              <span className="au-section-title">This page</span>
              <label className="au-link-row">
                <input
                  type="checkbox"
                  checked={selected.has(discovered.seedUrl)}
                  onChange={() => toggle(discovered.seedUrl)}
                />
                <span title={discovered.seedUrl}>{discovered.title || discovered.seedUrl}</span>
              </label>
            </div>

            <div className="au-section">
              <div className="au-section-header">
                <span className="au-section-title">Links on this page — same domain</span>
                {discovered.sameDomainLinks.length > 0 && (
                  <button
                    className="kw-show-more"
                    onClick={() => selectAll(discovered.sameDomainLinks.map((l) => l.url))}
                  >
                    Select all
                  </button>
                )}
              </div>
              {discovered.sameDomainLinks.length === 0 && <p className="widget-empty">None found.</p>}
              {discovered.sameDomainLinks.map((link) => (
                <label className="au-link-row" key={link.url}>
                  <input type="checkbox" checked={selected.has(link.url)} onChange={() => toggle(link.url)} />
                  <span title={link.url}>{link.text || link.url}</span>
                </label>
              ))}
            </div>

            <div className="au-section">
              <div className="au-section-header">
                <span className="au-section-title">Other domains</span>
                {discovered.externalLinks.length > 0 && (
                  <button className="kw-show-more" onClick={() => selectAll(discovered.externalLinks.map((l) => l.url))}>
                    Select all
                  </button>
                )}
              </div>
              {discovered.externalLinks.length === 0 && <p className="widget-empty">None found.</p>}
              {discovered.externalLinks.map((link) => (
                <label className="au-link-row" key={link.url}>
                  <input type="checkbox" checked={selected.has(link.url)} onChange={() => toggle(link.url)} />
                  <span title={link.url}>{link.text || link.url}</span>
                </label>
              ))}
            </div>

            <button className="au-primary-btn" onClick={handleConfirm} disabled={selected.size === 0}>
              {`Add ${selected.size} selected`}
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}
