import { createLocalFileStorage } from "./localFileStorage.js";
import { createS3Storage } from "./s3Storage.js";

export function createObjectStorage(config, dependencies = {}) {
  if (config?.mode === "local") {
    return createLocalFileStorage({ root: config.localRoot });
  }
  if (config?.mode === "s3") {
    return createS3Storage({
      bucket: config.bucket,
      endpoint: config.endpoint,
      region: config.region,
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      forcePathStyle: config.forcePathStyle,
      client: dependencies.s3Client,
    });
  }
  throw Object.assign(new Error("Unsupported object storage mode"), { code: "INVALID_STORAGE_MODE" });
}
