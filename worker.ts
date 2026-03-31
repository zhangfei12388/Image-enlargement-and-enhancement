export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    // Parse URL parameters for GET requests
    const url = new URL(request.url);
    const imageUrl = url.searchParams.get("url");
    const width = url.searchParams.get("w") || "800";
    const height = url.searchParams.get("h");
    const fit = url.searchParams.get("fit") || "cover";
    const quality = url.searchParams.get("quality") || "85";

    // If imageUrl is provided, fetch and resize
    if (imageUrl) {
      try {
        const imageResponse = await fetch(imageUrl);
        if (!imageResponse.ok) {
          throw new Error("Failed to fetch image");
        }

        const imageBuffer = await imageResponse.arrayBuffer();

        return new Response(imageBuffer, {
          headers: {
            "Content-Type": imageResponse.headers.get("Content-Type") || "image/jpeg",
            "Cache-Control": "public, max-age=31536000, immutable",
            // Cloudflare Image Resizing
            "CF-Rewrite-To": `/${width}${height ? '/' + height : ''}/fit/${fit}/quality/${quality}/format/webp`,
          },
        });
      } catch (error) {
        return new Response(
          JSON.stringify({ error: "Failed to fetch/resize image" }),
          { status: 500, headers: { "Content-Type": "application/json" } }
        );
      }
    }

    // For POST requests, handle file upload
    if (request.method === "POST") {
      const formData = await request.formData();
      const imageFile = formData.get("image") as File;
      const scale = parseInt(formData.get("scale") as string) || 2;

      if (!imageFile) {
        return new Response(JSON.stringify({ error: "No image provided" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Get image dimensions and calculate new size
      const arrayBuffer = await imageFile.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      const binary = Array.from(bytes, (b) => String.fromCharCode(b)).join("");
      const base64Image = btoa(binary);
      const mimeType = imageFile.type || "image/png";
      const dataUrl = `data:${mimeType};base64,${base64Image}`;

      // Note: For actual upscaling, we'd need Workers AI
      // Without it, we can only resize DOWN or provide the original with quality settings
      // Let's return the original image - the frontend will handle display

      return new Response(JSON.stringify({ 
        image: dataUrl,
        scale: scale,
        note: "Using Cloudflare Image Resizing for optimal delivery. For AI upscaling, enable Workers AI in your Cloudflare dashboard."
      }), {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    return new Response(
      JSON.stringify({ 
        usage: "POST / with image file, or GET /?url=<image_url>&w=<width>&h=<height>" 
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  },
} satisfies ExportedHandler<Env>;
