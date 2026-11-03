/** A PDF drawn page by page with pdf.js (works offline, no browser PDF plugin needed). */
import { useEffect, useRef, useState } from 'react';

export function PdfFrame({ bytes, title, height = 700 }: { bytes: Uint8Array; title: string; height?: number }) {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pages, setPages] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let task: { destroy: () => Promise<void> } | null = null;
    const el = host.current;
    if (!el) return;
    el.replaceChildren();
    setError(null);
    void (async () => {
      try {
        const pdfjs = await import('pdfjs-dist');
        const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
        const loading = pdfjs.getDocument({ data: bytes.slice() });
        task = loading;
        const doc = await loading.promise;
        if (cancelled) return;
        setPages(doc.numPages);
        const width = Math.max(320, el.clientWidth - 24);
        for (let i = 1; i <= doc.numPages; i++) {
          const page = await doc.getPage(i);
          if (cancelled) return;
          const base = page.getViewport({ scale: 1 });
          const scale = width / base.width;
          const dpr = window.devicePixelRatio || 1;
          const vp = page.getViewport({ scale: scale * dpr });
          const canvas = document.createElement('canvas');
          canvas.width = vp.width;
          canvas.height = vp.height;
          canvas.style.width = `${vp.width / dpr}px`;
          canvas.style.height = `${vp.height / dpr}px`;
          canvas.className = 'pdf-page';
          canvas.setAttribute('aria-label', `${title}, page ${i}`);
          el.appendChild(canvas);
          await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport: vp }).promise;
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'The PDF could not be shown.');
      }
    })();
    return () => {
      cancelled = true;
      // Each document has its own pdf.js worker; free it when the preview changes.
      void task?.destroy().catch(() => undefined);
    };
  }, [bytes, title]);

  return (
    <div className="pdf-frame" style={{ maxHeight: height }} role="document" aria-label={`${title}${pages ? ` (${pages} page${pages > 1 ? 's' : ''})` : ''}`}>
      {error ? <p className="small muted">{error}</p> : null}
      <div ref={host} className="pdf-pages" />
    </div>
  );
}
