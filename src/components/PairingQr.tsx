import { QRCodeSVG } from "qrcode.react";

/** A pairing link as a QR code a phone or another computer's camera reads: always dark on white, whatever the skin. */
export function PairingQr({ value, size = 160, label }: { value: string; size?: number; label?: string }) {
  return (
    <div className="shrink-0 rounded-md bg-white p-2" role={label ? "img" : undefined} aria-label={label}>
      <QRCodeSVG value={value} size={size} level="M" bgColor="#ffffff" fgColor="#111111" />
    </div>
  );
}
