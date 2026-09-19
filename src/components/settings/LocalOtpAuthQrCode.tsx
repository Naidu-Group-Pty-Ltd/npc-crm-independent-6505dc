import { useMemo } from 'react';
// Vendored locally from Kazuhiko Arase's MIT-licensed QRCode for JavaScript.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore CommonJS module with no declaration file.
import QRCode from '@/lib/security/vendor/qrcode';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore CommonJS module with no declaration file.
import QRErrorCorrectLevel from '@/lib/security/vendor/qrcode/QRErrorCorrectLevel';

interface LocalOtpAuthQrCodeProps {
  value: string;
}

/** Renders the short-lived provisioning URI entirely in the browser as SVG. */
export function LocalOtpAuthQrCode({ value }: LocalOtpAuthQrCodeProps) {
  const modules = useMemo(() => {
    const code = new QRCode(-1, QRErrorCorrectLevel.M);
    code.addData(value);
    code.make();
    return code.modules as boolean[][];
  }, [value]);
  const size = modules.length;
  const path = modules.flatMap((row, y) => row.flatMap((dark, x) => dark ? [`M${x} ${y}h1v1H${x}z`] : [])).join('');
  return <svg aria-label="Scan this QR code with your authenticator app" className="mx-auto h-52 w-52 rounded-md bg-white p-3 shadow-sm" viewBox={`0 0 ${size} ${size}`} role="img" shapeRendering="crispEdges"><path d={path} fill="#000" /></svg>;
}
