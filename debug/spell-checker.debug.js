/**
 * @biscuitpants/codemirror-spell-checker v0.0.12
 * Copyright 
 * @link https://github.com/biscuitpants/codemirror-spell-checker
 * @license MIT
 */
(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}g.CodeMirrorSpellChecker = f()}})(function(){var define,module,exports;return (function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){

},{}],2:[function(require,module,exports){
(function (__dirname){(function (){
/* globals chrome: false */
/* globals __dirname: false */
/* globals require: false */
/* globals Buffer: false */
/* globals module: false */

/**
 * Typo is a JavaScript implementation of a spellchecker using hunspell-style 
 * dictionaries.
 */

var Typo;

(function () {
"use strict";

/**
 * Typo constructor.
 *
 * @param {String} [dictionary] The locale code of the dictionary being used. e.g.,
 *                              "en_US". This is only used to auto-load dictionaries.
 * @param {String} [affData]    The data from the dictionary's .aff file. If omitted
 *                              and Typo.js is being used in a Chrome extension, the .aff
 *                              file will be loaded automatically from
 *                              lib/typo/dictionaries/[dictionary]/[dictionary].aff
 *                              In other environments, it will be loaded from
 *                              [settings.dictionaryPath]/dictionaries/[dictionary]/[dictionary].aff
 * @param {String} [wordsData]  The data from the dictionary's .dic file. If omitted
 *                              and Typo.js is being used in a Chrome extension, the .dic
 *                              file will be loaded automatically from
 *                              lib/typo/dictionaries/[dictionary]/[dictionary].dic
 *                              In other environments, it will be loaded from
 *                              [settings.dictionaryPath]/dictionaries/[dictionary]/[dictionary].dic
 * @param {Object} [settings]   Constructor settings. Available properties are:
 *                              {String} [dictionaryPath]: path to load dictionary from in non-chrome
 *                              environment.
 *                              {Object} [flags]: flag information.
 *                              {Boolean} [asyncLoad]: If true, affData and wordsData will be loaded
 *                              asynchronously.
 *                              {Function} [loadedCallback]: Called when both affData and wordsData
 *                              have been loaded. Only used if asyncLoad is set to true. The parameter
 *                              is the instantiated Typo object.
 *
 * @returns {Typo} A Typo object.
 */

Typo = function (dictionary, affData, wordsData, settings) {
	settings = settings || {};

	this.dictionary = null;
	
	this.rules = {};
	this.dictionaryTable = {};
	
	this.compoundRules = [];
	this.compoundRuleCodes = {};
	
	this.replacementTable = [];
	
	this.flags = settings.flags || {}; 
	
	this.memoized = {};

	this.loaded = false;
	
	var self = this;
	
	var path;
	
	// Loop-control variables.
	var i, j, _len, _jlen;
	
	if (dictionary) {
		self.dictionary = dictionary;
		
		// If the data is preloaded, just setup the Typo object.
		if (affData && wordsData) {
			setup();
		}
		// Loading data for Chrome extentions.
		else if (typeof window !== 'undefined' && 'chrome' in window && 'extension' in window.chrome && 'getURL' in window.chrome.extension) {
			if (settings.dictionaryPath) {
				path = settings.dictionaryPath;
			}
			else {
				path = "typo/dictionaries";
			}
			
			if (!affData) readDataFile(chrome.extension.getURL(path + "/" + dictionary + "/" + dictionary + ".aff"), setAffData);
			if (!wordsData) readDataFile(chrome.extension.getURL(path + "/" + dictionary + "/" + dictionary + ".dic"), setWordsData);
		}
		else {
			if (settings.dictionaryPath) {
				path = settings.dictionaryPath;
			}
			else if (typeof __dirname !== 'undefined') {
				path = __dirname + '/dictionaries';
			}
			else {
				path = './dictionaries';
			}
			
			if (!affData) readDataFile(path + "/" + dictionary + "/" + dictionary + ".aff", setAffData);
			if (!wordsData) readDataFile(path + "/" + dictionary + "/" + dictionary + ".dic", setWordsData);
		}
	}
	
	function readDataFile(url, setFunc) {
		var response = self._readFile(url, null, settings.asyncLoad);
		
		if (settings.asyncLoad) {
			response.then(function(data) {
				setFunc(data);
			});
		}
		else {
			setFunc(response);
		}
	}

	function setAffData(data) {
		affData = data;

		if (wordsData) {
			setup();
		}
	}

	function setWordsData(data) {
		wordsData = data;

		if (affData) {
			setup();
		}
	}

	function setup() {
		self.rules = self._parseAFF(affData);
		
		// Save the rule codes that are used in compound rules.
		self.compoundRuleCodes = {};
		
		for (i = 0, _len = self.compoundRules.length; i < _len; i++) {
			var rule = self.compoundRules[i];
			
			for (j = 0, _jlen = rule.length; j < _jlen; j++) {
				self.compoundRuleCodes[rule[j]] = [];
			}
		}
		
		// If we add this ONLYINCOMPOUND flag to self.compoundRuleCodes, then _parseDIC
		// will do the work of saving the list of words that are compound-only.
		if ("ONLYINCOMPOUND" in self.flags) {
			self.compoundRuleCodes[self.flags.ONLYINCOMPOUND] = [];
		}
		
		self.dictionaryTable = self._parseDIC(wordsData);
		
		// Get rid of any codes from the compound rule codes that are never used 
		// (or that were special regex characters).  Not especially necessary... 
		for (i in self.compoundRuleCodes) {
			if (self.compoundRuleCodes[i].length === 0) {
				delete self.compoundRuleCodes[i];
			}
		}
		
		// Build the full regular expressions for each compound rule.
		// I have a feeling (but no confirmation yet) that this method of 
		// testing for compound words is probably slow.
		for (i = 0, _len = self.compoundRules.length; i < _len; i++) {
			var ruleText = self.compoundRules[i];
			
			var expressionText = "";
			
			for (j = 0, _jlen = ruleText.length; j < _jlen; j++) {
				var character = ruleText[j];
				
				if (character in self.compoundRuleCodes) {
					expressionText += "(" + self.compoundRuleCodes[character].join("|") + ")";
				}
				else {
					expressionText += character;
				}
			}
			
			self.compoundRules[i] = new RegExp(expressionText, "i");
		}
		
		self.loaded = true;
		
		if (settings.asyncLoad && settings.loadedCallback) {
			settings.loadedCallback(self);
		}
	}
	
	return this;
};

Typo.prototype = {
	/**
	 * Loads a Typo instance from a hash of all of the Typo properties.
	 *
	 * @param object obj A hash of Typo properties, probably gotten from a JSON.parse(JSON.stringify(typo_instance)).
	 */
	
	load : function (obj) {
		for (var i in obj) {
			if (obj.hasOwnProperty(i)) {
				this[i] = obj[i];
			}
		}
		
		return this;
	},
	
	/**
	 * Read the contents of a file.
	 * 
	 * @param {String} path The path (relative) to the file.
	 * @param {String} [charset="ISO8859-1"] The expected charset of the file
	 * @param {Boolean} async If true, the file will be read asynchronously. For node.js this does nothing, all
	 *        files are read synchronously.
	 * @returns {String} The file data if async is false, otherwise a promise object. If running node.js, the data is
	 *          always returned.
	 */
	
	_readFile : function (path, charset, async) {
		charset = charset || "utf8";
		
		if (typeof XMLHttpRequest !== 'undefined') {
			var promise;
			var req = new XMLHttpRequest();
			req.open("GET", path, async);
			
			if (async) {
				promise = new Promise(function(resolve, reject) {
					req.onload = function() {
						if (req.status === 200) {
							resolve(req.responseText);
						}
						else {
							reject(req.statusText);
						}
					};
					
					req.onerror = function() {
						reject(req.statusText);
					}
				});
			}
		
			if (req.overrideMimeType)
				req.overrideMimeType("text/plain; charset=" + charset);
		
			req.send(null);
			
			return async ? promise : req.responseText;
		}
		else if (typeof require !== 'undefined') {
			// Node.js
			var fs = require("fs");
			
			try {
				if (fs.existsSync(path)) {
					return fs.readFileSync(path, charset);
				}
				else {
					console.log("Path " + path + " does not exist.");
				}
			} catch (e) {
				console.log(e);
				return '';
			}
		}
	},
	
	/**
	 * Parse the rules out from a .aff file.
	 *
	 * @param {String} data The contents of the affix file.
	 * @returns object The rules from the file.
	 */
	
	_parseAFF : function (data) {
		var rules = {};
		
		var line, subline, numEntries, lineParts;
		var i, j, _len, _jlen;
		
		// Remove comment lines
		data = this._removeAffixComments(data);
		
		var lines = data.split(/\r?\n/);
		
		for (i = 0, _len = lines.length; i < _len; i++) {
			line = lines[i];
			
			var definitionParts = line.split(/\s+/);
			
			var ruleType = definitionParts[0];
			
			if (ruleType == "PFX" || ruleType == "SFX") {
				var ruleCode = definitionParts[1];
				var combineable = definitionParts[2];
				numEntries = parseInt(definitionParts[3], 10);
				
				var entries = [];
				
				for (j = i + 1, _jlen = i + 1 + numEntries; j < _jlen; j++) {
					subline = lines[j];
					
					lineParts = subline.split(/\s+/);
					var charactersToRemove = lineParts[2];
					
					var additionParts = lineParts[3].split("/");
					
					var charactersToAdd = additionParts[0];
					if (charactersToAdd === "0") charactersToAdd = "";
					
					var continuationClasses = this.parseRuleCodes(additionParts[1]);
					
					var regexToMatch = lineParts[4];
					
					var entry = {};
					entry.add = charactersToAdd;
					
					if (continuationClasses.length > 0) entry.continuationClasses = continuationClasses;
					
					if (regexToMatch !== ".") {
						if (ruleType === "SFX") {
							entry.match = new RegExp(regexToMatch + "$");
						}
						else {
							entry.match = new RegExp("^" + regexToMatch);
						}
					}
					
					if (charactersToRemove != "0") {
						if (ruleType === "SFX") {
							entry.remove = new RegExp(charactersToRemove  + "$");
						}
						else {
							entry.remove = charactersToRemove;
						}
					}
					
					entries.push(entry);
				}
				
				rules[ruleCode] = { "type" : ruleType, "combineable" : (combineable == "Y"), "entries" : entries };
				
				i += numEntries;
			}
			else if (ruleType === "COMPOUNDRULE") {
				numEntries = parseInt(definitionParts[1], 10);
				
				for (j = i + 1, _jlen = i + 1 + numEntries; j < _jlen; j++) {
					line = lines[j];
					
					lineParts = line.split(/\s+/);
					this.compoundRules.push(lineParts[1]);
				}
				
				i += numEntries;
			}
			else if (ruleType === "REP") {
				lineParts = line.split(/\s+/);
				
				if (lineParts.length === 3) {
					this.replacementTable.push([ lineParts[1], lineParts[2] ]);
				}
			}
			else {
				// ONLYINCOMPOUND
				// COMPOUNDMIN
				// FLAG
				// KEEPCASE
				// NEEDAFFIX
				
				this.flags[ruleType] = definitionParts[1];
			}
		}
		
		return rules;
	},
	
	/**
	 * Removes comment lines and then cleans up blank lines and trailing whitespace.
	 *
	 * @param {String} data The data from an affix file.
	 * @return {String} The cleaned-up data.
	 */
	
	_removeAffixComments : function (data) {
		// Remove comments
		// This used to remove any string starting with '#' up to the end of the line,
		// but some COMPOUNDRULE definitions include '#' as part of the rule.
		// I haven't seen any affix files that use comments on the same line as real data,
		// so I don't think this will break anything.
		data = data.replace(/^\s*#.*$/mg, "");
		
		// Trim each line
		data = data.replace(/^\s\s*/m, '').replace(/\s\s*$/m, '');
		
		// Remove blank lines.
		data = data.replace(/\n{2,}/g, "\n");
		
		// Trim the entire string
		data = data.replace(/^\s\s*/, '').replace(/\s\s*$/, '');
		
		return data;
	},
	
	/**
	 * Parses the words out from the .dic file.
	 *
	 * @param {String} data The data from the dictionary file.
	 * @returns object The lookup table containing all of the words and
	 *                 word forms from the dictionary.
	 */
	
	_parseDIC : function (data) {
		data = this._removeDicComments(data);
		
		var lines = data.split(/\r?\n/);
		var dictionaryTable = {};
		
		function addWord(word, rules) {
			// Some dictionaries will list the same word multiple times with different rule sets.
			if (!dictionaryTable.hasOwnProperty(word)) {
				dictionaryTable[word] = null;
			}
			
			if (rules.length > 0) {
				if (dictionaryTable[word] === null) {
					dictionaryTable[word] = [];
				}

				dictionaryTable[word].push(rules);
			}
		}
		
		// The first line is the number of words in the dictionary.
		for (var i = 1, _len = lines.length; i < _len; i++) {
			var line = lines[i];
			
			if (!line) {
				// Ignore empty lines.
				continue;
			}

			var parts = line.split("/", 2);
			
			var word = parts[0];

			// Now for each affix rule, generate that form of the word.
			if (parts.length > 1) {
				var ruleCodesArray = this.parseRuleCodes(parts[1]);
				
				// Save the ruleCodes for compound word situations.
				if (!("NEEDAFFIX" in this.flags) || ruleCodesArray.indexOf(this.flags.NEEDAFFIX) == -1) {
					addWord(word, ruleCodesArray);
				}
				
				for (var j = 0, _jlen = ruleCodesArray.length; j < _jlen; j++) {
					var code = ruleCodesArray[j];
					
					var rule = this.rules[code];
					
					if (rule) {
						var newWords = this._applyRule(word, rule);
						
						for (var ii = 0, _iilen = newWords.length; ii < _iilen; ii++) {
							var newWord = newWords[ii];
							
							addWord(newWord, []);
							
							if (rule.combineable) {
								for (var k = j + 1; k < _jlen; k++) {
									var combineCode = ruleCodesArray[k];
									
									var combineRule = this.rules[combineCode];
									
									if (combineRule) {
										if (combineRule.combineable && (rule.type != combineRule.type)) {
											var otherNewWords = this._applyRule(newWord, combineRule);
											
											for (var iii = 0, _iiilen = otherNewWords.length; iii < _iiilen; iii++) {
												var otherNewWord = otherNewWords[iii];
												addWord(otherNewWord, []);
											}
										}
									}
								}
							}
						}
					}
					
					if (code in this.compoundRuleCodes) {
						this.compoundRuleCodes[code].push(word);
					}
				}
			}
			else {
				addWord(word.trim(), []);
			}
		}
		
		return dictionaryTable;
	},
	
	
	/**
	 * Removes comment lines and then cleans up blank lines and trailing whitespace.
	 *
	 * @param {String} data The data from a .dic file.
	 * @return {String} The cleaned-up data.
	 */
	
	_removeDicComments : function (data) {
		// I can't find any official documentation on it, but at least the de_DE
		// dictionary uses tab-indented lines as comments.
		
		// Remove comments
		data = data.replace(/^\t.*$/mg, "");
		
		return data;
	},
	
	parseRuleCodes : function (textCodes) {
		if (!textCodes) {
			return [];
		}
		else if (!("FLAG" in this.flags)) {
			return textCodes.split("");
		}
		else if (this.flags.FLAG === "long") {
			var flags = [];
			
			for (var i = 0, _len = textCodes.length; i < _len; i += 2) {
				flags.push(textCodes.substr(i, 2));
			}
			
			return flags;
		}
		else if (this.flags.FLAG === "num") {
			return textCodes.split(",");
		}
	},
	
	/**
	 * Applies an affix rule to a word.
	 *
	 * @param {String} word The base word.
	 * @param {Object} rule The affix rule.
	 * @returns {String[]} The new words generated by the rule.
	 */
	
	_applyRule : function (word, rule) {
		var entries = rule.entries;
		var newWords = [];
		
		for (var i = 0, _len = entries.length; i < _len; i++) {
			var entry = entries[i];
			
			if (!entry.match || word.match(entry.match)) {
				var newWord = word;
				
				if (entry.remove) {
					newWord = newWord.replace(entry.remove, "");
				}
				
				if (rule.type === "SFX") {
					newWord = newWord + entry.add;
				}
				else {
					newWord = entry.add + newWord;
				}
				
				newWords.push(newWord);
				
				if ("continuationClasses" in entry) {
					for (var j = 0, _jlen = entry.continuationClasses.length; j < _jlen; j++) {
						var continuationRule = this.rules[entry.continuationClasses[j]];
						
						if (continuationRule) {
							newWords = newWords.concat(this._applyRule(newWord, continuationRule));
						}
						/*
						else {
							// This shouldn't happen, but it does, at least in the de_DE dictionary.
							// I think the author mistakenly supplied lower-case rule codes instead 
							// of upper-case.
						}
						*/
					}
				}
			}
		}
		
		return newWords;
	},
	
	/**
	 * Checks whether a word or a capitalization variant exists in the current dictionary.
	 * The word is trimmed and several variations of capitalizations are checked.
	 * If you want to check a word without any changes made to it, call checkExact()
	 *
	 * @see http://blog.stevenlevithan.com/archives/faster-trim-javascript re:trimming function
	 *
	 * @param {String} aWord The word to check.
	 * @returns {Boolean}
	 */
	
	check : function (aWord) {
		if (!this.loaded) {
			throw "Dictionary not loaded.";
		}
		
		// Remove leading and trailing whitespace
		var trimmedWord = aWord.replace(/^\s\s*/, '').replace(/\s\s*$/, '');
		
		if (this.checkExact(trimmedWord)) {
			return true;
		}
		
		// The exact word is not in the dictionary.
		if (trimmedWord.toUpperCase() === trimmedWord) {
			// The word was supplied in all uppercase.
			// Check for a capitalized form of the word.
			var capitalizedWord = trimmedWord[0] + trimmedWord.substring(1).toLowerCase();
			
			if (this.hasFlag(capitalizedWord, "KEEPCASE")) {
				// Capitalization variants are not allowed for this word.
				return false;
			}
			
			if (this.checkExact(capitalizedWord)) {
				// The all-caps word is a capitalized word spelled correctly.
				return true;
			}

			if (this.checkExact(trimmedWord.toLowerCase())) {
				// The all-caps is a lowercase word spelled correctly.
				return true;
			}
		}
		
		var uncapitalizedWord = trimmedWord[0].toLowerCase() + trimmedWord.substring(1);
		
		if (uncapitalizedWord !== trimmedWord) {
			if (this.hasFlag(uncapitalizedWord, "KEEPCASE")) {
				// Capitalization variants are not allowed for this word.
				return false;
			}
			
			// Check for an uncapitalized form
			if (this.checkExact(uncapitalizedWord)) {
				// The word is spelled correctly but with the first letter capitalized.
				return true;
			}
		}
		
		return false;
	},
	
	/**
	 * Checks whether a word exists in the current dictionary.
	 *
	 * @param {String} word The word to check.
	 * @returns {Boolean}
	 */
	
	checkExact : function (word) {
		if (!this.loaded) {
			throw "Dictionary not loaded.";
		}

		var ruleCodes = this.dictionaryTable[word];
		
		var i, _len;
		
		if (typeof ruleCodes === 'undefined') {
			// Check if this might be a compound word.
			if ("COMPOUNDMIN" in this.flags && word.length >= this.flags.COMPOUNDMIN) {
				for (i = 0, _len = this.compoundRules.length; i < _len; i++) {
					if (word.match(this.compoundRules[i])) {
						return true;
					}
				}
			}
		}
		else if (ruleCodes === null) {
			// a null (but not undefined) value for an entry in the dictionary table
			// means that the word is in the dictionary but has no flags.
			return true;
		}
		else if (typeof ruleCodes === 'object') { // this.dictionary['hasOwnProperty'] will be a function.
			for (i = 0, _len = ruleCodes.length; i < _len; i++) {
				if (!this.hasFlag(word, "ONLYINCOMPOUND", ruleCodes[i])) {
					return true;
				}
			}
		}

		return false;
	},
	
	/**
	 * Looks up whether a given word is flagged with a given flag.
	 *
	 * @param {String} word The word in question.
	 * @param {String} flag The flag in question.
	 * @return {Boolean}
	 */
	 
	hasFlag : function (word, flag, wordFlags) {
		if (!this.loaded) {
			throw "Dictionary not loaded.";
		}

		if (flag in this.flags) {
			if (typeof wordFlags === 'undefined') {
				wordFlags = Array.prototype.concat.apply([], this.dictionaryTable[word]);
			}
			
			if (wordFlags && wordFlags.indexOf(this.flags[flag]) !== -1) {
				return true;
			}
		}
		
		return false;
	},
	
	/**
	 * Returns a list of suggestions for a misspelled word.
	 *
	 * @see http://www.norvig.com/spell-correct.html for the basis of this suggestor.
	 * This suggestor is primitive, but it works.
	 *
	 * @param {String} word The misspelling.
	 * @param {Number} [limit=5] The maximum number of suggestions to return.
	 * @returns {String[]} The array of suggestions.
	 */
	
	alphabet : "",
	
	suggest : function (word, limit) {
		if (!this.loaded) {
			throw "Dictionary not loaded.";
		}

		limit = limit || 5;

		if (this.memoized.hasOwnProperty(word)) {
			var memoizedLimit = this.memoized[word]['limit'];

			// Only return the cached list if it's big enough or if there weren't enough suggestions
			// to fill a smaller limit.
			if (limit <= memoizedLimit || this.memoized[word]['suggestions'].length < memoizedLimit) {
				return this.memoized[word]['suggestions'].slice(0, limit);
			}
		}
		
		if (this.check(word)) return [];
		
		// Check the replacement table.
		for (var i = 0, _len = this.replacementTable.length; i < _len; i++) {
			var replacementEntry = this.replacementTable[i];
			
			if (word.indexOf(replacementEntry[0]) !== -1) {
				var correctedWord = word.replace(replacementEntry[0], replacementEntry[1]);
				
				if (this.check(correctedWord)) {
					return [ correctedWord ];
				}
			}
		}
		
		var self = this;
		self.alphabet = "abcdefghijklmnopqrstuvwxyz";
		
		/*
		if (!self.alphabet) {
			// Use the alphabet as implicitly defined by the words in the dictionary.
			var alphaHash = {};
			
			for (var i in self.dictionaryTable) {
				for (var j = 0, _len = i.length; j < _len; j++) {
					alphaHash[i[j]] = true;
				}
			}
			
			for (var i in alphaHash) {
				self.alphabet += i;
			}
			
			var alphaArray = self.alphabet.split("");
			alphaArray.sort();
			self.alphabet = alphaArray.join("");
		}
		*/
		
		/**
		 * Returns a hash keyed by all of the strings that can be made by making a single edit to the word (or words in) `words`
		 * The value of each entry is the number of unique ways that the resulting word can be made.
		 *
		 * @arg mixed words Either a hash keyed by words or a string word to operate on.
		 * @arg bool known_only Whether this function should ignore strings that are not in the dictionary.
		 */
		function edits1(words, known_only) {
			var rv = {};
			
			var i, j, _iilen, _len, _jlen, _edit;

			var alphabetLength = self.alphabet.length;
			
			if (typeof words == 'string') {
				var word = words;
				words = {};
				words[word] = true;
			}

			for (var word in words) {
				for (i = 0, _len = word.length + 1; i < _len; i++) {
					var s = [ word.substring(0, i), word.substring(i) ];
				
					// Remove a letter.
					if (s[1]) {
						_edit = s[0] + s[1].substring(1);

						if (!known_only || self.check(_edit)) {
							if (!(_edit in rv)) {
								rv[_edit] = 1;
							}
							else {
								rv[_edit] += 1;
							}
						}
					}
					
					// Transpose letters
					// Eliminate transpositions of identical letters
					if (s[1].length > 1 && s[1][1] !== s[1][0]) {
						_edit = s[0] + s[1][1] + s[1][0] + s[1].substring(2);

						if (!known_only || self.check(_edit)) {
							if (!(_edit in rv)) {
								rv[_edit] = 1;
							}
							else {
								rv[_edit] += 1;
							}
						}
					}

					if (s[1]) {
						// Replace a letter with another letter.

						var lettercase = (s[1].substring(0,1).toUpperCase() === s[1].substring(0,1)) ? 'uppercase' : 'lowercase';

						for (j = 0; j < alphabetLength; j++) {
							var replacementLetter = self.alphabet[j];

							// Set the case of the replacement letter to the same as the letter being replaced.
							if ( 'uppercase' === lettercase ) {
								replacementLetter = replacementLetter.toUpperCase();
							}

							// Eliminate replacement of a letter by itself
							if (replacementLetter != s[1].substring(0,1)){
								_edit = s[0] + replacementLetter + s[1].substring(1);

								if (!known_only || self.check(_edit)) {
									if (!(_edit in rv)) {
										rv[_edit] = 1;
									}
									else {
										rv[_edit] += 1;
									}
								}
							}
						}
					}

					if (s[1]) {
						// Add a letter between each letter.
						for (j = 0; j < alphabetLength; j++) {
							// If the letters on each side are capitalized, capitalize the replacement.
							var lettercase = (s[0].substring(-1).toUpperCase() === s[0].substring(-1) && s[1].substring(0,1).toUpperCase() === s[1].substring(0,1)) ? 'uppercase' : 'lowercase';

							var replacementLetter = self.alphabet[j];

							if ( 'uppercase' === lettercase ) {
								replacementLetter = replacementLetter.toUpperCase();
							}

							_edit = s[0] + replacementLetter + s[1];

							if (!known_only || self.check(_edit)) {
								if (!(_edit in rv)) {
									rv[_edit] = 1;
								}
								else {
									rv[_edit] += 1;
								}
							}
						}
					}
				}
			}
			
			return rv;
		}

		function correct(word) {
			// Get the edit-distance-1 and edit-distance-2 forms of this word.
			var ed1 = edits1(word);
			var ed2 = edits1(ed1, true);
			
			// Sort the edits based on how many different ways they were created.
			var weighted_corrections = ed2;
			
			for (var ed1word in ed1) {
				if (!self.check(ed1word)) {
					continue;
				}

				if (ed1word in weighted_corrections) {
					weighted_corrections[ed1word] += ed1[ed1word];
				}
				else {
					weighted_corrections[ed1word] = ed1[ed1word];
				}
			}
			
			var i, _len;

			var sorted_corrections = [];
			
			for (i in weighted_corrections) {
				if (weighted_corrections.hasOwnProperty(i)) {
					sorted_corrections.push([ i, weighted_corrections[i] ]);
				}
			}

			function sorter(a, b) {
				var a_val = a[1];
				var b_val = b[1];
				if (a_val < b_val) {
					return -1;
				} else if (a_val > b_val) {
					return 1;
				}
				// @todo If a and b are equally weighted, add our own weight based on something like the key locations on this language's default keyboard.
				return b[0].localeCompare(a[0]);
			}
			
			sorted_corrections.sort(sorter).reverse();

			var rv = [];

			var capitalization_scheme = "lowercase";
			
			if (word.toUpperCase() === word) {
				capitalization_scheme = "uppercase";
			}
			else if (word.substr(0, 1).toUpperCase() + word.substr(1).toLowerCase() === word) {
				capitalization_scheme = "capitalized";
			}
			
			var working_limit = limit;

			for (i = 0; i < Math.min(working_limit, sorted_corrections.length); i++) {
				if ("uppercase" === capitalization_scheme) {
					sorted_corrections[i][0] = sorted_corrections[i][0].toUpperCase();
				}
				else if ("capitalized" === capitalization_scheme) {
					sorted_corrections[i][0] = sorted_corrections[i][0].substr(0, 1).toUpperCase() + sorted_corrections[i][0].substr(1);
				}
				
				if (!self.hasFlag(sorted_corrections[i][0], "NOSUGGEST") && rv.indexOf(sorted_corrections[i][0]) == -1) {
					rv.push(sorted_corrections[i][0]);
				}
				else {
					// If one of the corrections is not eligible as a suggestion , make sure we still return the right number of suggestions.
					working_limit++;
				}
			}

			return rv;
		}
		
		this.memoized[word] = {
			'suggestions': correct(word),
			'limit': limit
		};

		return this.memoized[word]['suggestions'];
	}
};
})();

// Support for use as a node.js module.
if (typeof module !== 'undefined') {
	module.exports = Typo;
}

}).call(this)}).call(this,"/node_modules/typo-js")

},{"fs":1}],3:[function(require,module,exports){
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
},{"typo-js":2}]},{},[3])(3)
});

