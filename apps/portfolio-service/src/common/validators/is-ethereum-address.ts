import { isEthereumAddress } from '@blockchain-explorer/contracts';
import { ValidateBy, type ValidationOptions } from 'class-validator';

export function IsEthereumAddress(options?: ValidationOptions): PropertyDecorator {
  return ValidateBy({
    name: 'isEthereumAddress',
    validator: {
      validate: (value: unknown) => isEthereumAddress(value),
      defaultMessage: () => '$property must be a valid Ethereum address',
    },
  }, options);
}
