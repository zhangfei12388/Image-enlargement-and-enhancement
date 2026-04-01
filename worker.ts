interface Env {
  AI: Ai;
  DB: D1Database;
}

// Pricing plans config
const PLANS = {
  free: {
    name: 'Free',
    price: 0,
    quota_2x: 10,
    quota_4x: 3,
    unlimited: false
  },
  pro: {
    name: 'Pro',
    price: 9.9,
    quota_2x: -1, // unlimited
    quota_4x: -1,
    unlimited: true
  }
};

function corsResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        },
      });
    }

    // Health check
    if (url.pathname === "/health") {
      return corsResponse({ status: "ok", plans: PLANS });
    }

    // Get plan info
    if (url.pathname === "/api/plans") {
      return corsResponse({ plans: PLANS });
    }

    // Record user login & init quota
    if (url.pathname === "/api/record-login") {
      if (request.method === "POST") {
        try {
          const body = await request.json();
          const { uid, email, name, picture } = body;

          if (!uid || !email) {
            return corsResponse({ error: "uid and email required" }, 400);
          }

          await env.DB.prepare(`
            INSERT INTO users (id, email, name, picture, last_login, usage_count, plan, quota_2x, quota_4x, quota_reset_date)
            VALUES (?, ?, ?, ?, datetime('now'), 1, 'free', 10, 3, date('now'))
            ON CONFLICT(id) DO UPDATE SET
              name = COALESCE(excluded.name, name),
              picture = COALESCE(excluded.picture, picture),
              last_login = datetime('now'),
              usage_count = usage_count + 1
          `).bind(uid, email, name || null, picture || null).run();

          return corsResponse({ success: true });
        } catch (e) {
          return corsResponse({ error: "Failed to record login" }, 500);
        }
      }
    }

    // Check quota
    if (url.pathname === "/api/check-quota") {
      const uid = url.searchParams.get("uid");
      const scale = parseInt(url.searchParams.get("scale") || "2");

      if (!uid) {
        return corsResponse({ error: "uid required" }, 400);
      }

      const user = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(uid).first();
      
      if (!user) {
        return corsResponse({ error: "User not found" }, 404);
      }

      // Check if quota needs reset (new day)
      const today = new Date().toISOString().split('T')[0];
      if (user.quota_reset_date !== today && user.plan === 'free') {
        // Reset daily quota
        await env.DB.prepare(`
          UPDATE users SET quota_2x = 10, quota_4x = 3, quota_reset_date = date('now') WHERE id = ?
        `).bind(uid).run();
        
        user.quota_2x = 10;
        user.quota_4x = 3;
      }

      const plan = PLANS[user.plan as keyof typeof PLANS] || PLANS.free;
      const quota = scale === 4 ? user.quota_4x : user.quota_2x;
      const hasQuota = plan.unlimited || quota > 0;

      return corsResponse({
        allowed: hasQuota,
        plan: user.plan,
        remaining_2x: plan.unlimited ? -1 : user.quota_2x,
        remaining_4x: plan.unlimited ? -1 : user.quota_4x,
        unlimited: plan.unlimited
      });
    }

    // Consume quota
    if (url.pathname === "/api/consume-quota") {
      if (request.method === "POST") {
        try {
          const body = await request.json();
          const { uid, scale } = body;

          if (!uid) {
            return corsResponse({ error: "uid required" }, 400);
          }

          const user = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(uid).first();
          
          if (!user) {
            return corsResponse({ error: "User not found" }, 404);
          }

          // Pro users have unlimited
          if (user.plan === 'pro') {
            return corsResponse({ success: true, unlimited: true });
          }

          // Check and consume quota
          const today = new Date().toISOString().split('T')[0];
          if (user.quota_reset_date !== today) {
            await env.DB.prepare(`
              UPDATE users SET quota_2x = 10, quota_4x = 3, quota_reset_date = date('now') WHERE id = ?
            `).bind(uid).run();
            user.quota_2x = 10;
            user.quota_4x = 3;
          }

          const quotaField = scale === 4 ? 'quota_4x' : 'quota_2x';
          const currentQuota = scale === 4 ? user.quota_4x : user.quota_2x;

          if (currentQuota <= 0) {
            return corsResponse({ error: "Quota exhausted", upgrade_required: true }, 403);
          }

          await env.DB.prepare(`UPDATE users SET ${quotaField} = ${quotaField} - 1 WHERE id = ?`).bind(uid).run();

          return corsResponse({ success: true });
        } catch (e) {
          return corsResponse({ error: "Failed to consume quota" }, 500);
        }
      }
    }

    // Get user info
    if (url.pathname === "/api/user") {
      const uid = url.searchParams.get("uid");
      if (!uid) {
        return corsResponse({ error: "uid required" }, 400);
      }

      const user = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(uid).first();
      if (!user) {
        return corsResponse({ error: "User not found" }, 404);
      }

      const stats = await env.DB.prepare(
        "SELECT COUNT(*) as total_usage FROM usage_logs WHERE user_id = ?"
      ).bind(uid).first();

      // Check quota reset
      const today = new Date().toISOString().split('T')[0];
      if (user.quota_reset_date !== today && user.plan === 'free') {
        await env.DB.prepare(`
          UPDATE users SET quota_2x = 10, quota_4x = 3, quota_reset_date = date('now') WHERE id = ?
        `).bind(uid).run();
        user.quota_2x = 10;
        user.quota_4x = 3;
      }

      const plan = PLANS[user.plan as keyof typeof PLANS] || PLANS.free;

      return corsResponse({
        id: user.id,
        email: user.email,
        name: user.name,
        picture: user.picture,
        plan: user.plan,
        plan_name: plan.name,
        total_usage: stats?.total_usage || 0,
        remaining_2x: plan.unlimited ? -1 : user.quota_2x,
        remaining_4x: plan.unlimited ? -1 : user.quota_4x,
        unlimited: plan.unlimited,
        quota_reset_date: user.quota_reset_date
      });
    }

    // Upgrade user (simplified - in production use Stripe)
    if (url.pathname === "/api/upgrade") {
      if (request.method === "POST") {
        try {
          const body = await request.json();
          const { uid } = body;

          if (!uid) {
            return corsResponse({ error: "uid required" }, 400);
          }

          await env.DB.prepare(`
            UPDATE users SET plan = 'pro', quota_2x = -1, quota_4x = -1 WHERE id = ?
          `).bind(uid).run();

          return corsResponse({ success: true, plan: 'pro' });
        } catch (e) {
          return corsResponse({ error: "Failed to upgrade" }, 500);
        }
      }
    }

    // Get user usage history
    if (url.pathname === "/api/user/history") {
      const uid = url.searchParams.get("uid");
      const limit = parseInt(url.searchParams.get("limit") || "10");
      
      if (!uid) {
        return corsResponse({ error: "uid required" }, 400);
      }

      const history = await env.DB.prepare(`
        SELECT * FROM usage_logs 
        WHERE user_id = ? 
        ORDER BY created_at DESC 
        LIMIT ?
      `).bind(uid, limit).all();

      return corsResponse(history.results);
    }

    // Record usage
    if (url.pathname === "/api/record-usage") {
      if (request.method === "POST") {
        try {
          const body = await request.json();
          const { user_id, filename, original_size, original_width, original_height, enhanced_width, enhanced_height, scale } = body;

          if (!user_id) {
            return corsResponse({ error: "user_id required" }, 400);
          }

          await env.DB.prepare(`
            INSERT INTO usage_logs (user_id, filename, original_size, original_width, original_height, enhanced_width, enhanced_height, scale)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `).bind(
            user_id,
            filename || 'untitled',
            original_size || 0,
            original_width || 0,
            original_height || 0,
            enhanced_width || 0,
            enhanced_height || 0,
            scale || 2
          ).run();

          return corsResponse({ success: true });
        } catch (e) {
          return corsResponse({ error: "Failed to record usage" }, 500);
        }
      }
    }

    // Get user statistics
    if (url.pathname === "/api/user/stats") {
      const uid = url.searchParams.get("uid");
      
      if (!uid) {
        return corsResponse({ error: "uid required" }, 400);
      }

      const totalResult = await env.DB.prepare(
        "SELECT COUNT(*) as count FROM usage_logs WHERE user_id = ?"
      ).bind(uid).first();

      const todayResult = await env.DB.prepare(
        "SELECT COUNT(*) as count FROM usage_logs WHERE user_id = ? AND date(created_at) = date('now')"
      ).bind(uid).first();

      const weekResult = await env.DB.prepare(
        "SELECT COUNT(*) as count FROM usage_logs WHERE user_id = ? AND created_at >= datetime('now', '-7 days')"
      ).bind(uid).first();

      const pixelsResult = await env.DB.prepare(
        "SELECT SUM(original_width * original_height) as total_original_pixels, SUM(enhanced_width * enhanced_height) as total_enhanced_pixels FROM usage_logs WHERE user_id = ?"
      ).bind(uid).first();

      return corsResponse({
        total_usage: totalResult?.count || 0,
        today_usage: todayResult?.count || 0,
        week_usage: weekResult?.count || 0,
        total_original_pixels: pixelsResult?.total_original_pixels || 0,
        total_enhanced_pixels: pixelsResult?.total_enhanced_pixels || 0,
      });
    }

    // Get all users (admin)
    if (url.pathname === "/api/users") {
      const result = await env.DB.prepare(
        "SELECT id, email, name, plan, first_login, last_login, usage_count FROM users ORDER BY last_login DESC LIMIT 100"
      ).all();
      return corsResponse(result.results);
    }

    return corsResponse({ 
      message: "Image Enhancement API",
      endpoints: ["/api/plans", "/api/check-quota", "/api/upgrade", "/api/user", "/api/user/stats", "/api/user/history"]
    });
  },
} satisfies ExportedHandler<Env>;
