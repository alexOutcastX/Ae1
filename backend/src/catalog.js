// Server-side price table. NEVER trust amounts sent by the client.
// amount_paise is in the smallest currency unit (paise for INR).
export const PRODUCTS = {
  credits_100:      { type: 'credits', credits: 100,  amount_paise: 9900,  label: '100 credits' },
  credits_500:      { type: 'credits', credits: 500,  amount_paise: 39900, label: '500 credits' },
  credits_1200:     { type: 'credits', credits: 1200, amount_paise: 79900, label: '1200 credits' },
  premium_lifetime: { type: 'premium', months: null,  amount_paise: 29900, label: 'Premium (lifetime)' },
  premium_monthly:  { type: 'premium', months: 1,     amount_paise: 9900,  label: 'Premium (1 month)' },
};

export function getProduct(id) {
  return PRODUCTS[id] || null;
}
