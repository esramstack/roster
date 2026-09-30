import { defineConfig } from "vite";

const SUPABASE_URL = "https://kpjynehmvmapyywjhyqj.supabase.co";

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      // Same-origin proxy so saves work from localhost AND LAN IPs (no CORS).
      "/api/dsa": {
        target: SUPABASE_URL,
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/api\/dsa/, "/functions/v1/dsa-api"),
      },
    },
  },
  preview: {
    port: 5173,
    proxy: {
      "/api/dsa": {
        target: SUPABASE_URL,
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/api\/dsa/, "/functions/v1/dsa-api"),
      },
    },
  },
});
