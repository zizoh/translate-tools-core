import axios from 'axios';
import { stringify } from 'query-string';
import xpath from 'xpath';
import { DOMParser } from '@xmldom/xmldom';

import { langCode, langCodeWithAuto } from '../../types/Translator';
import { BaseTranslator } from '../../util/BaseTranslator';
import { getToken } from './token';
import { visitArrayItems } from './utils';
import { getLanguageCodesISO639v2 } from '../../util/languages';

/**
 * Map with languages aliases.
 *
 * Google translator use legacy codes for some languages,
 * this map useful to use actual language codes by aliases
 *
 * @link https://xml.coverpages.org/iso639a.html
 */
const fixedLanguagesMap: Record<string, string> = {
	he: 'iw',
	jv: 'jw',
};

/**
 * Raw languages array
 */
// eslint-disable
// prettier-ignore
export const supportedLanguages = [
	'af', 'ak', 'am', 'ar', 'as', 'ay', 'az', 'be', 'bg', 'bho',
	'bm', 'bn', 'bs', 'ca', 'ceb', 'ckb', 'co', 'cs', 'cy', 'da',
	'de', 'doi', 'dv', 'ee', 'el', 'en', 'eo', 'es', 'et', 'eu',
	'fa', 'fi', 'fr', 'fy', 'ga', 'gd', 'gl', 'gn', 'gom', 'gu',
	'ha', 'haw', 'hi', 'hmn', 'hr', 'ht', 'hu', 'hy', 'id', 'ig',
	'ilo', 'is', 'it', 'iw', 'ja', 'jw', 'ka', 'kk', 'km', 'kn',
	'ko', 'kri', 'ku', 'ky', 'la', 'lb', 'lg', 'ln', 'lo', 'lt',
	'lus', 'lv', 'mai', 'mg', 'mi', 'mk', 'ml', 'mn', 'mni-Mtei', 'mr',
	'ms', 'mt', 'my', 'ne', 'nl', 'no', 'nso', 'ny', 'om', 'or',
	'pa', 'pl', 'ps', 'pt', 'qu', 'ro', 'ru', 'rw', 'sa', 'sd',
	'si', 'sk', 'sl', 'sm', 'sn', 'so', 'sq', 'sr', 'st', 'su',
	'sv', 'sw', 'ta', 'te', 'tg', 'th', 'ti', 'tk', 'tl', 'tr',
	'ts', 'tt', 'ug', 'uk', 'ur', 'uz', 'vi', 'xh', 'yi', 'yo',
	'zh-CN', 'zh-TW', 'zu'
];
// eslint-enable

/**
 * Common class for google translator implementations
 */
export abstract class AbstractGoogleTranslator extends BaseTranslator {
	public static isSupportedAutoFrom() {
		return true;
	}

	public static getSupportedLanguages(): langCode[] {
		const reversedLanguagesMap = Object.fromEntries(
			Object.entries(fixedLanguagesMap).map(([key, val]) => [val, key]),
		);

		return getLanguageCodesISO639v2(
			supportedLanguages.map((lang) => {
				// Replace legacy language codes to actual
				return reversedLanguagesMap[lang] ?? lang;
			}),
		);
	}

	public getLengthLimit() {
		return 4000;
	}

	public getRequestsTimeout() {
		return 300;
	}

	protected getFixedLanguage(lang: langCodeWithAuto) {
		if (lang === 'zh') return 'zh-CN';
		return fixedLanguagesMap[lang] ?? lang;
	}
}

/**
 * Translator implementation which use Google API with token from https://translate.google.com
 */
export class GoogleTranslator extends AbstractGoogleTranslator {
	public static readonly translatorName = 'GoogleTranslator';

	public checkLimitExceeding(text: string | string[]) {
		if (Array.isArray(text)) {
			const encodedText = this.encodeForBatch(text).join('');
			const extra = encodedText.length - this.getLengthLimit();
			return extra > 0 ? extra : 0;
		} else {
			const extra = text.length - this.getLengthLimit();
			return extra > 0 ? extra : 0;
		}
	}

	public translate(text: string, from: langCodeWithAuto, to: langCode) {
		return getToken(text).then(({ value: tk }) => {
			const apiPath = 'https://translate.google.com/translate_a/single';

			const data = {
				client: 't',
				sl: this.getFixedLanguage(from),
				tl: this.getFixedLanguage(to),
				hl: this.getFixedLanguage(to),
				dt: ['at', 'bd', 'ex', 'ld', 'md', 'qca', 'rw', 'rm', 'ss', 't'],
				ie: 'UTF-8',
				oe: 'UTF-8',
				otf: 1,
				ssel: 0,
				tsel: 0,
				kc: 7,
				q: text,
				tk,
			};

			const url = apiPath + '?' + stringify(data);

			return axios
				.get(this.wrapUrlToCorsProxy(url), {
					withCredentials: false,
					headers: this.options.headers,
				})
				.then((rsp) => rsp.data)
				.then((rsp) => {
					if (!(rsp instanceof Array) || !(rsp[0] instanceof Array)) {
						throw new Error('Unexpected response');
					}

					const translatedText = rsp[0]
						.map((chunk) =>
							chunk instanceof Array && typeof chunk[0] === 'string'
								? chunk[0]
								: '',
						)
						.join('');

					return translatedText;
				});
		});
	}

