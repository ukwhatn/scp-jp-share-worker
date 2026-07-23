import { defineConfig } from 'vitest/config';

// 純関数の単体テスト用に最小構成。Workers ランタイムを要するテストを追加する際は、
// @cloudflare/vitest-pool-workers が vitest 4 対応した後に defineWorkersConfig へ戻すこと。
export default defineConfig({
	test: {},
});
