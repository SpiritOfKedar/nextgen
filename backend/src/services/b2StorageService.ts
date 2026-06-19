import {
    HeadBucketCommand,
    HeadObjectCommand,
    GetObjectCommand,
    PutObjectCommand,
    S3Client,
} from '@aws-sdk/client-s3';
import {
    B2_APPLICATION_KEY,
    B2_BUCKET,
    B2_ENDPOINT,
    B2_KEY_ID,
    B2_REGION,
    isB2Enabled,
} from '../config/b2';
import { log, errorFields } from '../lib/logger';

let client: S3Client | null = null;

const getClient = (): S3Client => {
    if (!client) {
        client = new S3Client({
            endpoint: B2_ENDPOINT,
            region: B2_REGION,
            credentials: {
                accessKeyId: B2_KEY_ID,
                secretAccessKey: B2_APPLICATION_KEY,
            },
            forcePathStyle: true,
        });
    }
    return client;
};

export const snapshotKey = (fingerprint: string): string =>
    `snapshots/${fingerprint}.tar.gz`;

export const blobKey = (sha256: string): string => `blobs/${sha256}`;

export const putObject = async (
    key: string,
    body: Buffer,
    contentType: string,
): Promise<void> => {
    await getClient().send(
        new PutObjectCommand({
            Bucket: B2_BUCKET,
            Key: key,
            Body: body,
            ContentType: contentType,
        }),
    );
    log.debug('b2.put', { key, bytes: body.byteLength });
};

export const getObject = async (key: string): Promise<Buffer | null> => {
    try {
        const response = await getClient().send(
            new GetObjectCommand({
                Bucket: B2_BUCKET,
                Key: key,
            }),
        );
        if (!response.Body) return null;
        const bytes = Buffer.from(await response.Body.transformToByteArray());
        log.debug('b2.get', { key, bytes: bytes.byteLength });
        return bytes;
    } catch (error: unknown) {
        const err = error as { name?: string; $metadata?: { httpStatusCode?: number } };
        if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) {
            return null;
        }
        throw error;
    }
};

export const headObject = async (key: string): Promise<boolean> => {
    try {
        await getClient().send(
            new HeadObjectCommand({
                Bucket: B2_BUCKET,
                Key: key,
            }),
        );
        return true;
    } catch (error: unknown) {
        const err = error as { name?: string; $metadata?: { httpStatusCode?: number } };
        if (err.name === 'NotFound' || err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) {
            return false;
        }
        throw error;
    }
};

export const checkB2Connectivity = async (): Promise<boolean> => {
    if (!isB2Enabled()) return false;
    try {
        await getClient().send(new HeadBucketCommand({ Bucket: B2_BUCKET }));
        log.info('b2.ready', { bucket: B2_BUCKET, endpoint: B2_ENDPOINT });
        return true;
    } catch (error) {
        log.warn('b2.unreachable', {
            bucket: B2_BUCKET,
            endpoint: B2_ENDPOINT,
            ...errorFields(error),
        });
        return false;
    }
};