	private parseXMLResponse = (text: string) => {
		try {
			const doc = new DOMParser().parseFromString(text);
			const nodes = xpath.select('//pre/*[not(self::i)]//text()', doc);
			return nodes.length === 0
				? null
				: nodes.map((node) => node.toString()).join(' ');
		} catch (err) {
			return null;
		}
	};

	public translateBatch(text: string[], from: langCodeWithAuto, to: langCode) {
		const preparedText = this.encodeForBatch(text);
		return getToken(preparedText.join('')).then(({ value: tk }) => {
			const apiPath = 'https://translate.googleapis.com/translate_a/t';

			const data = {
				anno: 3,
				client: 'te',
				v: '1.0',
				format: 'html',
				sl: this.getFixedLanguage(from),
				tl: this.getFixedLanguage(to),
				tk,
			};

			const url = apiPath + '?' + stringify(data);
			const body = preparedText
				.map((text) => `&q=${encodeURIComponent(text)}`)
				.join('');

			return axios({
				url: this.wrapUrlToCorsProxy(url),
				method: 'POST',
				withCredentials: false,
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded',
					...this.options.headers,
				},
				data: body,
			})
				.then((rsp) => rsp.data)
				.then((rawResp) => {
					try {
						if (!Array.isArray(rawResp)) {
							throw new Error('Unexpected response');
						}

						const isSingleResponseMode = text.length === 1;

						const result: string[] = [];
						visitArrayItems(rawResp, (obj) => {
							if (isSingleResponseMode && result.length === 1) return;

							if (typeof obj !== 'string') return;

							if (isSingleResponseMode) {
								const parsedText = this.parseXMLResponse(obj);
								result.push(parsedText || obj);
							} else {
								const parsedText = this.parseXMLResponse(obj);
								if (parsedText !== null) {
									result.push(parsedText);
								}
							}
						});

						if (result.length !== text.length) {
							throw new Error(
								'Mismatching a lengths of original and translated arrays',
							);
						}

						return result as string[];
					} catch (err) {
						console.warn('Got response', rawResp);
						throw err;
					}
				});
		});
	}

	private encodeForBatch(textList: string[]) {
		return textList.map((text, i) => `<pre><a i="${i}">${text}</a></pre>`);
	}
}

/**
 * Translator implementation which use Google API without token
 */
export class GoogleTranslatorTokenFree extends AbstractGoogleTranslator {
	public static readonly translatorName = 'GoogleTranslatorTokenFree';

	public translate = async (text: string, from: langCodeWithAuto, to: langCode) => {
		const [translation] = await this.translateBatch([text], from, to);
		return translation;
	};

	public translateBatch(text: string[], from: langCodeWithAuto, to: langCode) {
		const apiPath = 'https://translate.googleapis.com/translate_a/t';

		const data = {
			client: 'dict-chrome-ex',
			sl: this.getFixedLanguage(from),
			tl: this.getFixedLanguage(to),
			q: text,
		};

		const url = apiPath + '?' + stringify(data);

		return axios({
			url: this.wrapUrlToCorsProxy(url),
			method: 'GET',
			withCredentials: false,
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
				...this.options.headers,
			},
		})
			.then((rsp) => rsp.data)
			.then((rawResp) => {
				try {
					if (!Array.isArray(rawResp)) {
						throw new Error('Unexpected response');
					}

					const intermediateTextsArray: string[] = [];
					visitArrayItems(rawResp, (obj) => {
						if (typeof obj === 'string') {
							intermediateTextsArray.push(obj);
						}
					});

					const result: string[] = [];

					const isSingleResponseMode = text.length === 1;
					const isOneToOneMappingMode =
						intermediateTextsArray.length === text.length;
					for (const idx in intermediateTextsArray) {
						const text = intermediateTextsArray[idx];

						if (isSingleResponseMode) {
							result.push(text);
							break;
						}

						// Each second text it's not translation if not 1-1 mapping
						const isTranslation =
							isOneToOneMappingMode || Number(idx) % 2 === 0;
						if (isTranslation) {
							result.push(text);
						}
					}

					if (result.length !== text.length) {
						console.warn('Translation result', result);
						throw new Error(
							'Mismatching a lengths of original and translated arrays',
						);
					}

					return result as string[];
				} catch (err) {
					console.warn('Got response', rawResp);
					throw err;
				}
			});
	}
}
