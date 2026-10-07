import { avatarColor, initials } from '../lib/text.js';

export default function Avatar({ name, size = 36 }) {
  return (
    <span className="avatar" style={{ background: avatarColor(name), width: size, height: size, fontSize: size * 0.38 }} aria-hidden="true">
      {initials(name)}
    </span>
  );
}
