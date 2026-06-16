import { Request, Response } from 'express';
import crypto from 'crypto';

/**
 * OPay requires HMAC-SHA512 signature authentication for cashier/create.
 * The signature is computed by:
 *   1. Sorting the request payload JSON keys alphabetically (deep sort)
 *   2. Serializing to a compact JSON string
 *   3. Computing HMAC-SHA512 of the serialized string using the merchant's Private Key
 *
 * Reference: https://documentation.opaycheckout.com/api-signature
 */
function sortObjectKeys(obj: any): any {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    return obj;
  }
  return Object.keys(obj)
    .sort()
    .reduce((sorted: any, key) => {
      sorted[key] = sortObjectKeys(obj[key]);
      return sorted;
    }, {});
}

function generateOpaySignature(payload: object, secretKey: string): string {
  const sorted = sortObjectKeys(payload);
  const serialized = JSON.stringify(sorted);
  return crypto.createHmac('sha512', secretKey).update(serialized).digest('hex');
}

export const createOpayCashier = async (req: Request, res: Response) => {
  try {
    const { amount, orderId, email, name } = req.body;

    if (!amount || !orderId) {
      return res.status(400).json({ message: 'Amount and orderId are required' });
    }

    const opayMerchantId = process.env.OPAY_MERCHANT_ID;
    const opayPrivateKey = process.env.OPAY_PRIVATE_KEY;

    // Amount must be in the smallest currency unit (kobo for NGN)
    // OPay cashier API accepts the total as a number in the smallest unit
    const amountInKobo = Math.round(Number(amount) * 100);

    // Determine frontend base URL (support both dev and prod)
    const frontendBase = process.env.FRONTEND_URL || 'http://localhost:5173';

    if (opayMerchantId && opayPrivateKey) {
      // Real OPay Sandbox cashier request
      try {
        const payload = {
          amount: {
            currency: 'NGN',
            total: amountInKobo
          },
          callbackUrl: `${req.protocol}://${req.get('host')}/api/payments/opay/webhook`,
          country: 'NG',
          expireAt: 30,
          orderId,
          productList: [
            {
              description: 'Event Tickets',
              name: 'Event Ticket',
              quantity: 1,
              unitPrice: amountInKobo
            }
          ],
          reference: orderId,
          returnUrl: `${frontendBase}/booking/success?orderId=${orderId}&status=success`,
          userInfo: {
            userEmail: email || 'guest@partystorm.com',
            userId: orderId,
            userMobile: '',
            userName: name || 'Guest User'
          }
        };

        const signature = generateOpaySignature(payload, opayPrivateKey);

        const response = await fetch('https://sandboxapi.opaycheckout.com/api/v1/international/cashier/create', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${signature}`,
            'MerchantId': opayMerchantId
          },
          body: JSON.stringify(payload)
        });

        const data: any = await response.json();

        if (data.code === '00000' && data.data && data.data.cashierUrl) {
          console.log(`[OPay] Sandbox cashier created. URL: ${data.data.cashierUrl}`);
          return res.json({ cashierUrl: data.data.cashierUrl });
        } else {
          console.warn('[OPay] Sandbox API returned non-success, falling back to mock cashier. Response:', JSON.stringify(data));
        }
      } catch (opayErr: any) {
        console.warn('[OPay] Failed to reach OPay sandbox, using mock cashier fallback:', opayErr?.message || opayErr);
      }
    } else {
      console.log('[OPay] Credentials not configured (OPAY_MERCHANT_ID / OPAY_PRIVATE_KEY missing). Using mock cashier.');
    }

    // Fallback: local mock OPay cashier page
    const mockCashierUrl = `${frontendBase}/opay-mock-checkout?orderId=${encodeURIComponent(orderId)}&amount=${encodeURIComponent(amount)}&email=${encodeURIComponent(email || '')}&name=${encodeURIComponent(name || '')}`;
    return res.json({ cashierUrl: mockCashierUrl });
  } catch (error) {
    console.error('OPay initiation error:', error);
    return res.status(500).json({ message: 'Server error during OPay transaction' });
  }
};

export const opayWebhook = async (req: Request, res: Response) => {
  try {
    const opayPrivateKey = process.env.OPAY_PRIVATE_KEY;
    const receivedSignature = req.headers['authorization']?.replace('Bearer ', '') || '';

    if (opayPrivateKey && receivedSignature) {
      const expectedSignature = generateOpaySignature(req.body, opayPrivateKey);
      if (receivedSignature !== expectedSignature) {
        console.warn('[OPay Webhook] Signature mismatch — possible tampered request.');
        return res.status(401).json({ message: 'Invalid webhook signature' });
      }
    }

    const { status, orderId } = req.body;
    console.log(`[OPay Webhook] Received: orderId=${orderId}, status=${status}`);

    // Future: update order/payment status in DB here

    return res.json({ code: '00000', message: 'Webhook received' });
  } catch (error) {
    console.error('OPay webhook error:', error);
    return res.status(500).json({ message: 'Webhook processing error' });
  }
};

export const verifyOpayPayment = async (req: Request, res: Response) => {
  try {
    const { orderId } = req.body;

    if (!orderId) {
      return res.status(400).json({ message: 'orderId is required' });
    }

    const opayMerchantId = process.env.OPAY_MERCHANT_ID;
    const opayPublicKey = process.env.OPAY_PUBLIC_KEY;

    if (!opayMerchantId || !opayPublicKey) {
      // No creds — treat as verified in dev/test mode
      console.log('[OPay Verify] Credentials not set, returning mock verified status.');
      return res.json({ status: 'SUCCESS', orderId });
    }

    // Status query uses PublicKey in Authorization header (not signature)
    const queryPayload = { orderId };
    const response = await fetch('https://sandboxapi.opaycheckout.com/api/v1/international/cashier/status/query', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${opayPublicKey}`,
        'MerchantId': opayMerchantId
      },
      body: JSON.stringify(queryPayload)
    });

    const data: any = await response.json();

    if (data.code === '00000' && data.data) {
      const paymentStatus = data.data.status; // 'SUCCESS', 'PENDING', 'FAIL', etc.
      return res.json({ status: paymentStatus, orderId, raw: data.data });
    } else {
      return res.status(400).json({ message: 'Could not retrieve payment status', raw: data });
    }
  } catch (error) {
    console.error('OPay status query error:', error);
    return res.status(500).json({ message: 'Server error during payment verification' });
  }
};
