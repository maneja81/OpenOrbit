import TablerIcon from "@/components/atoms/TablerIcon";
import { useFolderBrowse } from "@/hooks/useFolderBrowse";
import { useSharedKnowledgeFiles } from "@/hooks/useKnowledgeFiles";
import { hasAgentsAPI } from "@/lib/agentsApi";

function basename(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}

interface FolderBrowserProps {
  browse: ReturnType<typeof useFolderBrowse>;
}

/** Read-only view of one level inside a granted folder, shown in place of the knowledge list.
 *
 * Files are not click-to-open: fs:openPath launches the OS handler for its target and stays
 * deliberately restricted to the app's own storage directory, so opening happens through Finder
 * (fs:revealInFolder, which only highlights a file and returns nothing) instead.
 *
 * Adding a file offers no "already added" state: knowledgebase:add copies the file into app
 * storage and stores that path, so a row keeps no reference to where it came from and there is
 * nothing here to match against. Re-adding is already handled — the content hash is unique, and
 * the handler turns a repeat into "This file has already been added as …".
 *
 * The browse state is owned by the parent so closing the modal can reset it — see KnowledgeModal. */
export default function FolderBrowser({ browse }: FolderBrowserProps) {
  const { stack, entries, loading, error, open, back } = browse;
  const { addFiles } = useSharedKnowledgeFiles();

  const reveal = (path: string) => {
    if (hasAgentsAPI()) void window.agentsAPI.fs.revealInFolder(path);
  };

  return (
    <div className="kb-browser">
      <div className="kb-browser-bar">
        <button className="widget-icon-btn" aria-label="Back" onClick={back}>
          <TablerIcon name="ti-arrow-left" />
        </button>
        <div className="kb-browser-crumbs" aria-label="Folder path">
          {stack.map((path, i) => (
            <span key={path} className="kb-browser-crumb">
              {i > 0 && <TablerIcon name="ti-chevron-right" className="kb-browser-sep" />}
              <span title={path}>{basename(path)}</span>
            </span>
          ))}
        </div>
      </div>

      {loading && <p className="widget-empty">Reading folder…</p>}
      {!loading && error && <p className="widget-error">{error}</p>}
      {!loading && !error && entries.length === 0 && <p className="widget-empty">This folder is empty.</p>}

      <div className="kb-browser-list">
        {!loading &&
          !error &&
          entries.map((entry) =>
            entry.isDirectory ? (
              <button
                key={entry.path}
                className="kb-browser-row kb-browser-row-dir"
                onClick={() => open(entry.path)}
                title={entry.path}
              >
                <TablerIcon name="ti-folder" />
                <span className="kb-browser-name">{entry.name}</span>
                <TablerIcon name="ti-chevron-right" className="kb-browser-sep" />
              </button>
            ) : (
              <div key={entry.path} className="kb-browser-row" title={entry.path}>
                <TablerIcon name="ti-file-text" />
                <span className="kb-browser-name">{entry.name}</span>
                <button
                  className="widget-icon-btn"
                  aria-label={`Add ${entry.name} to the knowledge base`}
                  onClick={() => void addFiles([entry.path])}
                >
                  <TablerIcon name="ti-file-plus" />
                </button>
                <button
                  className="widget-icon-btn"
                  aria-label={`Reveal ${entry.name} in Finder`}
                  onClick={() => reveal(entry.path)}
                >
                  <TablerIcon name="ti-folder-open" />
                </button>
              </div>
            )
          )}
      </div>
    </div>
  );
}
