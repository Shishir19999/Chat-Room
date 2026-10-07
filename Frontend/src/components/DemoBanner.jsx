import { useState } from 'react';
import ConfirmDialog from './ConfirmDialog.jsx';
import { useToast } from './Toasts.jsx';

export const DEMO_USERNAME = 'demo_user';

export default function DemoBanner({ client }) {
  const [confirming, setConfirming] = useState(false);
  const { toast } = useToast();
  return (
    <div className="demo-banner" role="note">
      <span className="demo-badge">Demo mode</span>
      <span className="demo-text">Runs entirely in your browser: messages and rooms stay on this device, and the other people are simulated bots.</span>
      {client && <button type="button" className="link-btn" onClick={() => setConfirming(true)}>Reset demo data</button>}
      {confirming && (
        <ConfirmDialog
          title="Reset demo data?"
          message="All messages and rooms you created will be replaced by the original sample data."
          confirmLabel="Reset"
          onCancel={() => setConfirming(false)}
          onConfirm={async () => {
            try { await client.reset(); toast('Demo data was reset.', 'success'); } catch (e) { toast(e.message, 'error'); }
            setConfirming(false);
          }}
        />
      )}
    </div>
  );
}
