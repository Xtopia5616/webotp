import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";
import basicSsl from "@vitejs/plugin-basic-ssl";
import { paraglide } from "@inlang/paraglide-vite";

export default defineConfig({
  plugins: [
    paraglide({
      project: "./project.inlang",
      outdir: "./src/paraglide",
    }),
    sveltekit(),
    basicSsl(), // Required for WebAuthn PRF development
  ],
  server: {
    https: true, // Enable HTTPS locally
  },
});
