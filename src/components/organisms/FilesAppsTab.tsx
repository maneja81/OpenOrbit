import TablerIcon from "@/components/atoms/TablerIcon";
import { useSharedKnowledgeFiles } from "@/hooks/useKnowledgeFiles";
import { entryIcon } from "@/lib/knowledgeEntryIcon";

export default function FilesAppsTab() {
  const { files, error, addFolder, pickAndAdd, removeFile } = useSharedKnowledgeFiles();

  const folders = files.filter((f) => f.kind === "folder");
  // Documents and saved web pages share this list: both are app-owned copies the user manages
  // the same way, unlike a folder, which is a live grant over a directory they still own.
  const documents = files.filter((f) => f.kind !== "folder");

  return (
    <section className="settings-section">
      <div className="settings-section-header">
        <h3>Attached Folders</h3>
        <button
          type="button"
          className="settings-action-btn-sm settings-action-btn-ghost"
          onClick={() => void addFolder()}
        >
          <TablerIcon name="ti-folder-plus" />
          <span>Add folder</span>
        </button>
      </div>
      <p className="settings-hint">
        Agents can read anything inside these folders. Files are read live — nothing is copied.
      </p>
      <div className="settings-folder-list">
        {folders.length === 0 && <p className="settings-empty">No folders attached yet.</p>}
        {folders.map((folder) => (
          <div className="settings-folder-row" key={folder.id}>
            <TablerIcon name="ti-folder" />
            <span className="settings-folder-path" title={folder.path}>
              {folder.path}
            </span>
            <button
              className="settings-icon-btn"
              // Removing a folder revokes access; it never deletes anything from disk.
              aria-label={`Remove access to ${folder.path}`}
              onClick={() => void removeFile(folder.id)}
            >
              <TablerIcon name="ti-x" />
            </button>
          </div>
        ))}
      </div>

      <div className="settings-section-header">
        <h3>Saved Documents</h3>
        <button
          type="button"
          className="settings-action-btn-sm settings-action-btn-ghost"
          onClick={() => void pickAndAdd()}
        >
          <TablerIcon name="ti-file-plus" />
          <span>Add documents</span>
        </button>
      </div>
      <p className="settings-hint">
        Documents and web pages you've added. The app keeps its own copy of each — removing one
        deletes that copy, never your original.
      </p>
      <div className="settings-folder-list">
        {documents.length === 0 && (
          <p className="settings-empty">
            Nothing saved yet. Add documents above, or drop files onto the Knowledge widget.
          </p>
        )}
        {documents.map((doc) => (
          <div className="settings-folder-row" key={doc.id}>
            <TablerIcon name={entryIcon(doc.kind)} />
            <span className="settings-folder-path" title={doc.sourceUrl ?? doc.originalName}>
              {doc.originalName}
            </span>
            <button
              className="settings-icon-btn"
              aria-label={`Remove ${doc.originalName}`}
              onClick={() => void removeFile(doc.id)}
            >
              <TablerIcon name="ti-x" />
            </button>
          </div>
        ))}
      </div>
      {error && <p className="settings-error">{error}</p>}
    </section>
  );
}
