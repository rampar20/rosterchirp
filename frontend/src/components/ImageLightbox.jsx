import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

export default function ImageLightbox({ src, onClose }) {
  const overlayRef = useRef(null);

  // Close on Escape; enable native pinch-zoom on the image while open
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    document.body.style.overflow = 'hidden';

    // Signal the global font-scale pinch handler in main.jsx to stand down
    document.documentElement.dataset.lightboxOpen = '1';

    // Enable native browser pinch-to-zoom by removing the scale restrictions.
    // The original content is restored exactly on close.
    const viewport = document.querySelector('meta[name="viewport"]');
    const originalContent = viewport?.content ?? '';
    if (viewport) {
      viewport.content = originalContent
        .replace(/,?\s*maximum-scale=[^,]*/g, '')
        .replace(/,?\s*user-scalable=[^,]*/g, '')
        .trim();
    }

    return () => {
      window.removeEventListener('keydown', handler);
      document.body.style.overflow = '';
      delete document.documentElement.dataset.lightboxOpen;
      if (viewport) viewport.content = originalContent;
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={overlayRef}
      onClick={(e) => e.target === overlayRef.current && onClose()}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0,0,0,0.92)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        touchAction: 'pinch-zoom',
      }}
    >
      {/* Close button */}
      <button
        onClick={onClose}
        style={{
          position: 'absolute', top: 16, right: 16,
          background: 'rgba(255,255,255,0.15)', border: 'none',
          borderRadius: '50%', width: 40, height: 40,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', color: 'white', zIndex: 10000,
        }}
        title="Close"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>

      {/* Download button */}
      <a
        href={src}
        download
        style={{
          position: 'absolute', top: 16, right: 64,
          background: 'rgba(255,255,255,0.15)', border: 'none',
          borderRadius: '50%', width: 40, height: 40,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', color: 'white', zIndex: 10000, textDecoration: 'none',
        }}
        title="Download"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="7 10 12 15 17 10"/>
          <line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
      </a>

      {/* Image — fit to screen, browser handles pinch-zoom natively */}
      <img
        src={src}
        alt="Full size"
        style={{
          maxWidth: '92vw',
          maxHeight: '92vh',
          objectFit: 'contain',
          borderRadius: 8,
          userSelect: 'none',
          touchAction: 'pinch-zoom',
          boxShadow: '0 8px 40px rgba(0,0,0,0.6)',
        }}
        onClick={(e) => e.stopPropagation()} />
    </div>,
    document.body
  );
}
