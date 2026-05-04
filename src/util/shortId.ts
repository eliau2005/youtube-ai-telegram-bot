import { customAlphabet } from 'nanoid';

const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

export const shortJobId = customAlphabet(alphabet, 8);
export const longJobId = customAlphabet(alphabet, 12);
