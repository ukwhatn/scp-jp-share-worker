/**
 * Cloudflare Workers上で動作する動的OGP画像生成サービス。
 * SatoriとResvgを利用して、リクエストパラメータに基づいたカスタムOGP画像を生成します。
 *
 * エンドポイント:
 * - `/image`: パラメータに基づいてOGP画像を生成し、PNG形式で返却します。
 * - `/share`: OGPタグが埋め込まれたHTMLを生成し、指定されたページへリダイレクトさせます。
 * これにより、SNSなどでリッチなプレビューが表示されるようになります。
 */

// OGP画像生成ライブラリ
import satori, {init} from "satori/wasm";
import initYoga from "yoga-wasm-web";
import {initWasm, Resvg} from "@resvg/resvg-wasm";

// --- WASMモジュールのインポート ---
// wrangler.tomlでの設定が複雑なため、ここではビルド時にnode_modulesから直接WASMファイルを
// 読み込むように相対パスで指定しています。TypeScriptの型チェックエラーを回避するため、
// ts-ignoreを使用しています。
// @ts-ignore
import yogaWasm from '../node_modules/yoga-wasm-web/dist/yoga.wasm';
// @ts-ignore
import resvgWasm from '../node_modules/@resvg/resvg-wasm/index_bg.wasm'

// --- ライブラリの初期化 ---
// SatoriとResvgが内部で使用するWASMモジュールを初期化します。
// この処理はWorkerのグローバルスコープで一度だけ実行されます。
init(await initYoga(yogaWasm as WebAssembly.Module));
await initWasm(resvgWasm);


// --- グローバルキャッシュ ---
// 一度R2から取得したアセットをメモリ上にキャッシュし、後続のリクエストでのR2へのアクセスを削減します。

/**
 * フォントデータを格納するキャッシュオブジェクト。
 * @key variant名
 * @value フォントファイルのArrayBuffer
 */
let fontArrBufDict: Record<string, ArrayBuffer> = {};

/**
 * 背景画像データを格納するキャッシュオブジェクト。
 * @key variant名
 * @value 背景画像のArrayBuffer
 */
let backgroundImageBufDict: Record<string, ArrayBuffer> = {};


// --- 型定義 ---

/**
 * Cloudflare WorkersのHandler型を拡張し、
 * wrangler.tomlでバインディングしたR2 Bucket (`OGP_BUCKET`) を
 * `env`オブジェクトのプロパティとして型付けします。
 */
type Handler = ExportedHandler<{
	OGP_BUCKET: R2Bucket
}>;

/**
 * OGP画像のバリアント（デザインの種別）ごとの設定を定義するインターフェース。
 */
interface OGPVariant {
	backgroundImage: string; // R2上の背景画像ファイルパス
	fontFile: string;        // R2上のフォントファイルパス
	font: string;            // CSSのfont-family名
	fontWeight: number;      // フォントの太さ
	textColor: string;       // テキストの色
	textShadow: string;      // テキストシャドウのCSS値
}

/**
 * OGPバリアント設定をまとめるオブジェクトの型。
 * キーとしてバリアント名（例: "normal"）を持つ。
 */
interface OGPVariants {
	[variant: string]: OGPVariant;
}

// --- 定数定義 ---

/**
 * 利用可能なOGP画像のバリアント一覧。
 * クエリパラメータ `variant` で指定された値に対応する設定がここから参照されます。
 */
const OGP_VARIANTS: OGPVariants = {
	"normal": {
		"backgroundImage": "bgs/ogp-bg-normal.png",
		"fontFile": "fonts/NotoSansJP-Black.ttf",
		"font": "Noto Sans JP",
		"fontWeight": 900,
		"textColor": "#bc002d",
		"textShadow": "none",
	},
	"event25-time01": {
		"backgroundImage": "bgs/ogp-bg-event25-time01.png",
		"fontFile": "fonts/NotoSansJP-Black.ttf",
		"font": "Noto Sans JP",
		"fontWeight": 900,
		"textColor": "#fff",
		"textShadow": "0 0 10px rgba(0, 0, 0, 0.7)",
	}
}

/**
 * フォントサイズ計算や行分割で使用する共通オプション。
 */
const FONT_OPTIONS = {
	maxWidth: 700,         // テキスト表示領域の最大幅 (px)
	avgCharWidthRatio: 0.7, // フォントサイズに対する平均的な文字幅の比率（経験則に基づく調整値）
};

// --- メインハンドラ ---

