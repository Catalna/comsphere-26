import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

const UUID_KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validateKey(key) {
  if (typeof key !== "string" || !UUID_KEY.test(key)) {
    throw Object.assign(new TypeError("Invalid object key"), { code: "INVALID_OBJECT_KEY" });
  }
}

export function createS3Storage({ bucket, client, endpoint, region = "auto", accessKeyId, secretAccessKey, forcePathStyle = false }) {
  if (typeof bucket !== "string" || bucket.trim().length === 0) throw new TypeError("An S3 bucket is required");
  const s3 = client ?? new S3Client({
    region,
    ...(endpoint ? { endpoint } : {}),
    forcePathStyle,
    ...(accessKeyId && secretAccessKey ? { credentials: { accessKeyId, secretAccessKey } } : {}),
  });

  return Object.freeze({
    async putObject({ key, body, contentType }) {
      validateKey(key);
      await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: Buffer.from(body), ContentType: contentType }));
      return key;
    },

    async readObject(key) {
      validateKey(key);
      const result = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      if (!result.Body) throw Object.assign(new Error("Stored object is unavailable"), { code: "OBJECT_NOT_FOUND" });
      return result.Body;
    },

    async deleteObject(key) {
      validateKey(key);
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  });
}
