// 32-symbol alphabet with ambiguous characters removed (0/O, 1/I/L) so a
// code is never misread or mistyped when a guest copies it from an email or
// a screenshot.
const CODE_CHARS = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const CODE_LENGTH = 6;

// Generated client-side: coupons are only ever looked up scoped to one
// property (`property.coupons.find(...)`), so the code only needs to be
// unique within that property's own list, not globally — no server
// round-trip needed just to mint a code.
export function generateCouponCode(existingCodes: string[]): string {
  const existing = new Set(existingCodes);
  let code: string;
  do {
    let suffix = '';
    for (let i = 0; i < CODE_LENGTH; i++) {
      suffix += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    }
    code = `SH-${suffix}`;
  } while (existing.has(code));
  return code;
}