//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJub2RlX21vZHVsZXMvYnJvd3Nlci1yZXNvbHZlL2VtcHR5LmpzIiwibm9kZV9tb2R1bGVzL3R5cG8tanMvdHlwby5qcyIsInNyYy9qcy9zcGVsbC1jaGVja2VyLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBO0FDQUE7OztBQ0FBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7OztBQy8rQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSIsImZpbGUiOiJnZW5lcmF0ZWQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlc0NvbnRlbnQiOlsiKGZ1bmN0aW9uKCl7ZnVuY3Rpb24gcihlLG4sdCl7ZnVuY3Rpb24gbyhpLGYpe2lmKCFuW2ldKXtpZighZVtpXSl7dmFyIGM9XCJmdW5jdGlvblwiPT10eXBlb2YgcmVxdWlyZSYmcmVxdWlyZTtpZighZiYmYylyZXR1cm4gYyhpLCEwKTtpZih1KXJldHVybiB1KGksITApO3ZhciBhPW5ldyBFcnJvcihcIkNhbm5vdCBmaW5kIG1vZHVsZSAnXCIraStcIidcIik7dGhyb3cgYS5jb2RlPVwiTU9EVUxFX05PVF9GT1VORFwiLGF9dmFyIHA9bltpXT17ZXhwb3J0czp7fX07ZVtpXVswXS5jYWxsKHAuZXhwb3J0cyxmdW5jdGlvbihyKXt2YXIgbj1lW2ldWzFdW3JdO3JldHVybiBvKG58fHIpfSxwLHAuZXhwb3J0cyxyLGUsbix0KX1yZXR1cm4gbltpXS5leHBvcnRzfWZvcih2YXIgdT1cImZ1bmN0aW9uXCI9PXR5cGVvZiByZXF1aXJlJiZyZXF1aXJlLGk9MDtpPHQubGVuZ3RoO2krKylvKHRbaV0pO3JldHVybiBvfXJldHVybiByfSkoKSIsIiIsIi8qIGdsb2JhbHMgY2hyb21lOiBmYWxzZSAqL1xuLyogZ2xvYmFscyBfX2Rpcm5hbWU6IGZhbHNlICovXG4vKiBnbG9iYWxzIHJlcXVpcmU6IGZhbHNlICovXG4vKiBnbG9iYWxzIEJ1ZmZlcjogZmFsc2UgKi9cbi8qIGdsb2JhbHMgbW9kdWxlOiBmYWxzZSAqL1xuXG4vKipcbiAqIFR5cG8gaXMgYSBKYXZhU2NyaXB0IGltcGxlbWVudGF0aW9uIG9mIGEgc3BlbGxjaGVja2VyIHVzaW5nIGh1bnNwZWxsLXN0eWxlIFxuICogZGljdGlvbmFyaWVzLlxuICovXG5cbnZhciBUeXBvO1xuXG4oZnVuY3Rpb24gKCkge1xuXCJ1c2Ugc3RyaWN0XCI7XG5cbi8qKlxuICogVHlwbyBjb25zdHJ1Y3Rvci5cbiAqXG4gKiBAcGFyYW0ge1N0cmluZ30gW2RpY3Rpb25hcnldIFRoZSBsb2NhbGUgY29kZSBvZiB0aGUgZGljdGlvbmFyeSBiZWluZyB1c2VkLiBlLmcuLFxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICBcImVuX1VTXCIuIFRoaXMgaXMgb25seSB1c2VkIHRvIGF1dG8tbG9hZCBkaWN0aW9uYXJpZXMuXG4gKiBAcGFyYW0ge1N0cmluZ30gW2FmZkRhdGFdICAgIFRoZSBkYXRhIGZyb20gdGhlIGRpY3Rpb25hcnkncyAuYWZmIGZpbGUuIElmIG9taXR0ZWRcbiAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYW5kIFR5cG8uanMgaXMgYmVpbmcgdXNlZCBpbiBhIENocm9tZSBleHRlbnNpb24sIHRoZSAuYWZmXG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGZpbGUgd2lsbCBiZSBsb2FkZWQgYXV0b21hdGljYWxseSBmcm9tXG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGxpYi90eXBvL2RpY3Rpb25hcmllcy9bZGljdGlvbmFyeV0vW2RpY3Rpb25hcnldLmFmZlxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICBJbiBvdGhlciBlbnZpcm9ubWVudHMsIGl0IHdpbGwgYmUgbG9hZGVkIGZyb21cbiAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgW3NldHRpbmdzLmRpY3Rpb25hcnlQYXRoXS9kaWN0aW9uYXJpZXMvW2RpY3Rpb25hcnldL1tkaWN0aW9uYXJ5XS5hZmZcbiAqIEBwYXJhbSB7U3RyaW5nfSBbd29yZHNEYXRhXSAgVGhlIGRhdGEgZnJvbSB0aGUgZGljdGlvbmFyeSdzIC5kaWMgZmlsZS4gSWYgb21pdHRlZFxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICBhbmQgVHlwby5qcyBpcyBiZWluZyB1c2VkIGluIGEgQ2hyb21lIGV4dGVuc2lvbiwgdGhlIC5kaWNcbiAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZmlsZSB3aWxsIGJlIGxvYWRlZCBhdXRvbWF0aWNhbGx5IGZyb21cbiAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbGliL3R5cG8vZGljdGlvbmFyaWVzL1tkaWN0aW9uYXJ5XS9bZGljdGlvbmFyeV0uZGljXG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIEluIG90aGVyIGVudmlyb25tZW50cywgaXQgd2lsbCBiZSBsb2FkZWQgZnJvbVxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICBbc2V0dGluZ3MuZGljdGlvbmFyeVBhdGhdL2RpY3Rpb25hcmllcy9bZGljdGlvbmFyeV0vW2RpY3Rpb25hcnldLmRpY1xuICogQHBhcmFtIHtPYmplY3R9IFtzZXR0aW5nc10gICBDb25zdHJ1Y3RvciBzZXR0aW5ncy4gQXZhaWxhYmxlIHByb3BlcnRpZXMgYXJlOlxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICB7U3RyaW5nfSBbZGljdGlvbmFyeVBhdGhdOiBwYXRoIHRvIGxvYWQgZGljdGlvbmFyeSBmcm9tIGluIG5vbi1jaHJvbWVcbiAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZW52aXJvbm1lbnQuXG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHtPYmplY3R9IFtmbGFnc106IGZsYWcgaW5mb3JtYXRpb24uXG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHtCb29sZWFufSBbYXN5bmNMb2FkXTogSWYgdHJ1ZSwgYWZmRGF0YSBhbmQgd29yZHNEYXRhIHdpbGwgYmUgbG9hZGVkXG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGFzeW5jaHJvbm91c2x5LlxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICB7RnVuY3Rpb259IFtsb2FkZWRDYWxsYmFja106IENhbGxlZCB3aGVuIGJvdGggYWZmRGF0YSBhbmQgd29yZHNEYXRhXG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGhhdmUgYmVlbiBsb2FkZWQuIE9ubHkgdXNlZCBpZiBhc3luY0xvYWQgaXMgc2V0IHRvIHRydWUuIFRoZSBwYXJhbWV0ZXJcbiAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaXMgdGhlIGluc3RhbnRpYXRlZCBUeXBvIG9iamVjdC5cbiAqXG4gKiBAcmV0dXJucyB7VHlwb30gQSBUeXBvIG9iamVjdC5cbiAqL1xuXG5UeXBvID0gZnVuY3Rpb24gKGRpY3Rpb25hcnksIGFmZkRhdGEsIHdvcmRzRGF0YSwgc2V0dGluZ3MpIHtcblx0c2V0dGluZ3MgPSBzZXR0aW5ncyB8fCB7fTtcblxuXHR0aGlzLmRpY3Rpb25hcnkgPSBudWxsO1xuXHRcblx0dGhpcy5ydWxlcyA9IHt9O1xuXHR0aGlzLmRpY3Rpb25hcnlUYWJsZSA9IHt9O1xuXHRcblx0dGhpcy5jb21wb3VuZFJ1bGVzID0gW107XG5cdHRoaXMuY29tcG91bmRSdWxlQ29kZXMgPSB7fTtcblx0XG5cdHRoaXMucmVwbGFjZW1lbnRUYWJsZSA9IFtdO1xuXHRcblx0dGhpcy5mbGFncyA9IHNldHRpbmdzLmZsYWdzIHx8IHt9OyBcblx0XG5cdHRoaXMubWVtb2l6ZWQgPSB7fTtcblxuXHR0aGlzLmxvYWRlZCA9IGZhbHNlO1xuXHRcblx0dmFyIHNlbGYgPSB0aGlzO1xuXHRcblx0dmFyIHBhdGg7XG5cdFxuXHQvLyBMb29wLWNvbnRyb2wgdmFyaWFibGVzLlxuXHR2YXIgaSwgaiwgX2xlbiwgX2psZW47XG5cdFxuXHRpZiAoZGljdGlvbmFyeSkge1xuXHRcdHNlbGYuZGljdGlvbmFyeSA9IGRpY3Rpb25hcnk7XG5cdFx0XG5cdFx0Ly8gSWYgdGhlIGRhdGEgaXMgcHJlbG9hZGVkLCBqdXN0IHNldHVwIHRoZSBUeXBvIG9iamVjdC5cblx0XHRpZiAoYWZmRGF0YSAmJiB3b3Jkc0RhdGEpIHtcblx0XHRcdHNldHVwKCk7XG5cdFx0fVxuXHRcdC8vIExvYWRpbmcgZGF0YSBmb3IgQ2hyb21lIGV4dGVudGlvbnMuXG5cdFx0ZWxzZSBpZiAodHlwZW9mIHdpbmRvdyAhPT0gJ3VuZGVmaW5lZCcgJiYgJ2Nocm9tZScgaW4gd2luZG93ICYmICdleHRlbnNpb24nIGluIHdpbmRvdy5jaHJvbWUgJiYgJ2dldFVSTCcgaW4gd2luZG93LmNocm9tZS5leHRlbnNpb24pIHtcblx0XHRcdGlmIChzZXR0aW5ncy5kaWN0aW9uYXJ5UGF0aCkge1xuXHRcdFx0XHRwYXRoID0gc2V0dGluZ3MuZGljdGlvbmFyeVBhdGg7XG5cdFx0XHR9XG5cdFx0XHRlbHNlIHtcblx0XHRcdFx0cGF0aCA9IFwidHlwby9kaWN0aW9uYXJpZXNcIjtcblx0XHRcdH1cblx0XHRcdFxuXHRcdFx0aWYgKCFhZmZEYXRhKSByZWFkRGF0YUZpbGUoY2hyb21lLmV4dGVuc2lvbi5nZXRVUkwocGF0aCArIFwiL1wiICsgZGljdGlvbmFyeSArIFwiL1wiICsgZGljdGlvbmFyeSArIFwiLmFmZlwiKSwgc2V0QWZmRGF0YSk7XG5cdFx0XHRpZiAoIXdvcmRzRGF0YSkgcmVhZERhdGFGaWxlKGNocm9tZS5leHRlbnNpb24uZ2V0VVJMKHBhdGggKyBcIi9cIiArIGRpY3Rpb25hcnkgKyBcIi9cIiArIGRpY3Rpb25hcnkgKyBcIi5kaWNcIiksIHNldFdvcmRzRGF0YSk7XG5cdFx0fVxuXHRcdGVsc2Uge1xuXHRcdFx0aWYgKHNldHRpbmdzLmRpY3Rpb25hcnlQYXRoKSB7XG5cdFx0XHRcdHBhdGggPSBzZXR0aW5ncy5kaWN0aW9uYXJ5UGF0aDtcblx0XHRcdH1cblx0XHRcdGVsc2UgaWYgKHR5cGVvZiBfX2Rpcm5hbWUgIT09ICd1bmRlZmluZWQnKSB7XG5cdFx0XHRcdHBhdGggPSBfX2Rpcm5hbWUgKyAnL2RpY3Rpb25hcmllcyc7XG5cdFx0XHR9XG5cdFx0XHRlbHNlIHtcblx0XHRcdFx0cGF0aCA9ICcuL2RpY3Rpb25hcmllcyc7XG5cdFx0XHR9XG5cdFx0XHRcblx0XHRcdGlmICghYWZmRGF0YSkgcmVhZERhdGFGaWxlKHBhdGggKyBcIi9cIiArIGRpY3Rpb25hcnkgKyBcIi9cIiArIGRpY3Rpb25hcnkgKyBcIi5hZmZcIiwgc2V0QWZmRGF0YSk7XG5cdFx0XHRpZiAoIXdvcmRzRGF0YSkgcmVhZERhdGFGaWxlKHBhdGggKyBcIi9cIiArIGRpY3Rpb25hcnkgKyBcIi9cIiArIGRpY3Rpb25hcnkgKyBcIi5kaWNcIiwgc2V0V29yZHNEYXRhKTtcblx0XHR9XG5cdH1cblx0XG5cdGZ1bmN0aW9uIHJlYWREYXRhRmlsZSh1cmwsIHNldEZ1bmMpIHtcblx0XHR2YXIgcmVzcG9uc2UgPSBzZWxmLl9yZWFkRmlsZSh1cmwsIG51bGwsIHNldHRpbmdzLmFzeW5jTG9hZCk7XG5cdFx0XG5cdFx0aWYgKHNldHRpbmdzLmFzeW5jTG9hZCkge1xuXHRcdFx0cmVzcG9uc2UudGhlbihmdW5jdGlvbihkYXRhKSB7XG5cdFx0XHRcdHNldEZ1bmMoZGF0YSk7XG5cdFx0XHR9KTtcblx0XHR9XG5cdFx0ZWxzZSB7XG5cdFx0XHRzZXRGdW5jKHJlc3BvbnNlKTtcblx0XHR9XG5cdH1cblxuXHRmdW5jdGlvbiBzZXRBZmZEYXRhKGRhdGEpIHtcblx0XHRhZmZEYXRhID0gZGF0YTtcblxuXHRcdGlmICh3b3Jkc0RhdGEpIHtcblx0XHRcdHNldHVwKCk7XG5cdFx0fVxuXHR9XG5cblx0ZnVuY3Rpb24gc2V0V29yZHNEYXRhKGRhdGEpIHtcblx0XHR3b3Jkc0RhdGEgPSBkYXRhO1xuXG5cdFx0aWYgKGFmZkRhdGEpIHtcblx0XHRcdHNldHVwKCk7XG5cdFx0fVxuXHR9XG5cblx0ZnVuY3Rpb24gc2V0dXAoKSB7XG5cdFx0c2VsZi5ydWxlcyA9IHNlbGYuX3BhcnNlQUZGKGFmZkRhdGEpO1xuXHRcdFxuXHRcdC8vIFNhdmUgdGhlIHJ1bGUgY29kZXMgdGhhdCBhcmUgdXNlZCBpbiBjb21wb3VuZCBydWxlcy5cblx0XHRzZWxmLmNvbXBvdW5kUnVsZUNvZGVzID0ge307XG5cdFx0XG5cdFx0Zm9yIChpID0gMCwgX2xlbiA9IHNlbGYuY29tcG91bmRSdWxlcy5sZW5ndGg7IGkgPCBfbGVuOyBpKyspIHtcblx0XHRcdHZhciBydWxlID0gc2VsZi5jb21wb3VuZFJ1bGVzW2ldO1xuXHRcdFx0XG5cdFx0XHRmb3IgKGogPSAwLCBfamxlbiA9IHJ1bGUubGVuZ3RoOyBqIDwgX2psZW47IGorKykge1xuXHRcdFx0XHRzZWxmLmNvbXBvdW5kUnVsZUNvZGVzW3J1bGVbal1dID0gW107XG5cdFx0XHR9XG5cdFx0fVxuXHRcdFxuXHRcdC8vIElmIHdlIGFkZCB0aGlzIE9OTFlJTkNPTVBPVU5EIGZsYWcgdG8gc2VsZi5jb21wb3VuZFJ1bGVDb2RlcywgdGhlbiBfcGFyc2VESUNcblx0XHQvLyB3aWxsIGRvIHRoZSB3b3JrIG9mIHNhdmluZyB0aGUgbGlzdCBvZiB3b3JkcyB0aGF0IGFyZSBjb21wb3VuZC1vbmx5LlxuXHRcdGlmIChcIk9OTFlJTkNPTVBPVU5EXCIgaW4gc2VsZi5mbGFncykge1xuXHRcdFx0c2VsZi5jb21wb3VuZFJ1bGVDb2Rlc1tzZWxmLmZsYWdzLk9OTFlJTkNPTVBPVU5EXSA9IFtdO1xuXHRcdH1cblx0XHRcblx0XHRzZWxmLmRpY3Rpb25hcnlUYWJsZSA9IHNlbGYuX3BhcnNlRElDKHdvcmRzRGF0YSk7XG5cdFx0XG5cdFx0Ly8gR2V0IHJpZCBvZiBhbnkgY29kZXMgZnJvbSB0aGUgY29tcG91bmQgcnVsZSBjb2RlcyB0aGF0IGFyZSBuZXZlciB1c2VkIFxuXHRcdC8vIChvciB0aGF0IHdlcmUgc3BlY2lhbCByZWdleCBjaGFyYWN0ZXJzKS4gIE5vdCBlc3BlY2lhbGx5IG5lY2Vzc2FyeS4uLiBcblx0XHRmb3IgKGkgaW4gc2VsZi5jb21wb3VuZFJ1bGVDb2Rlcykge1xuXHRcdFx0aWYgKHNlbGYuY29tcG91bmRSdWxlQ29kZXNbaV0ubGVuZ3RoID09PSAwKSB7XG5cdFx0XHRcdGRlbGV0ZSBzZWxmLmNvbXBvdW5kUnVsZUNvZGVzW2ldO1xuXHRcdFx0fVxuXHRcdH1cblx0XHRcblx0XHQvLyBCdWlsZCB0aGUgZnVsbCByZWd1bGFyIGV4cHJlc3Npb25zIGZvciBlYWNoIGNvbXBvdW5kIHJ1bGUuXG5cdFx0Ly8gSSBoYXZlIGEgZmVlbGluZyAoYnV0IG5vIGNvbmZpcm1hdGlvbiB5ZXQpIHRoYXQgdGhpcyBtZXRob2Qgb2YgXG5cdFx0Ly8gdGVzdGluZyBmb3IgY29tcG91bmQgd29yZHMgaXMgcHJvYmFibHkgc2xvdy5cblx0XHRmb3IgKGkgPSAwLCBfbGVuID0gc2VsZi5jb21wb3VuZFJ1bGVzLmxlbmd0aDsgaSA8IF9sZW47IGkrKykge1xuXHRcdFx0dmFyIHJ1bGVUZXh0ID0gc2VsZi5jb21wb3VuZFJ1bGVzW2ldO1xuXHRcdFx0XG5cdFx0XHR2YXIgZXhwcmVzc2lvblRleHQgPSBcIlwiO1xuXHRcdFx0XG5cdFx0XHRmb3IgKGogPSAwLCBfamxlbiA9IHJ1bGVUZXh0Lmxlbmd0aDsgaiA8IF9qbGVuOyBqKyspIHtcblx0XHRcdFx0dmFyIGNoYXJhY3RlciA9IHJ1bGVUZXh0W2pdO1xuXHRcdFx0XHRcblx0XHRcdFx0aWYgKGNoYXJhY3RlciBpbiBzZWxmLmNvbXBvdW5kUnVsZUNvZGVzKSB7XG5cdFx0XHRcdFx0ZXhwcmVzc2lvblRleHQgKz0gXCIoXCIgKyBzZWxmLmNvbXBvdW5kUnVsZUNvZGVzW2NoYXJhY3Rlcl0uam9pbihcInxcIikgKyBcIilcIjtcblx0XHRcdFx0fVxuXHRcdFx0XHRlbHNlIHtcblx0XHRcdFx0XHRleHByZXNzaW9uVGV4dCArPSBjaGFyYWN0ZXI7XG5cdFx0XHRcdH1cblx0XHRcdH1cblx0XHRcdFxuXHRcdFx0c2VsZi5jb21wb3VuZFJ1bGVzW2ldID0gbmV3IFJlZ0V4cChleHByZXNzaW9uVGV4dCwgXCJpXCIpO1xuXHRcdH1cblx0XHRcblx0XHRzZWxmLmxvYWRlZCA9IHRydWU7XG5cdFx0XG5cdFx0aWYgKHNldHRpbmdzLmFzeW5jTG9hZCAmJiBzZXR0aW5ncy5sb2FkZWRDYWxsYmFjaykge1xuXHRcdFx0c2V0dGluZ3MubG9hZGVkQ2FsbGJhY2soc2VsZik7XG5cdFx0fVxuXHR9XG5cdFxuXHRyZXR1cm4gdGhpcztcbn07XG5cblR5cG8ucHJvdG90eXBlID0ge1xuXHQvKipcblx0ICogTG9hZHMgYSBUeXBvIGluc3RhbmNlIGZyb20gYSBoYXNoIG9mIGFsbCBvZiB0aGUgVHlwbyBwcm9wZXJ0aWVzLlxuXHQgKlxuXHQgKiBAcGFyYW0gb2JqZWN0IG9iaiBBIGhhc2ggb2YgVHlwbyBwcm9wZXJ0aWVzLCBwcm9iYWJseSBnb3R0ZW4gZnJvbSBhIEpTT04ucGFyc2UoSlNPTi5zdHJpbmdpZnkodHlwb19pbnN0YW5jZSkpLlxuXHQgKi9cblx0XG5cdGxvYWQgOiBmdW5jdGlvbiAob2JqKSB7XG5cdFx0Zm9yICh2YXIgaSBpbiBvYmopIHtcblx0XHRcdGlmIChvYmouaGFzT3duUHJvcGVydHkoaSkpIHtcblx0XHRcdFx0dGhpc1tpXSA9IG9ialtpXTtcblx0XHRcdH1cblx0XHR9XG5cdFx0XG5cdFx0cmV0dXJuIHRoaXM7XG5cdH0sXG5cdFxuXHQvKipcblx0ICogUmVhZCB0aGUgY29udGVudHMgb2YgYSBmaWxlLlxuXHQgKiBcblx0ICogQHBhcmFtIHtTdHJpbmd9IHBhdGggVGhlIHBhdGggKHJlbGF0aXZlKSB0byB0aGUgZmlsZS5cblx0ICogQHBhcmFtIHtTdHJpbmd9IFtjaGFyc2V0PVwiSVNPODg1OS0xXCJdIFRoZSBleHBlY3RlZCBjaGFyc2V0IG9mIHRoZSBmaWxlXG5cdCAqIEBwYXJhbSB7Qm9vbGVhbn0gYXN5bmMgSWYgdHJ1ZSwgdGhlIGZpbGUgd2lsbCBiZSByZWFkIGFzeW5jaHJvbm91c2x5LiBGb3Igbm9kZS5qcyB0aGlzIGRvZXMgbm90aGluZywgYWxsXG5cdCAqICAgICAgICBmaWxlcyBhcmUgcmVhZCBzeW5jaHJvbm91c2x5LlxuXHQgKiBAcmV0dXJucyB7U3RyaW5nfSBUaGUgZmlsZSBkYXRhIGlmIGFzeW5jIGlzIGZhbHNlLCBvdGhlcndpc2UgYSBwcm9taXNlIG9iamVjdC4gSWYgcnVubmluZyBub2RlLmpzLCB0aGUgZGF0YSBpc1xuXHQgKiAgICAgICAgICBhbHdheXMgcmV0dXJuZWQuXG5cdCAqL1xuXHRcblx0X3JlYWRGaWxlIDogZnVuY3Rpb24gKHBhdGgsIGNoYXJzZXQsIGFzeW5jKSB7XG5cdFx0Y2hhcnNldCA9IGNoYXJzZXQgfHwgXCJ1dGY4XCI7XG5cdFx0XG5cdFx0aWYgKHR5cGVvZiBYTUxIdHRwUmVxdWVzdCAhPT0gJ3VuZGVmaW5lZCcpIHtcblx0XHRcdHZhciBwcm9taXNlO1xuXHRcdFx0dmFyIHJlcSA9IG5ldyBYTUxIdHRwUmVxdWVzdCgpO1xuXHRcdFx0cmVxLm9wZW4oXCJHRVRcIiwgcGF0aCwgYXN5bmMpO1xuXHRcdFx0XG5cdFx0XHRpZiAoYXN5bmMpIHtcblx0XHRcdFx0cHJvbWlzZSA9IG5ldyBQcm9taXNlKGZ1bmN0aW9uKHJlc29sdmUsIHJlamVjdCkge1xuXHRcdFx0XHRcdHJlcS5vbmxvYWQgPSBmdW5jdGlvbigpIHtcblx0XHRcdFx0XHRcdGlmIChyZXEuc3RhdHVzID09PSAyMDApIHtcblx0XHRcdFx0XHRcdFx0cmVzb2x2ZShyZXEucmVzcG9uc2VUZXh0KTtcblx0XHRcdFx0XHRcdH1cblx0XHRcdFx0XHRcdGVsc2Uge1xuXHRcdFx0XHRcdFx0XHRyZWplY3QocmVxLnN0YXR1c1RleHQpO1xuXHRcdFx0XHRcdFx0fVxuXHRcdFx0XHRcdH07XG5cdFx0XHRcdFx0XG5cdFx0XHRcdFx0cmVxLm9uZXJyb3IgPSBmdW5jdGlvbigpIHtcblx0XHRcdFx0XHRcdHJlamVjdChyZXEuc3RhdHVzVGV4dCk7XG5cdFx0XHRcdFx0fVxuXHRcdFx0XHR9KTtcblx0XHRcdH1cblx0XHRcblx0XHRcdGlmIChyZXEub3ZlcnJpZGVNaW1lVHlwZSlcblx0XHRcdFx0cmVxLm92ZXJyaWRlTWltZVR5cGUoXCJ0ZXh0L3BsYWluOyBjaGFyc2V0PVwiICsgY2hhcnNldCk7XG5cdFx0XG5cdFx0XHRyZXEuc2VuZChudWxsKTtcblx0XHRcdFxuXHRcdFx0cmV0dXJuIGFzeW5jID8gcHJvbWlzZSA6IHJlcS5yZXNwb25zZVRleHQ7XG5cdFx0fVxuXHRcdGVsc2UgaWYgKHR5cGVvZiByZXF1aXJlICE9PSAndW5kZWZpbmVkJykge1xuXHRcdFx0Ly8gTm9kZS5qc1xuXHRcdFx0dmFyIGZzID0gcmVxdWlyZShcImZzXCIpO1xuXHRcdFx0XG5cdFx0XHR0cnkge1xuXHRcdFx0XHRpZiAoZnMuZXhpc3RzU3luYyhwYXRoKSkge1xuXHRcdFx0XHRcdHJldHVybiBmcy5yZWFkRmlsZVN5bmMocGF0aCwgY2hhcnNldCk7XG5cdFx0XHRcdH1cblx0XHRcdFx0ZWxzZSB7XG5cdFx0XHRcdFx0Y29uc29sZS5sb2coXCJQYXRoIFwiICsgcGF0aCArIFwiIGRvZXMgbm90IGV4aXN0LlwiKTtcblx0XHRcdFx0fVxuXHRcdFx0fSBjYXRjaCAoZSkge1xuXHRcdFx0XHRjb25zb2xlLmxvZyhlKTtcblx0XHRcdFx0cmV0dXJuICcnO1xuXHRcdFx0fVxuXHRcdH1cblx0fSxcblx0XG5cdC8qKlxuXHQgKiBQYXJzZSB0aGUgcnVsZXMgb3V0IGZyb20gYSAuYWZmIGZpbGUuXG5cdCAqXG5cdCAqIEBwYXJhbSB7U3RyaW5nfSBkYXRhIFRoZSBjb250ZW50cyBvZiB0aGUgYWZmaXggZmlsZS5cblx0ICogQHJldHVybnMgb2JqZWN0IFRoZSBydWxlcyBmcm9tIHRoZSBmaWxlLlxuXHQgKi9cblx0XG5cdF9wYXJzZUFGRiA6IGZ1bmN0aW9uIChkYXRhKSB7XG5cdFx0dmFyIHJ1bGVzID0ge307XG5cdFx0XG5cdFx0dmFyIGxpbmUsIHN1YmxpbmUsIG51bUVudHJpZXMsIGxpbmVQYXJ0cztcblx0XHR2YXIgaSwgaiwgX2xlbiwgX2psZW47XG5cdFx0XG5cdFx0Ly8gUmVtb3ZlIGNvbW1lbnQgbGluZXNcblx0XHRkYXRhID0gdGhpcy5fcmVtb3ZlQWZmaXhDb21tZW50cyhkYXRhKTtcblx0XHRcblx0XHR2YXIgbGluZXMgPSBkYXRhLnNwbGl0KC9cXHI/XFxuLyk7XG5cdFx0XG5cdFx0Zm9yIChpID0gMCwgX2xlbiA9IGxpbmVzLmxlbmd0aDsgaSA8IF9sZW47IGkrKykge1xuXHRcdFx0bGluZSA9IGxpbmVzW2ldO1xuXHRcdFx0XG5cdFx0XHR2YXIgZGVmaW5pdGlvblBhcnRzID0gbGluZS5zcGxpdCgvXFxzKy8pO1xuXHRcdFx0XG5cdFx0XHR2YXIgcnVsZVR5cGUgPSBkZWZpbml0aW9uUGFydHNbMF07XG5cdFx0XHRcblx0XHRcdGlmIChydWxlVHlwZSA9PSBcIlBGWFwiIHx8IHJ1bGVUeXBlID09IFwiU0ZYXCIpIHtcblx0XHRcdFx0dmFyIHJ1bGVDb2RlID0gZGVmaW5pdGlvblBhcnRzWzFdO1xuXHRcdFx0XHR2YXIgY29tYmluZWFibGUgPSBkZWZpbml0aW9uUGFydHNbMl07XG5cdFx0XHRcdG51bUVudHJpZXMgPSBwYXJzZUludChkZWZpbml0aW9uUGFydHNbM10sIDEwKTtcblx0XHRcdFx0XG5cdFx0XHRcdHZhciBlbnRyaWVzID0gW107XG5cdFx0XHRcdFxuXHRcdFx0XHRmb3IgKGogPSBpICsgMSwgX2psZW4gPSBpICsgMSArIG51bUVudHJpZXM7IGogPCBfamxlbjsgaisrKSB7XG5cdFx0XHRcdFx0c3VibGluZSA9IGxpbmVzW2pdO1xuXHRcdFx0XHRcdFxuXHRcdFx0XHRcdGxpbmVQYXJ0cyA9IHN1YmxpbmUuc3BsaXQoL1xccysvKTtcblx0XHRcdFx0XHR2YXIgY2hhcmFjdGVyc1RvUmVtb3ZlID0gbGluZVBhcnRzWzJdO1xuXHRcdFx0XHRcdFxuXHRcdFx0XHRcdHZhciBhZGRpdGlvblBhcnRzID0gbGluZVBhcnRzWzNdLnNwbGl0KFwiL1wiKTtcblx0XHRcdFx0XHRcblx0XHRcdFx0XHR2YXIgY2hhcmFjdGVyc1RvQWRkID0gYWRkaXRpb25QYXJ0c1swXTtcblx0XHRcdFx0XHRpZiAoY2hhcmFjdGVyc1RvQWRkID09PSBcIjBcIikgY2hhcmFjdGVyc1RvQWRkID0gXCJcIjtcblx0XHRcdFx0XHRcblx0XHRcdFx0XHR2YXIgY29udGludWF0aW9uQ2xhc3NlcyA9IHRoaXMucGFyc2VSdWxlQ29kZXMoYWRkaXRpb25QYXJ0c1sxXSk7XG5cdFx0XHRcdFx0XG5cdFx0XHRcdFx0dmFyIHJlZ2V4VG9NYXRjaCA9IGxpbmVQYXJ0c1s0XTtcblx0XHRcdFx0XHRcblx0XHRcdFx0XHR2YXIgZW50cnkgPSB7fTtcblx0XHRcdFx0XHRlbnRyeS5hZGQgPSBjaGFyYWN0ZXJzVG9BZGQ7XG5cdFx0XHRcdFx0XG5cdFx0XHRcdFx0aWYgKGNvbnRpbnVhdGlvbkNsYXNzZXMubGVuZ3RoID4gMCkgZW50cnkuY29udGludWF0aW9uQ2xhc3NlcyA9IGNvbnRpbnVhdGlvbkNsYXNzZXM7XG5cdFx0XHRcdFx0XG5cdFx0XHRcdFx0aWYgKHJlZ2V4VG9NYXRjaCAhPT0gXCIuXCIpIHtcblx0XHRcdFx0XHRcdGlmIChydWxlVHlwZSA9PT0gXCJTRlhcIikge1xuXHRcdFx0XHRcdFx0XHRlbnRyeS5tYXRjaCA9IG5ldyBSZWdFeHAocmVnZXhUb01hdGNoICsgXCIkXCIpO1xuXHRcdFx0XHRcdFx0fVxuXHRcdFx0XHRcdFx0ZWxzZSB7XG5cdFx0XHRcdFx0XHRcdGVudHJ5Lm1hdGNoID0gbmV3IFJlZ0V4cChcIl5cIiArIHJlZ2V4VG9NYXRjaCk7XG5cdFx0XHRcdFx0XHR9XG5cdFx0XHRcdFx0fVxuXHRcdFx0XHRcdFxuXHRcdFx0XHRcdGlmIChjaGFyYWN0ZXJzVG9SZW1vdmUgIT0gXCIwXCIpIHtcblx0XHRcdFx0XHRcdGlmIChydWxlVHlwZSA9PT0gXCJTRlhcIikge1xuXHRcdFx0XHRcdFx0XHRlbnRyeS5yZW1vdmUgPSBuZXcgUmVnRXhwKGNoYXJhY3RlcnNUb1JlbW92ZSAgKyBcIiRcIik7XG5cdFx0XHRcdFx0XHR9XG5cdFx0XHRcdFx0XHRlbHNlIHtcblx0XHRcdFx0XHRcdFx0ZW50cnkucmVtb3ZlID0gY2hhcmFjdGVyc1RvUmVtb3ZlO1xuXHRcdFx0XHRcdFx0fVxuXHRcdFx0XHRcdH1cblx0XHRcdFx0XHRcblx0XHRcdFx0XHRlbnRyaWVzLnB1c2goZW50cnkpO1xuXHRcdFx0XHR9XG5cdFx0XHRcdFxuXHRcdFx0XHRydWxlc1tydWxlQ29kZV0gPSB7IFwidHlwZVwiIDogcnVsZVR5cGUsIFwiY29tYmluZWFibGVcIiA6IChjb21iaW5lYWJsZSA9PSBcIllcIiksIFwiZW50cmllc1wiIDogZW50cmllcyB9O1xuXHRcdFx0XHRcblx0XHRcdFx0aSArPSBudW1FbnRyaWVzO1xuXHRcdFx0fVxuXHRcdFx0ZWxzZSBpZiAocnVsZVR5cGUgPT09IFwiQ09NUE9VTkRSVUxFXCIpIHtcblx0XHRcdFx0bnVtRW50cmllcyA9IHBhcnNlSW50KGRlZmluaXRpb25QYXJ0c1sxXSwgMTApO1xuXHRcdFx0XHRcblx0XHRcdFx0Zm9yIChqID0gaSArIDEsIF9qbGVuID0gaSArIDEgKyBudW1FbnRyaWVzOyBqIDwgX2psZW47IGorKykge1xuXHRcdFx0XHRcdGxpbmUgPSBsaW5lc1tqXTtcblx0XHRcdFx0XHRcblx0XHRcdFx0XHRsaW5lUGFydHMgPSBsaW5lLnNwbGl0KC9cXHMrLyk7XG5cdFx0XHRcdFx0dGhpcy5jb21wb3VuZFJ1bGVzLnB1c2gobGluZVBhcnRzWzFdKTtcblx0XHRcdFx0fVxuXHRcdFx0XHRcblx0XHRcdFx0aSArPSBudW1FbnRyaWVzO1xuXHRcdFx0fVxuXHRcdFx0ZWxzZSBpZiAocnVsZVR5cGUgPT09IFwiUkVQXCIpIHtcblx0XHRcdFx0bGluZVBhcnRzID0gbGluZS5zcGxpdCgvXFxzKy8pO1xuXHRcdFx0XHRcblx0XHRcdFx0aWYgKGxpbmVQYXJ0cy5sZW5ndGggPT09IDMpIHtcblx0XHRcdFx0XHR0aGlzLnJlcGxhY2VtZW50VGFibGUucHVzaChbIGxpbmVQYXJ0c1sxXSwgbGluZVBhcnRzWzJdIF0pO1xuXHRcdFx0XHR9XG5cdFx0XHR9XG5cdFx0XHRlbHNlIHtcblx0XHRcdFx0Ly8gT05MWUlOQ09NUE9VTkRcblx0XHRcdFx0Ly8gQ09NUE9VTkRNSU5cblx0XHRcdFx0Ly8gRkxBR1xuXHRcdFx0XHQvLyBLRUVQQ0FTRVxuXHRcdFx0XHQvLyBORUVEQUZGSVhcblx0XHRcdFx0XG5cdFx0XHRcdHRoaXMuZmxhZ3NbcnVsZVR5cGVdID0gZGVmaW5pdGlvblBhcnRzWzFdO1xuXHRcdFx0fVxuXHRcdH1cblx0XHRcblx0XHRyZXR1cm4gcnVsZXM7XG5cdH0sXG5cdFxuXHQvKipcblx0ICogUmVtb3ZlcyBjb21tZW50IGxpbmVzIGFuZCB0aGVuIGNsZWFucyB1cCBibGFuayBsaW5lcyBhbmQgdHJhaWxpbmcgd2hpdGVzcGFjZS5cblx0ICpcblx0ICogQHBhcmFtIHtTdHJpbmd9IGRhdGEgVGhlIGRhdGEgZnJvbSBhbiBhZmZpeCBmaWxlLlxuXHQgKiBAcmV0dXJuIHtTdHJpbmd9IFRoZSBjbGVhbmVkLXVwIGRhdGEuXG5cdCAqL1xuXHRcblx0X3JlbW92ZUFmZml4Q29tbWVudHMgOiBmdW5jdGlvbiAoZGF0YSkge1xuXHRcdC8vIFJlbW92ZSBjb21tZW50c1xuXHRcdC8vIFRoaXMgdXNlZCB0byByZW1vdmUgYW55IHN0cmluZyBzdGFydGluZyB3aXRoICcjJyB1cCB0byB0aGUgZW5kIG9mIHRoZSBsaW5lLFxuXHRcdC8vIGJ1dCBzb21lIENPTVBPVU5EUlVMRSBkZWZpbml0aW9ucyBpbmNsdWRlICcjJyBhcyBwYXJ0IG9mIHRoZSBydWxlLlxuXHRcdC8vIEkgaGF2ZW4ndCBzZWVuIGFueSBhZmZpeCBmaWxlcyB0aGF0IHVzZSBjb21tZW50cyBvbiB0aGUgc2FtZSBsaW5lIGFzIHJlYWwgZGF0YSxcblx0XHQvLyBzbyBJIGRvbid0IHRoaW5rIHRoaXMgd2lsbCBicmVhayBhbnl0aGluZy5cblx0XHRkYXRhID0gZGF0YS5yZXBsYWNlKC9eXFxzKiMuKiQvbWcsIFwiXCIpO1xuXHRcdFxuXHRcdC8vIFRyaW0gZWFjaCBsaW5lXG5cdFx0ZGF0YSA9IGRhdGEucmVwbGFjZSgvXlxcc1xccyovbSwgJycpLnJlcGxhY2UoL1xcc1xccyokL20sICcnKTtcblx0XHRcblx0XHQvLyBSZW1vdmUgYmxhbmsgbGluZXMuXG5cdFx0ZGF0YSA9IGRhdGEucmVwbGFjZSgvXFxuezIsfS9nLCBcIlxcblwiKTtcblx0XHRcblx0XHQvLyBUcmltIHRoZSBlbnRpcmUgc3RyaW5nXG5cdFx0ZGF0YSA9IGRhdGEucmVwbGFjZSgvXlxcc1xccyovLCAnJykucmVwbGFjZSgvXFxzXFxzKiQvLCAnJyk7XG5cdFx0XG5cdFx0cmV0dXJuIGRhdGE7XG5cdH0sXG5cdFxuXHQvKipcblx0ICogUGFyc2VzIHRoZSB3b3JkcyBvdXQgZnJvbSB0aGUgLmRpYyBmaWxlLlxuXHQgKlxuXHQgKiBAcGFyYW0ge1N0cmluZ30gZGF0YSBUaGUgZGF0YSBmcm9tIHRoZSBkaWN0aW9uYXJ5IGZpbGUuXG5cdCAqIEByZXR1cm5zIG9iamVjdCBUaGUgbG9va3VwIHRhYmxlIGNvbnRhaW5pbmcgYWxsIG9mIHRoZSB3b3JkcyBhbmRcblx0ICogICAgICAgICAgICAgICAgIHdvcmQgZm9ybXMgZnJvbSB0aGUgZGljdGlvbmFyeS5cblx0ICovXG5cdFxuXHRfcGFyc2VESUMgOiBmdW5jdGlvbiAoZGF0YSkge1xuXHRcdGRhdGEgPSB0aGlzLl9yZW1vdmVEaWNDb21tZW50cyhkYXRhKTtcblx0XHRcblx0XHR2YXIgbGluZXMgPSBkYXRhLnNwbGl0KC9cXHI/XFxuLyk7XG5cdFx0dmFyIGRpY3Rpb25hcnlUYWJsZSA9IHt9O1xuXHRcdFxuXHRcdGZ1bmN0aW9uIGFkZFdvcmQod29yZCwgcnVsZXMpIHtcblx0XHRcdC8vIFNvbWUgZGljdGlvbmFyaWVzIHdpbGwgbGlzdCB0aGUgc2FtZSB3b3JkIG11bHRpcGxlIHRpbWVzIHdpdGggZGlmZmVyZW50IHJ1bGUgc2V0cy5cblx0XHRcdGlmICghZGljdGlvbmFyeVRhYmxlLmhhc093blByb3BlcnR5KHdvcmQpKSB7XG5cdFx0XHRcdGRpY3Rpb25hcnlUYWJsZVt3b3JkXSA9IG51bGw7XG5cdFx0XHR9XG5cdFx0XHRcblx0XHRcdGlmIChydWxlcy5sZW5ndGggPiAwKSB7XG5cdFx0XHRcdGlmIChkaWN0aW9uYXJ5VGFibGVbd29yZF0gPT09IG51bGwpIHtcblx0XHRcdFx0XHRkaWN0aW9uYXJ5VGFibGVbd29yZF0gPSBbXTtcblx0XHRcdFx0fVxuXG5cdFx0XHRcdGRpY3Rpb25hcnlUYWJsZVt3b3JkXS5wdXNoKHJ1bGVzKTtcblx0XHRcdH1cblx0XHR9XG5cdFx0XG5cdFx0Ly8gVGhlIGZpcnN0IGxpbmUgaXMgdGhlIG51bWJlciBvZiB3b3JkcyBpbiB0aGUgZGljdGlvbmFyeS5cblx0XHRmb3IgKHZhciBpID0gMSwgX2xlbiA9IGxpbmVzLmxlbmd0aDsgaSA8IF9sZW47IGkrKykge1xuXHRcdFx0dmFyIGxpbmUgPSBsaW5lc1tpXTtcblx0XHRcdFxuXHRcdFx0aWYgKCFsaW5lKSB7XG5cdFx0XHRcdC8vIElnbm9yZSBlbXB0eSBsaW5lcy5cblx0XHRcdFx0Y29udGludWU7XG5cdFx0XHR9XG5cblx0XHRcdHZhciBwYXJ0cyA9IGxpbmUuc3BsaXQoXCIvXCIsIDIpO1xuXHRcdFx0XG5cdFx0XHR2YXIgd29yZCA9IHBhcnRzWzBdO1xuXG5cdFx0XHQvLyBOb3cgZm9yIGVhY2ggYWZmaXggcnVsZSwgZ2VuZXJhdGUgdGhhdCBmb3JtIG9mIHRoZSB3b3JkLlxuXHRcdFx0aWYgKHBhcnRzLmxlbmd0aCA+IDEpIHtcblx0XHRcdFx0dmFyIHJ1bGVDb2Rlc0FycmF5ID0gdGhpcy5wYXJzZVJ1bGVDb2RlcyhwYXJ0c1sxXSk7XG5cdFx0XHRcdFxuXHRcdFx0XHQvLyBTYXZlIHRoZSBydWxlQ29kZXMgZm9yIGNvbXBvdW5kIHdvcmQgc2l0dWF0aW9ucy5cblx0XHRcdFx0aWYgKCEoXCJORUVEQUZGSVhcIiBpbiB0aGlzLmZsYWdzKSB8fCBydWxlQ29kZXNBcnJheS5pbmRleE9mKHRoaXMuZmxhZ3MuTkVFREFGRklYKSA9PSAtMSkge1xuXHRcdFx0XHRcdGFkZFdvcmQod29yZCwgcnVsZUNvZGVzQXJyYXkpO1xuXHRcdFx0XHR9XG5cdFx0XHRcdFxuXHRcdFx0XHRmb3IgKHZhciBqID0gMCwgX2psZW4gPSBydWxlQ29kZXNBcnJheS5sZW5ndGg7IGogPCBfamxlbjsgaisrKSB7XG5cdFx0XHRcdFx0dmFyIGNvZGUgPSBydWxlQ29kZXNBcnJheVtqXTtcblx0XHRcdFx0XHRcblx0XHRcdFx0XHR2YXIgcnVsZSA9IHRoaXMucnVsZXNbY29kZV07XG5cdFx0XHRcdFx0XG5cdFx0XHRcdFx0aWYgKHJ1bGUpIHtcblx0XHRcdFx0XHRcdHZhciBuZXdXb3JkcyA9IHRoaXMuX2FwcGx5UnVsZSh3b3JkLCBydWxlKTtcblx0XHRcdFx0XHRcdFxuXHRcdFx0XHRcdFx0Zm9yICh2YXIgaWkgPSAwLCBfaWlsZW4gPSBuZXdXb3Jkcy5sZW5ndGg7IGlpIDwgX2lpbGVuOyBpaSsrKSB7XG5cdFx0XHRcdFx0XHRcdHZhciBuZXdXb3JkID0gbmV3V29yZHNbaWldO1xuXHRcdFx0XHRcdFx0XHRcblx0XHRcdFx0XHRcdFx0YWRkV29yZChuZXdXb3JkLCBbXSk7XG5cdFx0XHRcdFx0XHRcdFxuXHRcdFx0XHRcdFx0XHRpZiAocnVsZS5jb21iaW5lYWJsZSkge1xuXHRcdFx0XHRcdFx0XHRcdGZvciAodmFyIGsgPSBqICsgMTsgayA8IF9qbGVuOyBrKyspIHtcblx0XHRcdFx0XHRcdFx0XHRcdHZhciBjb21iaW5lQ29kZSA9IHJ1bGVDb2Rlc0FycmF5W2tdO1xuXHRcdFx0XHRcdFx0XHRcdFx0XG5cdFx0XHRcdFx0XHRcdFx0XHR2YXIgY29tYmluZVJ1bGUgPSB0aGlzLnJ1bGVzW2NvbWJpbmVDb2RlXTtcblx0XHRcdFx0XHRcdFx0XHRcdFxuXHRcdFx0XHRcdFx0XHRcdFx0aWYgKGNvbWJpbmVSdWxlKSB7XG5cdFx0XHRcdFx0XHRcdFx0XHRcdGlmIChjb21iaW5lUnVsZS5jb21iaW5lYWJsZSAmJiAocnVsZS50eXBlICE9IGNvbWJpbmVSdWxlLnR5cGUpKSB7XG5cdFx0XHRcdFx0XHRcdFx0XHRcdFx0dmFyIG90aGVyTmV3V29yZHMgPSB0aGlzLl9hcHBseVJ1bGUobmV3V29yZCwgY29tYmluZVJ1bGUpO1xuXHRcdFx0XHRcdFx0XHRcdFx0XHRcdFxuXHRcdFx0XHRcdFx0XHRcdFx0XHRcdGZvciAodmFyIGlpaSA9IDAsIF9paWlsZW4gPSBvdGhlck5ld1dvcmRzLmxlbmd0aDsgaWlpIDwgX2lpaWxlbjsgaWlpKyspIHtcblx0XHRcdFx0XHRcdFx0XHRcdFx0XHRcdHZhciBvdGhlck5ld1dvcmQgPSBvdGhlck5ld1dvcmRzW2lpaV07XG5cdFx0XHRcdFx0XHRcdFx0XHRcdFx0XHRhZGRXb3JkKG90aGVyTmV3V29yZCwgW10pO1xuXHRcdFx0XHRcdFx0XHRcdFx0XHRcdH1cblx0XHRcdFx0XHRcdFx0XHRcdFx0fVxuXHRcdFx0XHRcdFx0XHRcdFx0fVxuXHRcdFx0XHRcdFx0XHRcdH1cblx0XHRcdFx0XHRcdFx0fVxuXHRcdFx0XHRcdFx0fVxuXHRcdFx0XHRcdH1cblx0XHRcdFx0XHRcblx0XHRcdFx0XHRpZiAoY29kZSBpbiB0aGlzLmNvbXBvdW5kUnVsZUNvZGVzKSB7XG5cdFx0XHRcdFx0XHR0aGlzLmNvbXBvdW5kUnVsZUNvZGVzW2NvZGVdLnB1c2god29yZCk7XG5cdFx0XHRcdFx0fVxuXHRcdFx0XHR9XG5cdFx0XHR9XG5cdFx0XHRlbHNlIHtcblx0XHRcdFx0YWRkV29yZCh3b3JkLnRyaW0oKSwgW10pO1xuXHRcdFx0fVxuXHRcdH1cblx0XHRcblx0XHRyZXR1cm4gZGljdGlvbmFyeVRhYmxlO1xuXHR9LFxuXHRcblx0XG5cdC8qKlxuXHQgKiBSZW1vdmVzIGNvbW1lbnQgbGluZXMgYW5kIHRoZW4gY2xlYW5zIHVwIGJsYW5rIGxpbmVzIGFuZCB0cmFpbGluZyB3aGl0ZXNwYWNlLlxuXHQgKlxuXHQgKiBAcGFyYW0ge1N0cmluZ30gZGF0YSBUaGUgZGF0YSBmcm9tIGEgLmRpYyBmaWxlLlxuXHQgKiBAcmV0dXJuIHtTdHJpbmd9IFRoZSBjbGVhbmVkLXVwIGRhdGEuXG5cdCAqL1xuXHRcblx0X3JlbW92ZURpY0NvbW1lbnRzIDogZnVuY3Rpb24gKGRhdGEpIHtcblx0XHQvLyBJIGNhbid0IGZpbmQgYW55IG9mZmljaWFsIGRvY3VtZW50YXRpb24gb24gaXQsIGJ1dCBhdCBsZWFzdCB0aGUgZGVfREVcblx0XHQvLyBkaWN0aW9uYXJ5IHVzZXMgdGFiLWluZGVudGVkIGxpbmVzIGFzIGNvbW1lbnRzLlxuXHRcdFxuXHRcdC8vIFJlbW92ZSBjb21tZW50c1xuXHRcdGRhdGEgPSBkYXRhLnJlcGxhY2UoL15cXHQuKiQvbWcsIFwiXCIpO1xuXHRcdFxuXHRcdHJldHVybiBkYXRhO1xuXHR9LFxuXHRcblx0cGFyc2VSdWxlQ29kZXMgOiBmdW5jdGlvbiAodGV4dENvZGVzKSB7XG5cdFx0aWYgKCF0ZXh0Q29kZXMpIHtcblx0XHRcdHJldHVybiBbXTtcblx0XHR9XG5cdFx0ZWxzZSBpZiAoIShcIkZMQUdcIiBpbiB0aGlzLmZsYWdzKSkge1xuXHRcdFx0cmV0dXJuIHRleHRDb2Rlcy5zcGxpdChcIlwiKTtcblx0XHR9XG5cdFx0ZWxzZSBpZiAodGhpcy5mbGFncy5GTEFHID09PSBcImxvbmdcIikge1xuXHRcdFx0dmFyIGZsYWdzID0gW107XG5cdFx0XHRcblx0XHRcdGZvciAodmFyIGkgPSAwLCBfbGVuID0gdGV4dENvZGVzLmxlbmd0aDsgaSA8IF9sZW47IGkgKz0gMikge1xuXHRcdFx0XHRmbGFncy5wdXNoKHRleHRDb2Rlcy5zdWJzdHIoaSwgMikpO1xuXHRcdFx0fVxuXHRcdFx0XG5cdFx0XHRyZXR1cm4gZmxhZ3M7XG5cdFx0fVxuXHRcdGVsc2UgaWYgKHRoaXMuZmxhZ3MuRkxBRyA9PT0gXCJudW1cIikge1xuXHRcdFx0cmV0dXJuIHRleHRDb2Rlcy5zcGxpdChcIixcIik7XG5cdFx0fVxuXHR9LFxuXHRcblx0LyoqXG5cdCAqIEFwcGxpZXMgYW4gYWZmaXggcnVsZSB0byBhIHdvcmQuXG5cdCAqXG5cdCAqIEBwYXJhbSB7U3RyaW5nfSB3b3JkIFRoZSBiYXNlIHdvcmQuXG5cdCAqIEBwYXJhbSB7T2JqZWN0fSBydWxlIFRoZSBhZmZpeCBydWxlLlxuXHQgKiBAcmV0dXJucyB7U3RyaW5nW119IFRoZSBuZXcgd29yZHMgZ2VuZXJhdGVkIGJ5IHRoZSBydWxlLlxuXHQgKi9cblx0XG5cdF9hcHBseVJ1bGUgOiBmdW5jdGlvbiAod29yZCwgcnVsZSkge1xuXHRcdHZhciBlbnRyaWVzID0gcnVsZS5lbnRyaWVzO1xuXHRcdHZhciBuZXdXb3JkcyA9IFtdO1xuXHRcdFxuXHRcdGZvciAodmFyIGkgPSAwLCBfbGVuID0gZW50cmllcy5sZW5ndGg7IGkgPCBfbGVuOyBpKyspIHtcblx0XHRcdHZhciBlbnRyeSA9IGVudHJpZXNbaV07XG5cdFx0XHRcblx0XHRcdGlmICghZW50cnkubWF0Y2ggfHwgd29yZC5tYXRjaChlbnRyeS5tYXRjaCkpIHtcblx0XHRcdFx0dmFyIG5ld1dvcmQgPSB3b3JkO1xuXHRcdFx0XHRcblx0XHRcdFx0aWYgKGVudHJ5LnJlbW92ZSkge1xuXHRcdFx0XHRcdG5ld1dvcmQgPSBuZXdXb3JkLnJlcGxhY2UoZW50cnkucmVtb3ZlLCBcIlwiKTtcblx0XHRcdFx0fVxuXHRcdFx0XHRcblx0XHRcdFx0aWYgKHJ1bGUudHlwZSA9PT0gXCJTRlhcIikge1xuXHRcdFx0XHRcdG5ld1dvcmQgPSBuZXdXb3JkICsgZW50cnkuYWRkO1xuXHRcdFx0XHR9XG5cdFx0XHRcdGVsc2Uge1xuXHRcdFx0XHRcdG5ld1dvcmQgPSBlbnRyeS5hZGQgKyBuZXdXb3JkO1xuXHRcdFx0XHR9XG5cdFx0XHRcdFxuXHRcdFx0XHRuZXdXb3Jkcy5wdXNoKG5ld1dvcmQpO1xuXHRcdFx0XHRcblx0XHRcdFx0aWYgKFwiY29udGludWF0aW9uQ2xhc3Nlc1wiIGluIGVudHJ5KSB7XG5cdFx0XHRcdFx0Zm9yICh2YXIgaiA9IDAsIF9qbGVuID0gZW50cnkuY29udGludWF0aW9uQ2xhc3Nlcy5sZW5ndGg7IGogPCBfamxlbjsgaisrKSB7XG5cdFx0XHRcdFx0XHR2YXIgY29udGludWF0aW9uUnVsZSA9IHRoaXMucnVsZXNbZW50cnkuY29udGludWF0aW9uQ2xhc3Nlc1tqXV07XG5cdFx0XHRcdFx0XHRcblx0XHRcdFx0XHRcdGlmIChjb250aW51YXRpb25SdWxlKSB7XG5cdFx0XHRcdFx0XHRcdG5ld1dvcmRzID0gbmV3V29yZHMuY29uY2F0KHRoaXMuX2FwcGx5UnVsZShuZXdXb3JkLCBjb250aW51YXRpb25SdWxlKSk7XG5cdFx0XHRcdFx0XHR9XG5cdFx0XHRcdFx0XHQvKlxuXHRcdFx0XHRcdFx0ZWxzZSB7XG5cdFx0XHRcdFx0XHRcdC8vIFRoaXMgc2hvdWxkbid0IGhhcHBlbiwgYnV0IGl0IGRvZXMsIGF0IGxlYXN0IGluIHRoZSBkZV9ERSBkaWN0aW9uYXJ5LlxuXHRcdFx0XHRcdFx0XHQvLyBJIHRoaW5rIHRoZSBhdXRob3IgbWlzdGFrZW5seSBzdXBwbGllZCBsb3dlci1jYXNlIHJ1bGUgY29kZXMgaW5zdGVhZCBcblx0XHRcdFx0XHRcdFx0Ly8gb2YgdXBwZXItY2FzZS5cblx0XHRcdFx0XHRcdH1cblx0XHRcdFx0XHRcdCovXG5cdFx0XHRcdFx0fVxuXHRcdFx0XHR9XG5cdFx0XHR9XG5cdFx0fVxuXHRcdFxuXHRcdHJldHVybiBuZXdXb3Jkcztcblx0fSxcblx0XG5cdC8qKlxuXHQgKiBDaGVja3Mgd2hldGhlciBhIHdvcmQgb3IgYSBjYXBpdGFsaXphdGlvbiB2YXJpYW50IGV4aXN0cyBpbiB0aGUgY3VycmVudCBkaWN0aW9uYXJ5LlxuXHQgKiBUaGUgd29yZCBpcyB0cmltbWVkIGFuZCBzZXZlcmFsIHZhcmlhdGlvbnMgb2YgY2FwaXRhbGl6YXRpb25zIGFyZSBjaGVja2VkLlxuXHQgKiBJZiB5b3Ugd2FudCB0byBjaGVjayBhIHdvcmQgd2l0aG91dCBhbnkgY2hhbmdlcyBtYWRlIHRvIGl0LCBjYWxsIGNoZWNrRXhhY3QoKVxuXHQgKlxuXHQgKiBAc2VlIGh0dHA6Ly9ibG9nLnN0ZXZlbmxldml0aGFuLmNvbS9hcmNoaXZlcy9mYXN0ZXItdHJpbS1qYXZhc2NyaXB0IHJlOnRyaW1taW5nIGZ1bmN0aW9uXG5cdCAqXG5cdCAqIEBwYXJhbSB7U3RyaW5nfSBhV29yZCBUaGUgd29yZCB0byBjaGVjay5cblx0ICogQHJldHVybnMge0Jvb2xlYW59XG5cdCAqL1xuXHRcblx0Y2hlY2sgOiBmdW5jdGlvbiAoYVdvcmQpIHtcblx0XHRpZiAoIXRoaXMubG9hZGVkKSB7XG5cdFx0XHR0aHJvdyBcIkRpY3Rpb25hcnkgbm90IGxvYWRlZC5cIjtcblx0XHR9XG5cdFx0XG5cdFx0Ly8gUmVtb3ZlIGxlYWRpbmcgYW5kIHRyYWlsaW5nIHdoaXRlc3BhY2Vcblx0XHR2YXIgdHJpbW1lZFdvcmQgPSBhV29yZC5yZXBsYWNlKC9eXFxzXFxzKi8sICcnKS5yZXBsYWNlKC9cXHNcXHMqJC8sICcnKTtcblx0XHRcblx0XHRpZiAodGhpcy5jaGVja0V4YWN0KHRyaW1tZWRXb3JkKSkge1xuXHRcdFx0cmV0dXJuIHRydWU7XG5cdFx0fVxuXHRcdFxuXHRcdC8vIFRoZSBleGFjdCB3b3JkIGlzIG5vdCBpbiB0aGUgZGljdGlvbmFyeS5cblx0XHRpZiAodHJpbW1lZFdvcmQudG9VcHBlckNhc2UoKSA9PT0gdHJpbW1lZFdvcmQpIHtcblx0XHRcdC8vIFRoZSB3b3JkIHdhcyBzdXBwbGllZCBpbiBhbGwgdXBwZXJjYXNlLlxuXHRcdFx0Ly8gQ2hlY2sgZm9yIGEgY2FwaXRhbGl6ZWQgZm9ybSBvZiB0aGUgd29yZC5cblx0XHRcdHZhciBjYXBpdGFsaXplZFdvcmQgPSB0cmltbWVkV29yZFswXSArIHRyaW1tZWRXb3JkLnN1YnN0cmluZygxKS50b0xvd2VyQ2FzZSgpO1xuXHRcdFx0XG5cdFx0XHRpZiAodGhpcy5oYXNGbGFnKGNhcGl0YWxpemVkV29yZCwgXCJLRUVQQ0FTRVwiKSkge1xuXHRcdFx0XHQvLyBDYXBpdGFsaXphdGlvbiB2YXJpYW50cyBhcmUgbm90IGFsbG93ZWQgZm9yIHRoaXMgd29yZC5cblx0XHRcdFx0cmV0dXJuIGZhbHNlO1xuXHRcdFx0fVxuXHRcdFx0XG5cdFx0XHRpZiAodGhpcy5jaGVja0V4YWN0KGNhcGl0YWxpemVkV29yZCkpIHtcblx0XHRcdFx0Ly8gVGhlIGFsbC1jYXBzIHdvcmQgaXMgYSBjYXBpdGFsaXplZCB3b3JkIHNwZWxsZWQgY29ycmVjdGx5LlxuXHRcdFx0XHRyZXR1cm4gdHJ1ZTtcblx0XHRcdH1cblxuXHRcdFx0aWYgKHRoaXMuY2hlY2tFeGFjdCh0cmltbWVkV29yZC50b0xvd2VyQ2FzZSgpKSkge1xuXHRcdFx0XHQvLyBUaGUgYWxsLWNhcHMgaXMgYSBsb3dlcmNhc2Ugd29yZCBzcGVsbGVkIGNvcnJlY3RseS5cblx0XHRcdFx0cmV0dXJuIHRydWU7XG5cdFx0XHR9XG5cdFx0fVxuXHRcdFxuXHRcdHZhciB1bmNhcGl0YWxpemVkV29yZCA9IHRyaW1tZWRXb3JkWzBdLnRvTG93ZXJDYXNlKCkgKyB0cmltbWVkV29yZC5zdWJzdHJpbmcoMSk7XG5cdFx0XG5cdFx0aWYgKHVuY2FwaXRhbGl6ZWRXb3JkICE9PSB0cmltbWVkV29yZCkge1xuXHRcdFx0aWYgKHRoaXMuaGFzRmxhZyh1bmNhcGl0YWxpemVkV29yZCwgXCJLRUVQQ0FTRVwiKSkge1xuXHRcdFx0XHQvLyBDYXBpdGFsaXphdGlvbiB2YXJpYW50cyBhcmUgbm90IGFsbG93ZWQgZm9yIHRoaXMgd29yZC5cblx0XHRcdFx0cmV0dXJuIGZhbHNlO1xuXHRcdFx0fVxuXHRcdFx0XG5cdFx0XHQvLyBDaGVjayBmb3IgYW4gdW5jYXBpdGFsaXplZCBmb3JtXG5cdFx0XHRpZiAodGhpcy5jaGVja0V4YWN0KHVuY2FwaXRhbGl6ZWRXb3JkKSkge1xuXHRcdFx0XHQvLyBUaGUgd29yZCBpcyBzcGVsbGVkIGNvcnJlY3RseSBidXQgd2l0aCB0aGUgZmlyc3QgbGV0dGVyIGNhcGl0YWxpemVkLlxuXHRcdFx0XHRyZXR1cm4gdHJ1ZTtcblx0XHRcdH1cblx0XHR9XG5cdFx0XG5cdFx0cmV0dXJuIGZhbHNlO1xuXHR9LFxuXHRcblx0LyoqXG5cdCAqIENoZWNrcyB3aGV0aGVyIGEgd29yZCBleGlzdHMgaW4gdGhlIGN1cnJlbnQgZGljdGlvbmFyeS5cblx0ICpcblx0ICogQHBhcmFtIHtTdHJpbmd9IHdvcmQgVGhlIHdvcmQgdG8gY2hlY2suXG5cdCAqIEByZXR1cm5zIHtCb29sZWFufVxuXHQgKi9cblx0XG5cdGNoZWNrRXhhY3QgOiBmdW5jdGlvbiAod29yZCkge1xuXHRcdGlmICghdGhpcy5sb2FkZWQpIHtcblx0XHRcdHRocm93IFwiRGljdGlvbmFyeSBub3QgbG9hZGVkLlwiO1xuXHRcdH1cblxuXHRcdHZhciBydWxlQ29kZXMgPSB0aGlzLmRpY3Rpb25hcnlUYWJsZVt3b3JkXTtcblx0XHRcblx0XHR2YXIgaSwgX2xlbjtcblx0XHRcblx0XHRpZiAodHlwZW9mIHJ1bGVDb2RlcyA9PT0gJ3VuZGVmaW5lZCcpIHtcblx0XHRcdC8vIENoZWNrIGlmIHRoaXMgbWlnaHQgYmUgYSBjb21wb3VuZCB3b3JkLlxuXHRcdFx0aWYgKFwiQ09NUE9VTkRNSU5cIiBpbiB0aGlzLmZsYWdzICYmIHdvcmQubGVuZ3RoID49IHRoaXMuZmxhZ3MuQ09NUE9VTkRNSU4pIHtcblx0XHRcdFx0Zm9yIChpID0gMCwgX2xlbiA9IHRoaXMuY29tcG91bmRSdWxlcy5sZW5ndGg7IGkgPCBfbGVuOyBpKyspIHtcblx0XHRcdFx0XHRpZiAod29yZC5tYXRjaCh0aGlzLmNvbXBvdW5kUnVsZXNbaV0pKSB7XG5cdFx0XHRcdFx0XHRyZXR1cm4gdHJ1ZTtcblx0XHRcdFx0XHR9XG5cdFx0XHRcdH1cblx0XHRcdH1cblx0XHR9XG5cdFx0ZWxzZSBpZiAocnVsZUNvZGVzID09PSBudWxsKSB7XG5cdFx0XHQvLyBhIG51bGwgKGJ1dCBub3QgdW5kZWZpbmVkKSB2YWx1ZSBmb3IgYW4gZW50cnkgaW4gdGhlIGRpY3Rpb25hcnkgdGFibGVcblx0XHRcdC8vIG1lYW5zIHRoYXQgdGhlIHdvcmQgaXMgaW4gdGhlIGRpY3Rpb25hcnkgYnV0IGhhcyBubyBmbGFncy5cblx0XHRcdHJldHVybiB0cnVlO1xuXHRcdH1cblx0XHRlbHNlIGlmICh0eXBlb2YgcnVsZUNvZGVzID09PSAnb2JqZWN0JykgeyAvLyB0aGlzLmRpY3Rpb25hcnlbJ2hhc093blByb3BlcnR5J10gd2lsbCBiZSBhIGZ1bmN0aW9uLlxuXHRcdFx0Zm9yIChpID0gMCwgX2xlbiA9IHJ1bGVDb2Rlcy5sZW5ndGg7IGkgPCBfbGVuOyBpKyspIHtcblx0XHRcdFx0aWYgKCF0aGlzLmhhc0ZsYWcod29yZCwgXCJPTkxZSU5DT01QT1VORFwiLCBydWxlQ29kZXNbaV0pKSB7XG5cdFx0XHRcdFx0cmV0dXJuIHRydWU7XG5cdFx0XHRcdH1cblx0XHRcdH1cblx0XHR9XG5cblx0XHRyZXR1cm4gZmFsc2U7XG5cdH0sXG5cdFxuXHQvKipcblx0ICogTG9va3MgdXAgd2hldGhlciBhIGdpdmVuIHdvcmQgaXMgZmxhZ2dlZCB3aXRoIGEgZ2l2ZW4gZmxhZy5cblx0ICpcblx0ICogQHBhcmFtIHtTdHJpbmd9IHdvcmQgVGhlIHdvcmQgaW4gcXVlc3Rpb24uXG5cdCAqIEBwYXJhbSB7U3RyaW5nfSBmbGFnIFRoZSBmbGFnIGluIHF1ZXN0aW9uLlxuXHQgKiBAcmV0dXJuIHtCb29sZWFufVxuXHQgKi9cblx0IFxuXHRoYXNGbGFnIDogZnVuY3Rpb24gKHdvcmQsIGZsYWcsIHdvcmRGbGFncykge1xuXHRcdGlmICghdGhpcy5sb2FkZWQpIHtcblx0XHRcdHRocm93IFwiRGljdGlvbmFyeSBub3QgbG9hZGVkLlwiO1xuXHRcdH1cblxuXHRcdGlmIChmbGFnIGluIHRoaXMuZmxhZ3MpIHtcblx0XHRcdGlmICh0eXBlb2Ygd29yZEZsYWdzID09PSAndW5kZWZpbmVkJykge1xuXHRcdFx0XHR3b3JkRmxhZ3MgPSBBcnJheS5wcm90b3R5cGUuY29uY2F0LmFwcGx5KFtdLCB0aGlzLmRpY3Rpb25hcnlUYWJsZVt3b3JkXSk7XG5cdFx0XHR9XG5cdFx0XHRcblx0XHRcdGlmICh3b3JkRmxhZ3MgJiYgd29yZEZsYWdzLmluZGV4T2YodGhpcy5mbGFnc1tmbGFnXSkgIT09IC0xKSB7XG5cdFx0XHRcdHJldHVybiB0cnVlO1xuXHRcdFx0fVxuXHRcdH1cblx0XHRcblx0XHRyZXR1cm4gZmFsc2U7XG5cdH0sXG5cdFxuXHQvKipcblx0ICogUmV0dXJucyBhIGxpc3Qgb2Ygc3VnZ2VzdGlvbnMgZm9yIGEgbWlzc3BlbGxlZCB3b3JkLlxuXHQgKlxuXHQgKiBAc2VlIGh0dHA6Ly93d3cubm9ydmlnLmNvbS9zcGVsbC1jb3JyZWN0Lmh0bWwgZm9yIHRoZSBiYXNpcyBvZiB0aGlzIHN1Z2dlc3Rvci5cblx0ICogVGhpcyBzdWdnZXN0b3IgaXMgcHJpbWl0aXZlLCBidXQgaXQgd29ya3MuXG5cdCAqXG5cdCAqIEBwYXJhbSB7U3RyaW5nfSB3b3JkIFRoZSBtaXNzcGVsbGluZy5cblx0ICogQHBhcmFtIHtOdW1iZXJ9IFtsaW1pdD01XSBUaGUgbWF4aW11bSBudW1iZXIgb2Ygc3VnZ2VzdGlvbnMgdG8gcmV0dXJuLlxuXHQgKiBAcmV0dXJucyB7U3RyaW5nW119IFRoZSBhcnJheSBvZiBzdWdnZXN0aW9ucy5cblx0ICovXG5cdFxuXHRhbHBoYWJldCA6IFwiXCIsXG5cdFxuXHRzdWdnZXN0IDogZnVuY3Rpb24gKHdvcmQsIGxpbWl0KSB7XG5cdFx0aWYgKCF0aGlzLmxvYWRlZCkge1xuXHRcdFx0dGhyb3cgXCJEaWN0aW9uYXJ5IG5vdCBsb2FkZWQuXCI7XG5cdFx0fVxuXG5cdFx0bGltaXQgPSBsaW1pdCB8fCA1O1xuXG5cdFx0aWYgKHRoaXMubWVtb2l6ZWQuaGFzT3duUHJvcGVydHkod29yZCkpIHtcblx0XHRcdHZhciBtZW1vaXplZExpbWl0ID0gdGhpcy5tZW1vaXplZFt3b3JkXVsnbGltaXQnXTtcblxuXHRcdFx0Ly8gT25seSByZXR1cm4gdGhlIGNhY2hlZCBsaXN0IGlmIGl0J3MgYmlnIGVub3VnaCBvciBpZiB0aGVyZSB3ZXJlbid0IGVub3VnaCBzdWdnZXN0aW9uc1xuXHRcdFx0Ly8gdG8gZmlsbCBhIHNtYWxsZXIgbGltaXQuXG5cdFx0XHRpZiAobGltaXQgPD0gbWVtb2l6ZWRMaW1pdCB8fCB0aGlzLm1lbW9pemVkW3dvcmRdWydzdWdnZXN0aW9ucyddLmxlbmd0aCA8IG1lbW9pemVkTGltaXQpIHtcblx0XHRcdFx0cmV0dXJuIHRoaXMubWVtb2l6ZWRbd29yZF1bJ3N1Z2dlc3Rpb25zJ10uc2xpY2UoMCwgbGltaXQpO1xuXHRcdFx0fVxuXHRcdH1cblx0XHRcblx0XHRpZiAodGhpcy5jaGVjayh3b3JkKSkgcmV0dXJuIFtdO1xuXHRcdFxuXHRcdC8vIENoZWNrIHRoZSByZXBsYWNlbWVudCB0YWJsZS5cblx0XHRmb3IgKHZhciBpID0gMCwgX2xlbiA9IHRoaXMucmVwbGFjZW1lbnRUYWJsZS5sZW5ndGg7IGkgPCBfbGVuOyBpKyspIHtcblx0XHRcdHZhciByZXBsYWNlbWVudEVudHJ5ID0gdGhpcy5yZXBsYWNlbWVudFRhYmxlW2ldO1xuXHRcdFx0XG5cdFx0XHRpZiAod29yZC5pbmRleE9mKHJlcGxhY2VtZW50RW50cnlbMF0pICE9PSAtMSkge1xuXHRcdFx0XHR2YXIgY29ycmVjdGVkV29yZCA9IHdvcmQucmVwbGFjZShyZXBsYWNlbWVudEVudHJ5WzBdLCByZXBsYWNlbWVudEVudHJ5WzFdKTtcblx0XHRcdFx0XG5cdFx0XHRcdGlmICh0aGlzLmNoZWNrKGNvcnJlY3RlZFdvcmQpKSB7XG5cdFx0XHRcdFx0cmV0dXJuIFsgY29ycmVjdGVkV29yZCBdO1xuXHRcdFx0XHR9XG5cdFx0XHR9XG5cdFx0fVxuXHRcdFxuXHRcdHZhciBzZWxmID0gdGhpcztcblx0XHRzZWxmLmFscGhhYmV0ID0gXCJhYmNkZWZnaGlqa2xtbm9wcXJzdHV2d3h5elwiO1xuXHRcdFxuXHRcdC8qXG5cdFx0aWYgKCFzZWxmLmFscGhhYmV0KSB7XG5cdFx0XHQvLyBVc2UgdGhlIGFscGhhYmV0IGFzIGltcGxpY2l0bHkgZGVmaW5lZCBieSB0aGUgd29yZHMgaW4gdGhlIGRpY3Rpb25hcnkuXG5cdFx0XHR2YXIgYWxwaGFIYXNoID0ge307XG5cdFx0XHRcblx0XHRcdGZvciAodmFyIGkgaW4gc2VsZi5kaWN0aW9uYXJ5VGFibGUpIHtcblx0XHRcdFx0Zm9yICh2YXIgaiA9IDAsIF9sZW4gPSBpLmxlbmd0aDsgaiA8IF9sZW47IGorKykge1xuXHRcdFx0XHRcdGFscGhhSGFzaFtpW2pdXSA9IHRydWU7XG5cdFx0XHRcdH1cblx0XHRcdH1cblx0XHRcdFxuXHRcdFx0Zm9yICh2YXIgaSBpbiBhbHBoYUhhc2gpIHtcblx0XHRcdFx0c2VsZi5hbHBoYWJldCArPSBpO1xuXHRcdFx0fVxuXHRcdFx0XG5cdFx0XHR2YXIgYWxwaGFBcnJheSA9IHNlbGYuYWxwaGFiZXQuc3BsaXQoXCJcIik7XG5cdFx0XHRhbHBoYUFycmF5LnNvcnQoKTtcblx0XHRcdHNlbGYuYWxwaGFiZXQgPSBhbHBoYUFycmF5LmpvaW4oXCJcIik7XG5cdFx0fVxuXHRcdCovXG5cdFx0XG5cdFx0LyoqXG5cdFx0ICogUmV0dXJucyBhIGhhc2gga2V5ZWQgYnkgYWxsIG9mIHRoZSBzdHJpbmdzIHRoYXQgY2FuIGJlIG1hZGUgYnkgbWFraW5nIGEgc2luZ2xlIGVkaXQgdG8gdGhlIHdvcmQgKG9yIHdvcmRzIGluKSBgd29yZHNgXG5cdFx0ICogVGhlIHZhbHVlIG9mIGVhY2ggZW50cnkgaXMgdGhlIG51bWJlciBvZiB1bmlxdWUgd2F5cyB0aGF0IHRoZSByZXN1bHRpbmcgd29yZCBjYW4gYmUgbWFkZS5cblx0XHQgKlxuXHRcdCAqIEBhcmcgbWl4ZWQgd29yZHMgRWl0aGVyIGEgaGFzaCBrZXllZCBieSB3b3JkcyBvciBhIHN0cmluZyB3b3JkIHRvIG9wZXJhdGUgb24uXG5cdFx0ICogQGFyZyBib29sIGtub3duX29ubHkgV2hldGhlciB0aGlzIGZ1bmN0aW9uIHNob3VsZCBpZ25vcmUgc3RyaW5ncyB0aGF0IGFyZSBub3QgaW4gdGhlIGRpY3Rpb25hcnkuXG5cdFx0ICovXG5cdFx0ZnVuY3Rpb24gZWRpdHMxKHdvcmRzLCBrbm93bl9vbmx5KSB7XG5cdFx0XHR2YXIgcnYgPSB7fTtcblx0XHRcdFxuXHRcdFx0dmFyIGksIGosIF9paWxlbiwgX2xlbiwgX2psZW4sIF9lZGl0O1xuXG5cdFx0XHR2YXIgYWxwaGFiZXRMZW5ndGggPSBzZWxmLmFscGhhYmV0Lmxlbmd0aDtcblx0XHRcdFxuXHRcdFx0aWYgKHR5cGVvZiB3b3JkcyA9PSAnc3RyaW5nJykge1xuXHRcdFx0XHR2YXIgd29yZCA9IHdvcmRzO1xuXHRcdFx0XHR3b3JkcyA9IHt9O1xuXHRcdFx0XHR3b3Jkc1t3b3JkXSA9IHRydWU7XG5cdFx0XHR9XG5cblx0XHRcdGZvciAodmFyIHdvcmQgaW4gd29yZHMpIHtcblx0XHRcdFx0Zm9yIChpID0gMCwgX2xlbiA9IHdvcmQubGVuZ3RoICsgMTsgaSA8IF9sZW47IGkrKykge1xuXHRcdFx0XHRcdHZhciBzID0gWyB3b3JkLnN1YnN0cmluZygwLCBpKSwgd29yZC5zdWJzdHJpbmcoaSkgXTtcblx0XHRcdFx0XG5cdFx0XHRcdFx0Ly8gUmVtb3ZlIGEgbGV0dGVyLlxuXHRcdFx0XHRcdGlmIChzWzFdKSB7XG5cdFx0XHRcdFx0XHRfZWRpdCA9IHNbMF0gKyBzWzFdLnN1YnN0cmluZygxKTtcblxuXHRcdFx0XHRcdFx0aWYgKCFrbm93bl9vbmx5IHx8IHNlbGYuY2hlY2soX2VkaXQpKSB7XG5cdFx0XHRcdFx0XHRcdGlmICghKF9lZGl0IGluIHJ2KSkge1xuXHRcdFx0XHRcdFx0XHRcdHJ2W19lZGl0XSA9IDE7XG5cdFx0XHRcdFx0XHRcdH1cblx0XHRcdFx0XHRcdFx0ZWxzZSB7XG5cdFx0XHRcdFx0XHRcdFx0cnZbX2VkaXRdICs9IDE7XG5cdFx0XHRcdFx0XHRcdH1cblx0XHRcdFx0XHRcdH1cblx0XHRcdFx0XHR9XG5cdFx0XHRcdFx0XG5cdFx0XHRcdFx0Ly8gVHJhbnNwb3NlIGxldHRlcnNcblx0XHRcdFx0XHQvLyBFbGltaW5hdGUgdHJhbnNwb3NpdGlvbnMgb2YgaWRlbnRpY2FsIGxldHRlcnNcblx0XHRcdFx0XHRpZiAoc1sxXS5sZW5ndGggPiAxICYmIHNbMV1bMV0gIT09IHNbMV1bMF0pIHtcblx0XHRcdFx0XHRcdF9lZGl0ID0gc1swXSArIHNbMV1bMV0gKyBzWzFdWzBdICsgc1sxXS5zdWJzdHJpbmcoMik7XG5cblx0XHRcdFx0XHRcdGlmICgha25vd25fb25seSB8fCBzZWxmLmNoZWNrKF9lZGl0KSkge1xuXHRcdFx0XHRcdFx0XHRpZiAoIShfZWRpdCBpbiBydikpIHtcblx0XHRcdFx0XHRcdFx0XHRydltfZWRpdF0gPSAxO1xuXHRcdFx0XHRcdFx0XHR9XG5cdFx0XHRcdFx0XHRcdGVsc2Uge1xuXHRcdFx0XHRcdFx0XHRcdHJ2W19lZGl0XSArPSAxO1xuXHRcdFx0XHRcdFx0XHR9XG5cdFx0XHRcdFx0XHR9XG5cdFx0XHRcdFx0fVxuXG5cdFx0XHRcdFx0aWYgKHNbMV0pIHtcblx0XHRcdFx0XHRcdC8vIFJlcGxhY2UgYSBsZXR0ZXIgd2l0aCBhbm90aGVyIGxldHRlci5cblxuXHRcdFx0XHRcdFx0dmFyIGxldHRlcmNhc2UgPSAoc1sxXS5zdWJzdHJpbmcoMCwxKS50b1VwcGVyQ2FzZSgpID09PSBzWzFdLnN1YnN0cmluZygwLDEpKSA/ICd1cHBlcmNhc2UnIDogJ2xvd2VyY2FzZSc7XG5cblx0XHRcdFx0XHRcdGZvciAoaiA9IDA7IGogPCBhbHBoYWJldExlbmd0aDsgaisrKSB7XG5cdFx0XHRcdFx0XHRcdHZhciByZXBsYWNlbWVudExldHRlciA9IHNlbGYuYWxwaGFiZXRbal07XG5cblx0XHRcdFx0XHRcdFx0Ly8gU2V0IHRoZSBjYXNlIG9mIHRoZSByZXBsYWNlbWVudCBsZXR0ZXIgdG8gdGhlIHNhbWUgYXMgdGhlIGxldHRlciBiZWluZyByZXBsYWNlZC5cblx0XHRcdFx0XHRcdFx0aWYgKCAndXBwZXJjYXNlJyA9PT0gbGV0dGVyY2FzZSApIHtcblx0XHRcdFx0XHRcdFx0XHRyZXBsYWNlbWVudExldHRlciA9IHJlcGxhY2VtZW50TGV0dGVyLnRvVXBwZXJDYXNlKCk7XG5cdFx0XHRcdFx0XHRcdH1cblxuXHRcdFx0XHRcdFx0XHQvLyBFbGltaW5hdGUgcmVwbGFjZW1lbnQgb2YgYSBsZXR0ZXIgYnkgaXRzZWxmXG5cdFx0XHRcdFx0XHRcdGlmIChyZXBsYWNlbWVudExldHRlciAhPSBzWzFdLnN1YnN0cmluZygwLDEpKXtcblx0XHRcdFx0XHRcdFx0XHRfZWRpdCA9IHNbMF0gKyByZXBsYWNlbWVudExldHRlciArIHNbMV0uc3Vic3RyaW5nKDEpO1xuXG5cdFx0XHRcdFx0XHRcdFx0aWYgKCFrbm93bl9vbmx5IHx8IHNlbGYuY2hlY2soX2VkaXQpKSB7XG5cdFx0XHRcdFx0XHRcdFx0XHRpZiAoIShfZWRpdCBpbiBydikpIHtcblx0XHRcdFx0XHRcdFx0XHRcdFx0cnZbX2VkaXRdID0gMTtcblx0XHRcdFx0XHRcdFx0XHRcdH1cblx0XHRcdFx0XHRcdFx0XHRcdGVsc2Uge1xuXHRcdFx0XHRcdFx0XHRcdFx0XHRydltfZWRpdF0gKz0gMTtcblx0XHRcdFx0XHRcdFx0XHRcdH1cblx0XHRcdFx0XHRcdFx0XHR9XG5cdFx0XHRcdFx0XHRcdH1cblx0XHRcdFx0XHRcdH1cblx0XHRcdFx0XHR9XG5cblx0XHRcdFx0XHRpZiAoc1sxXSkge1xuXHRcdFx0XHRcdFx0Ly8gQWRkIGEgbGV0dGVyIGJldHdlZW4gZWFjaCBsZXR0ZXIuXG5cdFx0XHRcdFx0XHRmb3IgKGogPSAwOyBqIDwgYWxwaGFiZXRMZW5ndGg7IGorKykge1xuXHRcdFx0XHRcdFx0XHQvLyBJZiB0aGUgbGV0dGVycyBvbiBlYWNoIHNpZGUgYXJlIGNhcGl0YWxpemVkLCBjYXBpdGFsaXplIHRoZSByZXBsYWNlbWVudC5cblx0XHRcdFx0XHRcdFx0dmFyIGxldHRlcmNhc2UgPSAoc1swXS5zdWJzdHJpbmcoLTEpLnRvVXBwZXJDYXNlKCkgPT09IHNbMF0uc3Vic3RyaW5nKC0xKSAmJiBzWzFdLnN1YnN0cmluZygwLDEpLnRvVXBwZXJDYXNlKCkgPT09IHNbMV0uc3Vic3RyaW5nKDAsMSkpID8gJ3VwcGVyY2FzZScgOiAnbG93ZXJjYXNlJztcblxuXHRcdFx0XHRcdFx0XHR2YXIgcmVwbGFjZW1lbnRMZXR0ZXIgPSBzZWxmLmFscGhhYmV0W2pdO1xuXG5cdFx0XHRcdFx0XHRcdGlmICggJ3VwcGVyY2FzZScgPT09IGxldHRlcmNhc2UgKSB7XG5cdFx0XHRcdFx0XHRcdFx0cmVwbGFjZW1lbnRMZXR0ZXIgPSByZXBsYWNlbWVudExldHRlci50b1VwcGVyQ2FzZSgpO1xuXHRcdFx0XHRcdFx0XHR9XG5cblx0XHRcdFx0XHRcdFx0X2VkaXQgPSBzWzBdICsgcmVwbGFjZW1lbnRMZXR0ZXIgKyBzWzFdO1xuXG5cdFx0XHRcdFx0XHRcdGlmICgha25vd25fb25seSB8fCBzZWxmLmNoZWNrKF9lZGl0KSkge1xuXHRcdFx0XHRcdFx0XHRcdGlmICghKF9lZGl0IGluIHJ2KSkge1xuXHRcdFx0XHRcdFx0XHRcdFx0cnZbX2VkaXRdID0gMTtcblx0XHRcdFx0XHRcdFx0XHR9XG5cdFx0XHRcdFx0XHRcdFx0ZWxzZSB7XG5cdFx0XHRcdFx0XHRcdFx0XHRydltfZWRpdF0gKz0gMTtcblx0XHRcdFx0XHRcdFx0XHR9XG5cdFx0XHRcdFx0XHRcdH1cblx0XHRcdFx0XHRcdH1cblx0XHRcdFx0XHR9XG5cdFx0XHRcdH1cblx0XHRcdH1cblx0XHRcdFxuXHRcdFx0cmV0dXJuIHJ2O1xuXHRcdH1cblxuXHRcdGZ1bmN0aW9uIGNvcnJlY3Qod29yZCkge1xuXHRcdFx0Ly8gR2V0IHRoZSBlZGl0LWRpc3RhbmNlLTEgYW5kIGVkaXQtZGlzdGFuY2UtMiBmb3JtcyBvZiB0aGlzIHdvcmQuXG5cdFx0XHR2YXIgZWQxID0gZWRpdHMxKHdvcmQpO1xuXHRcdFx0dmFyIGVkMiA9IGVkaXRzMShlZDEsIHRydWUpO1xuXHRcdFx0XG5cdFx0XHQvLyBTb3J0IHRoZSBlZGl0cyBiYXNlZCBvbiBob3cgbWFueSBkaWZmZXJlbnQgd2F5cyB0aGV5IHdlcmUgY3JlYXRlZC5cblx0XHRcdHZhciB3ZWlnaHRlZF9jb3JyZWN0aW9ucyA9IGVkMjtcblx0XHRcdFxuXHRcdFx0Zm9yICh2YXIgZWQxd29yZCBpbiBlZDEpIHtcblx0XHRcdFx0aWYgKCFzZWxmLmNoZWNrKGVkMXdvcmQpKSB7XG5cdFx0XHRcdFx0Y29udGludWU7XG5cdFx0XHRcdH1cblxuXHRcdFx0XHRpZiAoZWQxd29yZCBpbiB3ZWlnaHRlZF9jb3JyZWN0aW9ucykge1xuXHRcdFx0XHRcdHdlaWdodGVkX2NvcnJlY3Rpb25zW2VkMXdvcmRdICs9IGVkMVtlZDF3b3JkXTtcblx0XHRcdFx0fVxuXHRcdFx0XHRlbHNlIHtcblx0XHRcdFx0XHR3ZWlnaHRlZF9jb3JyZWN0aW9uc1tlZDF3b3JkXSA9IGVkMVtlZDF3b3JkXTtcblx0XHRcdFx0fVxuXHRcdFx0fVxuXHRcdFx0XG5cdFx0XHR2YXIgaSwgX2xlbjtcblxuXHRcdFx0dmFyIHNvcnRlZF9jb3JyZWN0aW9ucyA9IFtdO1xuXHRcdFx0XG5cdFx0XHRmb3IgKGkgaW4gd2VpZ2h0ZWRfY29ycmVjdGlvbnMpIHtcblx0XHRcdFx0aWYgKHdlaWdodGVkX2NvcnJlY3Rpb25zLmhhc093blByb3BlcnR5KGkpKSB7XG5cdFx0XHRcdFx0c29ydGVkX2NvcnJlY3Rpb25zLnB1c2goWyBpLCB3ZWlnaHRlZF9jb3JyZWN0aW9uc1tpXSBdKTtcblx0XHRcdFx0fVxuXHRcdFx0fVxuXG5cdFx0XHRmdW5jdGlvbiBzb3J0ZXIoYSwgYikge1xuXHRcdFx0XHR2YXIgYV92YWwgPSBhWzFdO1xuXHRcdFx0XHR2YXIgYl92YWwgPSBiWzFdO1xuXHRcdFx0XHRpZiAoYV92YWwgPCBiX3ZhbCkge1xuXHRcdFx0XHRcdHJldHVybiAtMTtcblx0XHRcdFx0fSBlbHNlIGlmIChhX3ZhbCA+IGJfdmFsKSB7XG5cdFx0XHRcdFx0cmV0dXJuIDE7XG5cdFx0XHRcdH1cblx0XHRcdFx0Ly8gQHRvZG8gSWYgYSBhbmQgYiBhcmUgZXF1YWxseSB3ZWlnaHRlZCwgYWRkIG91ciBvd24gd2VpZ2h0IGJhc2VkIG9uIHNvbWV0aGluZyBsaWtlIHRoZSBrZXkgbG9jYXRpb25zIG9uIHRoaXMgbGFuZ3VhZ2UncyBkZWZhdWx0IGtleWJvYXJkLlxuXHRcdFx0XHRyZXR1cm4gYlswXS5sb2NhbGVDb21wYXJlKGFbMF0pO1xuXHRcdFx0fVxuXHRcdFx0XG5cdFx0XHRzb3J0ZWRfY29ycmVjdGlvbnMuc29ydChzb3J0ZXIpLnJldmVyc2UoKTtcblxuXHRcdFx0dmFyIHJ2ID0gW107XG5cblx0XHRcdHZhciBjYXBpdGFsaXphdGlvbl9zY2hlbWUgPSBcImxvd2VyY2FzZVwiO1xuXHRcdFx0XG5cdFx0XHRpZiAod29yZC50b1VwcGVyQ2FzZSgpID09PSB3b3JkKSB7XG5cdFx0XHRcdGNhcGl0YWxpemF0aW9uX3NjaGVtZSA9IFwidXBwZXJjYXNlXCI7XG5cdFx0XHR9XG5cdFx0XHRlbHNlIGlmICh3b3JkLnN1YnN0cigwLCAxKS50b1VwcGVyQ2FzZSgpICsgd29yZC5zdWJzdHIoMSkudG9Mb3dlckNhc2UoKSA9PT0gd29yZCkge1xuXHRcdFx0XHRjYXBpdGFsaXphdGlvbl9zY2hlbWUgPSBcImNhcGl0YWxpemVkXCI7XG5cdFx0XHR9XG5cdFx0XHRcblx0XHRcdHZhciB3b3JraW5nX2xpbWl0ID0gbGltaXQ7XG5cblx0XHRcdGZvciAoaSA9IDA7IGkgPCBNYXRoLm1pbih3b3JraW5nX2xpbWl0LCBzb3J0ZWRfY29ycmVjdGlvbnMubGVuZ3RoKTsgaSsrKSB7XG5cdFx0XHRcdGlmIChcInVwcGVyY2FzZVwiID09PSBjYXBpdGFsaXphdGlvbl9zY2hlbWUpIHtcblx0XHRcdFx0XHRzb3J0ZWRfY29ycmVjdGlvbnNbaV1bMF0gPSBzb3J0ZWRfY29ycmVjdGlvbnNbaV1bMF0udG9VcHBlckNhc2UoKTtcblx0XHRcdFx0fVxuXHRcdFx0XHRlbHNlIGlmIChcImNhcGl0YWxpemVkXCIgPT09IGNhcGl0YWxpemF0aW9uX3NjaGVtZSkge1xuXHRcdFx0XHRcdHNvcnRlZF9jb3JyZWN0aW9uc1tpXVswXSA9IHNvcnRlZF9jb3JyZWN0aW9uc1tpXVswXS5zdWJzdHIoMCwgMSkudG9VcHBlckNhc2UoKSArIHNvcnRlZF9jb3JyZWN0aW9uc1tpXVswXS5zdWJzdHIoMSk7XG5cdFx0XHRcdH1cblx0XHRcdFx0XG5cdFx0XHRcdGlmICghc2VsZi5oYXNGbGFnKHNvcnRlZF9jb3JyZWN0aW9uc1tpXVswXSwgXCJOT1NVR0dFU1RcIikgJiYgcnYuaW5kZXhPZihzb3J0ZWRfY29ycmVjdGlvbnNbaV1bMF0pID09IC0xKSB7XG5cdFx0XHRcdFx0cnYucHVzaChzb3J0ZWRfY29ycmVjdGlvbnNbaV1bMF0pO1xuXHRcdFx0XHR9XG5cdFx0XHRcdGVsc2Uge1xuXHRcdFx0XHRcdC8vIElmIG9uZSBvZiB0aGUgY29ycmVjdGlvbnMgaXMgbm90IGVsaWdpYmxlIGFzIGEgc3VnZ2VzdGlvbiAsIG1ha2Ugc3VyZSB3ZSBzdGlsbCByZXR1cm4gdGhlIHJpZ2h0IG51bWJlciBvZiBzdWdnZXN0aW9ucy5cblx0XHRcdFx0XHR3b3JraW5nX2xpbWl0Kys7XG5cdFx0XHRcdH1cblx0XHRcdH1cblxuXHRcdFx0cmV0dXJuIHJ2O1xuXHRcdH1cblx0XHRcblx0XHR0aGlzLm1lbW9pemVkW3dvcmRdID0ge1xuXHRcdFx0J3N1Z2dlc3Rpb25zJzogY29ycmVjdCh3b3JkKSxcblx0XHRcdCdsaW1pdCc6IGxpbWl0XG5cdFx0fTtcblxuXHRcdHJldHVybiB0aGlzLm1lbW9pemVkW3dvcmRdWydzdWdnZXN0aW9ucyddO1xuXHR9XG59O1xufSkoKTtcblxuLy8gU3VwcG9ydCBmb3IgdXNlIGFzIGEgbm9kZS5qcyBtb2R1bGUuXG5pZiAodHlwZW9mIG1vZHVsZSAhPT0gJ3VuZGVmaW5lZCcpIHtcblx0bW9kdWxlLmV4cG9ydHMgPSBUeXBvO1xufVxuIiwiXCJ1c2Ugc3RyaWN0XCI7XG5cbnZhciBUeXBvID0gcmVxdWlyZShcInR5cG8tanNcIik7XG5cbmZ1bmN0aW9uIENvZGVNaXJyb3JTcGVsbENoZWNrZXIob3B0aW9ucykge1xuXHRvcHRpb25zID0gb3B0aW9ucyB8fCB7fTtcblxuXHR2YXIgZGljdExhbmcgPSBcImVuX1VTXCI7XG5cblx0aWYob3B0aW9ucy5kaWN0aW9uYXJ5TGFuZ3VhZ2UpIHtcblx0XHRkaWN0TGFuZyA9IG9wdGlvbnMuZGljdGlvbmFyeUxhbmd1YWdlO1xuXHR9XG5cblx0aWYob3B0aW9ucy5lZGl0b3JJbnN0YW5jZSA9PSB1bmRlZmluZWQpIHtcblx0XHRjb25zb2xlLmVycm9yKFxuXHRcdFx0XCJDb2RlTWlycm9yIFNwZWxsIENoZWNrZXI6IFlvdSBtdXN0IHByb3ZpZGUgYW4gaW5zdGFuY2Ugb2YgYSBDb2RlTWlycm9yIGVkaXRvciB2aWEgdGhlIG9wdGlvbiBgZWRpdG9ySW5zdGFuY2VgXCJcblx0XHQpO1xuXHRcdHJldHVybjtcblx0fVxuXG5cdENvZGVNaXJyb3JTcGVsbENoZWNrZXIudHlwbyA9IG5ldyBUeXBvKGRpY3RMYW5nLCB1bmRlZmluZWQsIHVuZGVmaW5lZCwge1xuXHRcdHBsYXRmb3JtOiBcImFueVwiLFxuXHRcdGRpY3Rpb25hcnlQYXRoOiBcImh0dHBzOi8vc3BlbGxjaGVjay1kaWN0aW9uYXJpZXMuZ2l0aHViLmlvL1wiLFxuXHR9KTtcblxuXHR2YXIgd29yZFJlZ2V4ID0gL15bXiFcIiMkJSYoKSorLFxcLS4vOjs8PT4/QFtcXFxcXFxdXl9ge3x9flxcc10rLztcblxuXHRpZihvcHRpb25zLm1hdGNoUmVnZXggJiYgb3B0aW9ucy5tYXRjaFJlZ2V4IGluc3RhbmNlb2YgUmVnRXhwKSB7XG5cdFx0d29yZFJlZ2V4ID0gb3B0aW9ucy5tYXRjaFJlZ2V4O1xuXHR9XG5cblx0dmFyIHJlZ2V4SWdub3JlID0gL1swLTknXy1dKy87XG5cblx0aWYob3B0aW9ucy5pZ25vcmVSZWdleCAmJiBvcHRpb25zLmlnbm9yZVJlZ2V4IGluc3RhbmNlb2YgUmVnRXhwKSB7XG5cdFx0cmVnZXhJZ25vcmUgPSBvcHRpb25zLmlnbm9yZVJlZ2V4O1xuXHR9XG5cblx0dmFyIGN1c3RvbVdvcmRzID0gW107XG5cblx0aWYob3B0aW9ucy5jdXN0b21Xb3Jkcykge1xuXHRcdGlmKG9wdGlvbnMuY3VzdG9tV29yZHMgaW5zdGFuY2VvZiBGdW5jdGlvbikge1xuXHRcdFx0Y3VzdG9tV29yZHMgPSBvcHRpb25zLmN1c3RvbVdvcmRzKCk7XG5cdFx0fSBlbHNlIHtcblx0XHRcdGN1c3RvbVdvcmRzID0gb3B0aW9ucy5jdXN0b21Xb3Jkcztcblx0XHR9XG5cdH1cblxuXHR2YXIgY29tbWVudFJlZ2V4O1xuXG5cdGlmKG9wdGlvbnMuY29tbWVudFN0YXJ0KSB7XG5cdFx0Y29tbWVudFJlZ2V4ID0gbmV3IFJlZ0V4cChcIlxcXFxzKlwiICsgb3B0aW9ucy5jb21tZW50U3RhcnQpO1xuXHR9XG5cblx0dmFyIG92ZXJsYXkgPSB7XG5cdFx0dG9rZW46IGZ1bmN0aW9uKHN0cmVhbSkge1xuXHRcdFx0Ly8gSWdub3JlIGNvbW1lbnRzIGlmIGNvbmZpZ3VyZWQsIGFuZCBleGl0IGVhcmx5XG5cdFx0XHRpZihjb21tZW50UmVnZXggJiYgc3RyZWFtLnN0cmluZy5tYXRjaChjb21tZW50UmVnZXgpKSB7XG5cdFx0XHRcdHN0cmVhbS5uZXh0KCk7XG5cdFx0XHRcdHJldHVybiBudWxsO1xuXHRcdFx0fVxuXG5cdFx0XHR2YXIgd29yZCA9IHN0cmVhbS5tYXRjaCh3b3JkUmVnZXgsIHRydWUpO1xuXG5cdFx0XHRpZih3b3JkKSB7XG5cdFx0XHRcdHdvcmQgPSB3b3JkWzBdO1xuXHRcdFx0XHRpZihcblx0XHRcdFx0XHQhd29yZC5tYXRjaChyZWdleElnbm9yZSkgJiZcblx0XHRcdFx0XHRDb2RlTWlycm9yU3BlbGxDaGVja2VyLnR5cG8gJiZcblx0XHRcdFx0XHQhQ29kZU1pcnJvclNwZWxsQ2hlY2tlci50eXBvLmNoZWNrKHdvcmQpICYmXG5cdFx0XHRcdFx0IX5jdXN0b21Xb3Jkcy5pbmRleE9mKHdvcmQpXG5cdFx0XHRcdCkge1xuXHRcdFx0XHRcdHJldHVybiBcInNwZWxsLWVycm9yXCI7XG5cdFx0XHRcdH1cblx0XHRcdH0gZWxzZSB7XG5cdFx0XHRcdHN0cmVhbS5uZXh0KCk7XG5cdFx0XHRcdHJldHVybiBudWxsO1xuXHRcdFx0fVxuXHRcdH0sXG5cdH07XG5cblx0b3B0aW9ucy5lZGl0b3JJbnN0YW5jZS5hZGRPdmVybGF5KG92ZXJsYXkpO1xufVxuXG5Db2RlTWlycm9yU3BlbGxDaGVja2VyLnR5cG87XG5cbm1vZHVsZS5leHBvcnRzID0gQ29kZU1pcnJvclNwZWxsQ2hlY2tlcjsiXX0=
