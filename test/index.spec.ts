import { describe, it, expect } from 'vitest';
import { detectScpTag, splitTitle } from '../src/title';

describe('detectScpTag', () => {
	it('SCPタグを含むページHTMLでtrueを返す', () => {
		const html = `<div class="page-tags"><span><a href="/system:page-tags/tag/jp#pages">jp</a><a href="/system:page-tags/tag/scp#pages">scp</a></span></div>`;
		expect(detectScpTag(html)).toBe(true);
	});

	it('SCPタグを含まないページHTMLでfalseを返す', () => {
		const html = `<div class="page-tags"><span><a href="/system:page-tags/tag/jp#pages">jp</a><a href="/system:page-tags/tag/%E3%83%8F%E3%83%96#pages">ハブ</a></span></div>`;
		expect(detectScpTag(html)).toBe(false);
	});

	it('タグ名の部分一致（例: scp-jp）で誤検出しない', () => {
		const html = `<div class="page-tags"><span><a href="/system:page-tags/tag/scp-jp#pages">scp-jp</a></span></div>`;
		expect(detectScpTag(html)).toBe(false);
	});
});

describe('splitTitle', () => {
	describe('SCPタグ有り', () => {
		it('SCP-XXXX-JP形式を分割する', () => {
			expect(splitTitle('SCP-173-JP - タイトル例', true)).toEqual({
				title: 'SCP-173-JP',
				subtitle: 'タイトル例',
			});
		});

		it('AO-XXXX-JP形式を分割する', () => {
			expect(splitTitle('AO-2000-JP - 廃校の亡霊', true)).toEqual({
				title: 'AO-2000-JP',
				subtitle: '廃校の亡霊',
			});
		});

		it('EE-XXXX-JP形式を分割する', () => {
			expect(splitTitle('EE-5555-JP - 例題', true)).toEqual({
				title: 'EE-5555-JP',
				subtitle: '例題',
			});
		});

		it('SCP-XXXX-JP-J形式を分割する', () => {
			expect(splitTitle('SCP-999-JP-J - ジョーク', true)).toEqual({
				title: 'SCP-999-JP-J',
				subtitle: 'ジョーク',
			});
		});

		it('SCP-XXXX-JP-ARC形式を分割する', () => {
			expect(splitTitle('SCP-001-JP-ARC - 保存記事', true)).toEqual({
				title: 'SCP-001-JP-ARC',
				subtitle: '保存記事',
			});
		});

		it('SCP-XXXX-JP-D形式を分割する', () => {
			expect(splitTitle('SCP-2000-JP-D - 廃案', true)).toEqual({
				title: 'SCP-2000-JP-D',
				subtitle: '廃案',
			});
		});

		it('未解明アーティファクトXXXX号-JP形式を分割する', () => {
			expect(splitTitle('未解明アーティファクト0123号-JP - タイトル例', true)).toEqual({
				title: '未解明アーティファクト0123号-JP',
				subtitle: 'タイトル例',
			});
		});

		it("メタタイトル中に ' - ' を含む場合、最初の区切りのみで分割する", () => {
			expect(splitTitle('SCP-100-JP - 副題 - 追加', true)).toEqual({
				title: 'SCP-100-JP',
				subtitle: '副題 - 追加',
			});
		});

		it("SCPタグは有るが ' - ' を含まないタイトルは分割しない", () => {
			expect(splitTitle('特殊タイトル', true)).toEqual({
				title: '特殊タイトル',
				subtitle: null,
			});
		});

		it('KG984 / Frontios（既知の例外）は意図せぬ分割になる（許容）', () => {
			// renerd確認済みの唯一の例外。' - ' を含まないため実際には分割されず現状維持となる。
			expect(splitTitle('KG984 / Frontios', true)).toEqual({
				title: 'KG984 / Frontios',
				subtitle: null,
			});
		});
	});

	describe('SCPタグ無し', () => {
		it("T/G記事など SCPタグ無しは ' - ' があっても分割しない", () => {
			expect(splitTitle('技術ガイド - 導入編', false)).toEqual({
				title: '技術ガイド - 導入編',
				subtitle: null,
			});
		});

		it('プレーンなタイトルはそのまま返す', () => {
			expect(splitTitle('サンドボックスからのお知らせ', false)).toEqual({
				title: 'サンドボックスからのお知らせ',
				subtitle: null,
			});
		});
	});
});
