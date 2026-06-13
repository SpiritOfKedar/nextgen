const parsePositiveInt = (raw: string | undefined, fallback: number): number => {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.floor(parsed);
};

export const B2_KEY_ID = process.env.B2_KEY_ID?.trim() || '';
export const B2_APPLICATION_KEY = process.env.B2_APPLICATION_KEY?.trim() || '';
export const B2_BUCKET = process.env.B2_BUCKET?.trim() || '';
export const B2_ENDPOINT = process.env.B2_ENDPOINT?.trim() || '';
export const B2_REGION = process.env.B2_REGION?.trim() || 'us-east-005';
export const B2_BLOB_INLINE_MAX_BYTES = parsePositiveInt(process.env.B2_BLOB_INLINE_MAX_BYTES, 65_536);

export const isB2Enabled = (): boolean =>
    Boolean(B2_KEY_ID && B2_APPLICATION_KEY && B2_BUCKET && B2_ENDPOINT);
