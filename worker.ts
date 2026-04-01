interface Env {
  AI: Ai;
  DB: D1Database;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // CORS
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
      });
    }

    // Health check
    if (url.pathname === "/health") {
      return Response.json({ status: "ok", timestamp: new Date().toISOString() });
    }

    // Record user login
    if (url.pathname === "/api/record-login") {
      if (request.method === "POST") {
        try {
          const body = await request.json();
          const { uid, email, name, picture } = body;

          if (!uid || !email) {
            return Response.json({ error: "uid and email required" }, { status: 400 });
          }

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

          return Response.json({ success: true });
        } catch (e) {
          return Response.json({ error: "Failed to record login" }, { status: 500 });
        }
      }
    }

    // Get user info
    if (url.pathname === "/api/user") {
      const uid = url.searchParams.get("uid");
      if (!uid) {
        return Response.json({ error: "uid required" }, { status: 400 });
      }

      const result = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(uid).first();
      return Response.json(result || { error: "User not found" });
    }

    // Get all users (admin)
    if (url.pathname === "/api/users") {
      const result = await env.DB.prepare("SELECT id, email, name, first_login, last_login, usage_count FROM users ORDER BY last_login DESC LIMIT 100").all();
      return Response.json(result.results);
    }

    // Image processing with Workers AI (if available)
    if (request.method === "POST" && url.pathname === "/process") {
      try {
        const formData = await request.formData();
        const imageFile = formData.get("image") as File;
        const scale = parseInt(formData.get("scale") as string) || 2;
        const userId = formData.get("userId") as string;

        if (!imageFile) {
          return Response.json({ error: "No image provided" }, { status: 400 });
        }

        // Check if user exists, if not return error
        if (userId) {
          const user = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(userId).first();
          if (!user) {
            return Response.json({ error: "User not found. Please log in again." }, { status: 401 });
          }
        }

        // Get image as base64
        const arrayBuffer = await imageFile.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);
        const binary = Array.from(bytes, (b) => String.fromCharCode(b)).join("");
        const base64Image = btoa(binary);
        const mimeType = imageFile.type || "image/png";
        const dataUrl = `data:${mimeType};base64,${base64Image}`;

        // Try Workers AI (Real-ESRGAN or similar)
        let aiResult = null;
        try {
          // Check if AI is available by trying a simple model
          const models = await env.AI.models.list();
          if (models && models.length > 0) {
            // Try Real-ESRGAN
            const inputs = {
              image: dataUrl,
              scale: scale
            };
            
            try {
              aiResult = await env.AI.run("@cf/lmedia/real-esrgan-x2", inputs);
            } catch (e1) {
              try {
                aiResult = await env.AI.run("@cf/lmedia/real-esrgan-x4", inputs);
              } catch (e2) {
                // Real-ESRGAN not available, try alternative
                console.log("Real-ESRGAN not available, trying alternative...");
              }
            }
          }
        } catch (e) {
          console.log("Workers AI not available:", e.message);
        }

        // If AI result is base64, return it directly
        if (aiResult && typeof aiResult === 'object' && aiResult.image) {
          return Response.json({ 
            image: aiResult.image,
            method: "ai",
            scale: scale
          });
        }

        // Fallback: Return original for browser-side upscaling
        return Response.json({ 
          image: dataUrl,
          method: "browser",
          scale: scale,
          message: "AI upscaling not available, using browser-side interpolation"
        });

      } catch (e) {
        return Response.json({ error: "Processing failed: " + e.message }, { status: 500 });
      }
    }

    return Response.json({ 
      message: "Image Enhancement API",
      endpoints: {
        "POST /process": "Process image (form: image, scale, userId)",
        "POST /api/record-login": "Record user login (json: uid, email, name, picture)",
        "GET /api/user?uid=<uid>": "Get user info",
        "GET /api/users": "List all users (admin)"
      }
    });
  },
} satisfies ExportedHandler<Env>;
