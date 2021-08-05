"use strict";

var Typo = require("typo-js");

function CodeMirrorSpellChecker(options) {
	options = options || {};

	var dictLang = "en_US";

	if(options.dictionaryLanguage) {
		dictLang = options.dictionaryLanguage;
	}

	if(options.editorInstance == undefined) {
		console.error(
			"CodeMirror Spell Checker: You must provide an instance of a CodeMirror editor via the option `editorInstance`"
		);
		return;
	}

	// Because some browsers don't support this functionality yet
	if(!String.prototype.includes) {
		String.prototype.includes = function() {
			"use strict";
			return String.prototype.indexOf.apply(this, arguments) !== -1;
		};
	}

	// Load AFF/DIC data
	if(
		CodeMirrorSpellChecker.aff_data[dictLang] == undefined &&
		CodeMirrorSpellChecker.aff_loading != true
	) {
		var aff_url =
			"https://spellcheck-dictionaries.github.io/" +
			dictLang +
			"/" +
			dictLang +
			".aff";

		console.debug(
			"[cm.spellchecker] Loading " + dictLang + " aff file from " + aff_url
		);

		CodeMirrorSpellChecker.aff_loading = true;

		var xhr_aff = new XMLHttpRequest();

		xhr_aff.open("GET", aff_url, true);

		xhr_aff.onload = function() {
			if(xhr_aff.readyState === 4 && xhr_aff.status === 200) {
				CodeMirrorSpellChecker.aff_data[dictLang] = xhr_aff.responseText;

				CodeMirrorSpellChecker.aff_loading = false;
			}
		};

		xhr_aff.send(null);
	}

	if(
		CodeMirrorSpellChecker.dic_data[dictLang] == undefined &&
		CodeMirrorSpellChecker.dic_loading != true
	) {
		var dic_url =
			"https://spellcheck-dictionaries.github.io/" +
			dictLang +
			"/" +
			dictLang +
			".dic";

		console.debug(
			"[cm.spellchecker] Loading " + dictLang + " dic file from " + dic_url
		);

		CodeMirrorSpellChecker.dic_loading = true;

		var xhr_dic = new XMLHttpRequest();

		xhr_dic.open("GET", dic_url, true);

		xhr_dic.onload = function() {
			if(xhr_dic.readyState === 4 && xhr_dic.status === 200) {
				CodeMirrorSpellChecker.dic_data[dictLang] = xhr_dic.responseText;

				CodeMirrorSpellChecker.dic_loading = false;

				if(
					CodeMirrorSpellChecker.dic_data[dictLang] != undefined &&
					CodeMirrorSpellChecker.aff_data[dictLang] != undefined
				) {
					CodeMirrorSpellChecker.typo = new Typo(
						dictLang,
						CodeMirrorSpellChecker.aff_data[dictLang],
						CodeMirrorSpellChecker.dic_data[dictLang], {
							platform: "any",
						}
					);

					if(options.onDictionaryLoad != undefined) {
						options.onDictionaryLoad();
					}
				}
			}
		};
		xhr_dic.send(null);
	} else {
		CodeMirrorSpellChecker.typo = new Typo(
			dictLang,
			CodeMirrorSpellChecker.aff_data[dictLang],
			CodeMirrorSpellChecker.dic_data[dictLang], {
				platform: "any",
			}
		);
	}

	var wordRegex = /^[^!"#$%&()*+,\-./:;<=>?@[\\\]^_`{|}~\s]+/;

	if(options.matchRegex && options.matchRegex instanceof RegExp) {
		wordRegex = options.matchRegex;
	}

	var regexIgnore = /[0-9'_-]+/;

	if(options.ignoreRegex && options.ignoreRegex instanceof RegExp) {
		regexIgnore = options.ignoreRegex;
	}

	var customWords = [];

	if(options.customWords) {
		if(options.customWords instanceof Function) {
			customWords = options.customWords();
		} else {
			customWords = options.customWords;
		}
	}

	var commentRegex;

	if(options.commentStart) {
		commentRegex = new RegExp("\\s*" + options.commentStart);
	}

	var overlay = {
		token: function(stream) {
			// Ignore comments if configured, and exit early
			if(commentRegex && stream.string.match(commentRegex)) {
				stream.next();
				return null;
			}

			var word = stream.match(wordRegex, true);

			if(word) {
				word = word[0];
				if(
					!word.match(regexIgnore) &&
					CodeMirrorSpellChecker.typo &&
					!CodeMirrorSpellChecker.typo.check(word) &&
					!~customWords.indexOf(word)
				) {
					return "spell-error";
				}
			} else {
				stream.next();
				return null;
			}
		},
	};

	options.editorInstance.addOverlay(overlay);
}

CodeMirrorSpellChecker.aff_loading = false;
CodeMirrorSpellChecker.dic_loading = false;
CodeMirrorSpellChecker.aff_data = {};
CodeMirrorSpellChecker.dic_data = {};
CodeMirrorSpellChecker.typo;

module.exports = CodeMirrorSpellChecker;