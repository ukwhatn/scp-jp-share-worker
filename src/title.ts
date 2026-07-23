/**
 * OGP画像生成のためのタイトル解釈ヘルパー。
 * Workerのランタイム依存（WASM等）を持たない純関数のみを配置し、単体テスト可能に保つ。
 */

/**
 * Wikidotページの生HTMLから、SCPタグ (`<a href="/system:page-tags/tag/scp#pages">scp</a>`) の有無を判定する。
 * hrefパターン一致で見るのは、タグ名の部分一致（"scp" を含む他タグ）による誤検出を避けるため。
 */
export function detectScpTag(html: string): boolean {
	return /href="\/system:page-tags\/tag\/scp#pages"/.test(html);
}

/**
 * SCPタグ付きタイトルを「最初の ' - '」で番号部分とメタタイトル部分に分割する。
 * SCPタグ無し or ' - ' 未含有の場合はタイトル全体を title として返し、subtitle は null。
 */
export function splitTitle(fullTitle: string, hasScpTag: boolean): { title: string; subtitle: string | null } {
	if (!hasScpTag) {
		return { title: fullTitle, subtitle: null };
	}
	const idx = fullTitle.indexOf(" - ");
	if (idx === -1) {
		return { title: fullTitle, subtitle: null };
	}
	return {
		title: fullTitle.substring(0, idx),
		subtitle: fullTitle.substring(idx + 3),
	};
}
