import type { Readable } from "node:stream";

import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// One storage abstraction for MinIO (dev) and Cloudflare R2 (prod) — both speak S3.

export interface StorageConfig {
  endpoint?: string; // set for MinIO/R2; unset = real AWS
  accessKey: string;
  secretKey: string;
  bucket: string;
  region: string;
}

export function storageConfigFromEnv(): StorageConfig {
  return {
    endpoint: process.env.S3_ENDPOINT,
    accessKey: process.env.S3_ACCESS_KEY ?? "schemap",
    secretKey: process.env.S3_SECRET_KEY ?? "schemap-secret",
    bucket: process.env.S3_BUCKET ?? "schemap-uploads",
    region: process.env.S3_REGION ?? "us-east-1",
  };
}

export interface Storage {
  bucket: string;
  /** Presigned PUT URL — the browser uploads directly, never through our API (docs/02 §4.2). */
  presignUpload(key: string, expiresInSeconds?: number): Promise<string>;
  /** Stream a stored object — parsing is streaming-only, never full-file loads (docs/02 §1). */
  getObjectStream(key: string): Promise<Readable>;
}

export function createStorage(cfg: StorageConfig = storageConfigFromEnv()): Storage {
  const client = new S3Client({
    region: cfg.region,
    endpoint: cfg.endpoint,
    forcePathStyle: Boolean(cfg.endpoint), // MinIO requires path-style addressing
    credentials: { accessKeyId: cfg.accessKey, secretAccessKey: cfg.secretKey },
  });

  return {
    bucket: cfg.bucket,
    presignUpload(key, expiresInSeconds = 600) {
      return getSignedUrl(client, new PutObjectCommand({ Bucket: cfg.bucket, Key: key }), {
        expiresIn: expiresInSeconds,
      });
    },
    async getObjectStream(key) {
      const res = await client.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: key }));
      if (!res.Body) throw new Error(`Object ${key} has no body`);
      return res.Body as Readable;
    },
  };
}
