import { useEffect, useRef } from 'react';
import { useParallaxEnabled } from '../hooks/useMedia.js';

// Wrap a decorative scene; children with data-speed move at that fraction of the scroll distance.
// Uses transform only, IntersectionObserver (runs only while visible) and requestAnimationFrame.
// Disabled automatically for reduced motion, small screens and low-power devices.
export default function ParallaxScene({ as: Tag = 'div', className = '', children, ...rest }) {
  const ref = useRef(null);
  const enabled = useParallaxEnabled();

  useEffect(() => {
    const scene = ref.current;
    if (!scene || !enabled || typeof IntersectionObserver === 'undefined') return undefined;
    const layers = [...scene.querySelectorAll('[data-speed]')];
    let frame = 0;
    let active = false;

    const paint = () => {
      frame = 0;
      const offset = -scene.getBoundingClientRect().top;
      for (const layer of layers) {
        const speed = Number(layer.dataset.speed) || 0;
        layer.style.transform = `translate3d(0, ${(offset * speed).toFixed(1)}px, 0)`;
      }
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(paint); };
    const io = new IntersectionObserver(([entry]) => {
      active = entry.isIntersecting;
      if (active) {
        window.addEventListener('scroll', onScroll, { passive: true });
        onScroll();
      } else {
        window.removeEventListener('scroll', onScroll);
      }
    }, { rootMargin: '100px 0px' });
    io.observe(scene);

    return () => {
      io.disconnect();
      if (active) window.removeEventListener('scroll', onScroll);
      if (frame) cancelAnimationFrame(frame);
      for (const layer of layers) layer.style.transform = '';
    };
  }, [enabled]);

  return <Tag ref={ref} className={className} {...rest}>{children}</Tag>;
}