const handler: Handler = {
	/**
	 * Cloudflare Workers のエントリーポイント。すべてのリクエストをここで処理します。
	 * @param request - 受信したリクエストオブジェクト
	 * @param env - 環境変数やバインディング（R2など）を含むオブジェクト
	 * @returns レスポンスオブジェクト
	 */
	fetch: async (request, env) => {
		const {pathname, searchParams, origin} = new URL(request.url);

		// =============================================
		// 1. 画像生成エンドポイント (/image)
		// =============================================
		if (pathname === '/image') {
			// --- キャッシュの確認 ---
			const fullUrl = new URL(request.url).toString();
			// URLが長すぎる場合に備えてハッシュ化
			const encoder = new TextEncoder();
			const data = encoder.encode(fullUrl);
			const hashBuffer = await crypto.subtle.digest('SHA-256', data);
			const hashArray = Array.from(new Uint8Array(hashBuffer));
			const cacheKey = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

			// `nocache=true` が指定されているかどうかを確認
			const noCacheFlag = searchParams.get("nocache") === "true";

			// `nocache=true` が指定されていない場合、まずR2のキャッシュを確認
			if (!noCacheFlag) {
				const cache = await env.OGP_BUCKET.get(`image-cache/${cacheKey}`);
				if (cache) {
					// キャッシュヒットした場合、その画像を返す
					return new Response(cache.body, {
						headers: {
							"Content-Type": "image/png",
							"X-R2-Cache": "HIT", // カスタムヘッダでキャッシュヒットを通知
						},
					});
				}
			}

			// --- リクエストパラメータの解析 ---
			const paramPage = searchParams.get("page");

			// ページにアクセスして #page-title のinnerText を取得する
			if (!paramPage || paramPage.length === 0) {
				return new Response("Page parameter is required", {status: 400});
			}
			// ページタイトルを取得するためのURLを構築
			const pageUrl = `http://pseudo-scp-jp.wikidot.com/${encodeURIComponent(paramPage)}`;
			const pageResponse = await fetch(pageUrl);
			if (!pageResponse.ok) {
				return new Response(`Failed to fetch page: ${pageUrl}`, {status: pageResponse.status});
			}
			const pageText = await pageResponse.text();
			// ページのHTMLからタイトルを抽出
			/*
                        <div id="page-title">
                            Share X Normal
                        </div>
			 */
			const titleMatch = pageText.match(/<div id="page-title">\s*([^<]+)\s*<\/div>/);
			if (!titleMatch || titleMatch.length < 2) {
				return new Response("Failed to extract page title", {status: 500});
			}
			// ページタイトルを取得
			const pageTitle = titleMatch[1].trim();
			// ページタイトルをエスケープしてHTML特殊文字を処理
			const escapedTitle = escapeHtml(pageTitle);
			// ページタイトルをログに出力
			console.log(`Extracted page title: "${escapedTitle}"`);

			// SCP記事のタイトル形式 (`SCP-xxxx-JP - ZZZZZ`) を特別扱いし、
			// 番号部分 (title) と副題部分 (subtitle) に分割する
			const scpTitleRegex = /^(SCP-\d{3,4}-JP) - (.+)/;
			const isSCPTitle = scpTitleRegex.test(escapedTitle);
			let title, subtitle;
			if (isSCPTitle) {
				const match = escapedTitle.match(scpTitleRegex);
				title = match![1];
				subtitle = match![2];
			} else {
				title = escapedTitle;
				subtitle = searchParams.get("subtitle");
			}

			// バリアントの指定を取得 (デフォルトは "normal")
			const variant = searchParams.get("variant") || "normal";
			if (!(variant in OGP_VARIANTS)) {
				return new Response("Variant not found", {status: 404});
			}

			console.log(`Generating OGP image for title: "${title}", subtitle: "${subtitle || ''}", variant: "${variant}"`);

			// --- アセットの取得 (フォントと背景) ---
			// メモリキャッシュを確認し、なければR2から取得する
			if (!(variant in fontArrBufDict)) {
				const fontObj = await env.OGP_BUCKET.get(OGP_VARIANTS[variant].fontFile);
				if (!fontObj) {
					return new Response(`Failed to fetch font file: ${OGP_VARIANTS[variant].fontFile}`, {status: 500});
				}
				fontArrBufDict[variant] = await fontObj.arrayBuffer();
			}

			if (!(variant in backgroundImageBufDict)) {
				const bgImageObj = await env.OGP_BUCKET.get(OGP_VARIANTS[variant].backgroundImage);
				if (!bgImageObj) {
					return new Response(`Failed to fetch background image: ${OGP_VARIANTS[variant].backgroundImage}`, {status: 500});
				}
				backgroundImageBufDict[variant] = await bgImageObj.arrayBuffer();
			}

			// アセットが正しくロードできたか最終確認
			const fontArrBuf = fontArrBufDict[variant];
			const backgroundImageBuf = backgroundImageBufDict[variant];
			if (!fontArrBuf || !backgroundImageBuf) {
				return new Response("Font or background image not found after loading", {status: 500});
			}

			// --- テキストのレイアウト計算 ---
			let titleLines: string[] = [];
			let subtitleLines: string[] = [];
			let titleFontSize = 0;
			let subtitleFontSize = 0;

			// サブタイトルの有無でフォントサイズと行数の割り当てを変える
			if (subtitle) {
				titleFontSize = calculateFontSize(title, {minSize: 80, maxSize: 110, ...FONT_OPTIONS});
				titleLines = clampLines(title, {maxLines: 1, fontSize: titleFontSize, ...FONT_OPTIONS});
				subtitleFontSize = calculateFontSize(subtitle, {minSize: 30, maxSize: 70, ...FONT_OPTIONS});
				subtitleLines = clampLines(subtitle, {maxLines: 3, fontSize: subtitleFontSize, ...FONT_OPTIONS});
			} else {
				titleFontSize = calculateFontSize(title, {minSize: 60, maxSize: 110, ...FONT_OPTIONS});
				titleLines = clampLines(title, {maxLines: 4, fontSize: titleFontSize, ...FONT_OPTIONS});
			}

			// --- React/JSXによるOGPテンプレート定義 ---
			// SatoriはこのJSXライクな構造を解釈してSVGを生成する
			const ogpNode = (
				<div
					style={{
						width: "1200px",
						height: "630px",
						display: "flex",
						justifyContent: "center",
						alignItems: "center",
						backgroundImage: `url(data:image/png;base64,${btoa(Array.from(new Uint8Array(backgroundImageBuf), byte => String.fromCharCode(byte)).join(''))})`,
						backgroundSize: "cover",
						backgroundPosition: "center",
					}}
				>
					<div
						style={{
							padding: "48px 96px",
							display: "flex",
							flexDirection: "column",
							alignItems: "center",
							justifyContent: "center",
							fontSize: "76px",
							color: OGP_VARIANTS[variant].textColor,
							maxWidth: "100%",
							maxHeight: "100%",
							boxSizing: "border-box",
							textShadow: OGP_VARIANTS[variant].textShadow,
							textAlign: "center",
						}}
					>
						{/* Title */}
						<div style={{
							display: "flex",
							flexDirection: "column",
							fontSize: `${titleFontSize}px`,
							lineHeight: "1.2",
							fontWeight: OGP_VARIANTS[variant].fontWeight
						}}>
							{titleLines.map((line, index) => (<div key={`title-${index}`}>{line}</div>))}
						</div>

						{/* Subtitle (存在する場合のみレンダリング) */}
						{subtitleLines.length > 0 && (
							<div style={{
								display: "flex",
								flexDirection: "column",
								alignItems: "center",
								justifyContent: "center",
								fontSize: `${subtitleFontSize}px`,
								lineHeight: "1.3",
								marginTop: "24px",
								fontWeight: OGP_VARIANTS[variant].fontWeight
							}}>
								{subtitleLines.map((line, index) => (<div key={`subtitle-${index}`}>{line}</div>))}
							</div>
						)}
					</div>
				</div>
			);

			// --- 画像生成とレスポンス ---
			// SatoriでSVGを生成
			const svg = await satori(ogpNode, {
				width: 1200,
				height: 630,
				fonts: [{
					name: OGP_VARIANTS[variant].font,
					data: fontArrBuf,
					weight: OGP_VARIANTS[variant].fontWeight,
					style: "normal",
				}],
			});

			// ResvgでSVGをPNGに変換 (多くのプラットフォームはSVGのOGPをサポートしていないため)
			const png = (new Resvg(svg)).render().asPng();

			// 生成した画像をR2にキャッシュする
			if (!noCacheFlag) {
				await env.OGP_BUCKET.put(`image-cache/${cacheKey}`, png, {
					httpMetadata: {contentType: "image/png"},
				});
			}

			// 生成したPNG画像を返す
			return new Response(png, {
				headers: {
					"Content-Type": "image/png",
					"X-R2-Cache": "MISS", // キャッシュがなかったので生成したことを示す
				},
			});
		}

		// ==================================================
		// 2. シェア＆リダイレクト用エンドポイント (/share)
		// ==================================================
		if (pathname === '/share') {
			const page = searchParams.get('page');
			const variant = searchParams.get('variant') || 'normal';

			// リダイレクト先のページ指定は必須
			if (!page) {
				return new Response('`page` parameter is required.', {status: 400});
			}

			// OGP画像のURLを動的に構築
			let ogImageUrl = `${origin}/image?page=${encodeURIComponent(page)}`;
			ogImageUrl += `&variant=${encodeURIComponent(variant)}`;

			// リダイレクト先のWikidot URLを構築
			const redirectUrl = `http://scp-jp.wikidot.com/${page}`;

			// OGPタグ部分を動的に生成
			const ogpTags = ogImageUrl ? `
            <meta property="og:image" content="${ogImageUrl}" />
            <meta property="og:image:width" content="1200" />
            <meta property="og:image:height" content="630" />
            <meta name="twitter:card" content="summary_large_image" />
            <meta name="twitter:title" content="SCP財団Wiki 日本語版" />
            <meta name="twitter:image" content="${ogImageUrl}" />` : '';

			// OGPタグとリダイレクト用スクリプトを含んだHTMLを生成
			const html = `
        <!DOCTYPE html>
        <html lang="ja">
          <head>
            <meta charset="UTF-8">
            <title>リダイレクト中...</title>
            <meta property="og:title" content="SCP財団Wiki 日本語版" />
            <meta property="og:type" content="website" />
            <meta property="og:url" content="${request.url}" />
            <meta property="og:description" content="SCP財団日本語版Wiki" />
            ${ogpTags}
            <script>window.location.href = "${redirectUrl}";</script>
            <noscript>
              <meta http-equiv="refresh" content="0; url=${redirectUrl}" />
            </noscript>
          </head>
          <body>
            <p>ページ移動中... <a href="${redirectUrl}">移動しない場合はこちらをクリック</a></p>
          </body>
        </html>`;

			return new Response(html, {headers: {'Content-Type': 'text/html;charset=UTF-8'}});
		}

		// 指定外のパスへのアクセスは404を返す
		return new Response('Not Found', {status: 404});
	},
};

