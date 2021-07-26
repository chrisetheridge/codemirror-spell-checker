/**
 * @biscuitpants/codemirror-spell-checker v0.0.8
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
				"https://cdn.jsdelivr.net/npm/hunspell-dict-en-us@0.1.0/en-us.aff",
				true
			);
			xhr_aff.onload = function() {
				if(xhr_aff.readyState === 4 && xhr_aff.status === 200) {
					CodeMirrorSpellChecker.aff_data = xhr_aff.responseText;
					CodeMirrorSpellChecker.num_loaded++;

					if(CodeMirrorSpellChecker.num_loaded == 2) {
						CodeMirrorSpellChecker.typo = new Typo(
							"en_US",
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
				"https://cdn.jsdelivr.net/npm/hunspell-dict-en-us@0.1.0/en-us.dic",
				true
			);
			xhr_dic.onload = function() {
				if(xhr_dic.readyState === 4 && xhr_dic.status === 200) {
					CodeMirrorSpellChecker.dic_data = xhr_dic.responseText;
					CodeMirrorSpellChecker.num_loaded++;

					if(CodeMirrorSpellChecker.num_loaded == 2) {
						CodeMirrorSpellChecker.typo = new Typo(
							"en_US",
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
},{"typo-js":2}]},{},[3])(3)
});

//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJub2RlX21vZHVsZXMvYnJvd3Nlci1yZXNvbHZlL2VtcHR5LmpzIiwibm9kZV9tb2R1bGVzL3R5cG8tanMvdHlwby5qcyIsInNyYy9qcy9zcGVsbC1jaGVja2VyLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBO0FDQUE7OztBQ0FBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7OztBQy8rQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBIiwiZmlsZSI6ImdlbmVyYXRlZC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzQ29udGVudCI6WyIoZnVuY3Rpb24oKXtmdW5jdGlvbiByKGUsbix0KXtmdW5jdGlvbiBvKGksZil7aWYoIW5baV0pe2lmKCFlW2ldKXt2YXIgYz1cImZ1bmN0aW9uXCI9PXR5cGVvZiByZXF1aXJlJiZyZXF1aXJlO2lmKCFmJiZjKXJldHVybiBjKGksITApO2lmKHUpcmV0dXJuIHUoaSwhMCk7dmFyIGE9bmV3IEVycm9yKFwiQ2Fubm90IGZpbmQgbW9kdWxlICdcIitpK1wiJ1wiKTt0aHJvdyBhLmNvZGU9XCJNT0RVTEVfTk9UX0ZPVU5EXCIsYX12YXIgcD1uW2ldPXtleHBvcnRzOnt9fTtlW2ldWzBdLmNhbGwocC5leHBvcnRzLGZ1bmN0aW9uKHIpe3ZhciBuPWVbaV1bMV1bcl07cmV0dXJuIG8obnx8cil9LHAscC5leHBvcnRzLHIsZSxuLHQpfXJldHVybiBuW2ldLmV4cG9ydHN9Zm9yKHZhciB1PVwiZnVuY3Rpb25cIj09dHlwZW9mIHJlcXVpcmUmJnJlcXVpcmUsaT0wO2k8dC5sZW5ndGg7aSsrKW8odFtpXSk7cmV0dXJuIG99cmV0dXJuIHJ9KSgpIiwiIiwiLyogZ2xvYmFscyBjaHJvbWU6IGZhbHNlICovXG4vKiBnbG9iYWxzIF9fZGlybmFtZTogZmFsc2UgKi9cbi8qIGdsb2JhbHMgcmVxdWlyZTogZmFsc2UgKi9cbi8qIGdsb2JhbHMgQnVmZmVyOiBmYWxzZSAqL1xuLyogZ2xvYmFscyBtb2R1bGU6IGZhbHNlICovXG5cbi8qKlxuICogVHlwbyBpcyBhIEphdmFTY3JpcHQgaW1wbGVtZW50YXRpb24gb2YgYSBzcGVsbGNoZWNrZXIgdXNpbmcgaHVuc3BlbGwtc3R5bGUgXG4gKiBkaWN0aW9uYXJpZXMuXG4gKi9cblxudmFyIFR5cG87XG5cbihmdW5jdGlvbiAoKSB7XG5cInVzZSBzdHJpY3RcIjtcblxuLyoqXG4gKiBUeXBvIGNvbnN0cnVjdG9yLlxuICpcbiAqIEBwYXJhbSB7U3RyaW5nfSBbZGljdGlvbmFyeV0gVGhlIGxvY2FsZSBjb2RlIG9mIHRoZSBkaWN0aW9uYXJ5IGJlaW5nIHVzZWQuIGUuZy4sXG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIFwiZW5fVVNcIi4gVGhpcyBpcyBvbmx5IHVzZWQgdG8gYXV0by1sb2FkIGRpY3Rpb25hcmllcy5cbiAqIEBwYXJhbSB7U3RyaW5nfSBbYWZmRGF0YV0gICAgVGhlIGRhdGEgZnJvbSB0aGUgZGljdGlvbmFyeSdzIC5hZmYgZmlsZS4gSWYgb21pdHRlZFxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICBhbmQgVHlwby5qcyBpcyBiZWluZyB1c2VkIGluIGEgQ2hyb21lIGV4dGVuc2lvbiwgdGhlIC5hZmZcbiAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZmlsZSB3aWxsIGJlIGxvYWRlZCBhdXRvbWF0aWNhbGx5IGZyb21cbiAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbGliL3R5cG8vZGljdGlvbmFyaWVzL1tkaWN0aW9uYXJ5XS9bZGljdGlvbmFyeV0uYWZmXG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIEluIG90aGVyIGVudmlyb25tZW50cywgaXQgd2lsbCBiZSBsb2FkZWQgZnJvbVxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICBbc2V0dGluZ3MuZGljdGlvbmFyeVBhdGhdL2RpY3Rpb25hcmllcy9bZGljdGlvbmFyeV0vW2RpY3Rpb25hcnldLmFmZlxuICogQHBhcmFtIHtTdHJpbmd9IFt3b3Jkc0RhdGFdICBUaGUgZGF0YSBmcm9tIHRoZSBkaWN0aW9uYXJ5J3MgLmRpYyBmaWxlLiBJZiBvbWl0dGVkXG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGFuZCBUeXBvLmpzIGlzIGJlaW5nIHVzZWQgaW4gYSBDaHJvbWUgZXh0ZW5zaW9uLCB0aGUgLmRpY1xuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICBmaWxlIHdpbGwgYmUgbG9hZGVkIGF1dG9tYXRpY2FsbHkgZnJvbVxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICBsaWIvdHlwby9kaWN0aW9uYXJpZXMvW2RpY3Rpb25hcnldL1tkaWN0aW9uYXJ5XS5kaWNcbiAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgSW4gb3RoZXIgZW52aXJvbm1lbnRzLCBpdCB3aWxsIGJlIGxvYWRlZCBmcm9tXG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIFtzZXR0aW5ncy5kaWN0aW9uYXJ5UGF0aF0vZGljdGlvbmFyaWVzL1tkaWN0aW9uYXJ5XS9bZGljdGlvbmFyeV0uZGljXG4gKiBAcGFyYW0ge09iamVjdH0gW3NldHRpbmdzXSAgIENvbnN0cnVjdG9yIHNldHRpbmdzLiBBdmFpbGFibGUgcHJvcGVydGllcyBhcmU6XG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHtTdHJpbmd9IFtkaWN0aW9uYXJ5UGF0aF06IHBhdGggdG8gbG9hZCBkaWN0aW9uYXJ5IGZyb20gaW4gbm9uLWNocm9tZVxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICBlbnZpcm9ubWVudC5cbiAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAge09iamVjdH0gW2ZsYWdzXTogZmxhZyBpbmZvcm1hdGlvbi5cbiAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAge0Jvb2xlYW59IFthc3luY0xvYWRdOiBJZiB0cnVlLCBhZmZEYXRhIGFuZCB3b3Jkc0RhdGEgd2lsbCBiZSBsb2FkZWRcbiAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYXN5bmNocm9ub3VzbHkuXG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHtGdW5jdGlvbn0gW2xvYWRlZENhbGxiYWNrXTogQ2FsbGVkIHdoZW4gYm90aCBhZmZEYXRhIGFuZCB3b3Jkc0RhdGFcbiAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaGF2ZSBiZWVuIGxvYWRlZC4gT25seSB1c2VkIGlmIGFzeW5jTG9hZCBpcyBzZXQgdG8gdHJ1ZS4gVGhlIHBhcmFtZXRlclxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpcyB0aGUgaW5zdGFudGlhdGVkIFR5cG8gb2JqZWN0LlxuICpcbiAqIEByZXR1cm5zIHtUeXBvfSBBIFR5cG8gb2JqZWN0LlxuICovXG5cblR5cG8gPSBmdW5jdGlvbiAoZGljdGlvbmFyeSwgYWZmRGF0YSwgd29yZHNEYXRhLCBzZXR0aW5ncykge1xuXHRzZXR0aW5ncyA9IHNldHRpbmdzIHx8IHt9O1xuXG5cdHRoaXMuZGljdGlvbmFyeSA9IG51bGw7XG5cdFxuXHR0aGlzLnJ1bGVzID0ge307XG5cdHRoaXMuZGljdGlvbmFyeVRhYmxlID0ge307XG5cdFxuXHR0aGlzLmNvbXBvdW5kUnVsZXMgPSBbXTtcblx0dGhpcy5jb21wb3VuZFJ1bGVDb2RlcyA9IHt9O1xuXHRcblx0dGhpcy5yZXBsYWNlbWVudFRhYmxlID0gW107XG5cdFxuXHR0aGlzLmZsYWdzID0gc2V0dGluZ3MuZmxhZ3MgfHwge307IFxuXHRcblx0dGhpcy5tZW1vaXplZCA9IHt9O1xuXG5cdHRoaXMubG9hZGVkID0gZmFsc2U7XG5cdFxuXHR2YXIgc2VsZiA9IHRoaXM7XG5cdFxuXHR2YXIgcGF0aDtcblx0XG5cdC8vIExvb3AtY29udHJvbCB2YXJpYWJsZXMuXG5cdHZhciBpLCBqLCBfbGVuLCBfamxlbjtcblx0XG5cdGlmIChkaWN0aW9uYXJ5KSB7XG5cdFx0c2VsZi5kaWN0aW9uYXJ5ID0gZGljdGlvbmFyeTtcblx0XHRcblx0XHQvLyBJZiB0aGUgZGF0YSBpcyBwcmVsb2FkZWQsIGp1c3Qgc2V0dXAgdGhlIFR5cG8gb2JqZWN0LlxuXHRcdGlmIChhZmZEYXRhICYmIHdvcmRzRGF0YSkge1xuXHRcdFx0c2V0dXAoKTtcblx0XHR9XG5cdFx0Ly8gTG9hZGluZyBkYXRhIGZvciBDaHJvbWUgZXh0ZW50aW9ucy5cblx0XHRlbHNlIGlmICh0eXBlb2Ygd2luZG93ICE9PSAndW5kZWZpbmVkJyAmJiAnY2hyb21lJyBpbiB3aW5kb3cgJiYgJ2V4dGVuc2lvbicgaW4gd2luZG93LmNocm9tZSAmJiAnZ2V0VVJMJyBpbiB3aW5kb3cuY2hyb21lLmV4dGVuc2lvbikge1xuXHRcdFx0aWYgKHNldHRpbmdzLmRpY3Rpb25hcnlQYXRoKSB7XG5cdFx0XHRcdHBhdGggPSBzZXR0aW5ncy5kaWN0aW9uYXJ5UGF0aDtcblx0XHRcdH1cblx0XHRcdGVsc2Uge1xuXHRcdFx0XHRwYXRoID0gXCJ0eXBvL2RpY3Rpb25hcmllc1wiO1xuXHRcdFx0fVxuXHRcdFx0XG5cdFx0XHRpZiAoIWFmZkRhdGEpIHJlYWREYXRhRmlsZShjaHJvbWUuZXh0ZW5zaW9uLmdldFVSTChwYXRoICsgXCIvXCIgKyBkaWN0aW9uYXJ5ICsgXCIvXCIgKyBkaWN0aW9uYXJ5ICsgXCIuYWZmXCIpLCBzZXRBZmZEYXRhKTtcblx0XHRcdGlmICghd29yZHNEYXRhKSByZWFkRGF0YUZpbGUoY2hyb21lLmV4dGVuc2lvbi5nZXRVUkwocGF0aCArIFwiL1wiICsgZGljdGlvbmFyeSArIFwiL1wiICsgZGljdGlvbmFyeSArIFwiLmRpY1wiKSwgc2V0V29yZHNEYXRhKTtcblx0XHR9XG5cdFx0ZWxzZSB7XG5cdFx0XHRpZiAoc2V0dGluZ3MuZGljdGlvbmFyeVBhdGgpIHtcblx0XHRcdFx0cGF0aCA9IHNldHRpbmdzLmRpY3Rpb25hcnlQYXRoO1xuXHRcdFx0fVxuXHRcdFx0ZWxzZSBpZiAodHlwZW9mIF9fZGlybmFtZSAhPT0gJ3VuZGVmaW5lZCcpIHtcblx0XHRcdFx0cGF0aCA9IF9fZGlybmFtZSArICcvZGljdGlvbmFyaWVzJztcblx0XHRcdH1cblx0XHRcdGVsc2Uge1xuXHRcdFx0XHRwYXRoID0gJy4vZGljdGlvbmFyaWVzJztcblx0XHRcdH1cblx0XHRcdFxuXHRcdFx0aWYgKCFhZmZEYXRhKSByZWFkRGF0YUZpbGUocGF0aCArIFwiL1wiICsgZGljdGlvbmFyeSArIFwiL1wiICsgZGljdGlvbmFyeSArIFwiLmFmZlwiLCBzZXRBZmZEYXRhKTtcblx0XHRcdGlmICghd29yZHNEYXRhKSByZWFkRGF0YUZpbGUocGF0aCArIFwiL1wiICsgZGljdGlvbmFyeSArIFwiL1wiICsgZGljdGlvbmFyeSArIFwiLmRpY1wiLCBzZXRXb3Jkc0RhdGEpO1xuXHRcdH1cblx0fVxuXHRcblx0ZnVuY3Rpb24gcmVhZERhdGFGaWxlKHVybCwgc2V0RnVuYykge1xuXHRcdHZhciByZXNwb25zZSA9IHNlbGYuX3JlYWRGaWxlKHVybCwgbnVsbCwgc2V0dGluZ3MuYXN5bmNMb2FkKTtcblx0XHRcblx0XHRpZiAoc2V0dGluZ3MuYXN5bmNMb2FkKSB7XG5cdFx0XHRyZXNwb25zZS50aGVuKGZ1bmN0aW9uKGRhdGEpIHtcblx0XHRcdFx0c2V0RnVuYyhkYXRhKTtcblx0XHRcdH0pO1xuXHRcdH1cblx0XHRlbHNlIHtcblx0XHRcdHNldEZ1bmMocmVzcG9uc2UpO1xuXHRcdH1cblx0fVxuXG5cdGZ1bmN0aW9uIHNldEFmZkRhdGEoZGF0YSkge1xuXHRcdGFmZkRhdGEgPSBkYXRhO1xuXG5cdFx0aWYgKHdvcmRzRGF0YSkge1xuXHRcdFx0c2V0dXAoKTtcblx0XHR9XG5cdH1cblxuXHRmdW5jdGlvbiBzZXRXb3Jkc0RhdGEoZGF0YSkge1xuXHRcdHdvcmRzRGF0YSA9IGRhdGE7XG5cblx0XHRpZiAoYWZmRGF0YSkge1xuXHRcdFx0c2V0dXAoKTtcblx0XHR9XG5cdH1cblxuXHRmdW5jdGlvbiBzZXR1cCgpIHtcblx0XHRzZWxmLnJ1bGVzID0gc2VsZi5fcGFyc2VBRkYoYWZmRGF0YSk7XG5cdFx0XG5cdFx0Ly8gU2F2ZSB0aGUgcnVsZSBjb2RlcyB0aGF0IGFyZSB1c2VkIGluIGNvbXBvdW5kIHJ1bGVzLlxuXHRcdHNlbGYuY29tcG91bmRSdWxlQ29kZXMgPSB7fTtcblx0XHRcblx0XHRmb3IgKGkgPSAwLCBfbGVuID0gc2VsZi5jb21wb3VuZFJ1bGVzLmxlbmd0aDsgaSA8IF9sZW47IGkrKykge1xuXHRcdFx0dmFyIHJ1bGUgPSBzZWxmLmNvbXBvdW5kUnVsZXNbaV07XG5cdFx0XHRcblx0XHRcdGZvciAoaiA9IDAsIF9qbGVuID0gcnVsZS5sZW5ndGg7IGogPCBfamxlbjsgaisrKSB7XG5cdFx0XHRcdHNlbGYuY29tcG91bmRSdWxlQ29kZXNbcnVsZVtqXV0gPSBbXTtcblx0XHRcdH1cblx0XHR9XG5cdFx0XG5cdFx0Ly8gSWYgd2UgYWRkIHRoaXMgT05MWUlOQ09NUE9VTkQgZmxhZyB0byBzZWxmLmNvbXBvdW5kUnVsZUNvZGVzLCB0aGVuIF9wYXJzZURJQ1xuXHRcdC8vIHdpbGwgZG8gdGhlIHdvcmsgb2Ygc2F2aW5nIHRoZSBsaXN0IG9mIHdvcmRzIHRoYXQgYXJlIGNvbXBvdW5kLW9ubHkuXG5cdFx0aWYgKFwiT05MWUlOQ09NUE9VTkRcIiBpbiBzZWxmLmZsYWdzKSB7XG5cdFx0XHRzZWxmLmNvbXBvdW5kUnVsZUNvZGVzW3NlbGYuZmxhZ3MuT05MWUlOQ09NUE9VTkRdID0gW107XG5cdFx0fVxuXHRcdFxuXHRcdHNlbGYuZGljdGlvbmFyeVRhYmxlID0gc2VsZi5fcGFyc2VESUMod29yZHNEYXRhKTtcblx0XHRcblx0XHQvLyBHZXQgcmlkIG9mIGFueSBjb2RlcyBmcm9tIHRoZSBjb21wb3VuZCBydWxlIGNvZGVzIHRoYXQgYXJlIG5ldmVyIHVzZWQgXG5cdFx0Ly8gKG9yIHRoYXQgd2VyZSBzcGVjaWFsIHJlZ2V4IGNoYXJhY3RlcnMpLiAgTm90IGVzcGVjaWFsbHkgbmVjZXNzYXJ5Li4uIFxuXHRcdGZvciAoaSBpbiBzZWxmLmNvbXBvdW5kUnVsZUNvZGVzKSB7XG5cdFx0XHRpZiAoc2VsZi5jb21wb3VuZFJ1bGVDb2Rlc1tpXS5sZW5ndGggPT09IDApIHtcblx0XHRcdFx0ZGVsZXRlIHNlbGYuY29tcG91bmRSdWxlQ29kZXNbaV07XG5cdFx0XHR9XG5cdFx0fVxuXHRcdFxuXHRcdC8vIEJ1aWxkIHRoZSBmdWxsIHJlZ3VsYXIgZXhwcmVzc2lvbnMgZm9yIGVhY2ggY29tcG91bmQgcnVsZS5cblx0XHQvLyBJIGhhdmUgYSBmZWVsaW5nIChidXQgbm8gY29uZmlybWF0aW9uIHlldCkgdGhhdCB0aGlzIG1ldGhvZCBvZiBcblx0XHQvLyB0ZXN0aW5nIGZvciBjb21wb3VuZCB3b3JkcyBpcyBwcm9iYWJseSBzbG93LlxuXHRcdGZvciAoaSA9IDAsIF9sZW4gPSBzZWxmLmNvbXBvdW5kUnVsZXMubGVuZ3RoOyBpIDwgX2xlbjsgaSsrKSB7XG5cdFx0XHR2YXIgcnVsZVRleHQgPSBzZWxmLmNvbXBvdW5kUnVsZXNbaV07XG5cdFx0XHRcblx0XHRcdHZhciBleHByZXNzaW9uVGV4dCA9IFwiXCI7XG5cdFx0XHRcblx0XHRcdGZvciAoaiA9IDAsIF9qbGVuID0gcnVsZVRleHQubGVuZ3RoOyBqIDwgX2psZW47IGorKykge1xuXHRcdFx0XHR2YXIgY2hhcmFjdGVyID0gcnVsZVRleHRbal07XG5cdFx0XHRcdFxuXHRcdFx0XHRpZiAoY2hhcmFjdGVyIGluIHNlbGYuY29tcG91bmRSdWxlQ29kZXMpIHtcblx0XHRcdFx0XHRleHByZXNzaW9uVGV4dCArPSBcIihcIiArIHNlbGYuY29tcG91bmRSdWxlQ29kZXNbY2hhcmFjdGVyXS5qb2luKFwifFwiKSArIFwiKVwiO1xuXHRcdFx0XHR9XG5cdFx0XHRcdGVsc2Uge1xuXHRcdFx0XHRcdGV4cHJlc3Npb25UZXh0ICs9IGNoYXJhY3Rlcjtcblx0XHRcdFx0fVxuXHRcdFx0fVxuXHRcdFx0XG5cdFx0XHRzZWxmLmNvbXBvdW5kUnVsZXNbaV0gPSBuZXcgUmVnRXhwKGV4cHJlc3Npb25UZXh0LCBcImlcIik7XG5cdFx0fVxuXHRcdFxuXHRcdHNlbGYubG9hZGVkID0gdHJ1ZTtcblx0XHRcblx0XHRpZiAoc2V0dGluZ3MuYXN5bmNMb2FkICYmIHNldHRpbmdzLmxvYWRlZENhbGxiYWNrKSB7XG5cdFx0XHRzZXR0aW5ncy5sb2FkZWRDYWxsYmFjayhzZWxmKTtcblx0XHR9XG5cdH1cblx0XG5cdHJldHVybiB0aGlzO1xufTtcblxuVHlwby5wcm90b3R5cGUgPSB7XG5cdC8qKlxuXHQgKiBMb2FkcyBhIFR5cG8gaW5zdGFuY2UgZnJvbSBhIGhhc2ggb2YgYWxsIG9mIHRoZSBUeXBvIHByb3BlcnRpZXMuXG5cdCAqXG5cdCAqIEBwYXJhbSBvYmplY3Qgb2JqIEEgaGFzaCBvZiBUeXBvIHByb3BlcnRpZXMsIHByb2JhYmx5IGdvdHRlbiBmcm9tIGEgSlNPTi5wYXJzZShKU09OLnN0cmluZ2lmeSh0eXBvX2luc3RhbmNlKSkuXG5cdCAqL1xuXHRcblx0bG9hZCA6IGZ1bmN0aW9uIChvYmopIHtcblx0XHRmb3IgKHZhciBpIGluIG9iaikge1xuXHRcdFx0aWYgKG9iai5oYXNPd25Qcm9wZXJ0eShpKSkge1xuXHRcdFx0XHR0aGlzW2ldID0gb2JqW2ldO1xuXHRcdFx0fVxuXHRcdH1cblx0XHRcblx0XHRyZXR1cm4gdGhpcztcblx0fSxcblx0XG5cdC8qKlxuXHQgKiBSZWFkIHRoZSBjb250ZW50cyBvZiBhIGZpbGUuXG5cdCAqIFxuXHQgKiBAcGFyYW0ge1N0cmluZ30gcGF0aCBUaGUgcGF0aCAocmVsYXRpdmUpIHRvIHRoZSBmaWxlLlxuXHQgKiBAcGFyYW0ge1N0cmluZ30gW2NoYXJzZXQ9XCJJU084ODU5LTFcIl0gVGhlIGV4cGVjdGVkIGNoYXJzZXQgb2YgdGhlIGZpbGVcblx0ICogQHBhcmFtIHtCb29sZWFufSBhc3luYyBJZiB0cnVlLCB0aGUgZmlsZSB3aWxsIGJlIHJlYWQgYXN5bmNocm9ub3VzbHkuIEZvciBub2RlLmpzIHRoaXMgZG9lcyBub3RoaW5nLCBhbGxcblx0ICogICAgICAgIGZpbGVzIGFyZSByZWFkIHN5bmNocm9ub3VzbHkuXG5cdCAqIEByZXR1cm5zIHtTdHJpbmd9IFRoZSBmaWxlIGRhdGEgaWYgYXN5bmMgaXMgZmFsc2UsIG90aGVyd2lzZSBhIHByb21pc2Ugb2JqZWN0LiBJZiBydW5uaW5nIG5vZGUuanMsIHRoZSBkYXRhIGlzXG5cdCAqICAgICAgICAgIGFsd2F5cyByZXR1cm5lZC5cblx0ICovXG5cdFxuXHRfcmVhZEZpbGUgOiBmdW5jdGlvbiAocGF0aCwgY2hhcnNldCwgYXN5bmMpIHtcblx0XHRjaGFyc2V0ID0gY2hhcnNldCB8fCBcInV0ZjhcIjtcblx0XHRcblx0XHRpZiAodHlwZW9mIFhNTEh0dHBSZXF1ZXN0ICE9PSAndW5kZWZpbmVkJykge1xuXHRcdFx0dmFyIHByb21pc2U7XG5cdFx0XHR2YXIgcmVxID0gbmV3IFhNTEh0dHBSZXF1ZXN0KCk7XG5cdFx0XHRyZXEub3BlbihcIkdFVFwiLCBwYXRoLCBhc3luYyk7XG5cdFx0XHRcblx0XHRcdGlmIChhc3luYykge1xuXHRcdFx0XHRwcm9taXNlID0gbmV3IFByb21pc2UoZnVuY3Rpb24ocmVzb2x2ZSwgcmVqZWN0KSB7XG5cdFx0XHRcdFx0cmVxLm9ubG9hZCA9IGZ1bmN0aW9uKCkge1xuXHRcdFx0XHRcdFx0aWYgKHJlcS5zdGF0dXMgPT09IDIwMCkge1xuXHRcdFx0XHRcdFx0XHRyZXNvbHZlKHJlcS5yZXNwb25zZVRleHQpO1xuXHRcdFx0XHRcdFx0fVxuXHRcdFx0XHRcdFx0ZWxzZSB7XG5cdFx0XHRcdFx0XHRcdHJlamVjdChyZXEuc3RhdHVzVGV4dCk7XG5cdFx0XHRcdFx0XHR9XG5cdFx0XHRcdFx0fTtcblx0XHRcdFx0XHRcblx0XHRcdFx0XHRyZXEub25lcnJvciA9IGZ1bmN0aW9uKCkge1xuXHRcdFx0XHRcdFx0cmVqZWN0KHJlcS5zdGF0dXNUZXh0KTtcblx0XHRcdFx0XHR9XG5cdFx0XHRcdH0pO1xuXHRcdFx0fVxuXHRcdFxuXHRcdFx0aWYgKHJlcS5vdmVycmlkZU1pbWVUeXBlKVxuXHRcdFx0XHRyZXEub3ZlcnJpZGVNaW1lVHlwZShcInRleHQvcGxhaW47IGNoYXJzZXQ9XCIgKyBjaGFyc2V0KTtcblx0XHRcblx0XHRcdHJlcS5zZW5kKG51bGwpO1xuXHRcdFx0XG5cdFx0XHRyZXR1cm4gYXN5bmMgPyBwcm9taXNlIDogcmVxLnJlc3BvbnNlVGV4dDtcblx0XHR9XG5cdFx0ZWxzZSBpZiAodHlwZW9mIHJlcXVpcmUgIT09ICd1bmRlZmluZWQnKSB7XG5cdFx0XHQvLyBOb2RlLmpzXG5cdFx0XHR2YXIgZnMgPSByZXF1aXJlKFwiZnNcIik7XG5cdFx0XHRcblx0XHRcdHRyeSB7XG5cdFx0XHRcdGlmIChmcy5leGlzdHNTeW5jKHBhdGgpKSB7XG5cdFx0XHRcdFx0cmV0dXJuIGZzLnJlYWRGaWxlU3luYyhwYXRoLCBjaGFyc2V0KTtcblx0XHRcdFx0fVxuXHRcdFx0XHRlbHNlIHtcblx0XHRcdFx0XHRjb25zb2xlLmxvZyhcIlBhdGggXCIgKyBwYXRoICsgXCIgZG9lcyBub3QgZXhpc3QuXCIpO1xuXHRcdFx0XHR9XG5cdFx0XHR9IGNhdGNoIChlKSB7XG5cdFx0XHRcdGNvbnNvbGUubG9nKGUpO1xuXHRcdFx0XHRyZXR1cm4gJyc7XG5cdFx0XHR9XG5cdFx0fVxuXHR9LFxuXHRcblx0LyoqXG5cdCAqIFBhcnNlIHRoZSBydWxlcyBvdXQgZnJvbSBhIC5hZmYgZmlsZS5cblx0ICpcblx0ICogQHBhcmFtIHtTdHJpbmd9IGRhdGEgVGhlIGNvbnRlbnRzIG9mIHRoZSBhZmZpeCBmaWxlLlxuXHQgKiBAcmV0dXJucyBvYmplY3QgVGhlIHJ1bGVzIGZyb20gdGhlIGZpbGUuXG5cdCAqL1xuXHRcblx0X3BhcnNlQUZGIDogZnVuY3Rpb24gKGRhdGEpIHtcblx0XHR2YXIgcnVsZXMgPSB7fTtcblx0XHRcblx0XHR2YXIgbGluZSwgc3VibGluZSwgbnVtRW50cmllcywgbGluZVBhcnRzO1xuXHRcdHZhciBpLCBqLCBfbGVuLCBfamxlbjtcblx0XHRcblx0XHQvLyBSZW1vdmUgY29tbWVudCBsaW5lc1xuXHRcdGRhdGEgPSB0aGlzLl9yZW1vdmVBZmZpeENvbW1lbnRzKGRhdGEpO1xuXHRcdFxuXHRcdHZhciBsaW5lcyA9IGRhdGEuc3BsaXQoL1xccj9cXG4vKTtcblx0XHRcblx0XHRmb3IgKGkgPSAwLCBfbGVuID0gbGluZXMubGVuZ3RoOyBpIDwgX2xlbjsgaSsrKSB7XG5cdFx0XHRsaW5lID0gbGluZXNbaV07XG5cdFx0XHRcblx0XHRcdHZhciBkZWZpbml0aW9uUGFydHMgPSBsaW5lLnNwbGl0KC9cXHMrLyk7XG5cdFx0XHRcblx0XHRcdHZhciBydWxlVHlwZSA9IGRlZmluaXRpb25QYXJ0c1swXTtcblx0XHRcdFxuXHRcdFx0aWYgKHJ1bGVUeXBlID09IFwiUEZYXCIgfHwgcnVsZVR5cGUgPT0gXCJTRlhcIikge1xuXHRcdFx0XHR2YXIgcnVsZUNvZGUgPSBkZWZpbml0aW9uUGFydHNbMV07XG5cdFx0XHRcdHZhciBjb21iaW5lYWJsZSA9IGRlZmluaXRpb25QYXJ0c1syXTtcblx0XHRcdFx0bnVtRW50cmllcyA9IHBhcnNlSW50KGRlZmluaXRpb25QYXJ0c1szXSwgMTApO1xuXHRcdFx0XHRcblx0XHRcdFx0dmFyIGVudHJpZXMgPSBbXTtcblx0XHRcdFx0XG5cdFx0XHRcdGZvciAoaiA9IGkgKyAxLCBfamxlbiA9IGkgKyAxICsgbnVtRW50cmllczsgaiA8IF9qbGVuOyBqKyspIHtcblx0XHRcdFx0XHRzdWJsaW5lID0gbGluZXNbal07XG5cdFx0XHRcdFx0XG5cdFx0XHRcdFx0bGluZVBhcnRzID0gc3VibGluZS5zcGxpdCgvXFxzKy8pO1xuXHRcdFx0XHRcdHZhciBjaGFyYWN0ZXJzVG9SZW1vdmUgPSBsaW5lUGFydHNbMl07XG5cdFx0XHRcdFx0XG5cdFx0XHRcdFx0dmFyIGFkZGl0aW9uUGFydHMgPSBsaW5lUGFydHNbM10uc3BsaXQoXCIvXCIpO1xuXHRcdFx0XHRcdFxuXHRcdFx0XHRcdHZhciBjaGFyYWN0ZXJzVG9BZGQgPSBhZGRpdGlvblBhcnRzWzBdO1xuXHRcdFx0XHRcdGlmIChjaGFyYWN0ZXJzVG9BZGQgPT09IFwiMFwiKSBjaGFyYWN0ZXJzVG9BZGQgPSBcIlwiO1xuXHRcdFx0XHRcdFxuXHRcdFx0XHRcdHZhciBjb250aW51YXRpb25DbGFzc2VzID0gdGhpcy5wYXJzZVJ1bGVDb2RlcyhhZGRpdGlvblBhcnRzWzFdKTtcblx0XHRcdFx0XHRcblx0XHRcdFx0XHR2YXIgcmVnZXhUb01hdGNoID0gbGluZVBhcnRzWzRdO1xuXHRcdFx0XHRcdFxuXHRcdFx0XHRcdHZhciBlbnRyeSA9IHt9O1xuXHRcdFx0XHRcdGVudHJ5LmFkZCA9IGNoYXJhY3RlcnNUb0FkZDtcblx0XHRcdFx0XHRcblx0XHRcdFx0XHRpZiAoY29udGludWF0aW9uQ2xhc3Nlcy5sZW5ndGggPiAwKSBlbnRyeS5jb250aW51YXRpb25DbGFzc2VzID0gY29udGludWF0aW9uQ2xhc3Nlcztcblx0XHRcdFx0XHRcblx0XHRcdFx0XHRpZiAocmVnZXhUb01hdGNoICE9PSBcIi5cIikge1xuXHRcdFx0XHRcdFx0aWYgKHJ1bGVUeXBlID09PSBcIlNGWFwiKSB7XG5cdFx0XHRcdFx0XHRcdGVudHJ5Lm1hdGNoID0gbmV3IFJlZ0V4cChyZWdleFRvTWF0Y2ggKyBcIiRcIik7XG5cdFx0XHRcdFx0XHR9XG5cdFx0XHRcdFx0XHRlbHNlIHtcblx0XHRcdFx0XHRcdFx0ZW50cnkubWF0Y2ggPSBuZXcgUmVnRXhwKFwiXlwiICsgcmVnZXhUb01hdGNoKTtcblx0XHRcdFx0XHRcdH1cblx0XHRcdFx0XHR9XG5cdFx0XHRcdFx0XG5cdFx0XHRcdFx0aWYgKGNoYXJhY3RlcnNUb1JlbW92ZSAhPSBcIjBcIikge1xuXHRcdFx0XHRcdFx0aWYgKHJ1bGVUeXBlID09PSBcIlNGWFwiKSB7XG5cdFx0XHRcdFx0XHRcdGVudHJ5LnJlbW92ZSA9IG5ldyBSZWdFeHAoY2hhcmFjdGVyc1RvUmVtb3ZlICArIFwiJFwiKTtcblx0XHRcdFx0XHRcdH1cblx0XHRcdFx0XHRcdGVsc2Uge1xuXHRcdFx0XHRcdFx0XHRlbnRyeS5yZW1vdmUgPSBjaGFyYWN0ZXJzVG9SZW1vdmU7XG5cdFx0XHRcdFx0XHR9XG5cdFx0XHRcdFx0fVxuXHRcdFx0XHRcdFxuXHRcdFx0XHRcdGVudHJpZXMucHVzaChlbnRyeSk7XG5cdFx0XHRcdH1cblx0XHRcdFx0XG5cdFx0XHRcdHJ1bGVzW3J1bGVDb2RlXSA9IHsgXCJ0eXBlXCIgOiBydWxlVHlwZSwgXCJjb21iaW5lYWJsZVwiIDogKGNvbWJpbmVhYmxlID09IFwiWVwiKSwgXCJlbnRyaWVzXCIgOiBlbnRyaWVzIH07XG5cdFx0XHRcdFxuXHRcdFx0XHRpICs9IG51bUVudHJpZXM7XG5cdFx0XHR9XG5cdFx0XHRlbHNlIGlmIChydWxlVHlwZSA9PT0gXCJDT01QT1VORFJVTEVcIikge1xuXHRcdFx0XHRudW1FbnRyaWVzID0gcGFyc2VJbnQoZGVmaW5pdGlvblBhcnRzWzFdLCAxMCk7XG5cdFx0XHRcdFxuXHRcdFx0XHRmb3IgKGogPSBpICsgMSwgX2psZW4gPSBpICsgMSArIG51bUVudHJpZXM7IGogPCBfamxlbjsgaisrKSB7XG5cdFx0XHRcdFx0bGluZSA9IGxpbmVzW2pdO1xuXHRcdFx0XHRcdFxuXHRcdFx0XHRcdGxpbmVQYXJ0cyA9IGxpbmUuc3BsaXQoL1xccysvKTtcblx0XHRcdFx0XHR0aGlzLmNvbXBvdW5kUnVsZXMucHVzaChsaW5lUGFydHNbMV0pO1xuXHRcdFx0XHR9XG5cdFx0XHRcdFxuXHRcdFx0XHRpICs9IG51bUVudHJpZXM7XG5cdFx0XHR9XG5cdFx0XHRlbHNlIGlmIChydWxlVHlwZSA9PT0gXCJSRVBcIikge1xuXHRcdFx0XHRsaW5lUGFydHMgPSBsaW5lLnNwbGl0KC9cXHMrLyk7XG5cdFx0XHRcdFxuXHRcdFx0XHRpZiAobGluZVBhcnRzLmxlbmd0aCA9PT0gMykge1xuXHRcdFx0XHRcdHRoaXMucmVwbGFjZW1lbnRUYWJsZS5wdXNoKFsgbGluZVBhcnRzWzFdLCBsaW5lUGFydHNbMl0gXSk7XG5cdFx0XHRcdH1cblx0XHRcdH1cblx0XHRcdGVsc2Uge1xuXHRcdFx0XHQvLyBPTkxZSU5DT01QT1VORFxuXHRcdFx0XHQvLyBDT01QT1VORE1JTlxuXHRcdFx0XHQvLyBGTEFHXG5cdFx0XHRcdC8vIEtFRVBDQVNFXG5cdFx0XHRcdC8vIE5FRURBRkZJWFxuXHRcdFx0XHRcblx0XHRcdFx0dGhpcy5mbGFnc1tydWxlVHlwZV0gPSBkZWZpbml0aW9uUGFydHNbMV07XG5cdFx0XHR9XG5cdFx0fVxuXHRcdFxuXHRcdHJldHVybiBydWxlcztcblx0fSxcblx0XG5cdC8qKlxuXHQgKiBSZW1vdmVzIGNvbW1lbnQgbGluZXMgYW5kIHRoZW4gY2xlYW5zIHVwIGJsYW5rIGxpbmVzIGFuZCB0cmFpbGluZyB3aGl0ZXNwYWNlLlxuXHQgKlxuXHQgKiBAcGFyYW0ge1N0cmluZ30gZGF0YSBUaGUgZGF0YSBmcm9tIGFuIGFmZml4IGZpbGUuXG5cdCAqIEByZXR1cm4ge1N0cmluZ30gVGhlIGNsZWFuZWQtdXAgZGF0YS5cblx0ICovXG5cdFxuXHRfcmVtb3ZlQWZmaXhDb21tZW50cyA6IGZ1bmN0aW9uIChkYXRhKSB7XG5cdFx0Ly8gUmVtb3ZlIGNvbW1lbnRzXG5cdFx0Ly8gVGhpcyB1c2VkIHRvIHJlbW92ZSBhbnkgc3RyaW5nIHN0YXJ0aW5nIHdpdGggJyMnIHVwIHRvIHRoZSBlbmQgb2YgdGhlIGxpbmUsXG5cdFx0Ly8gYnV0IHNvbWUgQ09NUE9VTkRSVUxFIGRlZmluaXRpb25zIGluY2x1ZGUgJyMnIGFzIHBhcnQgb2YgdGhlIHJ1bGUuXG5cdFx0Ly8gSSBoYXZlbid0IHNlZW4gYW55IGFmZml4IGZpbGVzIHRoYXQgdXNlIGNvbW1lbnRzIG9uIHRoZSBzYW1lIGxpbmUgYXMgcmVhbCBkYXRhLFxuXHRcdC8vIHNvIEkgZG9uJ3QgdGhpbmsgdGhpcyB3aWxsIGJyZWFrIGFueXRoaW5nLlxuXHRcdGRhdGEgPSBkYXRhLnJlcGxhY2UoL15cXHMqIy4qJC9tZywgXCJcIik7XG5cdFx0XG5cdFx0Ly8gVHJpbSBlYWNoIGxpbmVcblx0XHRkYXRhID0gZGF0YS5yZXBsYWNlKC9eXFxzXFxzKi9tLCAnJykucmVwbGFjZSgvXFxzXFxzKiQvbSwgJycpO1xuXHRcdFxuXHRcdC8vIFJlbW92ZSBibGFuayBsaW5lcy5cblx0XHRkYXRhID0gZGF0YS5yZXBsYWNlKC9cXG57Mix9L2csIFwiXFxuXCIpO1xuXHRcdFxuXHRcdC8vIFRyaW0gdGhlIGVudGlyZSBzdHJpbmdcblx0XHRkYXRhID0gZGF0YS5yZXBsYWNlKC9eXFxzXFxzKi8sICcnKS5yZXBsYWNlKC9cXHNcXHMqJC8sICcnKTtcblx0XHRcblx0XHRyZXR1cm4gZGF0YTtcblx0fSxcblx0XG5cdC8qKlxuXHQgKiBQYXJzZXMgdGhlIHdvcmRzIG91dCBmcm9tIHRoZSAuZGljIGZpbGUuXG5cdCAqXG5cdCAqIEBwYXJhbSB7U3RyaW5nfSBkYXRhIFRoZSBkYXRhIGZyb20gdGhlIGRpY3Rpb25hcnkgZmlsZS5cblx0ICogQHJldHVybnMgb2JqZWN0IFRoZSBsb29rdXAgdGFibGUgY29udGFpbmluZyBhbGwgb2YgdGhlIHdvcmRzIGFuZFxuXHQgKiAgICAgICAgICAgICAgICAgd29yZCBmb3JtcyBmcm9tIHRoZSBkaWN0aW9uYXJ5LlxuXHQgKi9cblx0XG5cdF9wYXJzZURJQyA6IGZ1bmN0aW9uIChkYXRhKSB7XG5cdFx0ZGF0YSA9IHRoaXMuX3JlbW92ZURpY0NvbW1lbnRzKGRhdGEpO1xuXHRcdFxuXHRcdHZhciBsaW5lcyA9IGRhdGEuc3BsaXQoL1xccj9cXG4vKTtcblx0XHR2YXIgZGljdGlvbmFyeVRhYmxlID0ge307XG5cdFx0XG5cdFx0ZnVuY3Rpb24gYWRkV29yZCh3b3JkLCBydWxlcykge1xuXHRcdFx0Ly8gU29tZSBkaWN0aW9uYXJpZXMgd2lsbCBsaXN0IHRoZSBzYW1lIHdvcmQgbXVsdGlwbGUgdGltZXMgd2l0aCBkaWZmZXJlbnQgcnVsZSBzZXRzLlxuXHRcdFx0aWYgKCFkaWN0aW9uYXJ5VGFibGUuaGFzT3duUHJvcGVydHkod29yZCkpIHtcblx0XHRcdFx0ZGljdGlvbmFyeVRhYmxlW3dvcmRdID0gbnVsbDtcblx0XHRcdH1cblx0XHRcdFxuXHRcdFx0aWYgKHJ1bGVzLmxlbmd0aCA+IDApIHtcblx0XHRcdFx0aWYgKGRpY3Rpb25hcnlUYWJsZVt3b3JkXSA9PT0gbnVsbCkge1xuXHRcdFx0XHRcdGRpY3Rpb25hcnlUYWJsZVt3b3JkXSA9IFtdO1xuXHRcdFx0XHR9XG5cblx0XHRcdFx0ZGljdGlvbmFyeVRhYmxlW3dvcmRdLnB1c2gocnVsZXMpO1xuXHRcdFx0fVxuXHRcdH1cblx0XHRcblx0XHQvLyBUaGUgZmlyc3QgbGluZSBpcyB0aGUgbnVtYmVyIG9mIHdvcmRzIGluIHRoZSBkaWN0aW9uYXJ5LlxuXHRcdGZvciAodmFyIGkgPSAxLCBfbGVuID0gbGluZXMubGVuZ3RoOyBpIDwgX2xlbjsgaSsrKSB7XG5cdFx0XHR2YXIgbGluZSA9IGxpbmVzW2ldO1xuXHRcdFx0XG5cdFx0XHRpZiAoIWxpbmUpIHtcblx0XHRcdFx0Ly8gSWdub3JlIGVtcHR5IGxpbmVzLlxuXHRcdFx0XHRjb250aW51ZTtcblx0XHRcdH1cblxuXHRcdFx0dmFyIHBhcnRzID0gbGluZS5zcGxpdChcIi9cIiwgMik7XG5cdFx0XHRcblx0XHRcdHZhciB3b3JkID0gcGFydHNbMF07XG5cblx0XHRcdC8vIE5vdyBmb3IgZWFjaCBhZmZpeCBydWxlLCBnZW5lcmF0ZSB0aGF0IGZvcm0gb2YgdGhlIHdvcmQuXG5cdFx0XHRpZiAocGFydHMubGVuZ3RoID4gMSkge1xuXHRcdFx0XHR2YXIgcnVsZUNvZGVzQXJyYXkgPSB0aGlzLnBhcnNlUnVsZUNvZGVzKHBhcnRzWzFdKTtcblx0XHRcdFx0XG5cdFx0XHRcdC8vIFNhdmUgdGhlIHJ1bGVDb2RlcyBmb3IgY29tcG91bmQgd29yZCBzaXR1YXRpb25zLlxuXHRcdFx0XHRpZiAoIShcIk5FRURBRkZJWFwiIGluIHRoaXMuZmxhZ3MpIHx8IHJ1bGVDb2Rlc0FycmF5LmluZGV4T2YodGhpcy5mbGFncy5ORUVEQUZGSVgpID09IC0xKSB7XG5cdFx0XHRcdFx0YWRkV29yZCh3b3JkLCBydWxlQ29kZXNBcnJheSk7XG5cdFx0XHRcdH1cblx0XHRcdFx0XG5cdFx0XHRcdGZvciAodmFyIGogPSAwLCBfamxlbiA9IHJ1bGVDb2Rlc0FycmF5Lmxlbmd0aDsgaiA8IF9qbGVuOyBqKyspIHtcblx0XHRcdFx0XHR2YXIgY29kZSA9IHJ1bGVDb2Rlc0FycmF5W2pdO1xuXHRcdFx0XHRcdFxuXHRcdFx0XHRcdHZhciBydWxlID0gdGhpcy5ydWxlc1tjb2RlXTtcblx0XHRcdFx0XHRcblx0XHRcdFx0XHRpZiAocnVsZSkge1xuXHRcdFx0XHRcdFx0dmFyIG5ld1dvcmRzID0gdGhpcy5fYXBwbHlSdWxlKHdvcmQsIHJ1bGUpO1xuXHRcdFx0XHRcdFx0XG5cdFx0XHRcdFx0XHRmb3IgKHZhciBpaSA9IDAsIF9paWxlbiA9IG5ld1dvcmRzLmxlbmd0aDsgaWkgPCBfaWlsZW47IGlpKyspIHtcblx0XHRcdFx0XHRcdFx0dmFyIG5ld1dvcmQgPSBuZXdXb3Jkc1tpaV07XG5cdFx0XHRcdFx0XHRcdFxuXHRcdFx0XHRcdFx0XHRhZGRXb3JkKG5ld1dvcmQsIFtdKTtcblx0XHRcdFx0XHRcdFx0XG5cdFx0XHRcdFx0XHRcdGlmIChydWxlLmNvbWJpbmVhYmxlKSB7XG5cdFx0XHRcdFx0XHRcdFx0Zm9yICh2YXIgayA9IGogKyAxOyBrIDwgX2psZW47IGsrKykge1xuXHRcdFx0XHRcdFx0XHRcdFx0dmFyIGNvbWJpbmVDb2RlID0gcnVsZUNvZGVzQXJyYXlba107XG5cdFx0XHRcdFx0XHRcdFx0XHRcblx0XHRcdFx0XHRcdFx0XHRcdHZhciBjb21iaW5lUnVsZSA9IHRoaXMucnVsZXNbY29tYmluZUNvZGVdO1xuXHRcdFx0XHRcdFx0XHRcdFx0XG5cdFx0XHRcdFx0XHRcdFx0XHRpZiAoY29tYmluZVJ1bGUpIHtcblx0XHRcdFx0XHRcdFx0XHRcdFx0aWYgKGNvbWJpbmVSdWxlLmNvbWJpbmVhYmxlICYmIChydWxlLnR5cGUgIT0gY29tYmluZVJ1bGUudHlwZSkpIHtcblx0XHRcdFx0XHRcdFx0XHRcdFx0XHR2YXIgb3RoZXJOZXdXb3JkcyA9IHRoaXMuX2FwcGx5UnVsZShuZXdXb3JkLCBjb21iaW5lUnVsZSk7XG5cdFx0XHRcdFx0XHRcdFx0XHRcdFx0XG5cdFx0XHRcdFx0XHRcdFx0XHRcdFx0Zm9yICh2YXIgaWlpID0gMCwgX2lpaWxlbiA9IG90aGVyTmV3V29yZHMubGVuZ3RoOyBpaWkgPCBfaWlpbGVuOyBpaWkrKykge1xuXHRcdFx0XHRcdFx0XHRcdFx0XHRcdFx0dmFyIG90aGVyTmV3V29yZCA9IG90aGVyTmV3V29yZHNbaWlpXTtcblx0XHRcdFx0XHRcdFx0XHRcdFx0XHRcdGFkZFdvcmQob3RoZXJOZXdXb3JkLCBbXSk7XG5cdFx0XHRcdFx0XHRcdFx0XHRcdFx0fVxuXHRcdFx0XHRcdFx0XHRcdFx0XHR9XG5cdFx0XHRcdFx0XHRcdFx0XHR9XG5cdFx0XHRcdFx0XHRcdFx0fVxuXHRcdFx0XHRcdFx0XHR9XG5cdFx0XHRcdFx0XHR9XG5cdFx0XHRcdFx0fVxuXHRcdFx0XHRcdFxuXHRcdFx0XHRcdGlmIChjb2RlIGluIHRoaXMuY29tcG91bmRSdWxlQ29kZXMpIHtcblx0XHRcdFx0XHRcdHRoaXMuY29tcG91bmRSdWxlQ29kZXNbY29kZV0ucHVzaCh3b3JkKTtcblx0XHRcdFx0XHR9XG5cdFx0XHRcdH1cblx0XHRcdH1cblx0XHRcdGVsc2Uge1xuXHRcdFx0XHRhZGRXb3JkKHdvcmQudHJpbSgpLCBbXSk7XG5cdFx0XHR9XG5cdFx0fVxuXHRcdFxuXHRcdHJldHVybiBkaWN0aW9uYXJ5VGFibGU7XG5cdH0sXG5cdFxuXHRcblx0LyoqXG5cdCAqIFJlbW92ZXMgY29tbWVudCBsaW5lcyBhbmQgdGhlbiBjbGVhbnMgdXAgYmxhbmsgbGluZXMgYW5kIHRyYWlsaW5nIHdoaXRlc3BhY2UuXG5cdCAqXG5cdCAqIEBwYXJhbSB7U3RyaW5nfSBkYXRhIFRoZSBkYXRhIGZyb20gYSAuZGljIGZpbGUuXG5cdCAqIEByZXR1cm4ge1N0cmluZ30gVGhlIGNsZWFuZWQtdXAgZGF0YS5cblx0ICovXG5cdFxuXHRfcmVtb3ZlRGljQ29tbWVudHMgOiBmdW5jdGlvbiAoZGF0YSkge1xuXHRcdC8vIEkgY2FuJ3QgZmluZCBhbnkgb2ZmaWNpYWwgZG9jdW1lbnRhdGlvbiBvbiBpdCwgYnV0IGF0IGxlYXN0IHRoZSBkZV9ERVxuXHRcdC8vIGRpY3Rpb25hcnkgdXNlcyB0YWItaW5kZW50ZWQgbGluZXMgYXMgY29tbWVudHMuXG5cdFx0XG5cdFx0Ly8gUmVtb3ZlIGNvbW1lbnRzXG5cdFx0ZGF0YSA9IGRhdGEucmVwbGFjZSgvXlxcdC4qJC9tZywgXCJcIik7XG5cdFx0XG5cdFx0cmV0dXJuIGRhdGE7XG5cdH0sXG5cdFxuXHRwYXJzZVJ1bGVDb2RlcyA6IGZ1bmN0aW9uICh0ZXh0Q29kZXMpIHtcblx0XHRpZiAoIXRleHRDb2Rlcykge1xuXHRcdFx0cmV0dXJuIFtdO1xuXHRcdH1cblx0XHRlbHNlIGlmICghKFwiRkxBR1wiIGluIHRoaXMuZmxhZ3MpKSB7XG5cdFx0XHRyZXR1cm4gdGV4dENvZGVzLnNwbGl0KFwiXCIpO1xuXHRcdH1cblx0XHRlbHNlIGlmICh0aGlzLmZsYWdzLkZMQUcgPT09IFwibG9uZ1wiKSB7XG5cdFx0XHR2YXIgZmxhZ3MgPSBbXTtcblx0XHRcdFxuXHRcdFx0Zm9yICh2YXIgaSA9IDAsIF9sZW4gPSB0ZXh0Q29kZXMubGVuZ3RoOyBpIDwgX2xlbjsgaSArPSAyKSB7XG5cdFx0XHRcdGZsYWdzLnB1c2godGV4dENvZGVzLnN1YnN0cihpLCAyKSk7XG5cdFx0XHR9XG5cdFx0XHRcblx0XHRcdHJldHVybiBmbGFncztcblx0XHR9XG5cdFx0ZWxzZSBpZiAodGhpcy5mbGFncy5GTEFHID09PSBcIm51bVwiKSB7XG5cdFx0XHRyZXR1cm4gdGV4dENvZGVzLnNwbGl0KFwiLFwiKTtcblx0XHR9XG5cdH0sXG5cdFxuXHQvKipcblx0ICogQXBwbGllcyBhbiBhZmZpeCBydWxlIHRvIGEgd29yZC5cblx0ICpcblx0ICogQHBhcmFtIHtTdHJpbmd9IHdvcmQgVGhlIGJhc2Ugd29yZC5cblx0ICogQHBhcmFtIHtPYmplY3R9IHJ1bGUgVGhlIGFmZml4IHJ1bGUuXG5cdCAqIEByZXR1cm5zIHtTdHJpbmdbXX0gVGhlIG5ldyB3b3JkcyBnZW5lcmF0ZWQgYnkgdGhlIHJ1bGUuXG5cdCAqL1xuXHRcblx0X2FwcGx5UnVsZSA6IGZ1bmN0aW9uICh3b3JkLCBydWxlKSB7XG5cdFx0dmFyIGVudHJpZXMgPSBydWxlLmVudHJpZXM7XG5cdFx0dmFyIG5ld1dvcmRzID0gW107XG5cdFx0XG5cdFx0Zm9yICh2YXIgaSA9IDAsIF9sZW4gPSBlbnRyaWVzLmxlbmd0aDsgaSA8IF9sZW47IGkrKykge1xuXHRcdFx0dmFyIGVudHJ5ID0gZW50cmllc1tpXTtcblx0XHRcdFxuXHRcdFx0aWYgKCFlbnRyeS5tYXRjaCB8fCB3b3JkLm1hdGNoKGVudHJ5Lm1hdGNoKSkge1xuXHRcdFx0XHR2YXIgbmV3V29yZCA9IHdvcmQ7XG5cdFx0XHRcdFxuXHRcdFx0XHRpZiAoZW50cnkucmVtb3ZlKSB7XG5cdFx0XHRcdFx0bmV3V29yZCA9IG5ld1dvcmQucmVwbGFjZShlbnRyeS5yZW1vdmUsIFwiXCIpO1xuXHRcdFx0XHR9XG5cdFx0XHRcdFxuXHRcdFx0XHRpZiAocnVsZS50eXBlID09PSBcIlNGWFwiKSB7XG5cdFx0XHRcdFx0bmV3V29yZCA9IG5ld1dvcmQgKyBlbnRyeS5hZGQ7XG5cdFx0XHRcdH1cblx0XHRcdFx0ZWxzZSB7XG5cdFx0XHRcdFx0bmV3V29yZCA9IGVudHJ5LmFkZCArIG5ld1dvcmQ7XG5cdFx0XHRcdH1cblx0XHRcdFx0XG5cdFx0XHRcdG5ld1dvcmRzLnB1c2gobmV3V29yZCk7XG5cdFx0XHRcdFxuXHRcdFx0XHRpZiAoXCJjb250aW51YXRpb25DbGFzc2VzXCIgaW4gZW50cnkpIHtcblx0XHRcdFx0XHRmb3IgKHZhciBqID0gMCwgX2psZW4gPSBlbnRyeS5jb250aW51YXRpb25DbGFzc2VzLmxlbmd0aDsgaiA8IF9qbGVuOyBqKyspIHtcblx0XHRcdFx0XHRcdHZhciBjb250aW51YXRpb25SdWxlID0gdGhpcy5ydWxlc1tlbnRyeS5jb250aW51YXRpb25DbGFzc2VzW2pdXTtcblx0XHRcdFx0XHRcdFxuXHRcdFx0XHRcdFx0aWYgKGNvbnRpbnVhdGlvblJ1bGUpIHtcblx0XHRcdFx0XHRcdFx0bmV3V29yZHMgPSBuZXdXb3Jkcy5jb25jYXQodGhpcy5fYXBwbHlSdWxlKG5ld1dvcmQsIGNvbnRpbnVhdGlvblJ1bGUpKTtcblx0XHRcdFx0XHRcdH1cblx0XHRcdFx0XHRcdC8qXG5cdFx0XHRcdFx0XHRlbHNlIHtcblx0XHRcdFx0XHRcdFx0Ly8gVGhpcyBzaG91bGRuJ3QgaGFwcGVuLCBidXQgaXQgZG9lcywgYXQgbGVhc3QgaW4gdGhlIGRlX0RFIGRpY3Rpb25hcnkuXG5cdFx0XHRcdFx0XHRcdC8vIEkgdGhpbmsgdGhlIGF1dGhvciBtaXN0YWtlbmx5IHN1cHBsaWVkIGxvd2VyLWNhc2UgcnVsZSBjb2RlcyBpbnN0ZWFkIFxuXHRcdFx0XHRcdFx0XHQvLyBvZiB1cHBlci1jYXNlLlxuXHRcdFx0XHRcdFx0fVxuXHRcdFx0XHRcdFx0Ki9cblx0XHRcdFx0XHR9XG5cdFx0XHRcdH1cblx0XHRcdH1cblx0XHR9XG5cdFx0XG5cdFx0cmV0dXJuIG5ld1dvcmRzO1xuXHR9LFxuXHRcblx0LyoqXG5cdCAqIENoZWNrcyB3aGV0aGVyIGEgd29yZCBvciBhIGNhcGl0YWxpemF0aW9uIHZhcmlhbnQgZXhpc3RzIGluIHRoZSBjdXJyZW50IGRpY3Rpb25hcnkuXG5cdCAqIFRoZSB3b3JkIGlzIHRyaW1tZWQgYW5kIHNldmVyYWwgdmFyaWF0aW9ucyBvZiBjYXBpdGFsaXphdGlvbnMgYXJlIGNoZWNrZWQuXG5cdCAqIElmIHlvdSB3YW50IHRvIGNoZWNrIGEgd29yZCB3aXRob3V0IGFueSBjaGFuZ2VzIG1hZGUgdG8gaXQsIGNhbGwgY2hlY2tFeGFjdCgpXG5cdCAqXG5cdCAqIEBzZWUgaHR0cDovL2Jsb2cuc3RldmVubGV2aXRoYW4uY29tL2FyY2hpdmVzL2Zhc3Rlci10cmltLWphdmFzY3JpcHQgcmU6dHJpbW1pbmcgZnVuY3Rpb25cblx0ICpcblx0ICogQHBhcmFtIHtTdHJpbmd9IGFXb3JkIFRoZSB3b3JkIHRvIGNoZWNrLlxuXHQgKiBAcmV0dXJucyB7Qm9vbGVhbn1cblx0ICovXG5cdFxuXHRjaGVjayA6IGZ1bmN0aW9uIChhV29yZCkge1xuXHRcdGlmICghdGhpcy5sb2FkZWQpIHtcblx0XHRcdHRocm93IFwiRGljdGlvbmFyeSBub3QgbG9hZGVkLlwiO1xuXHRcdH1cblx0XHRcblx0XHQvLyBSZW1vdmUgbGVhZGluZyBhbmQgdHJhaWxpbmcgd2hpdGVzcGFjZVxuXHRcdHZhciB0cmltbWVkV29yZCA9IGFXb3JkLnJlcGxhY2UoL15cXHNcXHMqLywgJycpLnJlcGxhY2UoL1xcc1xccyokLywgJycpO1xuXHRcdFxuXHRcdGlmICh0aGlzLmNoZWNrRXhhY3QodHJpbW1lZFdvcmQpKSB7XG5cdFx0XHRyZXR1cm4gdHJ1ZTtcblx0XHR9XG5cdFx0XG5cdFx0Ly8gVGhlIGV4YWN0IHdvcmQgaXMgbm90IGluIHRoZSBkaWN0aW9uYXJ5LlxuXHRcdGlmICh0cmltbWVkV29yZC50b1VwcGVyQ2FzZSgpID09PSB0cmltbWVkV29yZCkge1xuXHRcdFx0Ly8gVGhlIHdvcmQgd2FzIHN1cHBsaWVkIGluIGFsbCB1cHBlcmNhc2UuXG5cdFx0XHQvLyBDaGVjayBmb3IgYSBjYXBpdGFsaXplZCBmb3JtIG9mIHRoZSB3b3JkLlxuXHRcdFx0dmFyIGNhcGl0YWxpemVkV29yZCA9IHRyaW1tZWRXb3JkWzBdICsgdHJpbW1lZFdvcmQuc3Vic3RyaW5nKDEpLnRvTG93ZXJDYXNlKCk7XG5cdFx0XHRcblx0XHRcdGlmICh0aGlzLmhhc0ZsYWcoY2FwaXRhbGl6ZWRXb3JkLCBcIktFRVBDQVNFXCIpKSB7XG5cdFx0XHRcdC8vIENhcGl0YWxpemF0aW9uIHZhcmlhbnRzIGFyZSBub3QgYWxsb3dlZCBmb3IgdGhpcyB3b3JkLlxuXHRcdFx0XHRyZXR1cm4gZmFsc2U7XG5cdFx0XHR9XG5cdFx0XHRcblx0XHRcdGlmICh0aGlzLmNoZWNrRXhhY3QoY2FwaXRhbGl6ZWRXb3JkKSkge1xuXHRcdFx0XHQvLyBUaGUgYWxsLWNhcHMgd29yZCBpcyBhIGNhcGl0YWxpemVkIHdvcmQgc3BlbGxlZCBjb3JyZWN0bHkuXG5cdFx0XHRcdHJldHVybiB0cnVlO1xuXHRcdFx0fVxuXG5cdFx0XHRpZiAodGhpcy5jaGVja0V4YWN0KHRyaW1tZWRXb3JkLnRvTG93ZXJDYXNlKCkpKSB7XG5cdFx0XHRcdC8vIFRoZSBhbGwtY2FwcyBpcyBhIGxvd2VyY2FzZSB3b3JkIHNwZWxsZWQgY29ycmVjdGx5LlxuXHRcdFx0XHRyZXR1cm4gdHJ1ZTtcblx0XHRcdH1cblx0XHR9XG5cdFx0XG5cdFx0dmFyIHVuY2FwaXRhbGl6ZWRXb3JkID0gdHJpbW1lZFdvcmRbMF0udG9Mb3dlckNhc2UoKSArIHRyaW1tZWRXb3JkLnN1YnN0cmluZygxKTtcblx0XHRcblx0XHRpZiAodW5jYXBpdGFsaXplZFdvcmQgIT09IHRyaW1tZWRXb3JkKSB7XG5cdFx0XHRpZiAodGhpcy5oYXNGbGFnKHVuY2FwaXRhbGl6ZWRXb3JkLCBcIktFRVBDQVNFXCIpKSB7XG5cdFx0XHRcdC8vIENhcGl0YWxpemF0aW9uIHZhcmlhbnRzIGFyZSBub3QgYWxsb3dlZCBmb3IgdGhpcyB3b3JkLlxuXHRcdFx0XHRyZXR1cm4gZmFsc2U7XG5cdFx0XHR9XG5cdFx0XHRcblx0XHRcdC8vIENoZWNrIGZvciBhbiB1bmNhcGl0YWxpemVkIGZvcm1cblx0XHRcdGlmICh0aGlzLmNoZWNrRXhhY3QodW5jYXBpdGFsaXplZFdvcmQpKSB7XG5cdFx0XHRcdC8vIFRoZSB3b3JkIGlzIHNwZWxsZWQgY29ycmVjdGx5IGJ1dCB3aXRoIHRoZSBmaXJzdCBsZXR0ZXIgY2FwaXRhbGl6ZWQuXG5cdFx0XHRcdHJldHVybiB0cnVlO1xuXHRcdFx0fVxuXHRcdH1cblx0XHRcblx0XHRyZXR1cm4gZmFsc2U7XG5cdH0sXG5cdFxuXHQvKipcblx0ICogQ2hlY2tzIHdoZXRoZXIgYSB3b3JkIGV4aXN0cyBpbiB0aGUgY3VycmVudCBkaWN0aW9uYXJ5LlxuXHQgKlxuXHQgKiBAcGFyYW0ge1N0cmluZ30gd29yZCBUaGUgd29yZCB0byBjaGVjay5cblx0ICogQHJldHVybnMge0Jvb2xlYW59XG5cdCAqL1xuXHRcblx0Y2hlY2tFeGFjdCA6IGZ1bmN0aW9uICh3b3JkKSB7XG5cdFx0aWYgKCF0aGlzLmxvYWRlZCkge1xuXHRcdFx0dGhyb3cgXCJEaWN0aW9uYXJ5IG5vdCBsb2FkZWQuXCI7XG5cdFx0fVxuXG5cdFx0dmFyIHJ1bGVDb2RlcyA9IHRoaXMuZGljdGlvbmFyeVRhYmxlW3dvcmRdO1xuXHRcdFxuXHRcdHZhciBpLCBfbGVuO1xuXHRcdFxuXHRcdGlmICh0eXBlb2YgcnVsZUNvZGVzID09PSAndW5kZWZpbmVkJykge1xuXHRcdFx0Ly8gQ2hlY2sgaWYgdGhpcyBtaWdodCBiZSBhIGNvbXBvdW5kIHdvcmQuXG5cdFx0XHRpZiAoXCJDT01QT1VORE1JTlwiIGluIHRoaXMuZmxhZ3MgJiYgd29yZC5sZW5ndGggPj0gdGhpcy5mbGFncy5DT01QT1VORE1JTikge1xuXHRcdFx0XHRmb3IgKGkgPSAwLCBfbGVuID0gdGhpcy5jb21wb3VuZFJ1bGVzLmxlbmd0aDsgaSA8IF9sZW47IGkrKykge1xuXHRcdFx0XHRcdGlmICh3b3JkLm1hdGNoKHRoaXMuY29tcG91bmRSdWxlc1tpXSkpIHtcblx0XHRcdFx0XHRcdHJldHVybiB0cnVlO1xuXHRcdFx0XHRcdH1cblx0XHRcdFx0fVxuXHRcdFx0fVxuXHRcdH1cblx0XHRlbHNlIGlmIChydWxlQ29kZXMgPT09IG51bGwpIHtcblx0XHRcdC8vIGEgbnVsbCAoYnV0IG5vdCB1bmRlZmluZWQpIHZhbHVlIGZvciBhbiBlbnRyeSBpbiB0aGUgZGljdGlvbmFyeSB0YWJsZVxuXHRcdFx0Ly8gbWVhbnMgdGhhdCB0aGUgd29yZCBpcyBpbiB0aGUgZGljdGlvbmFyeSBidXQgaGFzIG5vIGZsYWdzLlxuXHRcdFx0cmV0dXJuIHRydWU7XG5cdFx0fVxuXHRcdGVsc2UgaWYgKHR5cGVvZiBydWxlQ29kZXMgPT09ICdvYmplY3QnKSB7IC8vIHRoaXMuZGljdGlvbmFyeVsnaGFzT3duUHJvcGVydHknXSB3aWxsIGJlIGEgZnVuY3Rpb24uXG5cdFx0XHRmb3IgKGkgPSAwLCBfbGVuID0gcnVsZUNvZGVzLmxlbmd0aDsgaSA8IF9sZW47IGkrKykge1xuXHRcdFx0XHRpZiAoIXRoaXMuaGFzRmxhZyh3b3JkLCBcIk9OTFlJTkNPTVBPVU5EXCIsIHJ1bGVDb2Rlc1tpXSkpIHtcblx0XHRcdFx0XHRyZXR1cm4gdHJ1ZTtcblx0XHRcdFx0fVxuXHRcdFx0fVxuXHRcdH1cblxuXHRcdHJldHVybiBmYWxzZTtcblx0fSxcblx0XG5cdC8qKlxuXHQgKiBMb29rcyB1cCB3aGV0aGVyIGEgZ2l2ZW4gd29yZCBpcyBmbGFnZ2VkIHdpdGggYSBnaXZlbiBmbGFnLlxuXHQgKlxuXHQgKiBAcGFyYW0ge1N0cmluZ30gd29yZCBUaGUgd29yZCBpbiBxdWVzdGlvbi5cblx0ICogQHBhcmFtIHtTdHJpbmd9IGZsYWcgVGhlIGZsYWcgaW4gcXVlc3Rpb24uXG5cdCAqIEByZXR1cm4ge0Jvb2xlYW59XG5cdCAqL1xuXHQgXG5cdGhhc0ZsYWcgOiBmdW5jdGlvbiAod29yZCwgZmxhZywgd29yZEZsYWdzKSB7XG5cdFx0aWYgKCF0aGlzLmxvYWRlZCkge1xuXHRcdFx0dGhyb3cgXCJEaWN0aW9uYXJ5IG5vdCBsb2FkZWQuXCI7XG5cdFx0fVxuXG5cdFx0aWYgKGZsYWcgaW4gdGhpcy5mbGFncykge1xuXHRcdFx0aWYgKHR5cGVvZiB3b3JkRmxhZ3MgPT09ICd1bmRlZmluZWQnKSB7XG5cdFx0XHRcdHdvcmRGbGFncyA9IEFycmF5LnByb3RvdHlwZS5jb25jYXQuYXBwbHkoW10sIHRoaXMuZGljdGlvbmFyeVRhYmxlW3dvcmRdKTtcblx0XHRcdH1cblx0XHRcdFxuXHRcdFx0aWYgKHdvcmRGbGFncyAmJiB3b3JkRmxhZ3MuaW5kZXhPZih0aGlzLmZsYWdzW2ZsYWddKSAhPT0gLTEpIHtcblx0XHRcdFx0cmV0dXJuIHRydWU7XG5cdFx0XHR9XG5cdFx0fVxuXHRcdFxuXHRcdHJldHVybiBmYWxzZTtcblx0fSxcblx0XG5cdC8qKlxuXHQgKiBSZXR1cm5zIGEgbGlzdCBvZiBzdWdnZXN0aW9ucyBmb3IgYSBtaXNzcGVsbGVkIHdvcmQuXG5cdCAqXG5cdCAqIEBzZWUgaHR0cDovL3d3dy5ub3J2aWcuY29tL3NwZWxsLWNvcnJlY3QuaHRtbCBmb3IgdGhlIGJhc2lzIG9mIHRoaXMgc3VnZ2VzdG9yLlxuXHQgKiBUaGlzIHN1Z2dlc3RvciBpcyBwcmltaXRpdmUsIGJ1dCBpdCB3b3Jrcy5cblx0ICpcblx0ICogQHBhcmFtIHtTdHJpbmd9IHdvcmQgVGhlIG1pc3NwZWxsaW5nLlxuXHQgKiBAcGFyYW0ge051bWJlcn0gW2xpbWl0PTVdIFRoZSBtYXhpbXVtIG51bWJlciBvZiBzdWdnZXN0aW9ucyB0byByZXR1cm4uXG5cdCAqIEByZXR1cm5zIHtTdHJpbmdbXX0gVGhlIGFycmF5IG9mIHN1Z2dlc3Rpb25zLlxuXHQgKi9cblx0XG5cdGFscGhhYmV0IDogXCJcIixcblx0XG5cdHN1Z2dlc3QgOiBmdW5jdGlvbiAod29yZCwgbGltaXQpIHtcblx0XHRpZiAoIXRoaXMubG9hZGVkKSB7XG5cdFx0XHR0aHJvdyBcIkRpY3Rpb25hcnkgbm90IGxvYWRlZC5cIjtcblx0XHR9XG5cblx0XHRsaW1pdCA9IGxpbWl0IHx8IDU7XG5cblx0XHRpZiAodGhpcy5tZW1vaXplZC5oYXNPd25Qcm9wZXJ0eSh3b3JkKSkge1xuXHRcdFx0dmFyIG1lbW9pemVkTGltaXQgPSB0aGlzLm1lbW9pemVkW3dvcmRdWydsaW1pdCddO1xuXG5cdFx0XHQvLyBPbmx5IHJldHVybiB0aGUgY2FjaGVkIGxpc3QgaWYgaXQncyBiaWcgZW5vdWdoIG9yIGlmIHRoZXJlIHdlcmVuJ3QgZW5vdWdoIHN1Z2dlc3Rpb25zXG5cdFx0XHQvLyB0byBmaWxsIGEgc21hbGxlciBsaW1pdC5cblx0XHRcdGlmIChsaW1pdCA8PSBtZW1vaXplZExpbWl0IHx8IHRoaXMubWVtb2l6ZWRbd29yZF1bJ3N1Z2dlc3Rpb25zJ10ubGVuZ3RoIDwgbWVtb2l6ZWRMaW1pdCkge1xuXHRcdFx0XHRyZXR1cm4gdGhpcy5tZW1vaXplZFt3b3JkXVsnc3VnZ2VzdGlvbnMnXS5zbGljZSgwLCBsaW1pdCk7XG5cdFx0XHR9XG5cdFx0fVxuXHRcdFxuXHRcdGlmICh0aGlzLmNoZWNrKHdvcmQpKSByZXR1cm4gW107XG5cdFx0XG5cdFx0Ly8gQ2hlY2sgdGhlIHJlcGxhY2VtZW50IHRhYmxlLlxuXHRcdGZvciAodmFyIGkgPSAwLCBfbGVuID0gdGhpcy5yZXBsYWNlbWVudFRhYmxlLmxlbmd0aDsgaSA8IF9sZW47IGkrKykge1xuXHRcdFx0dmFyIHJlcGxhY2VtZW50RW50cnkgPSB0aGlzLnJlcGxhY2VtZW50VGFibGVbaV07XG5cdFx0XHRcblx0XHRcdGlmICh3b3JkLmluZGV4T2YocmVwbGFjZW1lbnRFbnRyeVswXSkgIT09IC0xKSB7XG5cdFx0XHRcdHZhciBjb3JyZWN0ZWRXb3JkID0gd29yZC5yZXBsYWNlKHJlcGxhY2VtZW50RW50cnlbMF0sIHJlcGxhY2VtZW50RW50cnlbMV0pO1xuXHRcdFx0XHRcblx0XHRcdFx0aWYgKHRoaXMuY2hlY2soY29ycmVjdGVkV29yZCkpIHtcblx0XHRcdFx0XHRyZXR1cm4gWyBjb3JyZWN0ZWRXb3JkIF07XG5cdFx0XHRcdH1cblx0XHRcdH1cblx0XHR9XG5cdFx0XG5cdFx0dmFyIHNlbGYgPSB0aGlzO1xuXHRcdHNlbGYuYWxwaGFiZXQgPSBcImFiY2RlZmdoaWprbG1ub3BxcnN0dXZ3eHl6XCI7XG5cdFx0XG5cdFx0Lypcblx0XHRpZiAoIXNlbGYuYWxwaGFiZXQpIHtcblx0XHRcdC8vIFVzZSB0aGUgYWxwaGFiZXQgYXMgaW1wbGljaXRseSBkZWZpbmVkIGJ5IHRoZSB3b3JkcyBpbiB0aGUgZGljdGlvbmFyeS5cblx0XHRcdHZhciBhbHBoYUhhc2ggPSB7fTtcblx0XHRcdFxuXHRcdFx0Zm9yICh2YXIgaSBpbiBzZWxmLmRpY3Rpb25hcnlUYWJsZSkge1xuXHRcdFx0XHRmb3IgKHZhciBqID0gMCwgX2xlbiA9IGkubGVuZ3RoOyBqIDwgX2xlbjsgaisrKSB7XG5cdFx0XHRcdFx0YWxwaGFIYXNoW2lbal1dID0gdHJ1ZTtcblx0XHRcdFx0fVxuXHRcdFx0fVxuXHRcdFx0XG5cdFx0XHRmb3IgKHZhciBpIGluIGFscGhhSGFzaCkge1xuXHRcdFx0XHRzZWxmLmFscGhhYmV0ICs9IGk7XG5cdFx0XHR9XG5cdFx0XHRcblx0XHRcdHZhciBhbHBoYUFycmF5ID0gc2VsZi5hbHBoYWJldC5zcGxpdChcIlwiKTtcblx0XHRcdGFscGhhQXJyYXkuc29ydCgpO1xuXHRcdFx0c2VsZi5hbHBoYWJldCA9IGFscGhhQXJyYXkuam9pbihcIlwiKTtcblx0XHR9XG5cdFx0Ki9cblx0XHRcblx0XHQvKipcblx0XHQgKiBSZXR1cm5zIGEgaGFzaCBrZXllZCBieSBhbGwgb2YgdGhlIHN0cmluZ3MgdGhhdCBjYW4gYmUgbWFkZSBieSBtYWtpbmcgYSBzaW5nbGUgZWRpdCB0byB0aGUgd29yZCAob3Igd29yZHMgaW4pIGB3b3Jkc2Bcblx0XHQgKiBUaGUgdmFsdWUgb2YgZWFjaCBlbnRyeSBpcyB0aGUgbnVtYmVyIG9mIHVuaXF1ZSB3YXlzIHRoYXQgdGhlIHJlc3VsdGluZyB3b3JkIGNhbiBiZSBtYWRlLlxuXHRcdCAqXG5cdFx0ICogQGFyZyBtaXhlZCB3b3JkcyBFaXRoZXIgYSBoYXNoIGtleWVkIGJ5IHdvcmRzIG9yIGEgc3RyaW5nIHdvcmQgdG8gb3BlcmF0ZSBvbi5cblx0XHQgKiBAYXJnIGJvb2wga25vd25fb25seSBXaGV0aGVyIHRoaXMgZnVuY3Rpb24gc2hvdWxkIGlnbm9yZSBzdHJpbmdzIHRoYXQgYXJlIG5vdCBpbiB0aGUgZGljdGlvbmFyeS5cblx0XHQgKi9cblx0XHRmdW5jdGlvbiBlZGl0czEod29yZHMsIGtub3duX29ubHkpIHtcblx0XHRcdHZhciBydiA9IHt9O1xuXHRcdFx0XG5cdFx0XHR2YXIgaSwgaiwgX2lpbGVuLCBfbGVuLCBfamxlbiwgX2VkaXQ7XG5cblx0XHRcdHZhciBhbHBoYWJldExlbmd0aCA9IHNlbGYuYWxwaGFiZXQubGVuZ3RoO1xuXHRcdFx0XG5cdFx0XHRpZiAodHlwZW9mIHdvcmRzID09ICdzdHJpbmcnKSB7XG5cdFx0XHRcdHZhciB3b3JkID0gd29yZHM7XG5cdFx0XHRcdHdvcmRzID0ge307XG5cdFx0XHRcdHdvcmRzW3dvcmRdID0gdHJ1ZTtcblx0XHRcdH1cblxuXHRcdFx0Zm9yICh2YXIgd29yZCBpbiB3b3Jkcykge1xuXHRcdFx0XHRmb3IgKGkgPSAwLCBfbGVuID0gd29yZC5sZW5ndGggKyAxOyBpIDwgX2xlbjsgaSsrKSB7XG5cdFx0XHRcdFx0dmFyIHMgPSBbIHdvcmQuc3Vic3RyaW5nKDAsIGkpLCB3b3JkLnN1YnN0cmluZyhpKSBdO1xuXHRcdFx0XHRcblx0XHRcdFx0XHQvLyBSZW1vdmUgYSBsZXR0ZXIuXG5cdFx0XHRcdFx0aWYgKHNbMV0pIHtcblx0XHRcdFx0XHRcdF9lZGl0ID0gc1swXSArIHNbMV0uc3Vic3RyaW5nKDEpO1xuXG5cdFx0XHRcdFx0XHRpZiAoIWtub3duX29ubHkgfHwgc2VsZi5jaGVjayhfZWRpdCkpIHtcblx0XHRcdFx0XHRcdFx0aWYgKCEoX2VkaXQgaW4gcnYpKSB7XG5cdFx0XHRcdFx0XHRcdFx0cnZbX2VkaXRdID0gMTtcblx0XHRcdFx0XHRcdFx0fVxuXHRcdFx0XHRcdFx0XHRlbHNlIHtcblx0XHRcdFx0XHRcdFx0XHRydltfZWRpdF0gKz0gMTtcblx0XHRcdFx0XHRcdFx0fVxuXHRcdFx0XHRcdFx0fVxuXHRcdFx0XHRcdH1cblx0XHRcdFx0XHRcblx0XHRcdFx0XHQvLyBUcmFuc3Bvc2UgbGV0dGVyc1xuXHRcdFx0XHRcdC8vIEVsaW1pbmF0ZSB0cmFuc3Bvc2l0aW9ucyBvZiBpZGVudGljYWwgbGV0dGVyc1xuXHRcdFx0XHRcdGlmIChzWzFdLmxlbmd0aCA+IDEgJiYgc1sxXVsxXSAhPT0gc1sxXVswXSkge1xuXHRcdFx0XHRcdFx0X2VkaXQgPSBzWzBdICsgc1sxXVsxXSArIHNbMV1bMF0gKyBzWzFdLnN1YnN0cmluZygyKTtcblxuXHRcdFx0XHRcdFx0aWYgKCFrbm93bl9vbmx5IHx8IHNlbGYuY2hlY2soX2VkaXQpKSB7XG5cdFx0XHRcdFx0XHRcdGlmICghKF9lZGl0IGluIHJ2KSkge1xuXHRcdFx0XHRcdFx0XHRcdHJ2W19lZGl0XSA9IDE7XG5cdFx0XHRcdFx0XHRcdH1cblx0XHRcdFx0XHRcdFx0ZWxzZSB7XG5cdFx0XHRcdFx0XHRcdFx0cnZbX2VkaXRdICs9IDE7XG5cdFx0XHRcdFx0XHRcdH1cblx0XHRcdFx0XHRcdH1cblx0XHRcdFx0XHR9XG5cblx0XHRcdFx0XHRpZiAoc1sxXSkge1xuXHRcdFx0XHRcdFx0Ly8gUmVwbGFjZSBhIGxldHRlciB3aXRoIGFub3RoZXIgbGV0dGVyLlxuXG5cdFx0XHRcdFx0XHR2YXIgbGV0dGVyY2FzZSA9IChzWzFdLnN1YnN0cmluZygwLDEpLnRvVXBwZXJDYXNlKCkgPT09IHNbMV0uc3Vic3RyaW5nKDAsMSkpID8gJ3VwcGVyY2FzZScgOiAnbG93ZXJjYXNlJztcblxuXHRcdFx0XHRcdFx0Zm9yIChqID0gMDsgaiA8IGFscGhhYmV0TGVuZ3RoOyBqKyspIHtcblx0XHRcdFx0XHRcdFx0dmFyIHJlcGxhY2VtZW50TGV0dGVyID0gc2VsZi5hbHBoYWJldFtqXTtcblxuXHRcdFx0XHRcdFx0XHQvLyBTZXQgdGhlIGNhc2Ugb2YgdGhlIHJlcGxhY2VtZW50IGxldHRlciB0byB0aGUgc2FtZSBhcyB0aGUgbGV0dGVyIGJlaW5nIHJlcGxhY2VkLlxuXHRcdFx0XHRcdFx0XHRpZiAoICd1cHBlcmNhc2UnID09PSBsZXR0ZXJjYXNlICkge1xuXHRcdFx0XHRcdFx0XHRcdHJlcGxhY2VtZW50TGV0dGVyID0gcmVwbGFjZW1lbnRMZXR0ZXIudG9VcHBlckNhc2UoKTtcblx0XHRcdFx0XHRcdFx0fVxuXG5cdFx0XHRcdFx0XHRcdC8vIEVsaW1pbmF0ZSByZXBsYWNlbWVudCBvZiBhIGxldHRlciBieSBpdHNlbGZcblx0XHRcdFx0XHRcdFx0aWYgKHJlcGxhY2VtZW50TGV0dGVyICE9IHNbMV0uc3Vic3RyaW5nKDAsMSkpe1xuXHRcdFx0XHRcdFx0XHRcdF9lZGl0ID0gc1swXSArIHJlcGxhY2VtZW50TGV0dGVyICsgc1sxXS5zdWJzdHJpbmcoMSk7XG5cblx0XHRcdFx0XHRcdFx0XHRpZiAoIWtub3duX29ubHkgfHwgc2VsZi5jaGVjayhfZWRpdCkpIHtcblx0XHRcdFx0XHRcdFx0XHRcdGlmICghKF9lZGl0IGluIHJ2KSkge1xuXHRcdFx0XHRcdFx0XHRcdFx0XHRydltfZWRpdF0gPSAxO1xuXHRcdFx0XHRcdFx0XHRcdFx0fVxuXHRcdFx0XHRcdFx0XHRcdFx0ZWxzZSB7XG5cdFx0XHRcdFx0XHRcdFx0XHRcdHJ2W19lZGl0XSArPSAxO1xuXHRcdFx0XHRcdFx0XHRcdFx0fVxuXHRcdFx0XHRcdFx0XHRcdH1cblx0XHRcdFx0XHRcdFx0fVxuXHRcdFx0XHRcdFx0fVxuXHRcdFx0XHRcdH1cblxuXHRcdFx0XHRcdGlmIChzWzFdKSB7XG5cdFx0XHRcdFx0XHQvLyBBZGQgYSBsZXR0ZXIgYmV0d2VlbiBlYWNoIGxldHRlci5cblx0XHRcdFx0XHRcdGZvciAoaiA9IDA7IGogPCBhbHBoYWJldExlbmd0aDsgaisrKSB7XG5cdFx0XHRcdFx0XHRcdC8vIElmIHRoZSBsZXR0ZXJzIG9uIGVhY2ggc2lkZSBhcmUgY2FwaXRhbGl6ZWQsIGNhcGl0YWxpemUgdGhlIHJlcGxhY2VtZW50LlxuXHRcdFx0XHRcdFx0XHR2YXIgbGV0dGVyY2FzZSA9IChzWzBdLnN1YnN0cmluZygtMSkudG9VcHBlckNhc2UoKSA9PT0gc1swXS5zdWJzdHJpbmcoLTEpICYmIHNbMV0uc3Vic3RyaW5nKDAsMSkudG9VcHBlckNhc2UoKSA9PT0gc1sxXS5zdWJzdHJpbmcoMCwxKSkgPyAndXBwZXJjYXNlJyA6ICdsb3dlcmNhc2UnO1xuXG5cdFx0XHRcdFx0XHRcdHZhciByZXBsYWNlbWVudExldHRlciA9IHNlbGYuYWxwaGFiZXRbal07XG5cblx0XHRcdFx0XHRcdFx0aWYgKCAndXBwZXJjYXNlJyA9PT0gbGV0dGVyY2FzZSApIHtcblx0XHRcdFx0XHRcdFx0XHRyZXBsYWNlbWVudExldHRlciA9IHJlcGxhY2VtZW50TGV0dGVyLnRvVXBwZXJDYXNlKCk7XG5cdFx0XHRcdFx0XHRcdH1cblxuXHRcdFx0XHRcdFx0XHRfZWRpdCA9IHNbMF0gKyByZXBsYWNlbWVudExldHRlciArIHNbMV07XG5cblx0XHRcdFx0XHRcdFx0aWYgKCFrbm93bl9vbmx5IHx8IHNlbGYuY2hlY2soX2VkaXQpKSB7XG5cdFx0XHRcdFx0XHRcdFx0aWYgKCEoX2VkaXQgaW4gcnYpKSB7XG5cdFx0XHRcdFx0XHRcdFx0XHRydltfZWRpdF0gPSAxO1xuXHRcdFx0XHRcdFx0XHRcdH1cblx0XHRcdFx0XHRcdFx0XHRlbHNlIHtcblx0XHRcdFx0XHRcdFx0XHRcdHJ2W19lZGl0XSArPSAxO1xuXHRcdFx0XHRcdFx0XHRcdH1cblx0XHRcdFx0XHRcdFx0fVxuXHRcdFx0XHRcdFx0fVxuXHRcdFx0XHRcdH1cblx0XHRcdFx0fVxuXHRcdFx0fVxuXHRcdFx0XG5cdFx0XHRyZXR1cm4gcnY7XG5cdFx0fVxuXG5cdFx0ZnVuY3Rpb24gY29ycmVjdCh3b3JkKSB7XG5cdFx0XHQvLyBHZXQgdGhlIGVkaXQtZGlzdGFuY2UtMSBhbmQgZWRpdC1kaXN0YW5jZS0yIGZvcm1zIG9mIHRoaXMgd29yZC5cblx0XHRcdHZhciBlZDEgPSBlZGl0czEod29yZCk7XG5cdFx0XHR2YXIgZWQyID0gZWRpdHMxKGVkMSwgdHJ1ZSk7XG5cdFx0XHRcblx0XHRcdC8vIFNvcnQgdGhlIGVkaXRzIGJhc2VkIG9uIGhvdyBtYW55IGRpZmZlcmVudCB3YXlzIHRoZXkgd2VyZSBjcmVhdGVkLlxuXHRcdFx0dmFyIHdlaWdodGVkX2NvcnJlY3Rpb25zID0gZWQyO1xuXHRcdFx0XG5cdFx0XHRmb3IgKHZhciBlZDF3b3JkIGluIGVkMSkge1xuXHRcdFx0XHRpZiAoIXNlbGYuY2hlY2soZWQxd29yZCkpIHtcblx0XHRcdFx0XHRjb250aW51ZTtcblx0XHRcdFx0fVxuXG5cdFx0XHRcdGlmIChlZDF3b3JkIGluIHdlaWdodGVkX2NvcnJlY3Rpb25zKSB7XG5cdFx0XHRcdFx0d2VpZ2h0ZWRfY29ycmVjdGlvbnNbZWQxd29yZF0gKz0gZWQxW2VkMXdvcmRdO1xuXHRcdFx0XHR9XG5cdFx0XHRcdGVsc2Uge1xuXHRcdFx0XHRcdHdlaWdodGVkX2NvcnJlY3Rpb25zW2VkMXdvcmRdID0gZWQxW2VkMXdvcmRdO1xuXHRcdFx0XHR9XG5cdFx0XHR9XG5cdFx0XHRcblx0XHRcdHZhciBpLCBfbGVuO1xuXG5cdFx0XHR2YXIgc29ydGVkX2NvcnJlY3Rpb25zID0gW107XG5cdFx0XHRcblx0XHRcdGZvciAoaSBpbiB3ZWlnaHRlZF9jb3JyZWN0aW9ucykge1xuXHRcdFx0XHRpZiAod2VpZ2h0ZWRfY29ycmVjdGlvbnMuaGFzT3duUHJvcGVydHkoaSkpIHtcblx0XHRcdFx0XHRzb3J0ZWRfY29ycmVjdGlvbnMucHVzaChbIGksIHdlaWdodGVkX2NvcnJlY3Rpb25zW2ldIF0pO1xuXHRcdFx0XHR9XG5cdFx0XHR9XG5cblx0XHRcdGZ1bmN0aW9uIHNvcnRlcihhLCBiKSB7XG5cdFx0XHRcdHZhciBhX3ZhbCA9IGFbMV07XG5cdFx0XHRcdHZhciBiX3ZhbCA9IGJbMV07XG5cdFx0XHRcdGlmIChhX3ZhbCA8IGJfdmFsKSB7XG5cdFx0XHRcdFx0cmV0dXJuIC0xO1xuXHRcdFx0XHR9IGVsc2UgaWYgKGFfdmFsID4gYl92YWwpIHtcblx0XHRcdFx0XHRyZXR1cm4gMTtcblx0XHRcdFx0fVxuXHRcdFx0XHQvLyBAdG9kbyBJZiBhIGFuZCBiIGFyZSBlcXVhbGx5IHdlaWdodGVkLCBhZGQgb3VyIG93biB3ZWlnaHQgYmFzZWQgb24gc29tZXRoaW5nIGxpa2UgdGhlIGtleSBsb2NhdGlvbnMgb24gdGhpcyBsYW5ndWFnZSdzIGRlZmF1bHQga2V5Ym9hcmQuXG5cdFx0XHRcdHJldHVybiBiWzBdLmxvY2FsZUNvbXBhcmUoYVswXSk7XG5cdFx0XHR9XG5cdFx0XHRcblx0XHRcdHNvcnRlZF9jb3JyZWN0aW9ucy5zb3J0KHNvcnRlcikucmV2ZXJzZSgpO1xuXG5cdFx0XHR2YXIgcnYgPSBbXTtcblxuXHRcdFx0dmFyIGNhcGl0YWxpemF0aW9uX3NjaGVtZSA9IFwibG93ZXJjYXNlXCI7XG5cdFx0XHRcblx0XHRcdGlmICh3b3JkLnRvVXBwZXJDYXNlKCkgPT09IHdvcmQpIHtcblx0XHRcdFx0Y2FwaXRhbGl6YXRpb25fc2NoZW1lID0gXCJ1cHBlcmNhc2VcIjtcblx0XHRcdH1cblx0XHRcdGVsc2UgaWYgKHdvcmQuc3Vic3RyKDAsIDEpLnRvVXBwZXJDYXNlKCkgKyB3b3JkLnN1YnN0cigxKS50b0xvd2VyQ2FzZSgpID09PSB3b3JkKSB7XG5cdFx0XHRcdGNhcGl0YWxpemF0aW9uX3NjaGVtZSA9IFwiY2FwaXRhbGl6ZWRcIjtcblx0XHRcdH1cblx0XHRcdFxuXHRcdFx0dmFyIHdvcmtpbmdfbGltaXQgPSBsaW1pdDtcblxuXHRcdFx0Zm9yIChpID0gMDsgaSA8IE1hdGgubWluKHdvcmtpbmdfbGltaXQsIHNvcnRlZF9jb3JyZWN0aW9ucy5sZW5ndGgpOyBpKyspIHtcblx0XHRcdFx0aWYgKFwidXBwZXJjYXNlXCIgPT09IGNhcGl0YWxpemF0aW9uX3NjaGVtZSkge1xuXHRcdFx0XHRcdHNvcnRlZF9jb3JyZWN0aW9uc1tpXVswXSA9IHNvcnRlZF9jb3JyZWN0aW9uc1tpXVswXS50b1VwcGVyQ2FzZSgpO1xuXHRcdFx0XHR9XG5cdFx0XHRcdGVsc2UgaWYgKFwiY2FwaXRhbGl6ZWRcIiA9PT0gY2FwaXRhbGl6YXRpb25fc2NoZW1lKSB7XG5cdFx0XHRcdFx0c29ydGVkX2NvcnJlY3Rpb25zW2ldWzBdID0gc29ydGVkX2NvcnJlY3Rpb25zW2ldWzBdLnN1YnN0cigwLCAxKS50b1VwcGVyQ2FzZSgpICsgc29ydGVkX2NvcnJlY3Rpb25zW2ldWzBdLnN1YnN0cigxKTtcblx0XHRcdFx0fVxuXHRcdFx0XHRcblx0XHRcdFx0aWYgKCFzZWxmLmhhc0ZsYWcoc29ydGVkX2NvcnJlY3Rpb25zW2ldWzBdLCBcIk5PU1VHR0VTVFwiKSAmJiBydi5pbmRleE9mKHNvcnRlZF9jb3JyZWN0aW9uc1tpXVswXSkgPT0gLTEpIHtcblx0XHRcdFx0XHRydi5wdXNoKHNvcnRlZF9jb3JyZWN0aW9uc1tpXVswXSk7XG5cdFx0XHRcdH1cblx0XHRcdFx0ZWxzZSB7XG5cdFx0XHRcdFx0Ly8gSWYgb25lIG9mIHRoZSBjb3JyZWN0aW9ucyBpcyBub3QgZWxpZ2libGUgYXMgYSBzdWdnZXN0aW9uICwgbWFrZSBzdXJlIHdlIHN0aWxsIHJldHVybiB0aGUgcmlnaHQgbnVtYmVyIG9mIHN1Z2dlc3Rpb25zLlxuXHRcdFx0XHRcdHdvcmtpbmdfbGltaXQrKztcblx0XHRcdFx0fVxuXHRcdFx0fVxuXG5cdFx0XHRyZXR1cm4gcnY7XG5cdFx0fVxuXHRcdFxuXHRcdHRoaXMubWVtb2l6ZWRbd29yZF0gPSB7XG5cdFx0XHQnc3VnZ2VzdGlvbnMnOiBjb3JyZWN0KHdvcmQpLFxuXHRcdFx0J2xpbWl0JzogbGltaXRcblx0XHR9O1xuXG5cdFx0cmV0dXJuIHRoaXMubWVtb2l6ZWRbd29yZF1bJ3N1Z2dlc3Rpb25zJ107XG5cdH1cbn07XG59KSgpO1xuXG4vLyBTdXBwb3J0IGZvciB1c2UgYXMgYSBub2RlLmpzIG1vZHVsZS5cbmlmICh0eXBlb2YgbW9kdWxlICE9PSAndW5kZWZpbmVkJykge1xuXHRtb2R1bGUuZXhwb3J0cyA9IFR5cG87XG59XG4iLCJcInVzZSBzdHJpY3RcIjtcblxudmFyIFR5cG8gPSByZXF1aXJlKFwidHlwby1qc1wiKTtcblxuZnVuY3Rpb24gQ29kZU1pcnJvclNwZWxsQ2hlY2tlcihvcHRpb25zKSB7XG5cdG9wdGlvbnMgPSBvcHRpb25zIHx8IHt9O1xuXG5cdGlmKFxuXHRcdHR5cGVvZiBvcHRpb25zLmNvZGVNaXJyb3JJbnN0YW5jZSAhPT0gXCJmdW5jdGlvblwiIHx8XG5cdFx0dHlwZW9mIG9wdGlvbnMuY29kZU1pcnJvckluc3RhbmNlLmRlZmluZU1vZGUgIT09IFwiZnVuY3Rpb25cIlxuXHQpIHtcblx0XHRjb25zb2xlLmxvZyhcblx0XHRcdFwiQ29kZU1pcnJvciBTcGVsbCBDaGVja2VyOiBZb3UgbXVzdCBwcm92aWRlIGFuIGluc3RhbmNlIG9mIENvZGVNaXJyb3IgdmlhIHRoZSBvcHRpb24gYGNvZGVNaXJyb3JJbnN0YW5jZWBcIlxuXHRcdCk7XG5cdFx0cmV0dXJuO1xuXHR9XG5cblx0Ly8gQmVjYXVzZSBzb21lIGJyb3dzZXJzIGRvbid0IHN1cHBvcnQgdGhpcyBmdW5jdGlvbmFsaXR5IHlldFxuXHRpZighU3RyaW5nLnByb3RvdHlwZS5pbmNsdWRlcykge1xuXHRcdFN0cmluZy5wcm90b3R5cGUuaW5jbHVkZXMgPSBmdW5jdGlvbigpIHtcblx0XHRcdFwidXNlIHN0cmljdFwiO1xuXHRcdFx0cmV0dXJuIFN0cmluZy5wcm90b3R5cGUuaW5kZXhPZi5hcHBseSh0aGlzLCBhcmd1bWVudHMpICE9PSAtMTtcblx0XHR9O1xuXHR9XG5cblx0Ly8gRGVmaW5lIHRoZSBuZXcgbW9kZVxuXHRvcHRpb25zLmNvZGVNaXJyb3JJbnN0YW5jZS5kZWZpbmVNb2RlKFwic3BlbGwtY2hlY2tlclwiLCBmdW5jdGlvbihjb25maWcpIHtcblx0XHQvLyBMb2FkIEFGRi9ESUMgZGF0YVxuXHRcdGlmKCFDb2RlTWlycm9yU3BlbGxDaGVja2VyLmFmZl9sb2FkaW5nKSB7XG5cdFx0XHRDb2RlTWlycm9yU3BlbGxDaGVja2VyLmFmZl9sb2FkaW5nID0gdHJ1ZTtcblx0XHRcdHZhciB4aHJfYWZmID0gbmV3IFhNTEh0dHBSZXF1ZXN0KCk7XG5cdFx0XHR4aHJfYWZmLm9wZW4oXG5cdFx0XHRcdFwiR0VUXCIsXG5cdFx0XHRcdFwiaHR0cHM6Ly9jZG4uanNkZWxpdnIubmV0L25wbS9odW5zcGVsbC1kaWN0LWVuLXVzQDAuMS4wL2VuLXVzLmFmZlwiLFxuXHRcdFx0XHR0cnVlXG5cdFx0XHQpO1xuXHRcdFx0eGhyX2FmZi5vbmxvYWQgPSBmdW5jdGlvbigpIHtcblx0XHRcdFx0aWYoeGhyX2FmZi5yZWFkeVN0YXRlID09PSA0ICYmIHhocl9hZmYuc3RhdHVzID09PSAyMDApIHtcblx0XHRcdFx0XHRDb2RlTWlycm9yU3BlbGxDaGVja2VyLmFmZl9kYXRhID0geGhyX2FmZi5yZXNwb25zZVRleHQ7XG5cdFx0XHRcdFx0Q29kZU1pcnJvclNwZWxsQ2hlY2tlci5udW1fbG9hZGVkKys7XG5cblx0XHRcdFx0XHRpZihDb2RlTWlycm9yU3BlbGxDaGVja2VyLm51bV9sb2FkZWQgPT0gMikge1xuXHRcdFx0XHRcdFx0Q29kZU1pcnJvclNwZWxsQ2hlY2tlci50eXBvID0gbmV3IFR5cG8oXG5cdFx0XHRcdFx0XHRcdFwiZW5fVVNcIixcblx0XHRcdFx0XHRcdFx0Q29kZU1pcnJvclNwZWxsQ2hlY2tlci5hZmZfZGF0YSxcblx0XHRcdFx0XHRcdFx0Q29kZU1pcnJvclNwZWxsQ2hlY2tlci5kaWNfZGF0YSwge1xuXHRcdFx0XHRcdFx0XHRcdHBsYXRmb3JtOiBcImFueVwiLFxuXHRcdFx0XHRcdFx0XHR9XG5cdFx0XHRcdFx0XHQpO1xuXHRcdFx0XHRcdH1cblx0XHRcdFx0fVxuXHRcdFx0fTtcblx0XHRcdHhocl9hZmYuc2VuZChudWxsKTtcblx0XHR9XG5cblx0XHRpZighQ29kZU1pcnJvclNwZWxsQ2hlY2tlci5kaWNfbG9hZGluZykge1xuXHRcdFx0Q29kZU1pcnJvclNwZWxsQ2hlY2tlci5kaWNfbG9hZGluZyA9IHRydWU7XG5cdFx0XHR2YXIgeGhyX2RpYyA9IG5ldyBYTUxIdHRwUmVxdWVzdCgpO1xuXHRcdFx0eGhyX2RpYy5vcGVuKFxuXHRcdFx0XHRcIkdFVFwiLFxuXHRcdFx0XHRcImh0dHBzOi8vY2RuLmpzZGVsaXZyLm5ldC9ucG0vaHVuc3BlbGwtZGljdC1lbi11c0AwLjEuMC9lbi11cy5kaWNcIixcblx0XHRcdFx0dHJ1ZVxuXHRcdFx0KTtcblx0XHRcdHhocl9kaWMub25sb2FkID0gZnVuY3Rpb24oKSB7XG5cdFx0XHRcdGlmKHhocl9kaWMucmVhZHlTdGF0ZSA9PT0gNCAmJiB4aHJfZGljLnN0YXR1cyA9PT0gMjAwKSB7XG5cdFx0XHRcdFx0Q29kZU1pcnJvclNwZWxsQ2hlY2tlci5kaWNfZGF0YSA9IHhocl9kaWMucmVzcG9uc2VUZXh0O1xuXHRcdFx0XHRcdENvZGVNaXJyb3JTcGVsbENoZWNrZXIubnVtX2xvYWRlZCsrO1xuXG5cdFx0XHRcdFx0aWYoQ29kZU1pcnJvclNwZWxsQ2hlY2tlci5udW1fbG9hZGVkID09IDIpIHtcblx0XHRcdFx0XHRcdENvZGVNaXJyb3JTcGVsbENoZWNrZXIudHlwbyA9IG5ldyBUeXBvKFxuXHRcdFx0XHRcdFx0XHRcImVuX1VTXCIsXG5cdFx0XHRcdFx0XHRcdENvZGVNaXJyb3JTcGVsbENoZWNrZXIuYWZmX2RhdGEsXG5cdFx0XHRcdFx0XHRcdENvZGVNaXJyb3JTcGVsbENoZWNrZXIuZGljX2RhdGEsIHtcblx0XHRcdFx0XHRcdFx0XHRwbGF0Zm9ybTogXCJhbnlcIixcblx0XHRcdFx0XHRcdFx0fVxuXHRcdFx0XHRcdFx0KTtcblxuXHRcdFx0XHRcdFx0aWYob3B0aW9ucy5vbkRpY3Rpb25hcnlMb2FkICE9IHVuZGVmaW5lZCkge1xuXHRcdFx0XHRcdFx0XHRvcHRpb25zLm9uRGljdGlvbmFyeUxvYWQoKTtcblx0XHRcdFx0XHRcdH1cblx0XHRcdFx0XHR9XG5cdFx0XHRcdH1cblx0XHRcdH07XG5cdFx0XHR4aHJfZGljLnNlbmQobnVsbCk7XG5cdFx0fVxuXG5cdFx0dmFyIHdvcmRSZWdleCA9IC9eW14hXCIjJCUmKCkqKyxcXC0uLzo7PD0+P0BbXFxcXFxcXV5fYHt8fX5cXHNdKy87XG5cblx0XHRpZihvcHRpb25zLm1hdGNoUmVnZXggJiYgb3B0aW9ucy5tYXRjaFJlZ2V4IGluc3RhbmNlb2YgUmVnRXhwKSB7XG5cdFx0XHR3b3JkUmVnZXggPSBvcHRpb25zLm1hdGNoUmVnZXg7XG5cdFx0fVxuXG5cdFx0dmFyIHJlZ2V4SWdub3JlID0gL1swLTknXy1dKy87XG5cblx0XHRpZihvcHRpb25zLmlnbm9yZVJlZ2V4ICYmIG9wdGlvbnMuaWdub3JlUmVnZXggaW5zdGFuY2VvZiBSZWdFeHApIHtcblx0XHRcdHJlZ2V4SWdub3JlID0gb3B0aW9ucy5pZ25vcmVSZWdleDtcblx0XHR9XG5cblx0XHR2YXIgY3VzdG9tV29yZHMgPSBbXTtcblxuXHRcdGlmKG9wdGlvbnMuY3VzdG9tV29yZHMpIHtcblx0XHRcdGlmKG9wdGlvbnMuY3VzdG9tV29yZHMgaW5zdGFuY2VvZiBGdW5jdGlvbikge1xuXHRcdFx0XHRjdXN0b21Xb3JkcyA9IG9wdGlvbnMuY3VzdG9tV29yZHMoKTtcblx0XHRcdH0gZWxzZSB7XG5cdFx0XHRcdGN1c3RvbVdvcmRzID0gb3B0aW9ucy5jdXN0b21Xb3Jkcztcblx0XHRcdH1cblx0XHR9XG5cblx0XHQvLyBDb2RlbWlycm9yIG1vZGUgb3ZlcmxheVxuXHRcdHZhciBvdmVybGF5ID0ge1xuXHRcdFx0dG9rZW46IGZ1bmN0aW9uKHN0cmVhbSkge1xuXHRcdFx0XHR2YXIgd29yZCA9IHN0cmVhbS5tYXRjaCh3b3JkUmVnZXgsIHRydWUpO1xuXG5cdFx0XHRcdGlmKHdvcmQpIHtcblx0XHRcdFx0XHR3b3JkID0gd29yZFswXTsgLy8gcmVnZXggbWF0Y2ggYm9keVxuXHRcdFx0XHRcdGlmKFxuXHRcdFx0XHRcdFx0IXdvcmQubWF0Y2gocmVnZXhJZ25vcmUpICYmXG5cdFx0XHRcdFx0XHRDb2RlTWlycm9yU3BlbGxDaGVja2VyLnR5cG8gJiZcblx0XHRcdFx0XHRcdCFDb2RlTWlycm9yU3BlbGxDaGVja2VyLnR5cG8uY2hlY2sod29yZCkgJiZcblx0XHRcdFx0XHRcdCF+Y3VzdG9tV29yZHMuaW5kZXhPZih3b3JkKVxuXHRcdFx0XHRcdClcblx0XHRcdFx0XHRcdHJldHVybiBcInNwZWxsLWVycm9yXCI7IC8vIENTUyBjbGFzczogY20tc3BlbGwtZXJyb3Jcblx0XHRcdFx0fSBlbHNlIHtcblx0XHRcdFx0XHRzdHJlYW0ubmV4dCgpOyAvLyBza2lwIG5vbi13b3JkIGNoYXJhY3RlclxuXHRcdFx0XHR9XG5cblx0XHRcdFx0cmV0dXJuIG51bGw7XG5cdFx0XHR9LFxuXHRcdH07XG5cblx0XHR2YXIgbW9kZSA9IG9wdGlvbnMuY29kZU1pcnJvckluc3RhbmNlLmdldE1vZGUoXG5cdFx0XHRjb25maWcsXG5cdFx0XHRjb25maWcuYmFja2Ryb3AgfHwgXCJ0ZXh0L3BsYWluXCJcblx0XHQpO1xuXG5cdFx0cmV0dXJuIG9wdGlvbnMuY29kZU1pcnJvckluc3RhbmNlLm92ZXJsYXlNb2RlKG1vZGUsIG92ZXJsYXksIHRydWUpO1xuXHR9KTtcbn1cblxuQ29kZU1pcnJvclNwZWxsQ2hlY2tlci5udW1fbG9hZGVkID0gMDtcbkNvZGVNaXJyb3JTcGVsbENoZWNrZXIuYWZmX2xvYWRpbmcgPSBmYWxzZTtcbkNvZGVNaXJyb3JTcGVsbENoZWNrZXIuZGljX2xvYWRpbmcgPSBmYWxzZTtcbkNvZGVNaXJyb3JTcGVsbENoZWNrZXIuYWZmX2RhdGEgPSBcIlwiO1xuQ29kZU1pcnJvclNwZWxsQ2hlY2tlci5kaWNfZGF0YSA9IFwiXCI7XG5Db2RlTWlycm9yU3BlbGxDaGVja2VyLnR5cG87XG5cbm1vZHVsZS5leHBvcnRzID0gQ29kZU1pcnJvclNwZWxsQ2hlY2tlcjsiXX0=
