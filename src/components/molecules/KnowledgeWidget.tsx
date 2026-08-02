import { useContext, useEffect, useMemo, useRef, useState } from "react";
import WidgetCard from "@/components/atoms/WidgetCard";
import TablerIcon from "@/components/atoms/TablerIcon";
import AddSourceMenu, { AddSourceId } from "@/components/molecules/AddSourceMenu";
import { useSharedKnowledgeFiles } from "@/hooks/useKnowledgeFiles";
import { hasAgentsAPI } from "@/lib/agentsApi";
import { KnowledgeWidgetAnchorContext } from "@/lib/knowledgeWidgetAnchor";
import { selectRecentFiles } from "@/lib/knowledgeRecentFiles";
import { entryIcon } from "@/lib/knowledgeEntryIcon";
import KnowledgeModal from "@/components/organisms/KnowledgeModal";
import AddUrlModal from "@/components/organisms/AddUrlModal";

const MAX_VISIBLE_FILES = 6;
const LOADING_LABELS = ["Uploading…", "Organizing…"];
const LOADING_LABEL_INTERVAL_MS = 1400;

export default function KnowledgeWidget() {
  const { files, loading, error, addFiles, addFolder, pickAndAdd, removeFile } = useSharedKnowledgeFiles();
  const [dragOver, setDragOver] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [addUrlModalOpen, setAddUrlModalOpen] = useState(false);
  const [loadingLabelIndex, setLoadingLabelIndex] = useState(0);
  const anchorRef = useContext(KnowledgeWidgetAnchorContext);
  const dropzoneRef = useRef<HTMLDivElement | null>(null);

  const recentFiles = useMemo(() => selectRecentFiles(files, MAX_VISIBLE_FILES), [files]);
  const hiddenCount = files.length - recentFiles.length;

  useEffect(() => {
    if (!loading) return;
    const interval = window.setInterval(() => {
      setLoadingLabelIndex((i) => (i + 1) % LOADING_LABELS.length);
    }, LOADING_LABEL_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [loading]);

  const setDropzoneRef = (el: HTMLDivElement | null) => {
    dropzoneRef.current = el;
    if (anchorRef) anchorRef.current = el;
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    // Stop this drop from also reaching the window-level app-wide handler
    // (useAppWideFileDrop) — otherwise a drop directly on this dropzone gets
    // ingested twice, once here and once via the bubbled window "drop" event.
    e.stopPropagation();
    setDragOver(false);
    if (!hasAgentsAPI()) return;
    const paths = Array.from(e.dataTransfer.files)
      .map((file) => window.agentsAPI.knowledgebase.getPathForFile(file))
      .filter(Boolean);
    if (paths.length > 0) void addFiles(paths);
  };

  const addSource = (id: AddSourceId) => {
    if (id === "file") void pickAndAdd();
    else if (id === "folder") void addFolder();
    else setAddUrlModalOpen(true);
  };

  return (
    <WidgetCard
      id="widget-knowledge"
      title="Knowledge"
      headerRight={
        <div className="widget-header-actions">
          <button className="widget-icon-btn" aria-label="Expand knowledge base" onClick={() => setModalOpen(true)}>
            <TablerIcon name="ti-arrows-maximize" />
          </button>
          <AddSourceMenu onSelect={addSource} />
        </div>
      }
    >
      <div
        ref={setDropzoneRef}
        className={`kw-dropzone${dragOver ? " dragover" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
      >
        <div className="kw-list">
          {files.length === 0 && (
            <p className="widget-empty">Nothing added yet. Drop files here, or use + for a folder or web page.</p>
          )}
          {recentFiles.map((file) => (
            <div className="kw-row" key={file.id}>
              <TablerIcon name={entryIcon(file.kind)} />
              <span className="kw-name" title={file.kind === "folder" ? file.path : file.originalName}>
                {file.originalName}
              </span>
              <button
                className="widget-icon-btn"
                aria-label={
                  // A folder is the user's own directory, not an app-owned copy — removing it
                  // revokes access rather than deleting anything, and the label has to say so.
                  file.kind === "folder" ? `Remove access to ${file.path}` : `Remove ${file.originalName}`
                }
                onClick={() => removeFile(file.id)}
              >
                <TablerIcon name="ti-x" />
              </button>
            </div>
          ))}
          {hiddenCount > 0 && (
            <button className="kw-show-more" onClick={() => setModalOpen(true)}>
              Show {hiddenCount} more…
            </button>
          )}
        </div>
      </div>
      {loading && <p className="kw-loading">{LOADING_LABELS[loadingLabelIndex]}</p>}
      {error && <p className="widget-error">{error}</p>}
      <KnowledgeModal open={modalOpen} onClose={() => setModalOpen(false)} />
      <AddUrlModal open={addUrlModalOpen} onClose={() => setAddUrlModalOpen(false)} />
    </WidgetCard>
  );
}
