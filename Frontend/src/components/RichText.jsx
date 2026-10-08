import { useMemo } from 'react';
import { renderMarkdown } from '../core/sanitize.js';
import { useToast } from './Toasts.jsx';

// Renders sanitized markdown (see core/sanitize.js: raw HTML is escaped, links show only their domain).
export default function RichText({ text, me, highlight = '', filter = false, className = '' }) {
  const { toast } = useToast();
  const html = useMemo(() => renderMarkdown(text, { me, highlight, filter }), [text, me, highlight, filter]);

  const onClick = (e) => {
    const btn = e.target.closest?.('.copy-code');
    if (!btn) return;
    const code = btn.parentElement.querySelector('code')?.textContent || '';
    navigator.clipboard?.writeText(code).then(() => toast('Code copied'), () => toast('Could not copy', 'error'));
  };

  return <div className={`rich ${className}`} onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />;
}
