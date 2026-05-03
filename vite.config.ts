import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * 相対パスにすると GitHub Pages の /リポジトリ名/ 配下でも、ルートドメインでも
 * アセットが index.html から正しく解決され、真っ白（JS 未読込）を防げます。
 */
export default defineConfig({
  base: "./",
  plugins: [react()],
});
