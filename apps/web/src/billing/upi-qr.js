import QRCode from 'qrcode';

// Personal/business UPI ID this app currently collects manual payments on,
// while the Cashfree merchant account is being set up. Set via env vars
// (never hardcoded here — this file is public) — see apps/web/.env.example.
// Replace with a business account once available — see docs/CASHFREE_SETUP.md.
const UPI_ID = import.meta.env.VITE_UPI_ID || 'your-upi-id@bank';
const PAYEE_NAME = import.meta.env.VITE_UPI_PAYEE_NAME || 'Your Name';

export function buildUpiUri({ amountRupees, note }) {
  const params = new URLSearchParams({ pa: UPI_ID, pn: PAYEE_NAME, cu: 'INR' });
  if (amountRupees != null) params.set('am', String(amountRupees));
  if (note) params.set('tn', note);
  return `upi://pay?${params.toString()}`;
}

// Generates a QR that pre-fills the exact plan amount in the customer's UPI
// app, instead of a static image with no amount — scanning it still requires
// the customer to confirm the payment themselves.
export async function renderUpiQrDataUrl({ amountRupees, note }) {
  const uri = buildUpiUri({ amountRupees, note });
  return QRCode.toDataURL(uri, { margin: 1, width: 220 });
}

export const upiPayeeId = UPI_ID;
export const upiPayeeName = PAYEE_NAME;
