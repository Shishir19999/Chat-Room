import { useState } from 'react';
import Dialog from './Dialog.jsx';
import { LIMITS, validateRoomName } from '../lib/limits.js';

export default function CreateRoomDialog({ onCreate, onClose }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    const problem = validateRoomName(name);
    if (problem) { setError(problem); return; }
    setBusy(true);
    try {
      await onCreate({ name: name.trim().toLowerCase(), description: description.trim() });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <Dialog
      title="Create a room"
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" form="create-room-form" className="btn btn-primary" disabled={busy}>{busy ? 'Creating...' : 'Create room'}</button>
        </>
      )}
    >
      <form id="create-room-form" onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="room-name">Room name</label>
          <div className="input-prefix"><span aria-hidden="true">#</span>
            <input id="room-name" value={name} maxLength={LIMITS.room} autoComplete="off" placeholder="book-club" aria-invalid={Boolean(error)} aria-describedby="room-name-help"
              onChange={(e) => { setName(e.target.value); setError(''); }} />
          </div>
          <p id="room-name-help" className={error ? 'field-error' : 'hint'} role={error ? 'alert' : undefined}>{error || 'Lowercase letters, numbers, dashes and underscores.'}</p>
        </div>
        <div className="field">
          <label htmlFor="room-desc">Description <span className="muted">(optional)</span></label>
          <input id="room-desc" value={description} maxLength={LIMITS.description} autoComplete="off" placeholder="What is this room about?" onChange={(e) => setDescription(e.target.value)} />
        </div>
      </form>
    </Dialog>
  );
}
