import { api } from './api.js';

// Opens Razorpay Checkout for a product id, then verifies server-side.
// Returns the fulfilment result from /payments/verify.
export function buyProduct(product, user) {
  return new Promise(async (resolve, reject) => {
    try {
      const order = await api('/api/payments/order', { method: 'POST', body: { product } });
      if (!window.Razorpay) return reject(new Error('Razorpay Checkout not loaded'));

      const rzp = new window.Razorpay({
        key: order.keyId,
        order_id: order.orderId,
        amount: order.amount,
        currency: order.currency,
        name: 'ProApp',
        description: order.label,
        prefill: { email: user?.email || '', name: user?.displayName || '' },
        theme: { color: '#4f46e5' },
        handler: async (response) => {
          try {
            const result = await api('/api/payments/verify', {
              method: 'POST',
              body: {
                orderId: response.razorpay_order_id,
                paymentId: response.razorpay_payment_id,
                signature: response.razorpay_signature,
              },
            });
            resolve(result);
          } catch (e) {
            reject(e);
          }
        },
        modal: { ondismiss: () => reject(new Error('payment_cancelled')) },
      });
      rzp.open();
    } catch (e) {
      reject(e);
    }
  });
}
