import { useState } from 'react';
import Dialog from './Dialog.jsx';

// Confirmation for destructive actions. onConfirm may be async; errors keep the dialog open.
export default function ConfirmDialog({ title, message, confirmLabel = 'Delete', onConfirm, onCancel }) {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try { await onConfirm(); } finally { setBusy(false); }
  };
  return (
    <Dialog
      title={title}
      onClose={onCancel}
      role="alertdialog"
      initialFocus="[data-cancel]"
      footer={(
        <>
          <button type="button" className="btn" data-cancel onClick={onCancel}>Cancel</button>
          <button type="button" className="btn btn-danger" onClick={run} disabled={busy}>{busy ? 'Working...' : confirmLabel}</button>
        </>
      )}
    >
      <p>{message}</p>
    </Dialog>
  );
}
