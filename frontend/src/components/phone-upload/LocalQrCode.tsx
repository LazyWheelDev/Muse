import { Component, type ReactNode } from 'react';
import { QRCodeSVG } from 'qrcode.react';

interface QrBoundaryProps {
  fallback: ReactNode;
  children: ReactNode;
}

interface QrBoundaryState {
  failed: boolean;
}

class QrBoundary extends Component<QrBoundaryProps, QrBoundaryState> {
  override state: QrBoundaryState = { failed: false };

  static getDerivedStateFromError(): QrBoundaryState {
    return { failed: true };
  }

  override componentDidCatch() {
    // The readable URL remains available; do not log a payload that contains the token.
  }

  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export function LocalQrCode({ value }: { value: string }) {
  const fallback = (
    <p role="status">
      The code could not be displayed. Enter the local address shown below on your phone.
    </p>
  );
  return (
    <QrBoundary fallback={fallback}>
      <div role="img" aria-label="QR code for adding a garment from your phone">
        <QRCodeSVG
          value={value}
          size={296}
          level="H"
          marginSize={4}
          bgColor="#fff9f1"
          fgColor="#302e2a"
          title="Muse phone upload code"
        />
      </div>
    </QrBoundary>
  );
}
