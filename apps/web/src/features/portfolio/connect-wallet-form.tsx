'use client';

import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import { isEthereumAddress } from '@blockchain-explorer/contracts/browser';
import { Button, Input } from '@/components/ui';
import { errorMessage } from '@/lib/api/client';
import { useTranslation } from '@/hooks/use-translation';

interface EthereumProvider {
  request(args: {
    method: string;
    params?: unknown[];
  }): Promise<unknown>;
}

interface Wallet {
  id: string;
  name: string;
  provider: EthereumProvider;
}

interface Connection {
  address: string;
  walletName: string;
}

interface Props {
  onSubmit(name: string, address: string): Promise<void>;
}

const messages = {
  kk: {
    connect: 'Connect Wallet',
    introduction:
      'Әмияныңды қос: мекенжайың анықталып, портфелің автоматты жасалады.',
    choose: 'Әмияныңды таңда',
    name: 'Портфель атауы — міндетті емес',
    namePlaceholder: 'Мысалы: Менің негізгі әмияным',
    manual: 'Мекенжайды қолмен енгізу',
    back: 'Әмиян арқылы қосу',
    address: 'Ethereum әмиянының мекенжайы',
    add: 'Портфель жасау',
    retry: 'Портфель жасауды қайталау',
    waiting: 'Әмиянда рұқсат бер...',
    saving: 'Портфель жасалып жатыр...',
    missing:
      'Браузерден әмиян табылмады. MetaMask, Rabby немесе Coinbase Wallet кеңейтімін орнатып, бетті жаңарт. Немесе мекенжайды қолмен енгіз.',
    rejected: 'Қосылу сұрауы қабылданбады. Қайта қосып көруге болады.',
    pending: 'Әмиянда ашық сұрау бар. Әмиян кеңейтімін ашып, соны аяқта.',
    failed: 'Әмиянға қосылу орындалмады. Қайта көр.',
    invalidAddress: 'Дұрыс Ethereum мекенжайын енгіз.',
    invalidName: 'Портфель атауы 100 таңбадан аспауы керек.',
    connected: 'Қосылған мекенжай',
    defaultName: 'Әмияным',
    readOnly:
      'Тек ашық мекенжай алынады. Қаражат жіберу немесе қол қою сұралмайды.',
  },
  en: {
    connect: 'Connect Wallet',
    introduction:
      'Connect your wallet to detect its address and create your portfolio automatically.',
    choose: 'Choose your wallet',
    name: 'Portfolio name — optional',
    namePlaceholder: 'For example: My main wallet',
    manual: 'Enter an address manually',
    back: 'Connect using a wallet',
    address: 'Ethereum wallet address',
    add: 'Create portfolio',
    retry: 'Retry creating portfolio',
    waiting: 'Approve the request in your wallet...',
    saving: 'Creating portfolio...',
    missing:
      'No browser wallet was found. Install MetaMask, Rabby or Coinbase Wallet and reload this page, or enter an address manually.',
    rejected: 'Connection was declined. You can try again.',
    pending: 'A wallet request is already open. Open your wallet to finish it.',
    failed: 'Could not connect to the wallet. Please try again.',
    invalidAddress: 'Enter a valid Ethereum address.',
    invalidName: 'Portfolio names must not exceed 100 characters.',
    connected: 'Connected address',
    defaultName: 'My wallet',
    readOnly:
      'Only your public address is requested. No transfers or signatures are requested.',
  },
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isProvider(value: unknown): value is EthereumProvider {
  return isRecord(value) && typeof value.request === 'function';
}

function walletErrorCode(error: unknown): number | undefined {
  if (!isRecord(error)) return undefined;

  const code = error.code;
  return typeof code === 'number' ? code : undefined;
}

export function ConnectWalletForm({ onSubmit }: Props) {
  const { locale } = useTranslation();
  const text = messages[locale];
  const id = useId();

  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [manual, setManual] = useState(false);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [connection, setConnection] = useState<Connection | null>(null);
  const [phase, setPhase] = useState<'idle' | 'connecting' | 'saving'>('idle');

  const [error, setError] = useState<
    | { message: string }
    | { cause: unknown }
    | null
  >(null);

  // Ref blocks duplicate clicks before React updates the button.
  const locked = useRef(false);
  const mounted = useRef(false);

  const busy = phase !== 'idle';

  useEffect(() => {
    mounted.current = true;

    const discovered = new Map<string, Wallet>();

    function announce(event: Event) {
      const detail: unknown = (event as CustomEvent<unknown>).detail;

      if (
        !isRecord(detail) ||
        !isRecord(detail.info) ||
        !isProvider(detail.provider)
      ) {
        return;
      }

      const { uuid, name: walletName } = detail.info;

      if (
        typeof uuid !== 'string' ||
        typeof walletName !== 'string' ||
        !uuid ||
        !walletName ||
        uuid.length > 200 ||
        walletName.length > 100
      ) {
        return;
      }

      // Ignore repeated announcements and duplicate provider objects.
      if (
        discovered.has(uuid) ||
        [...discovered.values()].some(
          wallet => wallet.provider === detail.provider,
        )
      ) {
        return;
      }

      if (discovered.size >= 20) return;

      discovered.set(uuid, {
        id: uuid,
        name: walletName,
        provider: detail.provider,
      });

      setWallets([...discovered.values()]);
    }

    window.addEventListener('eip6963:announceProvider', announce);
    window.dispatchEvent(new Event('eip6963:requestProvider'));

    // Compatibility fallback for older injected wallets.
    const fallbackTimer = window.setTimeout(() => {
      if (discovered.size > 0) return;

      const ethereum: unknown = (
        window as unknown as { ethereum?: unknown }
      ).ethereum;

      if (isProvider(ethereum)) {
        setWallets([
          {
            id: 'injected',
            name: 'Browser Wallet',
            provider: ethereum,
          },
        ]);
      }
    }, 500);

    return () => {
      mounted.current = false;
      window.clearTimeout(fallbackTimer);
      window.removeEventListener('eip6963:announceProvider', announce);
    };
  }, []);

  function validName(): boolean {
    if (name.trim().length > 100) {
      setError({ message: text.invalidName });
      return false;
    }

    return true;
  }

  async function save(
    walletAddress: string,
    fallbackName: string,
  ): Promise<void> {
    if (!mounted.current) return;

    setPhase('saving');

    try {
      await onSubmit(
        name.trim() || fallbackName,
        walletAddress.toLowerCase(),
      );
    } catch (cause) {
      if (mounted.current) setError({ cause });
    }
  }

  function finish() {
    locked.current = false;
    if (mounted.current) setPhase('idle');
  }

  async function connect(wallet: Wallet) {
    if (locked.current || !validName()) return;

    locked.current = true;
    setError(null);
    setPhase('connecting');

    try {
      const accounts = await wallet.provider.request({
        method: 'eth_requestAccounts',
      });

      if (!mounted.current) return;

      if (
        !Array.isArray(accounts) ||
        typeof accounts[0] !== 'string' ||
        !isEthereumAddress(accounts[0])
      ) {
        setError({ message: text.invalidAddress });
        return;
      }

      const nextConnection = {
        address: accounts[0],
        walletName: wallet.name,
      };

      setConnection(nextConnection);
      setPickerOpen(false);

      await save(nextConnection.address, nextConnection.walletName);
    } catch (cause) {
      if (!mounted.current) return;

      const code = walletErrorCode(cause);

      setError({
        message:
          code === 4001
            ? text.rejected
            : code === -32002
              ? text.pending
              : text.failed,
      });
    } finally {
      finish();
    }
  }

  async function retryCreation() {
    if (locked.current || !connection || !validName()) return;

    locked.current = true;
    setError(null);

    try {
      await save(connection.address, connection.walletName);
    } finally {
      finish();
    }
  }

  async function submitManual(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (locked.current || !validName()) return;

    if (!isEthereumAddress(address.trim())) {
      setError({ message: text.invalidAddress });
      return;
    }

    locked.current = true;
    setError(null);

    try {
      await save(address.trim(), text.defaultName);
    } finally {
      finish();
    }
  }

  function switchMode() {
    if (locked.current) return;

    setManual(current => !current);
    setPickerOpen(false);
    setError(null);
  }

  return (
    <div className="page-stack" aria-busy={busy}>
      <p className="muted">{text.introduction}</p>

      <div className="field">
        <label htmlFor={`${id}-name`}>{text.name}</label>
        <Input
          id={`${id}-name`}
          value={name}
          onChange={event => setName(event.target.value)}
          placeholder={text.namePlaceholder}
          maxLength={100}
          autoComplete="off"
          disabled={busy}
        />
      </div>

      {manual ? (
        <form
          className="page-stack"
          onSubmit={submitManual}
          noValidate
        >
          <div className="field">
            <label htmlFor={`${id}-address`}>{text.address}</label>
            <Input
              id={`${id}-address`}
              value={address}
              onChange={event => setAddress(event.target.value)}
              placeholder="0x..."
              autoComplete="off"
              spellCheck={false}
              required
              disabled={busy}
            />
          </div>

          <Button type="submit" disabled={busy}>
            {phase === 'saving' ? text.saving : text.add}
          </Button>
        </form>
      ) : connection ? (
        <div className="page-stack">
          <div className="field">
            <label>{text.connected}</label>
            <code style={{ overflowWrap: 'anywhere' }}>
              {connection.address}
            </code>
          </div>

          <Button
            type="button"
            disabled={busy}
            onClick={() => void retryCreation()}
          >
            {phase === 'saving' ? text.saving : text.retry}
          </Button>
        </div>
      ) : (
        <div className="page-stack">
          <Button
            type="button"
            disabled={busy}
            onClick={() => {
              setError(null);
              setPickerOpen(true);
              window.dispatchEvent(new Event('eip6963:requestProvider'));
            }}
          >
            {text.connect}
          </Button>

          {pickerOpen && (
            <div className="page-stack">
              <strong>{text.choose}</strong>

              {wallets.length === 0 ? (
                <p className="muted">{text.missing}</p>
              ) : (
                wallets.map(wallet => (
                  <Button
                    key={wallet.id}
                    type="button"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => void connect(wallet)}
                  >
                    {wallet.name}
                  </Button>
                ))
              )}
            </div>
          )}
        </div>
      )}

      {phase === 'connecting' && (
        <p className="muted" role="status">
          {text.waiting}
        </p>
      )}

      {error && (
        <p className="form-error" role="alert">
          {'message' in error
            ? error.message
            : errorMessage(error.cause, locale)}
        </p>
      )}

      <Button
        type="button"
        variant="ghost"
        disabled={busy}
        onClick={switchMode}
      >
        {manual ? text.back : text.manual}
      </Button>

      <small className="muted">{text.readOnly}</small>
    </div>
  );
}