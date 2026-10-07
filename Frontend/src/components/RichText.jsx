import { Fragment } from 'react';
import { splitHighlight, tokenize } from '../lib/text.js';

function Marked({ text, query }) {
  return splitHighlight(text, query).map((p, i) => (p.match ? <mark key={i}>{p.value}</mark> : <Fragment key={i}>{p.value}</Fragment>));
}

// Plain text with @mentions highlighted and http(s) links made clickable (no HTML is ever injected).
export default function RichText({ text, me, query = '' }) {
  return tokenize(text).map((t, i) => {
    if (t.type === 'link') {
      return <a key={i} href={t.value} target="_blank" rel="noopener noreferrer nofollow"><Marked text={t.value} query={query} /></a>;
    }
    if (t.type === 'mention') {
      const self = me && t.value.slice(1).toLowerCase() === me.toLowerCase();
      return <span key={i} className={`mention${self ? ' mention-me' : ''}`}><Marked text={t.value} query={query} /></span>;
    }
    return <Marked key={i} text={t.value} query={query} />;
  });
}
