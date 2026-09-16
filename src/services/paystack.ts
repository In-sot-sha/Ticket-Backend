import crypto from 'crypto';

const PAYSTACK_BASE = 'https://api.paystack.co';

function secretKey(): string {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key) throw new Error('PAYSTACK_SECRET_KEY is not configured');
  return key;
}

export function paystackPublicKey(): string | null {
  return process.env.PAYSTACK_PUBLIC_KEY || process.env.VITE_PAYSTACK_PUBLIC_KEY || null;
}

async function paystackFetch<T = any>(
  path: string,
  options: { method?: string; body?: Record<string, unknown> } = {},
): Promise<{ ok: boolean; data: T; message?: string }> {
  const res = await fetch(`${PAYSTACK_BASE}${path}`, {
    method: options.method || 'GET',
    headers: {
      Authorization: `Bearer ${secretKey()}`,
      'Content-Type': 'application/json',
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const json: any = await res.json().catch(() => ({}));
  return {
    ok: Boolean(json?.status),
    data: json?.data as T,
    message: json?.message,
  };
}

export function verifyPaystackWebhookSignature(rawBody: string | Buffer, signature: string | undefined): boolean {
  if (!signature) return false;
  const hash = crypto.createHmac('sha512', secretKey()).update(rawBody).digest('hex');
  return hash === signature;
}

export async function initializePaystackTransaction(input: {
  email: string;
  amountKobo: number;
  reference: string;
  callbackUrl?: string;
  metadata?: Record<string, unknown>;
  subaccount?: string;
  transactionChargeKobo?: number;
  bearer?: 'account' | 'subaccount';
}): Promise<{
  authorizationUrl: string;
  accessCode: string;
  reference: string;
}> {
  const body: Record<string, unknown> = {
    email: input.email,
    amount: input.amountKobo,
    reference: input.reference,
    currency: 'NGN',
    metadata: input.metadata || {},
  };
  if (input.callbackUrl) body.callback_url = input.callbackUrl;
  if (input.subaccount) {
    body.subaccount = input.subaccount;
    if (input.transactionChargeKobo != null) {
      body.transaction_charge = input.transactionChargeKobo;
    }
    if (input.bearer) body.bearer = input.bearer;
  }

  const result = await paystackFetch<{
    authorization_url: string;
    access_code: string;
    reference: string;
  }>('/transaction/initialize', { method: 'POST', body });

  if (!result.ok || !result.data?.reference) {
    throw new Error(result.message || 'Failed to initialize Paystack transaction');
  }

  return {
    authorizationUrl: result.data.authorization_url,
    accessCode: result.data.access_code,
    reference: result.data.reference,
  };
}

export type PaystackVerifiedTransaction = {
  status: string;
  reference: string;
  amount: number; // kobo
  currency: string;
  paid_at?: string;
  gateway_response?: string;
  metadata?: Record<string, unknown>;
  customer?: { email?: string };
};

export async function verifyPaystackTransaction(reference: string): Promise<PaystackVerifiedTransaction> {
  const result = await paystackFetch<PaystackVerifiedTransaction>(
    `/transaction/verify/${encodeURIComponent(reference)}`,
  );
  if (!result.ok || !result.data) {
    throw new Error(result.message || 'Failed to verify Paystack transaction');
  }
  return result.data;
}

export async function listPaystackBanks(currency = 'NGN'): Promise<Array<{ name: string; code: string }>> {
  const result = await paystackFetch<Array<{ name: string; code: string }>>(
    `/bank?currency=${currency}`,
  );
  if (!result.ok || !Array.isArray(result.data)) {
    throw new Error(result.message || 'Failed to list banks');
  }
  return result.data;
}

export async function resolveBankCode(bankName: string): Promise<string | null> {
  const banks = await listPaystackBanks();
  const query = bankName.toLowerCase().trim();
  const exact = banks.find((b) => b.name.toLowerCase() === query);
  if (exact) return exact.code;
  const partial = banks.find(
    (b) => b.name.toLowerCase().includes(query) || query.includes(b.name.toLowerCase()),
  );
  return partial?.code ?? null;
}

export async function createOrUpdatePaystackSubaccount(input: {
  businessName: string;
  settlementBank: string;
  accountNumber: string;
  percentageCharge?: number;
  existingCode?: string | null;
}): Promise<string> {
  const percentage_charge = input.percentageCharge ?? 0;
  if (input.existingCode) {
    const updated = await paystackFetch<{ subaccount_code: string }>(
      `/subaccount/${encodeURIComponent(input.existingCode)}`,
      {
        method: 'PUT',
        body: {
          business_name: input.businessName,
          settlement_bank: input.settlementBank,
          account_number: input.accountNumber,
          percentage_charge,
        },
      },
    );
    if (updated.ok && updated.data?.subaccount_code) {
      return updated.data.subaccount_code;
    }
  }

  const created = await paystackFetch<{ subaccount_code: string }>('/subaccount', {
    method: 'POST',
    body: {
      business_name: input.businessName,
      settlement_bank: input.settlementBank,
      account_number: input.accountNumber,
      percentage_charge,
    },
  });

  if (!created.ok || !created.data?.subaccount_code) {
    throw new Error(created.message || 'Failed to create Paystack subaccount');
  }
  return created.data.subaccount_code;
}

export function makePaymentReference(prefix: string, eventId: number): string {
  const rand = crypto.randomBytes(4).toString('hex');
  return `${prefix}_${Date.now()}_${eventId}_${rand}`;
}
