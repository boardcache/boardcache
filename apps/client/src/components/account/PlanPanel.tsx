import { useEffect, useState } from 'react';
import { BadgeCheckIcon } from '../icons';
import { syncApi } from '../../lib/sync/syncApi';
import { useSyncStore } from '../../state/syncStore';
import { PRICES } from '../../lib/plans';
import { BuyCreditsDialog } from './BuyCreditsDialog';
import { canPurchase } from '../../lib/mobile';
import { refreshHostedAi, useAIStore } from '../../state/aiStore';

const GB = 1024 * 1024 * 1024;
const MB = 1024 * 1024;

function fmtBytes(n: number): string {
  if (n >= GB) return `${(n / GB).toFixed(n >= 10 * GB ? 0 : 1)} GB`;
  if (n >= MB) return `${Math.round(n / MB)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

const PLAN_LABELS: Record<string, string> = {
  free: 'Free',
  personal: 'Personal',
  team: 'Team',
  unlimited: 'Self-hosted',
};

/**
 * Plan & storage (Settings → Sync): what plan this account is on, how much
 * of the quota is used, and — on servers without enforcement (self-hosted) —
 * plain usage with no limits. Billing buttons plug in here later.
 */
async function goTo(urlPromise: Promise<string>): Promise<void> {
  try {
    window.location.href = await urlPromise;
  } catch (e) {
    window.alert(e instanceof Error ? e.message : 'Couldn’t open billing.');
  }
}

/** AI credit balance + pack purchase (only on servers with hosted AI). */
function HostedCreditsRow({ billing }: { billing: boolean }) {
  const hosted = useAIStore((s) => s.hosted);
  const [buying, setBuying] = useState(false);
  useEffect(() => void refreshHostedAi(), []);
  const c = hosted?.credits;
  if (!hosted?.enabled || !c || c.available === null) return null;
  return (
    <div className="plan-ai" data-testid="plan-ai-credits">
      <div className="plan-row">
        <span className="plan-usage">
          <strong>{c.available}</strong> AI credits
          {c.monthlyAllowance
            ? ` · ${Math.max(0, c.monthlyAllowance - c.monthlyUsed)} of ${c.monthlyAllowance} monthly, ${c.purchased} purchased`
            : ''}
        </span>
        {billing && hosted.pack.purchasable && canPurchase() && (
          <button
            type="button"
            className="plan-btn"
            data-testid="plan-buy-credits"
            onClick={() => setBuying(true)}
          >
            Buy credits
          </button>
        )}
      </div>
      {buying && <BuyCreditsDialog pack={hosted.pack} onClose={() => setBuying(false)} />}
      <p className="settings-hint plan-ai-prices" data-testid="plan-ai-prices">
        {[
          hosted.ops.chat && `chat ${hosted.ops.chat.credits}`,
          hosted.ops.agent && `assistant step ${hosted.ops.agent.credits}`,
          hosted.ops.deep && `think harder ${hosted.ops.deep.credits}`,
          hosted.ops.image && `image ${hosted.ops.image.credits}`,
          hosted.ops.transcribe && `transcription ${hosted.ops.transcribe.credits}/min`,
        ]
          .filter(Boolean)
          .join(' · ')}{' '}
        credits each
      </p>
    </div>
  );
}

export function PlanPanel() {
  const ent = useSyncStore((s) => s.entitlements);
  type Interval = 'month' | 'year' | 'founding';
  // Two pills: Monthly and Yearly. While founding seats last, Yearly IS the
  // founding rate; once they are gone it is the normal yearly price.
  const [period, setPeriod] = useState<'month' | 'yearly'>('yearly');

  // Fresh on every open: a checkout or portal visit may just have ended.
  useEffect(() => void useSyncStore.getState().refreshEntitlements(), []);

  if (!ent) return null;
  const interval: Interval = period === 'month' ? 'month' : ent.foundingOpen ? 'founding' : 'year';
  const { limits, usage } = ent;
  // syncBytes 0 = a tier with no sync at all (Free): show the pitch, not a bar.
  const noSync = limits.syncBytes === 0;
  const pct =
    limits.syncBytes !== null && limits.syncBytes > 0
      ? Math.min(100, (usage.syncBytes / limits.syncBytes) * 100)
      : 0;

  return (
    <div className="plan-panel settings-card" data-testid="plan-panel">
      <h4>Plan &amp; storage</h4>
      <div className="plan-row">
        <span className="plan-badge" data-testid="plan-name">
          {PLAN_LABELS[ent.plan] ?? ent.plan}
        </span>
        <span className="plan-usage" data-testid="plan-usage">
          {limits.syncBytes === null
            ? `${fmtBytes(usage.syncBytes)} stored · no limits on this server`
            : noSync
              ? 'Local boards only — sync starts with Personal'
              : `${fmtBytes(usage.syncBytes)} of ${fmtBytes(limits.syncBytes)} used`}
        </span>
      </div>
      {limits.syncBytes !== null && !noSync && (
        <div className="plan-bar" role="progressbar" aria-valuenow={Math.round(pct)}>
          <div
            className={`plan-bar-fill${pct >= 90 ? ' plan-bar-hot' : ''}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
      {ent.complimentary && (
        <p className="plan-founding" data-testid="plan-complimentary">
          Complimentary plan: full access, nothing to pay, no end date.
        </p>
      )}
      {ent.foundingAt && (
        <p className="plan-founding" data-testid="plan-founding">
          <BadgeCheckIcon size={13} /> Founding member since{' '}
          {new Date(ent.foundingAt).toLocaleDateString(undefined, {
            month: 'long',
            year: 'numeric',
          })}
          . Your rate is locked for as long as you keep the plan.
        </p>
      )}
      {!ent.billing && noSync && canPurchase() && (
        <p className="settings-hint" data-testid="plan-coming-soon">
          Paid plans aren’t open yet. Boards stay on this device until they are.
        </p>
      )}
      {ent.billing && canPurchase() && !ent.complimentary && (
        <div className="plan-actions">
          {ent.plan === 'free' ? (
            <>
              <div className="plan-interval" role="radiogroup" aria-label="Billing period">
                {(
                  [
                    ['month', 'Monthly'],
                    ['yearly', ent.foundingOpen ? 'Yearly (Founding Member)' : 'Yearly'],
                  ] as ['month' | 'yearly', string][]
                ).map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    role="radio"
                    aria-checked={period === k}
                    className={period === k ? 'active' : ''}
                    data-testid={`plan-interval-${k === 'month' ? 'month' : 'year'}`}
                    onClick={() => setPeriod(k)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="plan-choices">
                <button
                  type="button"
                  className="plan-btn"
                  data-testid="plan-upgrade-personal"
                  onClick={() => void goTo(syncApi.billingCheckout('personal', interval))}
                >
                  Personal · {PRICES.personal[interval]}
                </button>
                <button
                  type="button"
                  className="plan-btn"
                  data-testid="plan-upgrade-team"
                  onClick={() => void goTo(syncApi.billingCheckout('team', interval))}
                >
                  Team · {PRICES.team[interval]}
                </button>
              </div>
              {interval === 'founding' && (
                <p className="settings-hint plan-founding-hint">
                  The founding rate goes to the first 250 accounts and stays yours for life. It
                  comes with the badge.
                </p>
              )}
            </>
          ) : (
            <button
              type="button"
              className="plan-btn"
              data-testid="plan-manage"
              onClick={() => void goTo(syncApi.billingPortal())}
            >
              Manage billing
            </button>
          )}
        </div>
      )}
      <HostedCreditsRow billing={ent.billing} />
      {ent.enforced && !noSync && (
        <p className="settings-hint">
          {limits.syncedBoards !== null &&
            limits.syncedBoards > 0 &&
            `Synced boards: ${usage.syncedBoards}/${limits.syncedBoards} · `}
          {limits.teamBoardsOwned !== null &&
            limits.teamBoardsOwned > 0 &&
            `Team boards: ${usage.teamBoardsOwned}/${limits.teamBoardsOwned}`}
        </p>
      )}
    </div>
  );
}
