/** Barcode validation and generation for EAN-13 and Code 128. */

export function ean13CheckDigit(first12: string): number {
  if (!/^\d{12}$/.test(first12)) throw new Error('EAN-13 needs 12 digits before the check digit');
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
}

export function isValidEan13(code: string): boolean {
  if (!/^\d{13}$/.test(code)) return false;
  return ean13CheckDigit(code.slice(0, 12)) === Number(code[12]);
}

/** Code 128 (B) accepts printable ASCII; we cap length to what a 58mm label can hold. */
export function isValidCode128(code: string): boolean {
  return code.length >= 1 && code.length <= 48 && /^[\x20-\x7e]+$/.test(code);
}

export type BarcodeType = 'ean13' | 'code128';

export function detectBarcodeType(code: string): BarcodeType | null {
  if (isValidEan13(code)) return 'ean13';
  if (isValidCode128(code)) return 'code128';
  return null;
}

/**
 * In-store EAN-13 for goods without a manufacturer barcode. Prefix 2xx is reserved by GS1 for
 * restricted (in-store) circulation, so these never collide with real product codes.
 */
export function generateInStoreEan13(seq: number, prefix = '200'): string {
  const body = `${prefix}${String(Math.abs(Math.trunc(seq))).padStart(9, '0')}`.slice(0, 12);
  return body + ean13CheckDigit(body);
}

/** 860 is Uzbekistan's GS1 prefix; used for realistic demo manufacturer barcodes. */
export function generateEan13(seq: number, prefix = '478'): string {
  return generateInStoreEan13(seq, prefix);
}
