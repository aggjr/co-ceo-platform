import crypto from 'crypto';
import bcrypt from 'bcrypt';

const BCRYPT_ROUNDS = 12;

export class PasswordService {
  static async hash(plain: string): Promise<string> {
    return bcrypt.hash(plain, BCRYPT_ROUNDS);
  }

  static async verify(plain: string, storedHash: string): Promise<boolean> {
    if (storedHash.startsWith('$2')) {
      return bcrypt.compare(plain, storedHash);
    }
    const legacy = crypto.createHash('sha256').update(plain).digest('hex');
    return legacy === storedHash;
  }
}
