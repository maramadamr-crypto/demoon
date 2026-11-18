import React, { useLayoutEffect, useRef } from 'react';
import { getCachedPdfCanvas, renderPdfPageToCanvas } from '../../services/fileProcessor';

interface PdfPageCanvasProps {
  pdfFileId: string;
  pageNumber: number;
  scale?: number;
  className?: string;
  onRendered?: () => void;
}

/**
 * Direct PDF-to-Canvas renderer:
 * Paints synchronously from offscreen canvas cache in <0.5ms when pre-warmed,
 * or renders directly via PDF.js without JPEG compression / img decode overhead.
 */
export const PdfPageCanvas: React.FC<PdfPageCanvasProps> = ({
  pdfFileId,
  pageNumber,
  scale = 1.15,
  className = 'w-full h-auto block pointer-events-none select-none',
  onRendered,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onRenderedRef = useRef(onRendered);
  onRenderedRef.current = onRendered;

  useLayoutEffect(() => {
    const target = canvasRef.current;
    if (!target || !pdfFileId) return;

    const blit = (src: HTMLCanvasElement) => {
      if (src.width === 0 || src.height === 0) return;
      target.width = src.width;
      target.height = src.height;
      const ctx = target.getContext('2d', { alpha: false });
      if (ctx) {
        ctx.drawImage(src, 0, 0);
      }
      onRenderedRef.current?.();
    };

    const cached = getCachedPdfCanvas(pdfFileId, pageNumber);
    if (cached && cached.width > 0) {
      blit(cached);
      return;
    }

    let cancelled = false;
    renderPdfPageToCanvas(pdfFileId, pageNumber, scale).then((rendered) => {
      if (!cancelled && rendered) {
        blit(rendered);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [pdfFileId, pageNumber, scale]);

  return (
    <canvas
      ref={canvasRef}
      width={600}
      height={848}
      className={`${className} bg-white`}
    />
  );
};
