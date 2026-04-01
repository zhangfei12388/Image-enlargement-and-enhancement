interface Env {
  AI: Ai;
  DB: D1Database;
}

// Pricing Plans
const PLANS = {
  free: { name: 'Free', monthly_credits: 3, price: 0 },
  basic: { name: 'Basic', monthly_credits: 500, price: 4.9 },
  pro: { name: 'Pro', monthly_credits: -1, price: 9.9 }
};

// Credit Packages
const CREDIT_PACKAGES = [
  { name: 'Starter', credits: 30, price: 0.5, days: 30 },
  { name: 'Small', credits: 100, price: 1, days: 30 },
  { name: 'Medium', credits: 500, price: 4, days: 90 },
  { name: 'Large', credits: 1000, price: 7, days: 180 },
  { name: 'Team', credits: 5000, price: 25, days: 365 }
];

function cors(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }
      });
    }

    // Get plans info
    if (url.pathname === "/api/plans") {
      return cors({ plans: PLANS, packages: CREDIT_PACKAGES });
    }

    // Record login & give welcome credits
    if (url.pathname === "/api/record-login") {
      if (request.method !== "POST") return cors({ error: "Method not allowed" }, 405);
      try {
        const { uid, email, name, picture } = await request.json();
        if (!uid || !email) return cors({ error: "uid and email required" }, 400);

        // Upsert user
        await env.DB.prepare(`
          INSERT INTO users (id, email, name, picture, last_login, usage_count)
          VALUES (?, ?, ?, ?, datetime('now'), 1)
          ON CONFLICT(id) DO UPDATE SET
            name = COALESCE(excluded.name, name),
            picture = COALESCE(excluded.picture, picture),
            last_login = datetime('now'),
            usage_count = usage_count + 1
        `).bind(uid, email, name || null, picture || null).run();

        // Give welcome credits if first login
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

      // Get subscription
      const sub = await env.DB.prepare("SELECT * FROM subscriptions WHERE user_id = ? AND status = 'active'").bind(uid).first();
      const plan = sub ? PLANS[sub.plan as keyof typeof PLANS] : null;

      // Get credit balance
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

        // Check subscription first
        const sub = await env.DB.prepare("SELECT * FROM subscriptions WHERE user_id = ? AND status = 'active'").bind(uid).first();
        const plan = sub ? PLANS[sub.plan as keyof typeof PLANS] : null;
        if (plan?.monthly_credits === -1) return cors({ success: true, unlimited: true });

        // Check credits
        const credits = await env.DB.prepare(`
          SELECT * FROM credits 
          WHERE user_id = ? AND amount > 0 AND (expires_at IS NULL OR expires_at > datetime('now'))
          ORDER BY expires_at ASC LIMIT 1
        `).bind(uid).first();

        if (!credits && plan?.monthly_credits === 0) {
          return cors({ error: "No credits", purchase_required: true }, 403);
        }

        // Deduct credit
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

    // Simulate purchase (in production, this would be after PayPal/Stripe webhook)
    if (url.pathname === "/api/purchase") {
      if (request.method !== "POST") return cors({ error: "Method not allowed" }, 405);
      try {
        const { uid, package_index } = await request.json();
        if (!uid) return cors({ error: "uid required" }, 400);

        const pkg = CREDIT_PACKAGES[package_index];
        if (!pkg) return cors({ error: "Invalid package" }, 400);

        // Add credits
        await env.DB.prepare(`
          INSERT INTO credits (user_id, amount, plan_type, expires_at)
          VALUES (?, ?, ?, datetime('now', '+' || ? || ' days'))
        `).bind(uid, pkg.credits, pkg.name, pkg.days).run();

        return cors({ success: true, credits: pkg.credits, package: pkg.name });
      } catch (e) { return cors({ error: "Failed" }, 500); }
    }

    // Simulate subscription
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
      return cors({ status: "ok", plans: PLANS, packages: CREDIT_PACKAGES });
    }

    return cors({ message: "Image Enhancement API" });
  },
} satisfies ExportedHandler<Env>;
