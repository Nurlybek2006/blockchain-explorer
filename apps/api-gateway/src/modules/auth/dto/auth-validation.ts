import { registerDecorator } from 'class-validator';

export function normalizeEmail(value: unknown): unknown {
  return typeof value === 'string' ? value.trim().toLowerCase() : value;
}

export function trimText(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

/** bcrypt truncates after 72 UTF-8 bytes, including for multibyte passwords. */
export function MaxUtf8Bytes(maximum: number): PropertyDecorator {
  return (target, propertyKey) => {
    registerDecorator({
      name: 'maxUtf8Bytes',
      target: target.constructor,
      propertyName: String(propertyKey),
      constraints: [maximum],
      options: { message: `$property must contain at most ${maximum} UTF-8 bytes` },
      validator: {
        validate(value: unknown): boolean {
          return typeof value === 'string' && Buffer.byteLength(value, 'utf8') <= maximum;
        },
      },
    });
  };
}
