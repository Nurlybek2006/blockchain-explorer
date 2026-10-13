import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import bcrypt from 'bcrypt';

@Injectable()
export class PasswordService {
  private readonly rounds: number;
  // A missing user performs the same expensive comparison as an existing user.
  private readonly dummyHash: Promise<string>;

  constructor(config: ConfigService) {
    this.rounds = Number(config.get<unknown>('BCRYPT_ROUNDS') ?? 12);
    if (!Number.isInteger(this.rounds) || this.rounds < 10 || this.rounds > 14) {
      throw new Error('BCRYPT_ROUNDS must be an integer between 10 and 14');
    }
    this.dummyHash = bcrypt.hash(randomBytes(32).toString('hex'), this.rounds);
  }

  hash(password: string): Promise<string> {
    return bcrypt.hash(password, this.rounds);
  }

  async matches(password: string, storedHash: string | undefined): Promise<boolean> {
    const result = await bcrypt.compare(password, storedHash ?? await this.dummyHash);
    return storedHash !== undefined && result;
  }
}
