export const phoneUploadSessionStatuses = [
  'pending',
  'opened',
  'uploading',
  'processing',
  'completed',
  'failed',
  'cancelled',
  'expired',
] as const;

export type PhoneUploadSessionStatus = (typeof phoneUploadSessionStatuses)[number];

export const phoneUploadListenerStatuses = ['ready', 'unavailable'] as const;

export type PhoneUploadListenerStatus = (typeof phoneUploadListenerStatuses)[number];

/** States whose token can never become usable again without creating a new session. */
export const permanentPhoneUploadStatuses = new Set<PhoneUploadSessionStatus>([
  'completed',
  'cancelled',
  'expired',
]);

export interface PhoneUploadSessionCreated {
  id: string;
  status: PhoneUploadSessionStatus;
  createdAt: string;
  expiresAt: string;
  uploadUrl: string;
  fallbackUploadUrl: string | null;
  qrPayload: string;
  listenerStatus: PhoneUploadListenerStatus;
}

export interface PhoneUploadSession {
  id: string;
  status: PhoneUploadSessionStatus;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  failedAt: string | null;
  clothingItemId: number | null;
  errorCode: string | null;
  listenerStatus: PhoneUploadListenerStatus;
}

export const deviceSessionStatusCopy: Record<
  PhoneUploadSessionStatus,
  { title: string; description: string }
> = {
  pending: {
    title: 'Waiting for phone',
    description: 'Scan the code with a phone connected to the same local network.',
  },
  opened: {
    title: 'Phone connected',
    description: 'Choose a garment photograph and add its details on your phone.',
  },
  uploading: {
    title: 'Receiving image',
    description: 'Keep the phone page open while Muse receives the photograph.',
  },
  processing: {
    title: 'Processing image',
    description: 'Muse is saving the original and preparing local wardrobe images.',
  },
  completed: {
    title: 'Import complete',
    description: 'Your new garment is ready in Wardrobe.',
  },
  failed: {
    title: 'Import failed',
    description: 'No garment was changed. Retry on the phone or generate a new code.',
  },
  cancelled: {
    title: 'Session cancelled',
    description: 'This upload code can no longer be used.',
  },
  expired: {
    title: 'Session expired',
    description: 'Generate a new code to continue from your phone.',
  },
};
