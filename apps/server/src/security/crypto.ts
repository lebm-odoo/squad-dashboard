import { createCipheriv, createDecipheriv, randomBytes, scrypt } from 'node:crypto';
import { z } from 'zod';

// Bounded before any key derivation: an altered file or row must not make scrypt allocate gigabytes.
export const kdfParams = z.object({
  N: z
    .number()
    .int()
    .min(2 ** 14)
    .max(2 ** 20),
  r: z.literal(8),
  p: z.literal(1),
});
export type KdfParams = z.infer<typeof kdfParams>;

export const sealedBox = z.object({ iv: z.base64(), tag: z.base64(), data: z.base64() });
export type SealedBox = z.infer<typeof sealedBox>;

export const newKdf = (): KdfParams => ({ N: 2 ** 17, r: 8, p: 1 });

export const derive = (secret: string, salt: Buffer, { N, r, p }: KdfParams) =>
  new Promise<Buffer>((resolve, reject) =>
    scrypt(secret, salt, 32, { N, r, p, maxmem: 256 * N * r }, (error, key) => (error ? reject(error) : resolve(key))),
  );

// The associated data binds a box to where it is stored: a box copied elsewhere does not open.
export function seal(key: Buffer, plain: Buffer, aad: string): SealedBox {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv).setAAD(Buffer.from(aad));
  const data = Buffer.concat([cipher.update(plain), cipher.final()]);
  return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
}

export function unseal(key: Buffer, box: SealedBox, aad: string): Buffer {
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(box.iv, 'base64')).setAAD(Buffer.from(aad));
  decipher.setAuthTag(Buffer.from(box.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(box.data, 'base64')), decipher.final()]);
}
