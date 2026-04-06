export interface Env {
  AI: Ai;
  DB: D1Database;
  PAYPAL_CLIENT_ID: string;
  PAYPAL_CLIENT_SECRET: string;
  PAYPAL_WEBHOOK_ID?: string;
}

// Pricing Plans
const PLANS = {
  free: { name: 'Free', monthly_credits: 3, price: 0 },
  basic: { name: 'Basic', monthly_credits: 500, price: 4.9 },
  pro: { name: 'Pro', monthly_credits: -1, price: 9.9 }
};

// Credit Packages with PayPal prices
const CREDIT_PACKAGES = [
  { name: 'Starter', credits: 30, price: 0.5, days: 30, paypalPrice: "0.50" },
  { name: 'Small', credits: 100, price: 1, days: 30, paypalPrice: "1.00" },
  { name: 'Medium', credits: 500, price: 4, days: 90, paypalPrice: "4.00" },
  { name: 'Large', credits: 1000, price: 7, days: 180, paypalPrice: "7.00" },
  { name: 'Team', credits: 5000, price: 25, days: 365, paypalPrice: "25.00" }
];

// Subscription Plans with PayPal prices
const SUBSCRIPTION_PLANS = {
  basic: { name: 'Basic', monthly_credits: 500, price: 4.9, paypalPrice: "4.90", interval: "MONTH" },
  pro: { name: 'Pro', monthly_credits: -1, price: 9.9, paypalPrice: "9.90", interval: "MONTH" }
};

function cors(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
}

// Get PayPal API base URL based on mode
function getPayPalBaseUrl(mode: string): string {
  return mode === 'live' ? 'https://api.paypal.com' : 'https://api-m.sandbox.paypal.com';
}

