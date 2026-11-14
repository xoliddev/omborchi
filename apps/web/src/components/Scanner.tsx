import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n';
import { Modal } from './ui';

interface Detector {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}
declare global {
  interface Window {
    BarcodeDetector?: { new (opts: { formats: string[] }): Detector; getSupportedFormats?: () => Promise<string[]> };
  }
}

/**
 * Camera barcode scanning with the browser's BarcodeDetector (Chrome on Android, Edge, …).
 * Where it is not available — or the camera is refused — the same dialog takes a typed code.
 * USB/Bluetooth scanners need nothing: they type the code and press Enter in any search field.
 */
export function Scanner({ onCode, onClose }: { onCode: (code: string) => void; onClose: () => void }) {
  const { t } = useI18n();
  const video = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<'starting' | 'scanning' | 'unsupported' | 'denied'>(window.BarcodeDetector ? 'starting' : 'unsupported');
  const [manual, setManual] = useState('');

  useEffect(() => {
    if (!window.BarcodeDetector || !navigator.mediaDevices?.getUserMedia) {
      setStatus('unsupported');
      return;
    }
    let stream: MediaStream | null = null;
    let stopped = false;
    let raf = 0;
    (async () => {
      try {
        const detector = new window.BarcodeDetector!({ formats: ['ean_13', 'ean_8', 'code_128', 'upc_a', 'qr_code'] });
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (stopped) return;
        video.current!.srcObject = stream;
        await video.current!.play();
        setStatus('scanning');
        const tick = async () => {
          if (stopped || !video.current) return;
          try {
            const codes = await detector.detect(video.current);
            if (codes[0]?.rawValue) {
              navigator.vibrate?.(60);
              onCode(codes[0].rawValue);
              return;
            }
          } catch {
            /* frame not ready */
          }
          raf = requestAnimationFrame(tick);
        };
        tick();
      } catch {
        setStatus('denied');
      }
    })();
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((tr) => tr.stop());
    };
  }, [onCode]);

  return (
    <Modal title={t('scan.title')} onClose={onClose}>
      <div className="stack">
        {status !== 'unsupported' && status !== 'denied' && (
          <div style={{ position: 'relative', borderRadius: 10, overflow: 'hidden', background: '#000', aspectRatio: '4 / 3' }}>
            <video ref={video} muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            <div style={{ position: 'absolute', left: '12%', right: '12%', top: '45%', height: 2, background: '#4fd1c5', boxShadow: '0 0 12px #4fd1c5' }} />
          </div>
        )}
        <p className="muted small">{status === 'unsupported' ? t('scan.unsupported') : status === 'denied' ? t('scan.denied') : t('scan.hint')}</p>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            if (manual.trim()) onCode(manual.trim());
          }}
        >
          <input className="input" autoFocus={status !== 'scanning'} inputMode="numeric" placeholder={t('scan.manual')} value={manual} onChange={(e) => setManual(e.target.value)} aria-label={t('scan.manual')} />
          <button className="btn primary">{t('common.ok')}</button>
        </form>
      </div>
    </Modal>
  );
}
