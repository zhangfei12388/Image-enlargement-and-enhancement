export interface Env {
  ASSETS: R2Bucket;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    let path = url.pathname;

    // Default to index.html for root
    if (path === "/") {
      path = "/index.html";
    }

    // Try to get from R2 bucket
    const object = await env.ASSETS.get(path);

    if (object) {
      return new Response(object.body, {
        headers: {
          "Content-Type": getContentType(path),
          "Cache-Control": "public, max-age=31536000, immutable",
        },
      });
    }

    // Try index.html for SPA routing
    const indexObject = await env.ASSETS.get("/index.html");
    if (indexObject) {
      return new Response(indexObject.body, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "public, max-age=31536000, immutable",
        },
      });
    }

    // 404
    return new Response("Not Found", { status: 404 });
  },
};

function getContentType(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase();
  const types: Record<string, string> = {
    html: "text/html; charset=utf-8",
    js: "application/javascript",
    css: "text/css",
    json: "application/json",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    svg: "image/svg+xml",
    ico: "image/x-icon",
    txt: "text/plain",
  };
  return types[ext || ""] || "application/octet-stream";
}
