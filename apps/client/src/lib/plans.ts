import { syncApi } from './sync/syncApi';

/** Display prices and one-line plan copy; the server's Stripe prices are the source of truth. */
export type PaidPlan = 'personal' | 'team';
export type PlanChoice = 'free' | PaidPlan;
export type Interval = 'month' | 'year' | 'founding';

export const PRICES: Record<PaidPlan, Record<Interval, string>> = {
  personal: { month: '$9 / month', year: '$90 / year', founding: '$72 / year' },
  team: { month: '$24 / month', year: '$240 / year', founding: '$192 / year' },
};

export const PLAN_COPY: Record<PlanChoice, { name: string; line: string }> = {
  free: {
    name: 'Free',
    line: 'Access Community boards, clipper inbox, AI assistant by the credit pack.',
  },
  personal: { name: 'Personal', line: 'Sync across devices, 200 AI credits a month.' },
  team: { name: 'Team', line: 'One flat price for the team, 750 credits, Think harder.' },
};

export const INTERVAL_LABELS: Record<Interval, string> = {
  month: 'Monthly',
  year: 'Yearly',
  founding: 'Yearly (Founding Member)',
};

/**
 * A plan chosen at sign-up waits here until the account may check out:
 * right away on servers that don't verify email, otherwise the moment the
 * address is verified. One shot: it is forgotten when checkout starts.
 */
const KEY = 'boardcache.pendingPlan';

export interface PendingPlan {
  plan: PaidPlan;
  interval: Interval;
}

export function pendingPlan(): PendingPlan | null {
  try {
    const raw = localStorage.getItem(KEY);
    const p = raw ? (JSON.parse(raw) as PendingPlan) : null;
    return p && (p.plan === 'personal' || p.plan === 'team') ? p : null;
  } catch {
    return null;
  }
}

export function setPendingPlan(p: PendingPlan | null): void {
  try {
    if (p) localStorage.setItem(KEY, JSON.stringify(p));
    else localStorage.removeItem(KEY);
  } catch {
    /* no storage: the Plan panel is always there */
  }
}

/** Send the browser to Stripe for the pending plan, if any. */
export async function startPendingCheckout(): Promise<boolean> {
  const p = pendingPlan();
  if (!p) return false;
  setPendingPlan(null);
  try {
    window.location.href = await syncApi.billingCheckout(p.plan, p.interval);
    return true;
  } catch {
    return false; // the Plan panel offers the same checkout
  }
}
