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

	CodeMirrorSpellChecker.typo = new Typo(dictLang, undefined, undefined, {
		platform: "any",
		dictionaryPath: "https://spellcheck-dictionaries.github.io/",
	});

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

CodeMirrorSpellChecker.typo;

module.exports = CodeMirrorSpellChecker;