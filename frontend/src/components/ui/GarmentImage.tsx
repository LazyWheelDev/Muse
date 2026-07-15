import { ImageOff } from 'lucide-react';
import { useState } from 'react';

import type { ClothingImage } from '../../features/clothing/model';
import styles from './GarmentImage.module.css';

interface GarmentImageProps {
  image: ClothingImage | null;
  fallbackImages?: readonly ClothingImage[];
  alt: string;
  className?: string;
  loading?: 'eager' | 'lazy';
}

export function GarmentImage({
  image,
  fallbackImages = [],
  alt,
  className,
  loading = 'eager',
}: GarmentImageProps) {
  const [failedUrls, setFailedUrls] = useState<readonly string[]>([]);
  const candidates = [image, ...fallbackImages].filter(
    (candidate, index, all): candidate is ClothingImage =>
      candidate !== null &&
      all.findIndex((entry) => entry?.contentUrl === candidate.contentUrl) === index,
  );
  const activeImage =
    candidates.find((candidate) => !failedUrls.includes(candidate.contentUrl)) ?? null;

  return (
    <div className={`${styles.frame} ${className ?? ''}`}>
      {activeImage === null ? (
        <div className={styles.placeholder} role="img" aria-label={`${alt} image unavailable`}>
          <ImageOff size={40} aria-hidden="true" />
          <span>Image unavailable</span>
        </div>
      ) : (
        <img
          className={styles.image}
          src={activeImage.contentUrl}
          alt={alt}
          width={activeImage.width}
          height={activeImage.height}
          loading={loading}
          decoding="async"
          onError={() =>
            setFailedUrls((current) =>
              current.includes(activeImage.contentUrl)
                ? current
                : [...current, activeImage.contentUrl],
            )
          }
        />
      )}
    </div>
  );
}
