import { avatarColor, initials } from '../lib/format.js';

// Initials on a coloured disc; the optional dot shows presence.
export default function Avatar({ name, color, size = 36, presence, className = '' }) {
  return (
    <span className={`avatar ${className}`} style={{ '--size': `${size}px`, background: avatarColor(color) }} aria-hidden="true">
      {initials(name)}
      {presence && <span className={`presence presence-${presence}`} />}
    </span>
  );
}
