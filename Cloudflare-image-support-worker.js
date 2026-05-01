export default {
  async fetch(req) {
    try {
      if (req.method !== "POST") {
        return new Response("POST only", { status: 405 });
      }

      // Accept key either as form field "key" or header "x-imgbb-key"
      const form = await req.formData();
      const file = form.get("file");
      const keyFromForm = form.get("key");
      const keyFromHeader = req.headers.get("x-imgbb-key");
      const imgbbKey = (keyFromForm && String(keyFromForm).trim()) || (keyFromHeader && String(keyFromHeader).trim());

      if (!file) return new Response("No file provided", { status: 400 });
      if (!imgbbKey) return new Response("No imgbb API key provided (form field 'key' or header 'x-imgbb-key')", { status: 400 });

      // Prepare new FormData for ImgBB
      const imgForm = new FormData();
      imgForm.append("image", file);

      // Call ImgBB with provided key
      const imgbbRes = await fetch(`https://api.imgbb.com/1/upload?key=${encodeURIComponent(imgbbKey)}`, {
        method: "POST",
        body: imgForm
      });

      const json = await imgbbRes.json();

      if (!json || !json.data || !json.data.url) {
        // Return ImgBB response in case of failure to help debugging (do not leak keys back to clients)
        return new Response(JSON.stringify({ error: "ImgBB returned unexpected response", raw: json }), { status: 500 });
      }

      // Return the URL with CORS headers
      return new Response(JSON.stringify({ url: json.data.url }), {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Content-Type": "application/json"
        }
      });
    } catch (err) {
      return new Response("Worker error:\n" + (err?.stack || String(err)), { status: 500 });
    }
  }
};