// Get PayPal Access Token
async function getPayPalAccessToken(env: Env): Promise<string> {
  const clientId = env.PAYPAL_CLIENT_ID || '';
  const clientSecret = env.PAYPAL_CLIENT_SECRET || '';
  const mode = (env as any).PAYPAL_MODE || 'live';
  
  if (!clientId || !clientSecret) {
    throw new Error('PayPal credentials not configured');
  }
  
  // Use btoa for base64 encoding (compatible with Cloudflare Workers)
  const auth = btoa(`${clientId}:${clientSecret}`);
  const baseUrl = getPayPalBaseUrl(mode);
  
  const response = await fetch(`${baseUrl}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials'
  });
  
  const data = await response.json();
  
  if (!data.access_token) {
    throw new Error('Failed to get PayPal access token: ' + JSON.stringify(data));
  }
  
  return data.access_token;
}

// Create PayPal Order
async function createPayPalOrder(env: Env, amount: string, description: string, customId: string): Promise<{ orderId: string, approvalUrl: string }> {
  const accessToken = await getPayPalAccessToken(env);
  const mode = (env as any).PAYPAL_MODE || 'live';
  const baseUrl = getPayPalBaseUrl(mode);
  
  const response = await fetch(`${baseUrl}/v2/checkout/orders`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [{
        amount: {
          currency_code: 'USD',
          value: amount
        },
        description: description,
        custom_id: customId
      }]
    })
  });
  
  const order = await response.json();
  
  if (order.error || order.status === 'INSTRUMENT_DECLINED' || order.status === 'INTERNAL_SERVER_ERROR') {
    throw new Error('PayPal order creation failed: ' + JSON.stringify(order));
  }
  
  const approvalUrl = order.links?.find((link: any) => link.rel === 'approve')?.href;
  
  return {
    orderId: order.id,
    approvalUrl: approvalUrl || ''
  };
}

// Deliver credits to user
async function deliverCredits(env: Env, userId: string, packageIndex: number): Promise<void> {
  const pkg = CREDIT_PACKAGES[packageIndex];
  if (!pkg) {
    console.error('Invalid package index:', packageIndex);
    return;
  }

  // Add credits to user
  await env.DB.prepare(`
    INSERT INTO credits (user_id, amount, plan_type, expires_at)
    VALUES (?, ?, ?, datetime('now', '+' || ? || ' days'))
  `).bind(userId, pkg.credits, pkg.name, pkg.days).run();

  // Log the transaction
  await env.DB.prepare(`
    INSERT INTO transactions (user_id, type, amount, description, paypal_order_id)
    VALUES (?, 'credit_purchase', ?, ?, ?)
  `).bind(userId, pkg.credits, `${pkg.name} Package`, 'unknown').run();

  console.log(`Delivered ${pkg.credits} credits to user ${userId}`);
}

// Verify PayPal webhook signature
async function verifyPayPalWebhook(payload: string, headers: Headers, env: Env): Promise<boolean> {
  const headersObj = {
    'PAYPAL-AUTH-ALGO': headers.get('PAYPAL-AUTH-ALGO') || '',
    'PAYPAL-CERT-URL': headers.get('PAYPAL-CERT-URL') || '',
    'PAYPAL-TRANSMISSION-ID': headers.get('PAYPAL-TRANSMISSION-ID') || '',
    'PAYPAL-TRANSMISSION-SIG': headers.get('PAYPAL-TRANSMISSION-SIG') || '',
    'PAYPAL-TRANSMISSION-TIME': headers.get('PAYPAL-TRANSMISSION-TIME') || ''
  };

  // Check if webhook ID is configured
  if (!env.PAYPAL_WEBHOOK_ID) {
    console.log('PAYPAL_WEBHOOK_ID not configured, skipping verification');
    return true; // In demo mode, skip verification
  }

  try {
    const accessToken = await getPayPalAccessToken(env);
    const mode = (env as any).PAYPAL_MODE || 'live';
    const baseUrl = getPayPalBaseUrl(mode);
    
    const response = await fetch(`${baseUrl}/v1/notifications/verify-webhook-signature`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        auth_algo: headersObj['PAYPAL-AUTH-ALGO'],
        cert_url: headersObj['PAYPAL-CERT-URL'],
        transmission_id: headersObj['PAYPAL-TRANSMISSION-ID'],
        transmission_sig: headersObj['PAYPAL-TRANSMISSION-SIG'],
        transmission_time: headersObj['PAYPAL-TRANSMISSION-TIME'],
        webhook_id: env.PAYPAL_WEBHOOK_ID,
        webhook_event: JSON.parse(payload)
      })
    });

    const result = await response.json();
    return result.verification_status === 'SUCCESS';
  } catch (e) {
    console.error('Webhook verification error:', e);
    return false;
  }
}

// Deliver credits to user
async function deliverCreditsToUser(env: Env, userId: string, packageIndex: number): Promise<void> {
  const pkg = CREDIT_PACKAGES[packageIndex];
  if (!pkg) {
    console.error('Invalid package index:', packageIndex);
    return;
  }

  // Check if already delivered (prevent duplicate)
  const existing = await env.DB.prepare(
    "SELECT * FROM paypal_orders WHERE user_id = ? AND package_index = ? AND status = 'completed'"
  ).bind(userId, packageIndex).first();

  if (existing) {
    console.log('Credits already delivered for this order');
    return;
  }

  // Add credits
  await env.DB.prepare(`
    INSERT INTO credits (user_id, amount, plan_type, expires_at)
    VALUES (?, ?, ?, datetime('now', '+' || ? || ' days'))
  `).bind(userId, pkg.credits, pkg.name, pkg.days).run();

  console.log(`Delivered ${pkg.credits} credits to user ${userId}`);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, PAYPAL-AUTH-ALGO, PAYPAL-CERT-URL, PAYPAL-TRANSMISSION-ID, PAYPAL-TRANSMISSION-SIG, PAYPAL-TRANSMISSION-TIME'
        }
      });
    }

    // ============================================
    // PayPal Webhook Handler
    // ============================================
    if (url.pathname === "/api/paypal-webhook") {
      if (request.method !== "POST") {
        return cors({ error: "Method not allowed" }, 405);
      }

      try {
        const payload = await request.text();
        const headers = request.headers;
        const event = JSON.parse(payload);

        console.log('Webhook received:', event.event_type);

        // Verify webhook signature (skip in demo mode)
        // const isValid = await verifyPayPalWebhook(payload, headers, env);
        // if (!isValid) {
        //   return cors({ error: "Invalid webhook signature" }, 403);
        // }

        // Handle different event types
        switch (event.event_type) {
          case 'PAYMENT.CAPTURE.COMPLETED':
          case 'CHECKOUT.ORDER.APPROVED': {
            const orderId = event.resource?.id;
            const customId = event.resource?.custom_id || event.resource?.purchase_units?.[0]?.custom_id;
            
            console.log('Payment completed:', orderId, customId);

            if (customId && customId.startsWith('credits_')) {
              // Parse: credits_{uid}_{packageIndex}_{timestamp}
              const parts = customId.split('_');
              if (parts.length >= 3) {
                const userId = parts[1];
                const packageIndex = parseInt(parts[2]);

                // Update order status
                await env.DB.prepare(`
                  UPDATE paypal_orders 
                  SET status = 'completed', updated_at = datetime('now')
                  WHERE order_id = ?
                `).bind(orderId).run();

                // Deliver credits
                await deliverCreditsToUser(env, userId, packageIndex);
              }
            }
            break;
          }

          case 'PAYMENT.CAPTURE.DENIED':
          case 'PAYMENT.CAPTURE.DECLINED': {
            const orderId = event.resource?.id;
            console.log('Payment denied:', orderId);

            await env.DB.prepare(`
              UPDATE paypal_orders 
              SET status = 'failed', updated_at = datetime('now')
              WHERE order_id = ?
            `).bind(orderId).run();
            break;
          }

          case 'PAYMENT.CAPTURE.REFUNDED': {
            const orderId = event.resource?.id;
            console.log('Payment refunded:', orderId);

            await env.DB.prepare(`
              UPDATE paypal_orders 
              SET status = 'refunded', updated_at = datetime('now')
              WHERE order_id = ?
            `).bind(orderId).run();
            break;
          }

          default:
            console.log('Unhandled event type:', event.event_type);
        }

        return cors({ received: true });
      } catch (e) {
        console.error('Webhook processing error:', e);
        return cors({ error: "Webhook processing failed" }, 500);
      }
    }

    // Get plans info
    if (url.pathname === "/api/plans") {
      return cors({ plans: PLANS, packages: CREDIT_PACKAGES, subscriptions: SUBSCRIPTION_PLANS });
    }

    // Create PayPal order for credits
    if (url.pathname === "/api/create-order") {
      if (request.method !== "POST") return cors({ error: "Method not allowed" }, 405);
      try {
        const { uid, package_index } = await request.json();
        if (!uid) return cors({ error: "uid required" }, 400);

        const pkg = CREDIT_PACKAGES[package_index];
        if (!pkg) return cors({ error: "Invalid package" }, 400);

        const orderData = await createPayPalOrder(
          env,
          pkg.paypalPrice,
          `${pkg.name} Package - ${pkg.credits} Credits`,
          `credits_${uid}_${package_index}_${Date.now()}`
        );

        // Store pending order in DB
        await env.DB.prepare(`
          INSERT INTO paypal_orders (order_id, user_id, type, package_index, amount, status, custom_data)
          VALUES (?, ?, 'credits', ?, ?, 'pending', ?)
        `).bind(
          orderData.orderId,
          uid,
          package_index,
          pkg.credits,
          JSON.stringify({ package_name: pkg.name })
        ).run();

        return cors({ orderId: orderData.orderId, approvalUrl: orderData.approvalUrl });
      } catch (e: any) {
        console.error('Create order error:', e);
        return cors({ error: "Failed to create order", details: e.message }, 500);
      }
    }

    // Create PayPal subscription
    if (url.pathname === "/api/create-subscription") {
      if (request.method !== "POST") return cors({ error: "Method not allowed" }, 405);
      try {
        const { uid, plan } = await request.json();
        if (!uid) return cors({ error: "uid required" }, 400);

        const subPlan = SUBSCRIPTION_PLANS[plan as keyof typeof SUBSCRIPTION_PLANS];
        if (!subPlan) return cors({ error: "Invalid plan" }, 400);

        const accessToken = await getPayPalAccessToken(env);
        const mode = (env as any).PAYPAL_MODE || 'live';
        const baseUrl = getPayPalBaseUrl(mode);

        const response = await fetch(`${baseUrl}/v1/billing/subscriptions`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            plan_id: `PROVIDE_YOUR_PAYPAL_PLAN_ID_${plan}`,
            subscriber: { custom_id: uid },
            custom_id: `sub_${uid}_${plan}_${Date.now()}`
          })
        });

        const subData = await response.json();
        const approvalUrl = subData.links?.find((link: any) => link.rel === 'approve')?.href;

        return cors({ subscriptionId: subData.id, approvalUrl: approvalUrl || '' });
      } catch (e) {
        console.error('Create subscription error:', e);
        return cors({ error: "Failed to create subscription" }, 500);
      }
    }

    // PayPal return URL (after payment)
    if (url.pathname === "/api/paypal-return") {
      return new Response(null, {
        status: 302,
        headers: { 'Location': '/?payment=success' }
      });
    }

    // Check order status (for frontend polling)
    if (url.pathname === "/api/check-order") {
      const orderId = url.searchParams.get("orderId");
      if (!orderId) return cors({ error: "orderId required" }, 400);

      try {
        const localOrder = await env.DB.prepare("SELECT * FROM paypal_orders WHERE order_id = ?").bind(orderId).first();
        
        if (localOrder?.status === 'completed') {
          // Credits should already be delivered via webhook
          return cors({
            status: 'completed',
            credits: CREDIT_PACKAGES[localOrder.package_index as number]?.credits || 0
          });
        }

        return cors({
          status: localOrder?.status || 'unknown',
          credits: null
        });
      } catch (e) {
        return cors({ error: "Check failed" }, 500);
      }
    }

    // Record login & give welcome credits
    if (url.pathname === "/api/record-login") {
      if (request.method !== "POST") return cors({ error: "Method not allowed" }, 405);
      try {
        const { uid, email, name, picture } = await request.json();
        if (!uid || !email) return cors({ error: "uid and email required" }, 400);

        await env.DB.prepare(`
          INSERT INTO users (id, email, name, picture, last_login, usage_count)
          VALUES (?, ?, ?, ?, datetime('now'), 1)
          ON CONFLICT(id) DO UPDATE SET
            name = COALESCE(excluded.name, name),
            picture = COALESCE(excluded.picture, picture),
            last_login = datetime('now'),
            usage_count = usage_count + 1
        `).bind(uid, email, name || null, picture || null).run();

        const existing = await env.DB.prepare("SELECT * FROM credits WHERE user_id = ?").bind(uid).first();
        if (!existing) {
          await env.DB.prepare(`
            INSERT INTO credits (user_id, amount, plan_type, expires_at)
            VALUES (?, 3, 'welcome', datetime('now', '+30 days'))
          `).bind(uid).run();
        }

        return cors({ success: true });
      } catch (e) { return cors({ error: "Failed" }, 500); }
    }

    // Get user balance
    if (url.pathname === "/api/balance") {
      const uid = url.searchParams.get("uid");
      if (!uid) return cors({ error: "uid required" }, 400);

      const sub = await env.DB.prepare("SELECT * FROM subscriptions WHERE user_id = ? AND status = 'active'").bind(uid).first();
      const plan = sub ? PLANS[sub.plan as keyof typeof PLANS] : null;

      const credits = await env.DB.prepare(`
        SELECT SUM(amount) as total FROM credits 
        WHERE user_id = ? AND (expires_at IS NULL OR expires_at > datetime('now'))
      `).bind(uid).first();

      const balance = (credits?.total || 0) + (plan?.monthly_credits === -1 ? 999999 : (sub ? plan?.monthly_credits || 0 : 0));

      return cors({ balance, plan: plan?.name || 'free', unlimited: plan?.monthly_credits === -1 });
    }

    // Consume credit
    if (url.pathname === "/api/consume") {
      if (request.method !== "POST") return cors({ error: "Method not allowed" }, 405);
      try {
        const { uid } = await request.json();
        if (!uid) return cors({ error: "uid required" }, 400);

        const sub = await env.DB.prepare("SELECT * FROM subscriptions WHERE user_id = ? AND status = 'active'").bind(uid).first();
        const plan = sub ? PLANS[sub.plan as keyof typeof PLANS] : null;
        if (plan?.monthly_credits === -1) return cors({ success: true, unlimited: true });

        const credits = await env.DB.prepare(`
          SELECT * FROM credits 
          WHERE user_id = ? AND amount > 0 AND (expires_at IS NULL OR expires_at > datetime('now'))
          ORDER BY expires_at ASC LIMIT 1
        `).bind(uid).first();

        if (!credits && plan?.monthly_credits === 0) {
          return cors({ error: "No credits", purchase_required: true }, 403);
        }

        if (credits) {
          await env.DB.prepare("UPDATE credits SET amount = amount - 1 WHERE id = ?").bind(credits.id).run();
        }

        return cors({ success: true });
      } catch (e) { return cors({ error: "Failed" }, 500); }
    }

    // Get user info with stats
    if (url.pathname === "/api/user") {
      const uid = url.searchParams.get("uid");
      if (!uid) return cors({ error: "uid required" }, 400);

      const user = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(uid).first();
      if (!user) return cors({ error: "User not found" }, 404);

      const stats = await env.DB.prepare("SELECT COUNT(*) as count FROM usage_logs WHERE user_id = ?").bind(uid).first();
      const sub = await env.DB.prepare("SELECT * FROM subscriptions WHERE user_id = ? AND status = 'active'").bind(uid).first();
      const plan = sub ? PLANS[sub.plan as keyof typeof PLANS] : null;

      const credits = await env.DB.prepare(`
        SELECT SUM(amount) as total FROM credits 
        WHERE user_id = ? AND (expires_at IS NULL OR expires_at > datetime('now'))
      `).bind(uid).first();

      const totalCredits = (plan?.monthly_credits === -1 ? -1 : (credits?.total || 0) + (sub ? plan?.monthly_credits || 0 : 0));

      return cors({
        id: user.id,
        email: user.email,
        name: user.name,
        picture: user.picture,
        plan: plan?.name || 'free',
        balance: totalCredits,
        unlimited: plan?.monthly_credits === -1,
        total_usage: stats?.count || 0
      });
    }

    // Record usage
    if (url.pathname === "/api/record-usage") {
      if (request.method !== "POST") return cors({ error: "Method not allowed" }, 405);
      try {
        const { user_id, filename, original_size, original_width, original_height, enhanced_width, enhanced_height, scale } = await request.json();
        if (!user_id) return cors({ error: "user_id required" }, 400);

        await env.DB.prepare(`
          INSERT INTO usage_logs (user_id, filename, original_size, original_width, original_height, enhanced_width, enhanced_height, scale)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(user_id, filename || 'untitled', original_size || 0, original_width || 0, original_height || 0, enhanced_width || 0, enhanced_height || 0, scale || 2).run();

        return cors({ success: true });
      } catch (e) { return cors({ error: "Failed" }, 500); }
    }

    // Get user history
    if (url.pathname === "/api/user/history") {
      const uid = url.searchParams.get("uid");
      const limit = parseInt(url.searchParams.get("limit") || "10");
      if (!uid) return cors({ error: "uid required" }, 400);

      const history = await env.DB.prepare(`
        SELECT * FROM usage_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT ?
      `).bind(uid, limit).all();

      return cors(history.results);
    }

    // Get user stats
    if (url.pathname === "/api/user/stats") {
      const uid = url.searchParams.get("uid");
      if (!uid) return cors({ error: "uid required" }, 400);

      const total = await env.DB.prepare("SELECT COUNT(*) as count FROM usage_logs WHERE user_id = ?").bind(uid).first();
      const week = await env.DB.prepare("SELECT COUNT(*) as count FROM usage_logs WHERE user_id = ? AND created_at >= datetime('now', '-7 days')").bind(uid).first();

      return cors({ total_usage: total?.count || 0, week_usage: week?.count || 0 });
    }

    // Demo purchase (for testing without PayPal)
    if (url.pathname === "/api/purchase") {
      if (request.method !== "POST") return cors({ error: "Method not allowed" }, 405);
      try {
        const { uid, package_index } = await request.json();
        if (!uid) return cors({ error: "uid required" }, 400);

        const pkg = CREDIT_PACKAGES[package_index];
        if (!pkg) return cors({ error: "Invalid package" }, 400);

        await env.DB.prepare(`
          INSERT INTO credits (user_id, amount, plan_type, expires_at)
          VALUES (?, ?, ?, datetime('now', '+' || ? || ' days'))
        `).bind(uid, pkg.credits, pkg.name, pkg.days).run();

        return cors({ success: true, credits: pkg.credits, package: pkg.name });
      } catch (e) { return cors({ error: "Failed" }, 500); }
    }

    // Demo subscription
    if (url.pathname === "/api/subscribe") {
      if (request.method !== "POST") return cors({ error: "Method not allowed" }, 405);
      try {
        const { uid, plan } = await request.json();
        if (!uid) return cors({ error: "uid required" }, 400);

        if (!PLANS[plan as keyof typeof PLANS]) return cors({ error: "Invalid plan" }, 400);

        await env.DB.prepare(`
          INSERT INTO subscriptions (user_id, plan, status, expires_at)
          VALUES (?, ?, 'active', datetime('now', '+30 days'))
          ON CONFLICT(user_id) DO UPDATE SET plan = excluded.plan, status = 'active', expires_at = datetime('now', '+30 days')
        `).bind(uid, plan).run();

        return cors({ success: true, plan: PLANS[plan as keyof typeof PLANS].name });
      } catch (e) { return cors({ error: "Failed" }, 500); }
    }

    // Health check
    if (url.pathname === "/health") {
      return cors({ status: "ok", webhook_url: "https://image-enhancement-worker.feiz45607.workers.dev/api/paypal-webhook" });
    }

    return cors({ message: "Image Enhancement API" });
  },
} satisfies ExportedHandler<Env>;
