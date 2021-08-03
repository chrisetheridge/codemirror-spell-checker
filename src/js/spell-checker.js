"use strict";

var Typo = require("typo-js");

function CodeMirrorSpellChecker(options) {
	options = options || {};

	var dictLang = "en_US";

	if(options.dictionaryLanguage) {
		dictLang = options.dictionaryLanguage;
	}

	if(
		typeof options.codeMirrorInstance !== "function" ||
		typeof options.codeMirrorInstance.defineMode !== "function"
	) {
		console.log(
			"CodeMirror Spell Checker: You must provide an instance of CodeMirror via the option `codeMirrorInstance`"
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

	// Define the new mode
	options.codeMirrorInstance.defineMode("spell-checker", function(config) {
		// Load AFF/DIC data
		if(!CodeMirrorSpellChecker.aff_loading) {
			CodeMirrorSpellChecker.aff_loading = true;
			var xhr_aff = new XMLHttpRequest();
			xhr_aff.open(
				"GET",
				"https://spellcheck-dictionaries.github.io/" +
				dictLang +
				"/" +
				dictLang +
				".aff",
				true
			);
			xhr_aff.onload = function() {
				if(xhr_aff.readyState === 4 && xhr_aff.status === 200) {
					CodeMirrorSpellChecker.aff_data = xhr_aff.responseText;
					CodeMirrorSpellChecker.num_loaded++;

					if(CodeMirrorSpellChecker.num_loaded == 2) {
						CodeMirrorSpellChecker.typo = new Typo(
							dictLang,
							CodeMirrorSpellChecker.aff_data,
							CodeMirrorSpellChecker.dic_data, {
								platform: "any",
							}
						);
					}
				}
			};
			xhr_aff.send(null);
		}

		if(!CodeMirrorSpellChecker.dic_loading) {
			CodeMirrorSpellChecker.dic_loading = true;
			var xhr_dic = new XMLHttpRequest();
			xhr_dic.open(
				"GET",
				"https://spellcheck-dictionaries.github.io/" +
				dictLang +
				"/" +
				dictLang +
				".dic",
				true
			);
			xhr_dic.onload = function() {
				if(xhr_dic.readyState === 4 && xhr_dic.status === 200) {
					CodeMirrorSpellChecker.dic_data = xhr_dic.responseText;
					CodeMirrorSpellChecker.num_loaded++;

					if(CodeMirrorSpellChecker.num_loaded == 2) {
						CodeMirrorSpellChecker.typo = new Typo(
							dictLang,
							CodeMirrorSpellChecker.aff_data,
							CodeMirrorSpellChecker.dic_data, {
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

		// Codemirror mode overlay
		var overlay = {
			token: function(stream) {
				var word = stream.match(wordRegex, true);

				if(word) {
					word = word[0]; // regex match body
					if(
						!word.match(regexIgnore) &&
						CodeMirrorSpellChecker.typo &&
						!CodeMirrorSpellChecker.typo.check(word) &&
						!~customWords.indexOf(word)
					)
						return "spell-error"; // CSS class: cm-spell-error
				} else {
					stream.next(); // skip non-word character
				}

				return null;
			},
		};

		var mode = options.codeMirrorInstance.getMode(
			config,
			config.backdrop || "text/plain"
		);

		return options.codeMirrorInstance.overlayMode(mode, overlay, true);
	});
}

CodeMirrorSpellChecker.num_loaded = 0;
CodeMirrorSpellChecker.aff_loading = false;
CodeMirrorSpellChecker.dic_loading = false;
CodeMirrorSpellChecker.aff_data = "";
CodeMirrorSpellChecker.dic_data = "";
CodeMirrorSpellChecker.typo;

module.exports = CodeMirrorSpellChecker;