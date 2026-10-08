import Icon from './Icon.jsx';
import { DEMO_BANNER, PUBLIC_NOTICE } from '../core/constants.js';

// Live preview banner (static GitHub Pages build).
export function DemoBanner() {
  return (
    <aside className="demo-banner" aria-label="Live preview notice">
      <Icon name="bolt" size={16} />
      <span>{DEMO_BANNER}</span>
    </aside>
  );
}

// Status strip above the conversation: offline, connection problems, empty-room help and the public-room notice.
export function StatusBanners({ snap, kind, isPublic, practiceActive, onPractice, onInvite, onReconnect, noticeHidden, onHideNotice }) {
  const { state, detail, peers } = snap.status;
  const alone = peers === 0 && !practiceActive;
  return (
    <div className="banners">
      {state === 'offline' && !snap.joinError && (
        <div className="banner banner-bad" role="alert">
          <Icon name="wifiOff" size={18} />
          <p><strong>{snap.status.reason === 'webrtc' ? 'Peer-to-peer is not available.' : 'You are offline.'}</strong> {detail} {snap.status.reason === 'webrtc' ? '' : kind === 'p2p' ? 'Messages are saved on this device and delivered when you are back and others are online.' : 'Messages will be sent when the connection returns.'}</p>
          {onReconnect && <button type="button" className="btn btn-sm" onClick={onReconnect}><Icon name="refresh" size={14} /> Retry</button>}
        </div>
      )}
      {state === 'connecting' && (
        <div className="banner banner-wait" role="status"><Icon name="refresh" size={18} className="spin" /><p>{detail || 'Connecting...'}</p></div>
      )}
      {snap.joinError && (
        <div className="banner banner-bad" role="alert"><Icon name="lock" size={18} /><p><strong>{snap.joinError.code === 'wrong-password' ? 'Wrong room password.' : 'Could not join.'}</strong> {snap.joinError.error}</p></div>
      )}
      {state === 'online' && alone && (
        <div className="banner banner-info">
          <Icon name="users" size={18} />
          <p><strong>Nobody else is here yet.</strong> {kind === 'p2p' ? 'Share the invite link so a friend can join. They connect straight to you, no server.' : 'Share the invite link so a friend can join.'}{snap.ws.password ? ' If you expect people to be here, check the room password: a different password finds nobody.' : ''}</p>
          <button type="button" className="btn btn-sm" onClick={onInvite}>Invite</button>
          <button type="button" className="btn btn-sm" onClick={() => onPractice(true)}><Icon name="bot" size={14} /> Try the practice bot</button>
        </div>
      )}
      {practiceActive && (
        <div className="banner banner-info">
          <Icon name="bot" size={18} />
          <p><strong>Practice bot is on.</strong> It only exists on this device. Real people can still join.</p>
          <button type="button" className="btn btn-sm" onClick={() => onPractice(false)}>Turn off</button>
        </div>
      )}
      {isPublic && !noticeHidden && (
        <div className="banner banner-notice" role="note">
          <Icon name="shield" size={18} />
          <p>{PUBLIC_NOTICE}</p>
          <button type="button" className="icon-btn" onClick={onHideNotice} aria-label="Hide this notice"><Icon name="close" size={14} /></button>
        </div>
      )}
    </div>
  );
}
