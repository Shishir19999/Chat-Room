import { useEffect, useId, useRef, useState } from 'react';
import Icon from './Icon.jsx';

// Small popup menu: opens on click, arrow keys move, Escape / outside click / choosing an item closes it.
export default function Menu({ label, icon = 'more', items, align = 'right', className = '', size = 18 }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);
  const id = useId();
  const visible = items.filter(Boolean);

  useEffect(() => {
    if (!open) return undefined;
    const first = wrap.current?.querySelector('[role="menuitem"]');
    first?.focus();
    const onDown = (e) => { if (!wrap.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const onKey = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); wrap.current?.querySelector('button')?.focus(); return; }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const nodes = [...wrap.current.querySelectorAll('[role="menuitem"]')];
    const at = nodes.indexOf(document.activeElement);
    const next = e.key === 'ArrowDown' ? (at + 1) % nodes.length : (at - 1 + nodes.length) % nodes.length;
    nodes[next]?.focus();
  };

  if (!visible.length) return null;
  return (
    <span className={`menu ${className}`} ref={wrap} onKeyDown={onKey}>
      <button type="button" className="icon-btn" aria-label={label} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen((o) => !o)}>
        <Icon name={icon} size={size} />
      </button>
      {open && (
        <div className={`menu-list menu-${align}`} role="menu" id={id} aria-label={label}>
          {visible.map((it) => (
            <button key={it.label} type="button" role="menuitem" className={it.danger ? 'danger' : ''}
              onClick={() => { setOpen(false); it.onSelect(); }}>
              {it.icon && <Icon name={it.icon} size={16} />}{it.label}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}
