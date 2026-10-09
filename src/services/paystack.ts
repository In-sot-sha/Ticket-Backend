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

export async function resolvePaystackAccount(
  accountNumber: string,
  bankCode: string,
): Promise<{ accountName: string; accountNumber: string }> {
  const cleanAccount = accountNumber.trim();
  const cleanCode = bankCode.trim();

  // Paystack NUBAN Account Resolution API (Free of charge)
  const result = await paystackFetch<{ account_name: string; account_number: string }>(
    `/bank/resolve?account_number=${encodeURIComponent(cleanAccount)}&bank_code=${encodeURIComponent(cleanCode)}`,
  );

  if (result.ok && result.data?.account_name) {
    return {
      accountName: result.data.account_name,
      accountNumber: result.data.account_number || cleanAccount,
    };
  }

  // Graceful fallback for test mode if live rate limit reached
  const isTestKey = (process.env.PAYSTACK_SECRET_KEY || '').startsWith('sk_test_');
  if (isTestKey && cleanAccount.length === 10) {
    if (cleanCode !== '001') {
      const testRes = await paystackFetch<{ account_name: string; account_number: string }>(
        `/bank/resolve?account_number=${encodeURIComponent(cleanAccount)}&bank_code=001`,
      );
      if (testRes.ok && testRes.data?.account_name) {
        return {
          accountName: testRes.data.account_name,
          accountNumber: cleanAccount,
        };
      }
    }
  }

  throw new Error(result.message || 'Could not verify account name. Check account number and bank.');
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
    const message = updated.message || 'Failed to update Paystack subaccount';
    // A deleted code can be replaced. Any other failure must keep the current subaccount.
    if (!/not found/i.test(message)) {
      throw new Error(message);
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

export type PaystackSettlementRow = {
  id: number;
  status: string;
  amount: number;
  settlementDate: string | null;
  subaccountCode: string | null;
  businessName: string | null;
  references: string[];
};

export type PaystackSettlementSnapshot = {
  configured: boolean;
  settlements: PaystackSettlementRow[];
  byReference: Record<string, { status: string; settlementDate: string | null; settlementId: number }>;
};

let settlementCache: { at: number; body: PaystackSettlementSnapshot } | null = null;

export async function loadPaystackSettlementSnapshot(): Promise<PaystackSettlementSnapshot> {
  if (!process.env.PAYSTACK_SECRET_KEY) {
    return { configured: false, settlements: [], byReference: {} };
  }
  if (settlementCache && Date.now() - settlementCache.at < 5 * 60 * 1000) {
    return settlementCache.body;
  }

  const recent = (await listPaystackSettlements(20)).slice(0, 12);
  const txLists: any[][] = [];
  for (let i = 0; i < recent.length; i += 4) {
    const chunk = recent.slice(i, i + 4);
    const loaded = await Promise.all(
      chunk.map((settlement) => listPaystackSettlementTransactions(settlement.id).catch(() => [] as any[])),
    );
    txLists.push(...loaded);
  }

  const byReference: PaystackSettlementSnapshot['byReference'] = {};
  const settlements: PaystackSettlementRow[] = recent.map((settlement, index) => {
    const txs = txLists[index] || [];
    const sub = txs.find((tx) => tx?.subaccount)?.subaccount || settlement.subaccount;
    const code = sub?.subaccount_code || null;
    const references: string[] = [];
    for (const tx of txs) {
      if (!tx?.reference) continue;
      const reference = String(tx.reference);
      references.push(reference);
      byReference[reference] = {
        status: String(settlement.status || ''),
        settlementDate: settlement.settlement_date || settlement.createdAt || null,
        settlementId: settlement.id,
      };
    }
    const amountKobo = Number(settlement.effective_amount ?? settlement.total_amount ?? 0);
    return {
      id: settlement.id,
      status: String(settlement.status || ''),
      amount: amountKobo / 100,
      settlementDate: settlement.settlement_date || settlement.createdAt || null,
      subaccountCode: code,
      businessName: sub?.business_name || null,
      references,
    };
  });

  const body = { configured: true, settlements, byReference };
  settlementCache = { at: Date.now(), body };
  return body;
}

export async function listPaystackSettlements(perPage = 20): Promise<any[]> {
  const result = await paystackFetch<any[]>(`/settlement?perPage=${perPage}`);
  if (!result.ok || !Array.isArray(result.data)) {
    throw new Error(result.message || 'Failed to list Paystack settlements');
  }
  return result.data;
}

export async function listPaystackSettlementTransactions(settlementId: number | string): Promise<any[]> {
  const result = await paystackFetch<any[]>(
    `/settlement/${encodeURIComponent(String(settlementId))}/transactions?perPage=100`,
  );
  if (!result.ok || !Array.isArray(result.data)) return [];
  return result.data;
}

export function makePaymentReference(prefix: string, eventId: number): string {
  const rand = crypto.randomBytes(4).toString('hex');
  return `${prefix}_${Date.now()}_${eventId}_${rand}`;
}
