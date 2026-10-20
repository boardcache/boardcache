import { useState } from 'react';
import { syncApi } from '../../lib/sync/syncApi';
import { UiDialog } from '../ui/Dialog';

const QUANTITIES = [1, 2, 5, 10] as const;

/** How many packs: a pill per quantity, the total beside it, then Stripe. */
export function BuyCreditsDialog({
  pack,
  onClose,
}: {
  pack: { credits: number; priceCents?: number };
  onClose: () => void;
}) {
  const [quantity, setQuantity] = useState<number>(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const price = (n: number) =>
    pack.priceCents === undefined ? '' : `$${((pack.priceCents * n) / 100).toFixed(0)}`;
  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      window.location.href = await syncApi.billingCredits(quantity);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t open billing.');
      setBusy(false);
    }
  };
  return (
    <UiDialog
      title="Buy credits"
      onClose={onClose}
      className="lock-sheet"
      testId="buy-credits-dialog"
      dismissable={!busy}
    >
      <div className="sync-body">
        <p className="sync-note">
          Packs of {pack.credits} credits{pack.priceCents !== undefined ? ` for ${price(1)}` : ''}.
          Purchased credits never expire and sit beside your monthly allowance.
        </p>
        <div className="plan-interval" role="radiogroup" aria-label="How many packs">
          {QUANTITIES.map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={quantity === n}
              className={quantity === n ? 'active' : ''}
              data-testid={`buy-credits-${n}`}
              onClick={() => setQuantity(n)}
            >
              {n === 1 ? '1 pack' : `${n} packs`}
            </button>
          ))}
        </div>
        <p className="plan-usage" data-testid="buy-credits-total">
          <strong>{(pack.credits * quantity).toLocaleString()} credits</strong>
          {pack.priceCents !== undefined && ` · ${price(quantity)}`}
        </p>
        {error && (
          <p className="sync-error" role="alert">
            {error}
          </p>
        )}
        <div className="sync-actions">
          <button
            type="button"
            className="sync-primary"
            disabled={busy}
            data-testid="buy-credits-go"
            onClick={() => void go()}
          >
            {busy ? 'Opening checkout' : 'Continue to checkout'}
          </button>
        </div>
      </div>
    </UiDialog>
  );
}
