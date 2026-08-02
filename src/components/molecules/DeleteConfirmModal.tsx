import { useState } from "react";
import Modal from "@/components/atoms/Modal";

const CONFIRM_WORD = "DELETE";

interface DeleteConfirmModalProps {
  open: boolean;
  itemLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

// Shared type-to-confirm modal for irreversible deletes (custom agents, MCP servers) —
// generalizes the same "type RESET to confirm" mechanic already used in the Danger Zone.
export default function DeleteConfirmModal({ open, itemLabel, onConfirm, onCancel }: DeleteConfirmModalProps) {
  const [confirmText, setConfirmText] = useState("");

  const handleCancel = () => {
    setConfirmText("");
    onCancel();
  };

  const handleConfirm = () => {
    if (confirmText !== CONFIRM_WORD) return;
    setConfirmText("");
    onConfirm();
  };

  return (
    <Modal open={open} onClose={handleCancel} label={`Delete ${itemLabel}?`}>
      <div className="delete-confirm-modal danger-zone">
        <h3>Delete {itemLabel}?</h3>
        <p className="danger-zone-desc">This cannot be undone.</p>
        <label className="settings-field">
          <span>
            Type <strong>{CONFIRM_WORD}</strong> to confirm
          </span>
          <input
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={CONFIRM_WORD}
            autoComplete="off"
          />
        </label>
        <div className="delete-confirm-modal-actions">
          <button className="danger-zone-reset-btn" disabled={confirmText !== CONFIRM_WORD} onClick={handleConfirm}>
            Delete
          </button>
          <button type="button" className="settings-action-btn-sm settings-action-btn-ghost" onClick={handleCancel}>
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  );
}