// --- ヘルパー関数 ---

/**
 * XSS対策のため、HTML特殊文字をエスケープします。
 * @param unsafe - エスケープ対象の文字列
 * @returns エスケープ後の安全な文字列
 */
function escapeHtml(unsafe: string | null): string {
	if (unsafe === null) return '';
	return unsafe
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#039;");
}

/**
 * テキストが指定された幅に収まるように、最適なフォントサイズを計算します。
 * @param text - 対象のテキスト
 * @param options - {minSize, maxSize, maxWidth, avgCharWidthRatio}
 * @returns 計算されたフォントサイズ (px)
 */
function calculateFontSize(text: string, {minSize, maxSize, maxWidth, avgCharWidthRatio}: {
	minSize: number,
	maxSize: number,
	maxWidth: number,
	avgCharWidthRatio: number
}): number {
	if (!text) return minSize;
	// テキストのおおよその幅を推定
	const estimatedWidth = text.length * (maxSize * avgCharWidthRatio);
	// 最大幅に対するスケールを計算
	const scale = Math.min(maxWidth / estimatedWidth, 1.0);
	const fontSize = maxSize * scale;
	// minSizeとmaxSizeの範囲内に収める
	return Math.max(minSize, Math.min(maxSize, fontSize));
}

/**
 * テキストを指定された行数と幅に収まるように分割・省略します。
 * @param text - 対象のテキスト
 * @param options - {maxLines, fontSize, maxWidth, avgCharWidthRatio}
 * @returns 分割された文字列の配列
 */
function clampLines(text: string, {maxLines, fontSize, maxWidth, avgCharWidthRatio}: {
	maxLines: number,
	fontSize: number,
	maxWidth: number,
	avgCharWidthRatio: number
}): string[] {
	if (!text) return [];
	// 1行あたりの最大文字数をおおよそで計算
	const charsPerLine = Math.floor(maxWidth / (fontSize * avgCharWidthRatio));
	const maxChars = charsPerLine * maxLines;

	// 最大文字数を超える場合は "..." を付けて省略
	let processedText = text;
	if (text.length > maxChars) {
		processedText = text.substring(0, maxChars - 3) + "...";
	}

	// 計算した文字数でテキストを行に分割
	const lines = [];
	for (let i = 0; i < processedText.length; i += charsPerLine) {
		lines.push(processedText.substring(i, i + charsPerLine));
	}
	// 最大行数を超えないようにsliceする
	return lines.slice(0, maxLines);
}

// デフォルトハンドラとしてエクスポート
export default handler;
