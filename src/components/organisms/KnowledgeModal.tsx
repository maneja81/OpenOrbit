import { useMemo, useState } from "react";
import Modal from "@/components/atoms/Modal";
import TablerIcon from "@/components/atoms/TablerIcon";
import Combobox from "@/components/atoms/Combobox";
import FolderBrowser from "@/components/molecules/FolderBrowser";
import { useSharedKnowledgeFiles } from "@/hooks/useKnowledgeFiles";
import { useFolderBrowse } from "@/hooks/useFolderBrowse";
import { deriveCategoryTabs } from "@/lib/knowledgeCategories";
import { entryIcon } from "@/lib/knowledgeEntryIcon";
import { hasAgentsAPI } from "@/lib/agentsApi";
import AddSourceMenu, { AddSourceId } from "@/components/molecules/AddSourceMenu";
import AddUrlModal from "@/components/organisms/AddUrlModal";

interface KnowledgeModalProps {
  open: boolean;
  onClose: () => void;
}

export default function KnowledgeModal({ open, onClose }: KnowledgeModalProps) {
  const { files, error, pendingIds, removeFile, updateCategory, syncOne, openFile, addFolder, pickAndAdd } =
    useSharedKnowledgeFiles();
  const [activeTab, setActiveTab] = useState("All");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [addUrlModalOpen, setAddUrlModalOpen] = useState(false);
  const browse = useFolderBrowse();

  const tabs = useMemo(() => deriveCategoryTabs(files), [files]);
  // Falls back to "All" during render (rather than storing it) whenever the stored
  // activeTab's category has disappeared — e.g. its last file was recategorized or
  // removed — so the tab bar never gets stuck showing an unreachable empty category.
  const effectiveActiveTab = tabs.includes(activeTab) ? activeTab : "All";
  const visible = effectiveActiveTab === "All" ? files : files.filter((f) => f.category === effectiveActiveTab);

  const toggleSelected = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // `bulkBusy` rather than reading pendingIds: the loops below are sequential, so only one id
  // is ever in flight and pendingIds would let the toolbar re-arm between rows.
  const [bulkBusy, setBulkBusy] = useState(false);

  const bulkRemove = async () => {
    setBulkBusy(true);
    try {
      for (const id of selected) await removeFile(id);
      setSelected(new Set());
    } finally {
      setBulkBusy(false);
    }
  };

  // Folder rows are skipped rather than passed through: syncing one is already a no-op in the
  // main process, but sending them would make the button look like it did something.
  const bulkSync = async () => {
    setBulkBusy(true);
    try {
      const syncable = files.filter((f) => selected.has(f.id) && f.kind !== "folder");
      for (const file of syncable) await syncOne(file.id);
    } finally {
      setBulkBusy(false);
    }
  };

  const reveal = (path: string) => {
    if (hasAgentsAPI()) void window.agentsAPI.fs.revealInFolder(path);
  };

  const addSource = (id: AddSourceId) => {
    if (id === "file") void pickAndAdd();
    else if (id === "folder") void addFolder();
    else setAddUrlModalOpen(true);
  };

  // Browsing is a mode of this modal, not a separate one — leaving it open across a close/reopen
  // would drop the user back into a folder they'd navigated away from.
  const handleClose = () => {
    browse.reset();
    onClose();
  };

  return (
    <Modal open={open} onClose={handleClose} label="Knowledge">
      <div className="km-header">
        <span className="km-title">Knowledge</span>
        <div className="widget-header-actions">
          {/* The same three sources the widget's "+" offers — the expanded view used to be the
              only surface that could add a URL and nothing else. */}
          {!browse.currentPath && <AddSourceMenu onSelect={addSource} />}
          <button className="widget-icon-btn" aria-label="Close" onClick={handleClose}>
            <TablerIcon name="ti-x" />
          </button>
        </div>
      </div>
      <div className="km-body">
        {browse.currentPath ? (
          <FolderBrowser browse={browse} />
        ) : (
          <>
            {/* "All" alone is not a filter — deriveCategoryTabs always returns it, so a lone tab
                means there is nothing to switch between. */}
            {tabs.length > 1 && (
              <div className="km-tabs">
                {tabs.map((tab) => (
                  <button
                    key={tab}
                    className={`km-tab${tab === effectiveActiveTab ? " active" : ""}`}
                    onClick={() => setActiveTab(tab)}
                  >
                    {tab}
                  </button>
                ))}
              </div>
            )}
            {selected.size > 0 && (
              <div className="km-bulk-toolbar">
                <span>{selected.size} selected</span>
                <button className="widget-icon-btn" aria-label="Bulk re-sync" disabled={bulkBusy} onClick={bulkSync}>
                  <TablerIcon name="ti-refresh" />
                </button>
                <button className="widget-icon-btn" aria-label="Bulk remove" disabled={bulkBusy} onClick={bulkRemove}>
                  <TablerIcon name="ti-trash" />
                </button>
              </div>
            )}
            <div className="km-list">
              {visible.length === 0 && (
                <p className="widget-empty">
                  {files.length === 0
                    ? "Nothing added yet. Drop files onto the Knowledge widget, or add a web page from here."
                    : "No files in this category."}
                </p>
              )}
              {visible.map((file) => {
                const isFolder = file.kind === "folder";
                return (
                  <div className="km-row" key={file.id}>
                    <input
                      type="checkbox"
                      checked={selected.has(file.id)}
                      onChange={() => toggleSelected(file.id)}
                      aria-label={`Select ${file.originalName}`}
                    />
                    <TablerIcon name={entryIcon(file.kind)} />
                    <span
                      className="km-name km-name-clickable"
                      title={isFolder ? file.path : file.originalName}
                      role="button"
                      tabIndex={0}
                      onClick={() => (isFolder ? browse.open(file.path) : void openFile(file.path))}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          if (isFolder) browse.open(file.path);
                          else void openFile(file.path);
                        }
                      }}
                    >
                      {file.originalName}
                    </span>
                    {/* A folder has no content to categorise, no stored copy to re-sync, and no
                        source URL — only reveal and remove apply to it. */}
                    {!isFolder && (
                      <div className="km-category-select">
                        <Combobox
                          value={file.category}
                          options={tabs
                            .filter((t) => t !== "All")
                            .concat(tabs.includes(file.category) ? [] : [file.category])
                            .map((cat) => ({ value: cat, label: cat }))}
                          onChange={(cat) => void updateCategory(file.id, cat)}
                          ariaLabel={`Category for ${file.originalName}`}
                          size="sm"
                        />
                      </div>
                    )}
                    <button
                      className="widget-icon-btn"
                      aria-label={`Reveal ${file.originalName}`}
                      onClick={() => reveal(file.path)}
                    >
                      <TablerIcon name="ti-folder-open" />
                    </button>
                    {file.sourceUrl && (
                      <button
                        className="widget-icon-btn"
                        aria-label={`Open source for ${file.originalName}`}
                        onClick={() => hasAgentsAPI() && void window.agentsAPI.fs.openExternal(file.sourceUrl!)}
                      >
                        <TablerIcon name="ti-external-link" />
                      </button>
                    )}
                    {!isFolder && (
                      <button
                        className="widget-icon-btn"
                        aria-label={`Re-sync ${file.originalName}`}
                        disabled={pendingIds.has(file.id)}
                        onClick={() => void syncOne(file.id)}
                      >
                        <TablerIcon name="ti-refresh" />
                      </button>
                    )}
                    <button
                      className="widget-icon-btn"
                      aria-label={
                        isFolder ? `Remove access to ${file.path}` : `Remove ${file.originalName}`
                      }
                      disabled={pendingIds.has(file.id)}
                      onClick={() => void removeFile(file.id)}
                    >
                      <TablerIcon name="ti-x" />
                    </button>
                  </div>
                );
              })}
            </div>
          </>
        )}
        {error && <p className="widget-error">{error}</p>}
      </div>
      <AddUrlModal open={addUrlModalOpen} onClose={() => setAddUrlModalOpen(false)} />
    </Modal>
  );
}
