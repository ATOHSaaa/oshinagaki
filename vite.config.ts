import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * GitHub Pages のプロジェクトサイトは /リポジトリ名/ で配信される。
 * GitHub Actions では GITHUB_REPOSITORY が自動で入る（例: owner/oshinagaki）。
 * ローカルでは未設定のため base は "/" のまま。
 */
const repo = process.env.GITHUB_REPOSITORY?.split("/")[1];
const base = repo ? `/${repo}/` : "/";

export default defineConfig({
  base,
  plugins: [react()],
});
