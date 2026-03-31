export interface Env {
  AI: Ai;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    try {
      const formData = await request.formData();
      const imageFile = formData.get("image") as File;
      const scale = parseInt(formData.get("scale") as string) || 2;

      if (!imageFile) {
        return new Response(JSON.stringify({ error: "No image provided" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Convert file to base64
      const arrayBuffer = await imageFile.arrayBuffer();
      const base64Image = btoa(
        new Uint8Array(arrayBuffer).reduce(
          (data, byte) => data + String.fromCharCode(byte),
          ""
        )
      );
      const mimeType = imageFile.type || "image/png";
      const dataUrl = `data:${mimeType};base64,${base64Image}`;

      // Prepare the AI prompt with scale factor
      const prompt = `upscale by ${scale}x, enhance details, improve quality, high quality, sharp, clear`;

      // Call Cloudflare Workers AI Real-ESRGAN model
      const result = await env.AI.run("@cf/unum/uform-gen2-q4", {
        image: dataUrl,
        prompt,
      });

      // Get the enhanced image from response
      const enhancedImage = result.image;
      
      if (!enhancedImage) {
        return new Response(
          JSON.stringify({ error: "AI processing failed - no image returned" }),
          {
            status: 500,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      return new Response(JSON.stringify({ image: enhancedImage }), {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      });
    } catch (error) {
      console.error("Enhancement error:", error);
      return new Response(
        JSON.stringify({
          error: error instanceof Error ? error.message : "Processing failed",
        }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        }
      );
    }
  },
};
