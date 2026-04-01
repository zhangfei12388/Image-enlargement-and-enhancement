interface Env {
  AI: Ai;
  DB: D1Database;
}

// Helper to add CORS headers
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

    // CORS preflight
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
      return corsResponse({ status: "ok", timestamp: new Date().toISOString() });
    }

    // Record user login
    if (url.pathname === "/api/record-login") {
      if (request.method === "POST") {
        try {
          const body = await request.json();
          const { uid, email, name, picture } = body;

          if (!uid || !email) {
            return corsResponse({ error: "uid and email required" }, 400);
          }

          await env.DB.prepare(`
            INSERT INTO users (id, email, name, picture, last_login, usage_count)
            VALUES (?, ?, ?, ?, datetime('now'), 1)
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

      return corsResponse({
        ...user,
        total_usage: stats?.total_usage || 0
      });
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
        storage_saved: pixelsResult?.total_enhanced_pixels ? 
          Math.round((1 - pixelsResult.total_original_pixels / pixelsResult.total_enhanced_pixels) * 100) : 0
      });
    }

    // Get all users
    if (url.pathname === "/api/users") {
      const result = await env.DB.prepare(
        "SELECT id, email, name, picture, first_login, last_login, usage_count FROM users ORDER BY last_login DESC LIMIT 100"
      ).all();
      return corsResponse(result.results);
    }

    return corsResponse({ 
      message: "Image Enhancement API",
      endpoints: {
        "POST /api/record-login": "Record user login",
        "GET /api/user?uid=<uid>": "Get user info",
        "GET /api/user/history?uid=<uid>&limit=<n>": "Get usage history",
        "GET /api/user/stats?uid=<uid>": "Get user statistics",
        "POST /api/record-usage": "Record usage"
      }
    });
  },
} satisfies ExportedHandler<Env>;
