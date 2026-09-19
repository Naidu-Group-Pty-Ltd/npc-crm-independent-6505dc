// Vendored locally from Kazuhiko Arase's MIT-licensed QRCode for JavaScript.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore CommonJS module with no declaration file.
import QRCode from '../security/vendor/qrcode';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore CommonJS module with no declaration file.
import QRErrorCorrectLevel from '../security/vendor/qrcode/QRErrorCorrectLevel';

/** Encodes a QR payload locally so report data never reaches a third-party service. */
export function encodeQrModules(data: string): boolean[][] {
  const code = new QRCode(-1, QRErrorCorrectLevel.M);
  code.addData(data);
  code.make();
  return code.modules as boolean[][];
}

