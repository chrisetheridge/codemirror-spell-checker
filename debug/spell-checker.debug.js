/**
 * @biscuitpants/codemirror-spell-checker v0.0.6
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

		console.log(regexIgnore, options);

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

//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJub2RlX21vZHVsZXMvYnJvd3Nlci1yZXNvbHZlL2VtcHR5LmpzIiwibm9kZV9tb2R1bGVzL3R5cG8tanMvdHlwby5qcyIsInNyYy9qcy9zcGVsbC1jaGVja2VyLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBO0FDQUE7OztBQ0FBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7OztBQy8rQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EiLCJmaWxlIjoiZ2VuZXJhdGVkLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXNDb250ZW50IjpbIihmdW5jdGlvbigpe2Z1bmN0aW9uIHIoZSxuLHQpe2Z1bmN0aW9uIG8oaSxmKXtpZighbltpXSl7aWYoIWVbaV0pe3ZhciBjPVwiZnVuY3Rpb25cIj09dHlwZW9mIHJlcXVpcmUmJnJlcXVpcmU7aWYoIWYmJmMpcmV0dXJuIGMoaSwhMCk7aWYodSlyZXR1cm4gdShpLCEwKTt2YXIgYT1uZXcgRXJyb3IoXCJDYW5ub3QgZmluZCBtb2R1bGUgJ1wiK2krXCInXCIpO3Rocm93IGEuY29kZT1cIk1PRFVMRV9OT1RfRk9VTkRcIixhfXZhciBwPW5baV09e2V4cG9ydHM6e319O2VbaV1bMF0uY2FsbChwLmV4cG9ydHMsZnVuY3Rpb24ocil7dmFyIG49ZVtpXVsxXVtyXTtyZXR1cm4gbyhufHxyKX0scCxwLmV4cG9ydHMscixlLG4sdCl9cmV0dXJuIG5baV0uZXhwb3J0c31mb3IodmFyIHU9XCJmdW5jdGlvblwiPT10eXBlb2YgcmVxdWlyZSYmcmVxdWlyZSxpPTA7aTx0Lmxlbmd0aDtpKyspbyh0W2ldKTtyZXR1cm4gb31yZXR1cm4gcn0pKCkiLCIiLCIvKiBnbG9iYWxzIGNocm9tZTogZmFsc2UgKi9cbi8qIGdsb2JhbHMgX19kaXJuYW1lOiBmYWxzZSAqL1xuLyogZ2xvYmFscyByZXF1aXJlOiBmYWxzZSAqL1xuLyogZ2xvYmFscyBCdWZmZXI6IGZhbHNlICovXG4vKiBnbG9iYWxzIG1vZHVsZTogZmFsc2UgKi9cblxuLyoqXG4gKiBUeXBvIGlzIGEgSmF2YVNjcmlwdCBpbXBsZW1lbnRhdGlvbiBvZiBhIHNwZWxsY2hlY2tlciB1c2luZyBodW5zcGVsbC1zdHlsZSBcbiAqIGRpY3Rpb25hcmllcy5cbiAqL1xuXG52YXIgVHlwbztcblxuKGZ1bmN0aW9uICgpIHtcblwidXNlIHN0cmljdFwiO1xuXG4vKipcbiAqIFR5cG8gY29uc3RydWN0b3IuXG4gKlxuICogQHBhcmFtIHtTdHJpbmd9IFtkaWN0aW9uYXJ5XSBUaGUgbG9jYWxlIGNvZGUgb2YgdGhlIGRpY3Rpb25hcnkgYmVpbmcgdXNlZC4gZS5nLixcbiAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgXCJlbl9VU1wiLiBUaGlzIGlzIG9ubHkgdXNlZCB0byBhdXRvLWxvYWQgZGljdGlvbmFyaWVzLlxuICogQHBhcmFtIHtTdHJpbmd9IFthZmZEYXRhXSAgICBUaGUgZGF0YSBmcm9tIHRoZSBkaWN0aW9uYXJ5J3MgLmFmZiBmaWxlLiBJZiBvbWl0dGVkXG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGFuZCBUeXBvLmpzIGlzIGJlaW5nIHVzZWQgaW4gYSBDaHJvbWUgZXh0ZW5zaW9uLCB0aGUgLmFmZlxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICBmaWxlIHdpbGwgYmUgbG9hZGVkIGF1dG9tYXRpY2FsbHkgZnJvbVxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICBsaWIvdHlwby9kaWN0aW9uYXJpZXMvW2RpY3Rpb25hcnldL1tkaWN0aW9uYXJ5XS5hZmZcbiAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgSW4gb3RoZXIgZW52aXJvbm1lbnRzLCBpdCB3aWxsIGJlIGxvYWRlZCBmcm9tXG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIFtzZXR0aW5ncy5kaWN0aW9uYXJ5UGF0aF0vZGljdGlvbmFyaWVzL1tkaWN0aW9uYXJ5XS9bZGljdGlvbmFyeV0uYWZmXG4gKiBAcGFyYW0ge1N0cmluZ30gW3dvcmRzRGF0YV0gIFRoZSBkYXRhIGZyb20gdGhlIGRpY3Rpb25hcnkncyAuZGljIGZpbGUuIElmIG9taXR0ZWRcbiAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYW5kIFR5cG8uanMgaXMgYmVpbmcgdXNlZCBpbiBhIENocm9tZSBleHRlbnNpb24sIHRoZSAuZGljXG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGZpbGUgd2lsbCBiZSBsb2FkZWQgYXV0b21hdGljYWxseSBmcm9tXG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGxpYi90eXBvL2RpY3Rpb25hcmllcy9bZGljdGlvbmFyeV0vW2RpY3Rpb25hcnldLmRpY1xuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICBJbiBvdGhlciBlbnZpcm9ubWVudHMsIGl0IHdpbGwgYmUgbG9hZGVkIGZyb21cbiAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgW3NldHRpbmdzLmRpY3Rpb25hcnlQYXRoXS9kaWN0aW9uYXJpZXMvW2RpY3Rpb25hcnldL1tkaWN0aW9uYXJ5XS5kaWNcbiAqIEBwYXJhbSB7T2JqZWN0fSBbc2V0dGluZ3NdICAgQ29uc3RydWN0b3Igc2V0dGluZ3MuIEF2YWlsYWJsZSBwcm9wZXJ0aWVzIGFyZTpcbiAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAge1N0cmluZ30gW2RpY3Rpb25hcnlQYXRoXTogcGF0aCB0byBsb2FkIGRpY3Rpb25hcnkgZnJvbSBpbiBub24tY2hyb21lXG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGVudmlyb25tZW50LlxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICB7T2JqZWN0fSBbZmxhZ3NdOiBmbGFnIGluZm9ybWF0aW9uLlxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICB7Qm9vbGVhbn0gW2FzeW5jTG9hZF06IElmIHRydWUsIGFmZkRhdGEgYW5kIHdvcmRzRGF0YSB3aWxsIGJlIGxvYWRlZFxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICBhc3luY2hyb25vdXNseS5cbiAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAge0Z1bmN0aW9ufSBbbG9hZGVkQ2FsbGJhY2tdOiBDYWxsZWQgd2hlbiBib3RoIGFmZkRhdGEgYW5kIHdvcmRzRGF0YVxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICBoYXZlIGJlZW4gbG9hZGVkLiBPbmx5IHVzZWQgaWYgYXN5bmNMb2FkIGlzIHNldCB0byB0cnVlLiBUaGUgcGFyYW1ldGVyXG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlzIHRoZSBpbnN0YW50aWF0ZWQgVHlwbyBvYmplY3QuXG4gKlxuICogQHJldHVybnMge1R5cG99IEEgVHlwbyBvYmplY3QuXG4gKi9cblxuVHlwbyA9IGZ1bmN0aW9uIChkaWN0aW9uYXJ5LCBhZmZEYXRhLCB3b3Jkc0RhdGEsIHNldHRpbmdzKSB7XG5cdHNldHRpbmdzID0gc2V0dGluZ3MgfHwge307XG5cblx0dGhpcy5kaWN0aW9uYXJ5ID0gbnVsbDtcblx0XG5cdHRoaXMucnVsZXMgPSB7fTtcblx0dGhpcy5kaWN0aW9uYXJ5VGFibGUgPSB7fTtcblx0XG5cdHRoaXMuY29tcG91bmRSdWxlcyA9IFtdO1xuXHR0aGlzLmNvbXBvdW5kUnVsZUNvZGVzID0ge307XG5cdFxuXHR0aGlzLnJlcGxhY2VtZW50VGFibGUgPSBbXTtcblx0XG5cdHRoaXMuZmxhZ3MgPSBzZXR0aW5ncy5mbGFncyB8fCB7fTsgXG5cdFxuXHR0aGlzLm1lbW9pemVkID0ge307XG5cblx0dGhpcy5sb2FkZWQgPSBmYWxzZTtcblx0XG5cdHZhciBzZWxmID0gdGhpcztcblx0XG5cdHZhciBwYXRoO1xuXHRcblx0Ly8gTG9vcC1jb250cm9sIHZhcmlhYmxlcy5cblx0dmFyIGksIGosIF9sZW4sIF9qbGVuO1xuXHRcblx0aWYgKGRpY3Rpb25hcnkpIHtcblx0XHRzZWxmLmRpY3Rpb25hcnkgPSBkaWN0aW9uYXJ5O1xuXHRcdFxuXHRcdC8vIElmIHRoZSBkYXRhIGlzIHByZWxvYWRlZCwganVzdCBzZXR1cCB0aGUgVHlwbyBvYmplY3QuXG5cdFx0aWYgKGFmZkRhdGEgJiYgd29yZHNEYXRhKSB7XG5cdFx0XHRzZXR1cCgpO1xuXHRcdH1cblx0XHQvLyBMb2FkaW5nIGRhdGEgZm9yIENocm9tZSBleHRlbnRpb25zLlxuXHRcdGVsc2UgaWYgKHR5cGVvZiB3aW5kb3cgIT09ICd1bmRlZmluZWQnICYmICdjaHJvbWUnIGluIHdpbmRvdyAmJiAnZXh0ZW5zaW9uJyBpbiB3aW5kb3cuY2hyb21lICYmICdnZXRVUkwnIGluIHdpbmRvdy5jaHJvbWUuZXh0ZW5zaW9uKSB7XG5cdFx0XHRpZiAoc2V0dGluZ3MuZGljdGlvbmFyeVBhdGgpIHtcblx0XHRcdFx0cGF0aCA9IHNldHRpbmdzLmRpY3Rpb25hcnlQYXRoO1xuXHRcdFx0fVxuXHRcdFx0ZWxzZSB7XG5cdFx0XHRcdHBhdGggPSBcInR5cG8vZGljdGlvbmFyaWVzXCI7XG5cdFx0XHR9XG5cdFx0XHRcblx0XHRcdGlmICghYWZmRGF0YSkgcmVhZERhdGFGaWxlKGNocm9tZS5leHRlbnNpb24uZ2V0VVJMKHBhdGggKyBcIi9cIiArIGRpY3Rpb25hcnkgKyBcIi9cIiArIGRpY3Rpb25hcnkgKyBcIi5hZmZcIiksIHNldEFmZkRhdGEpO1xuXHRcdFx0aWYgKCF3b3Jkc0RhdGEpIHJlYWREYXRhRmlsZShjaHJvbWUuZXh0ZW5zaW9uLmdldFVSTChwYXRoICsgXCIvXCIgKyBkaWN0aW9uYXJ5ICsgXCIvXCIgKyBkaWN0aW9uYXJ5ICsgXCIuZGljXCIpLCBzZXRXb3Jkc0RhdGEpO1xuXHRcdH1cblx0XHRlbHNlIHtcblx0XHRcdGlmIChzZXR0aW5ncy5kaWN0aW9uYXJ5UGF0aCkge1xuXHRcdFx0XHRwYXRoID0gc2V0dGluZ3MuZGljdGlvbmFyeVBhdGg7XG5cdFx0XHR9XG5cdFx0XHRlbHNlIGlmICh0eXBlb2YgX19kaXJuYW1lICE9PSAndW5kZWZpbmVkJykge1xuXHRcdFx0XHRwYXRoID0gX19kaXJuYW1lICsgJy9kaWN0aW9uYXJpZXMnO1xuXHRcdFx0fVxuXHRcdFx0ZWxzZSB7XG5cdFx0XHRcdHBhdGggPSAnLi9kaWN0aW9uYXJpZXMnO1xuXHRcdFx0fVxuXHRcdFx0XG5cdFx0XHRpZiAoIWFmZkRhdGEpIHJlYWREYXRhRmlsZShwYXRoICsgXCIvXCIgKyBkaWN0aW9uYXJ5ICsgXCIvXCIgKyBkaWN0aW9uYXJ5ICsgXCIuYWZmXCIsIHNldEFmZkRhdGEpO1xuXHRcdFx0aWYgKCF3b3Jkc0RhdGEpIHJlYWREYXRhRmlsZShwYXRoICsgXCIvXCIgKyBkaWN0aW9uYXJ5ICsgXCIvXCIgKyBkaWN0aW9uYXJ5ICsgXCIuZGljXCIsIHNldFdvcmRzRGF0YSk7XG5cdFx0fVxuXHR9XG5cdFxuXHRmdW5jdGlvbiByZWFkRGF0YUZpbGUodXJsLCBzZXRGdW5jKSB7XG5cdFx0dmFyIHJlc3BvbnNlID0gc2VsZi5fcmVhZEZpbGUodXJsLCBudWxsLCBzZXR0aW5ncy5hc3luY0xvYWQpO1xuXHRcdFxuXHRcdGlmIChzZXR0aW5ncy5hc3luY0xvYWQpIHtcblx0XHRcdHJlc3BvbnNlLnRoZW4oZnVuY3Rpb24oZGF0YSkge1xuXHRcdFx0XHRzZXRGdW5jKGRhdGEpO1xuXHRcdFx0fSk7XG5cdFx0fVxuXHRcdGVsc2Uge1xuXHRcdFx0c2V0RnVuYyhyZXNwb25zZSk7XG5cdFx0fVxuXHR9XG5cblx0ZnVuY3Rpb24gc2V0QWZmRGF0YShkYXRhKSB7XG5cdFx0YWZmRGF0YSA9IGRhdGE7XG5cblx0XHRpZiAod29yZHNEYXRhKSB7XG5cdFx0XHRzZXR1cCgpO1xuXHRcdH1cblx0fVxuXG5cdGZ1bmN0aW9uIHNldFdvcmRzRGF0YShkYXRhKSB7XG5cdFx0d29yZHNEYXRhID0gZGF0YTtcblxuXHRcdGlmIChhZmZEYXRhKSB7XG5cdFx0XHRzZXR1cCgpO1xuXHRcdH1cblx0fVxuXG5cdGZ1bmN0aW9uIHNldHVwKCkge1xuXHRcdHNlbGYucnVsZXMgPSBzZWxmLl9wYXJzZUFGRihhZmZEYXRhKTtcblx0XHRcblx0XHQvLyBTYXZlIHRoZSBydWxlIGNvZGVzIHRoYXQgYXJlIHVzZWQgaW4gY29tcG91bmQgcnVsZXMuXG5cdFx0c2VsZi5jb21wb3VuZFJ1bGVDb2RlcyA9IHt9O1xuXHRcdFxuXHRcdGZvciAoaSA9IDAsIF9sZW4gPSBzZWxmLmNvbXBvdW5kUnVsZXMubGVuZ3RoOyBpIDwgX2xlbjsgaSsrKSB7XG5cdFx0XHR2YXIgcnVsZSA9IHNlbGYuY29tcG91bmRSdWxlc1tpXTtcblx0XHRcdFxuXHRcdFx0Zm9yIChqID0gMCwgX2psZW4gPSBydWxlLmxlbmd0aDsgaiA8IF9qbGVuOyBqKyspIHtcblx0XHRcdFx0c2VsZi5jb21wb3VuZFJ1bGVDb2Rlc1tydWxlW2pdXSA9IFtdO1xuXHRcdFx0fVxuXHRcdH1cblx0XHRcblx0XHQvLyBJZiB3ZSBhZGQgdGhpcyBPTkxZSU5DT01QT1VORCBmbGFnIHRvIHNlbGYuY29tcG91bmRSdWxlQ29kZXMsIHRoZW4gX3BhcnNlRElDXG5cdFx0Ly8gd2lsbCBkbyB0aGUgd29yayBvZiBzYXZpbmcgdGhlIGxpc3Qgb2Ygd29yZHMgdGhhdCBhcmUgY29tcG91bmQtb25seS5cblx0XHRpZiAoXCJPTkxZSU5DT01QT1VORFwiIGluIHNlbGYuZmxhZ3MpIHtcblx0XHRcdHNlbGYuY29tcG91bmRSdWxlQ29kZXNbc2VsZi5mbGFncy5PTkxZSU5DT01QT1VORF0gPSBbXTtcblx0XHR9XG5cdFx0XG5cdFx0c2VsZi5kaWN0aW9uYXJ5VGFibGUgPSBzZWxmLl9wYXJzZURJQyh3b3Jkc0RhdGEpO1xuXHRcdFxuXHRcdC8vIEdldCByaWQgb2YgYW55IGNvZGVzIGZyb20gdGhlIGNvbXBvdW5kIHJ1bGUgY29kZXMgdGhhdCBhcmUgbmV2ZXIgdXNlZCBcblx0XHQvLyAob3IgdGhhdCB3ZXJlIHNwZWNpYWwgcmVnZXggY2hhcmFjdGVycykuICBOb3QgZXNwZWNpYWxseSBuZWNlc3NhcnkuLi4gXG5cdFx0Zm9yIChpIGluIHNlbGYuY29tcG91bmRSdWxlQ29kZXMpIHtcblx0XHRcdGlmIChzZWxmLmNvbXBvdW5kUnVsZUNvZGVzW2ldLmxlbmd0aCA9PT0gMCkge1xuXHRcdFx0XHRkZWxldGUgc2VsZi5jb21wb3VuZFJ1bGVDb2Rlc1tpXTtcblx0XHRcdH1cblx0XHR9XG5cdFx0XG5cdFx0Ly8gQnVpbGQgdGhlIGZ1bGwgcmVndWxhciBleHByZXNzaW9ucyBmb3IgZWFjaCBjb21wb3VuZCBydWxlLlxuXHRcdC8vIEkgaGF2ZSBhIGZlZWxpbmcgKGJ1dCBubyBjb25maXJtYXRpb24geWV0KSB0aGF0IHRoaXMgbWV0aG9kIG9mIFxuXHRcdC8vIHRlc3RpbmcgZm9yIGNvbXBvdW5kIHdvcmRzIGlzIHByb2JhYmx5IHNsb3cuXG5cdFx0Zm9yIChpID0gMCwgX2xlbiA9IHNlbGYuY29tcG91bmRSdWxlcy5sZW5ndGg7IGkgPCBfbGVuOyBpKyspIHtcblx0XHRcdHZhciBydWxlVGV4dCA9IHNlbGYuY29tcG91bmRSdWxlc1tpXTtcblx0XHRcdFxuXHRcdFx0dmFyIGV4cHJlc3Npb25UZXh0ID0gXCJcIjtcblx0XHRcdFxuXHRcdFx0Zm9yIChqID0gMCwgX2psZW4gPSBydWxlVGV4dC5sZW5ndGg7IGogPCBfamxlbjsgaisrKSB7XG5cdFx0XHRcdHZhciBjaGFyYWN0ZXIgPSBydWxlVGV4dFtqXTtcblx0XHRcdFx0XG5cdFx0XHRcdGlmIChjaGFyYWN0ZXIgaW4gc2VsZi5jb21wb3VuZFJ1bGVDb2Rlcykge1xuXHRcdFx0XHRcdGV4cHJlc3Npb25UZXh0ICs9IFwiKFwiICsgc2VsZi5jb21wb3VuZFJ1bGVDb2Rlc1tjaGFyYWN0ZXJdLmpvaW4oXCJ8XCIpICsgXCIpXCI7XG5cdFx0XHRcdH1cblx0XHRcdFx0ZWxzZSB7XG5cdFx0XHRcdFx0ZXhwcmVzc2lvblRleHQgKz0gY2hhcmFjdGVyO1xuXHRcdFx0XHR9XG5cdFx0XHR9XG5cdFx0XHRcblx0XHRcdHNlbGYuY29tcG91bmRSdWxlc1tpXSA9IG5ldyBSZWdFeHAoZXhwcmVzc2lvblRleHQsIFwiaVwiKTtcblx0XHR9XG5cdFx0XG5cdFx0c2VsZi5sb2FkZWQgPSB0cnVlO1xuXHRcdFxuXHRcdGlmIChzZXR0aW5ncy5hc3luY0xvYWQgJiYgc2V0dGluZ3MubG9hZGVkQ2FsbGJhY2spIHtcblx0XHRcdHNldHRpbmdzLmxvYWRlZENhbGxiYWNrKHNlbGYpO1xuXHRcdH1cblx0fVxuXHRcblx0cmV0dXJuIHRoaXM7XG59O1xuXG5UeXBvLnByb3RvdHlwZSA9IHtcblx0LyoqXG5cdCAqIExvYWRzIGEgVHlwbyBpbnN0YW5jZSBmcm9tIGEgaGFzaCBvZiBhbGwgb2YgdGhlIFR5cG8gcHJvcGVydGllcy5cblx0ICpcblx0ICogQHBhcmFtIG9iamVjdCBvYmogQSBoYXNoIG9mIFR5cG8gcHJvcGVydGllcywgcHJvYmFibHkgZ290dGVuIGZyb20gYSBKU09OLnBhcnNlKEpTT04uc3RyaW5naWZ5KHR5cG9faW5zdGFuY2UpKS5cblx0ICovXG5cdFxuXHRsb2FkIDogZnVuY3Rpb24gKG9iaikge1xuXHRcdGZvciAodmFyIGkgaW4gb2JqKSB7XG5cdFx0XHRpZiAob2JqLmhhc093blByb3BlcnR5KGkpKSB7XG5cdFx0XHRcdHRoaXNbaV0gPSBvYmpbaV07XG5cdFx0XHR9XG5cdFx0fVxuXHRcdFxuXHRcdHJldHVybiB0aGlzO1xuXHR9LFxuXHRcblx0LyoqXG5cdCAqIFJlYWQgdGhlIGNvbnRlbnRzIG9mIGEgZmlsZS5cblx0ICogXG5cdCAqIEBwYXJhbSB7U3RyaW5nfSBwYXRoIFRoZSBwYXRoIChyZWxhdGl2ZSkgdG8gdGhlIGZpbGUuXG5cdCAqIEBwYXJhbSB7U3RyaW5nfSBbY2hhcnNldD1cIklTTzg4NTktMVwiXSBUaGUgZXhwZWN0ZWQgY2hhcnNldCBvZiB0aGUgZmlsZVxuXHQgKiBAcGFyYW0ge0Jvb2xlYW59IGFzeW5jIElmIHRydWUsIHRoZSBmaWxlIHdpbGwgYmUgcmVhZCBhc3luY2hyb25vdXNseS4gRm9yIG5vZGUuanMgdGhpcyBkb2VzIG5vdGhpbmcsIGFsbFxuXHQgKiAgICAgICAgZmlsZXMgYXJlIHJlYWQgc3luY2hyb25vdXNseS5cblx0ICogQHJldHVybnMge1N0cmluZ30gVGhlIGZpbGUgZGF0YSBpZiBhc3luYyBpcyBmYWxzZSwgb3RoZXJ3aXNlIGEgcHJvbWlzZSBvYmplY3QuIElmIHJ1bm5pbmcgbm9kZS5qcywgdGhlIGRhdGEgaXNcblx0ICogICAgICAgICAgYWx3YXlzIHJldHVybmVkLlxuXHQgKi9cblx0XG5cdF9yZWFkRmlsZSA6IGZ1bmN0aW9uIChwYXRoLCBjaGFyc2V0LCBhc3luYykge1xuXHRcdGNoYXJzZXQgPSBjaGFyc2V0IHx8IFwidXRmOFwiO1xuXHRcdFxuXHRcdGlmICh0eXBlb2YgWE1MSHR0cFJlcXVlc3QgIT09ICd1bmRlZmluZWQnKSB7XG5cdFx0XHR2YXIgcHJvbWlzZTtcblx0XHRcdHZhciByZXEgPSBuZXcgWE1MSHR0cFJlcXVlc3QoKTtcblx0XHRcdHJlcS5vcGVuKFwiR0VUXCIsIHBhdGgsIGFzeW5jKTtcblx0XHRcdFxuXHRcdFx0aWYgKGFzeW5jKSB7XG5cdFx0XHRcdHByb21pc2UgPSBuZXcgUHJvbWlzZShmdW5jdGlvbihyZXNvbHZlLCByZWplY3QpIHtcblx0XHRcdFx0XHRyZXEub25sb2FkID0gZnVuY3Rpb24oKSB7XG5cdFx0XHRcdFx0XHRpZiAocmVxLnN0YXR1cyA9PT0gMjAwKSB7XG5cdFx0XHRcdFx0XHRcdHJlc29sdmUocmVxLnJlc3BvbnNlVGV4dCk7XG5cdFx0XHRcdFx0XHR9XG5cdFx0XHRcdFx0XHRlbHNlIHtcblx0XHRcdFx0XHRcdFx0cmVqZWN0KHJlcS5zdGF0dXNUZXh0KTtcblx0XHRcdFx0XHRcdH1cblx0XHRcdFx0XHR9O1xuXHRcdFx0XHRcdFxuXHRcdFx0XHRcdHJlcS5vbmVycm9yID0gZnVuY3Rpb24oKSB7XG5cdFx0XHRcdFx0XHRyZWplY3QocmVxLnN0YXR1c1RleHQpO1xuXHRcdFx0XHRcdH1cblx0XHRcdFx0fSk7XG5cdFx0XHR9XG5cdFx0XG5cdFx0XHRpZiAocmVxLm92ZXJyaWRlTWltZVR5cGUpXG5cdFx0XHRcdHJlcS5vdmVycmlkZU1pbWVUeXBlKFwidGV4dC9wbGFpbjsgY2hhcnNldD1cIiArIGNoYXJzZXQpO1xuXHRcdFxuXHRcdFx0cmVxLnNlbmQobnVsbCk7XG5cdFx0XHRcblx0XHRcdHJldHVybiBhc3luYyA/IHByb21pc2UgOiByZXEucmVzcG9uc2VUZXh0O1xuXHRcdH1cblx0XHRlbHNlIGlmICh0eXBlb2YgcmVxdWlyZSAhPT0gJ3VuZGVmaW5lZCcpIHtcblx0XHRcdC8vIE5vZGUuanNcblx0XHRcdHZhciBmcyA9IHJlcXVpcmUoXCJmc1wiKTtcblx0XHRcdFxuXHRcdFx0dHJ5IHtcblx0XHRcdFx0aWYgKGZzLmV4aXN0c1N5bmMocGF0aCkpIHtcblx0XHRcdFx0XHRyZXR1cm4gZnMucmVhZEZpbGVTeW5jKHBhdGgsIGNoYXJzZXQpO1xuXHRcdFx0XHR9XG5cdFx0XHRcdGVsc2Uge1xuXHRcdFx0XHRcdGNvbnNvbGUubG9nKFwiUGF0aCBcIiArIHBhdGggKyBcIiBkb2VzIG5vdCBleGlzdC5cIik7XG5cdFx0XHRcdH1cblx0XHRcdH0gY2F0Y2ggKGUpIHtcblx0XHRcdFx0Y29uc29sZS5sb2coZSk7XG5cdFx0XHRcdHJldHVybiAnJztcblx0XHRcdH1cblx0XHR9XG5cdH0sXG5cdFxuXHQvKipcblx0ICogUGFyc2UgdGhlIHJ1bGVzIG91dCBmcm9tIGEgLmFmZiBmaWxlLlxuXHQgKlxuXHQgKiBAcGFyYW0ge1N0cmluZ30gZGF0YSBUaGUgY29udGVudHMgb2YgdGhlIGFmZml4IGZpbGUuXG5cdCAqIEByZXR1cm5zIG9iamVjdCBUaGUgcnVsZXMgZnJvbSB0aGUgZmlsZS5cblx0ICovXG5cdFxuXHRfcGFyc2VBRkYgOiBmdW5jdGlvbiAoZGF0YSkge1xuXHRcdHZhciBydWxlcyA9IHt9O1xuXHRcdFxuXHRcdHZhciBsaW5lLCBzdWJsaW5lLCBudW1FbnRyaWVzLCBsaW5lUGFydHM7XG5cdFx0dmFyIGksIGosIF9sZW4sIF9qbGVuO1xuXHRcdFxuXHRcdC8vIFJlbW92ZSBjb21tZW50IGxpbmVzXG5cdFx0ZGF0YSA9IHRoaXMuX3JlbW92ZUFmZml4Q29tbWVudHMoZGF0YSk7XG5cdFx0XG5cdFx0dmFyIGxpbmVzID0gZGF0YS5zcGxpdCgvXFxyP1xcbi8pO1xuXHRcdFxuXHRcdGZvciAoaSA9IDAsIF9sZW4gPSBsaW5lcy5sZW5ndGg7IGkgPCBfbGVuOyBpKyspIHtcblx0XHRcdGxpbmUgPSBsaW5lc1tpXTtcblx0XHRcdFxuXHRcdFx0dmFyIGRlZmluaXRpb25QYXJ0cyA9IGxpbmUuc3BsaXQoL1xccysvKTtcblx0XHRcdFxuXHRcdFx0dmFyIHJ1bGVUeXBlID0gZGVmaW5pdGlvblBhcnRzWzBdO1xuXHRcdFx0XG5cdFx0XHRpZiAocnVsZVR5cGUgPT0gXCJQRlhcIiB8fCBydWxlVHlwZSA9PSBcIlNGWFwiKSB7XG5cdFx0XHRcdHZhciBydWxlQ29kZSA9IGRlZmluaXRpb25QYXJ0c1sxXTtcblx0XHRcdFx0dmFyIGNvbWJpbmVhYmxlID0gZGVmaW5pdGlvblBhcnRzWzJdO1xuXHRcdFx0XHRudW1FbnRyaWVzID0gcGFyc2VJbnQoZGVmaW5pdGlvblBhcnRzWzNdLCAxMCk7XG5cdFx0XHRcdFxuXHRcdFx0XHR2YXIgZW50cmllcyA9IFtdO1xuXHRcdFx0XHRcblx0XHRcdFx0Zm9yIChqID0gaSArIDEsIF9qbGVuID0gaSArIDEgKyBudW1FbnRyaWVzOyBqIDwgX2psZW47IGorKykge1xuXHRcdFx0XHRcdHN1YmxpbmUgPSBsaW5lc1tqXTtcblx0XHRcdFx0XHRcblx0XHRcdFx0XHRsaW5lUGFydHMgPSBzdWJsaW5lLnNwbGl0KC9cXHMrLyk7XG5cdFx0XHRcdFx0dmFyIGNoYXJhY3RlcnNUb1JlbW92ZSA9IGxpbmVQYXJ0c1syXTtcblx0XHRcdFx0XHRcblx0XHRcdFx0XHR2YXIgYWRkaXRpb25QYXJ0cyA9IGxpbmVQYXJ0c1szXS5zcGxpdChcIi9cIik7XG5cdFx0XHRcdFx0XG5cdFx0XHRcdFx0dmFyIGNoYXJhY3RlcnNUb0FkZCA9IGFkZGl0aW9uUGFydHNbMF07XG5cdFx0XHRcdFx0aWYgKGNoYXJhY3RlcnNUb0FkZCA9PT0gXCIwXCIpIGNoYXJhY3RlcnNUb0FkZCA9IFwiXCI7XG5cdFx0XHRcdFx0XG5cdFx0XHRcdFx0dmFyIGNvbnRpbnVhdGlvbkNsYXNzZXMgPSB0aGlzLnBhcnNlUnVsZUNvZGVzKGFkZGl0aW9uUGFydHNbMV0pO1xuXHRcdFx0XHRcdFxuXHRcdFx0XHRcdHZhciByZWdleFRvTWF0Y2ggPSBsaW5lUGFydHNbNF07XG5cdFx0XHRcdFx0XG5cdFx0XHRcdFx0dmFyIGVudHJ5ID0ge307XG5cdFx0XHRcdFx0ZW50cnkuYWRkID0gY2hhcmFjdGVyc1RvQWRkO1xuXHRcdFx0XHRcdFxuXHRcdFx0XHRcdGlmIChjb250aW51YXRpb25DbGFzc2VzLmxlbmd0aCA+IDApIGVudHJ5LmNvbnRpbnVhdGlvbkNsYXNzZXMgPSBjb250aW51YXRpb25DbGFzc2VzO1xuXHRcdFx0XHRcdFxuXHRcdFx0XHRcdGlmIChyZWdleFRvTWF0Y2ggIT09IFwiLlwiKSB7XG5cdFx0XHRcdFx0XHRpZiAocnVsZVR5cGUgPT09IFwiU0ZYXCIpIHtcblx0XHRcdFx0XHRcdFx0ZW50cnkubWF0Y2ggPSBuZXcgUmVnRXhwKHJlZ2V4VG9NYXRjaCArIFwiJFwiKTtcblx0XHRcdFx0XHRcdH1cblx0XHRcdFx0XHRcdGVsc2Uge1xuXHRcdFx0XHRcdFx0XHRlbnRyeS5tYXRjaCA9IG5ldyBSZWdFeHAoXCJeXCIgKyByZWdleFRvTWF0Y2gpO1xuXHRcdFx0XHRcdFx0fVxuXHRcdFx0XHRcdH1cblx0XHRcdFx0XHRcblx0XHRcdFx0XHRpZiAoY2hhcmFjdGVyc1RvUmVtb3ZlICE9IFwiMFwiKSB7XG5cdFx0XHRcdFx0XHRpZiAocnVsZVR5cGUgPT09IFwiU0ZYXCIpIHtcblx0XHRcdFx0XHRcdFx0ZW50cnkucmVtb3ZlID0gbmV3IFJlZ0V4cChjaGFyYWN0ZXJzVG9SZW1vdmUgICsgXCIkXCIpO1xuXHRcdFx0XHRcdFx0fVxuXHRcdFx0XHRcdFx0ZWxzZSB7XG5cdFx0XHRcdFx0XHRcdGVudHJ5LnJlbW92ZSA9IGNoYXJhY3RlcnNUb1JlbW92ZTtcblx0XHRcdFx0XHRcdH1cblx0XHRcdFx0XHR9XG5cdFx0XHRcdFx0XG5cdFx0XHRcdFx0ZW50cmllcy5wdXNoKGVudHJ5KTtcblx0XHRcdFx0fVxuXHRcdFx0XHRcblx0XHRcdFx0cnVsZXNbcnVsZUNvZGVdID0geyBcInR5cGVcIiA6IHJ1bGVUeXBlLCBcImNvbWJpbmVhYmxlXCIgOiAoY29tYmluZWFibGUgPT0gXCJZXCIpLCBcImVudHJpZXNcIiA6IGVudHJpZXMgfTtcblx0XHRcdFx0XG5cdFx0XHRcdGkgKz0gbnVtRW50cmllcztcblx0XHRcdH1cblx0XHRcdGVsc2UgaWYgKHJ1bGVUeXBlID09PSBcIkNPTVBPVU5EUlVMRVwiKSB7XG5cdFx0XHRcdG51bUVudHJpZXMgPSBwYXJzZUludChkZWZpbml0aW9uUGFydHNbMV0sIDEwKTtcblx0XHRcdFx0XG5cdFx0XHRcdGZvciAoaiA9IGkgKyAxLCBfamxlbiA9IGkgKyAxICsgbnVtRW50cmllczsgaiA8IF9qbGVuOyBqKyspIHtcblx0XHRcdFx0XHRsaW5lID0gbGluZXNbal07XG5cdFx0XHRcdFx0XG5cdFx0XHRcdFx0bGluZVBhcnRzID0gbGluZS5zcGxpdCgvXFxzKy8pO1xuXHRcdFx0XHRcdHRoaXMuY29tcG91bmRSdWxlcy5wdXNoKGxpbmVQYXJ0c1sxXSk7XG5cdFx0XHRcdH1cblx0XHRcdFx0XG5cdFx0XHRcdGkgKz0gbnVtRW50cmllcztcblx0XHRcdH1cblx0XHRcdGVsc2UgaWYgKHJ1bGVUeXBlID09PSBcIlJFUFwiKSB7XG5cdFx0XHRcdGxpbmVQYXJ0cyA9IGxpbmUuc3BsaXQoL1xccysvKTtcblx0XHRcdFx0XG5cdFx0XHRcdGlmIChsaW5lUGFydHMubGVuZ3RoID09PSAzKSB7XG5cdFx0XHRcdFx0dGhpcy5yZXBsYWNlbWVudFRhYmxlLnB1c2goWyBsaW5lUGFydHNbMV0sIGxpbmVQYXJ0c1syXSBdKTtcblx0XHRcdFx0fVxuXHRcdFx0fVxuXHRcdFx0ZWxzZSB7XG5cdFx0XHRcdC8vIE9OTFlJTkNPTVBPVU5EXG5cdFx0XHRcdC8vIENPTVBPVU5ETUlOXG5cdFx0XHRcdC8vIEZMQUdcblx0XHRcdFx0Ly8gS0VFUENBU0Vcblx0XHRcdFx0Ly8gTkVFREFGRklYXG5cdFx0XHRcdFxuXHRcdFx0XHR0aGlzLmZsYWdzW3J1bGVUeXBlXSA9IGRlZmluaXRpb25QYXJ0c1sxXTtcblx0XHRcdH1cblx0XHR9XG5cdFx0XG5cdFx0cmV0dXJuIHJ1bGVzO1xuXHR9LFxuXHRcblx0LyoqXG5cdCAqIFJlbW92ZXMgY29tbWVudCBsaW5lcyBhbmQgdGhlbiBjbGVhbnMgdXAgYmxhbmsgbGluZXMgYW5kIHRyYWlsaW5nIHdoaXRlc3BhY2UuXG5cdCAqXG5cdCAqIEBwYXJhbSB7U3RyaW5nfSBkYXRhIFRoZSBkYXRhIGZyb20gYW4gYWZmaXggZmlsZS5cblx0ICogQHJldHVybiB7U3RyaW5nfSBUaGUgY2xlYW5lZC11cCBkYXRhLlxuXHQgKi9cblx0XG5cdF9yZW1vdmVBZmZpeENvbW1lbnRzIDogZnVuY3Rpb24gKGRhdGEpIHtcblx0XHQvLyBSZW1vdmUgY29tbWVudHNcblx0XHQvLyBUaGlzIHVzZWQgdG8gcmVtb3ZlIGFueSBzdHJpbmcgc3RhcnRpbmcgd2l0aCAnIycgdXAgdG8gdGhlIGVuZCBvZiB0aGUgbGluZSxcblx0XHQvLyBidXQgc29tZSBDT01QT1VORFJVTEUgZGVmaW5pdGlvbnMgaW5jbHVkZSAnIycgYXMgcGFydCBvZiB0aGUgcnVsZS5cblx0XHQvLyBJIGhhdmVuJ3Qgc2VlbiBhbnkgYWZmaXggZmlsZXMgdGhhdCB1c2UgY29tbWVudHMgb24gdGhlIHNhbWUgbGluZSBhcyByZWFsIGRhdGEsXG5cdFx0Ly8gc28gSSBkb24ndCB0aGluayB0aGlzIHdpbGwgYnJlYWsgYW55dGhpbmcuXG5cdFx0ZGF0YSA9IGRhdGEucmVwbGFjZSgvXlxccyojLiokL21nLCBcIlwiKTtcblx0XHRcblx0XHQvLyBUcmltIGVhY2ggbGluZVxuXHRcdGRhdGEgPSBkYXRhLnJlcGxhY2UoL15cXHNcXHMqL20sICcnKS5yZXBsYWNlKC9cXHNcXHMqJC9tLCAnJyk7XG5cdFx0XG5cdFx0Ly8gUmVtb3ZlIGJsYW5rIGxpbmVzLlxuXHRcdGRhdGEgPSBkYXRhLnJlcGxhY2UoL1xcbnsyLH0vZywgXCJcXG5cIik7XG5cdFx0XG5cdFx0Ly8gVHJpbSB0aGUgZW50aXJlIHN0cmluZ1xuXHRcdGRhdGEgPSBkYXRhLnJlcGxhY2UoL15cXHNcXHMqLywgJycpLnJlcGxhY2UoL1xcc1xccyokLywgJycpO1xuXHRcdFxuXHRcdHJldHVybiBkYXRhO1xuXHR9LFxuXHRcblx0LyoqXG5cdCAqIFBhcnNlcyB0aGUgd29yZHMgb3V0IGZyb20gdGhlIC5kaWMgZmlsZS5cblx0ICpcblx0ICogQHBhcmFtIHtTdHJpbmd9IGRhdGEgVGhlIGRhdGEgZnJvbSB0aGUgZGljdGlvbmFyeSBmaWxlLlxuXHQgKiBAcmV0dXJucyBvYmplY3QgVGhlIGxvb2t1cCB0YWJsZSBjb250YWluaW5nIGFsbCBvZiB0aGUgd29yZHMgYW5kXG5cdCAqICAgICAgICAgICAgICAgICB3b3JkIGZvcm1zIGZyb20gdGhlIGRpY3Rpb25hcnkuXG5cdCAqL1xuXHRcblx0X3BhcnNlRElDIDogZnVuY3Rpb24gKGRhdGEpIHtcblx0XHRkYXRhID0gdGhpcy5fcmVtb3ZlRGljQ29tbWVudHMoZGF0YSk7XG5cdFx0XG5cdFx0dmFyIGxpbmVzID0gZGF0YS5zcGxpdCgvXFxyP1xcbi8pO1xuXHRcdHZhciBkaWN0aW9uYXJ5VGFibGUgPSB7fTtcblx0XHRcblx0XHRmdW5jdGlvbiBhZGRXb3JkKHdvcmQsIHJ1bGVzKSB7XG5cdFx0XHQvLyBTb21lIGRpY3Rpb25hcmllcyB3aWxsIGxpc3QgdGhlIHNhbWUgd29yZCBtdWx0aXBsZSB0aW1lcyB3aXRoIGRpZmZlcmVudCBydWxlIHNldHMuXG5cdFx0XHRpZiAoIWRpY3Rpb25hcnlUYWJsZS5oYXNPd25Qcm9wZXJ0eSh3b3JkKSkge1xuXHRcdFx0XHRkaWN0aW9uYXJ5VGFibGVbd29yZF0gPSBudWxsO1xuXHRcdFx0fVxuXHRcdFx0XG5cdFx0XHRpZiAocnVsZXMubGVuZ3RoID4gMCkge1xuXHRcdFx0XHRpZiAoZGljdGlvbmFyeVRhYmxlW3dvcmRdID09PSBudWxsKSB7XG5cdFx0XHRcdFx0ZGljdGlvbmFyeVRhYmxlW3dvcmRdID0gW107XG5cdFx0XHRcdH1cblxuXHRcdFx0XHRkaWN0aW9uYXJ5VGFibGVbd29yZF0ucHVzaChydWxlcyk7XG5cdFx0XHR9XG5cdFx0fVxuXHRcdFxuXHRcdC8vIFRoZSBmaXJzdCBsaW5lIGlzIHRoZSBudW1iZXIgb2Ygd29yZHMgaW4gdGhlIGRpY3Rpb25hcnkuXG5cdFx0Zm9yICh2YXIgaSA9IDEsIF9sZW4gPSBsaW5lcy5sZW5ndGg7IGkgPCBfbGVuOyBpKyspIHtcblx0XHRcdHZhciBsaW5lID0gbGluZXNbaV07XG5cdFx0XHRcblx0XHRcdGlmICghbGluZSkge1xuXHRcdFx0XHQvLyBJZ25vcmUgZW1wdHkgbGluZXMuXG5cdFx0XHRcdGNvbnRpbnVlO1xuXHRcdFx0fVxuXG5cdFx0XHR2YXIgcGFydHMgPSBsaW5lLnNwbGl0KFwiL1wiLCAyKTtcblx0XHRcdFxuXHRcdFx0dmFyIHdvcmQgPSBwYXJ0c1swXTtcblxuXHRcdFx0Ly8gTm93IGZvciBlYWNoIGFmZml4IHJ1bGUsIGdlbmVyYXRlIHRoYXQgZm9ybSBvZiB0aGUgd29yZC5cblx0XHRcdGlmIChwYXJ0cy5sZW5ndGggPiAxKSB7XG5cdFx0XHRcdHZhciBydWxlQ29kZXNBcnJheSA9IHRoaXMucGFyc2VSdWxlQ29kZXMocGFydHNbMV0pO1xuXHRcdFx0XHRcblx0XHRcdFx0Ly8gU2F2ZSB0aGUgcnVsZUNvZGVzIGZvciBjb21wb3VuZCB3b3JkIHNpdHVhdGlvbnMuXG5cdFx0XHRcdGlmICghKFwiTkVFREFGRklYXCIgaW4gdGhpcy5mbGFncykgfHwgcnVsZUNvZGVzQXJyYXkuaW5kZXhPZih0aGlzLmZsYWdzLk5FRURBRkZJWCkgPT0gLTEpIHtcblx0XHRcdFx0XHRhZGRXb3JkKHdvcmQsIHJ1bGVDb2Rlc0FycmF5KTtcblx0XHRcdFx0fVxuXHRcdFx0XHRcblx0XHRcdFx0Zm9yICh2YXIgaiA9IDAsIF9qbGVuID0gcnVsZUNvZGVzQXJyYXkubGVuZ3RoOyBqIDwgX2psZW47IGorKykge1xuXHRcdFx0XHRcdHZhciBjb2RlID0gcnVsZUNvZGVzQXJyYXlbal07XG5cdFx0XHRcdFx0XG5cdFx0XHRcdFx0dmFyIHJ1bGUgPSB0aGlzLnJ1bGVzW2NvZGVdO1xuXHRcdFx0XHRcdFxuXHRcdFx0XHRcdGlmIChydWxlKSB7XG5cdFx0XHRcdFx0XHR2YXIgbmV3V29yZHMgPSB0aGlzLl9hcHBseVJ1bGUod29yZCwgcnVsZSk7XG5cdFx0XHRcdFx0XHRcblx0XHRcdFx0XHRcdGZvciAodmFyIGlpID0gMCwgX2lpbGVuID0gbmV3V29yZHMubGVuZ3RoOyBpaSA8IF9paWxlbjsgaWkrKykge1xuXHRcdFx0XHRcdFx0XHR2YXIgbmV3V29yZCA9IG5ld1dvcmRzW2lpXTtcblx0XHRcdFx0XHRcdFx0XG5cdFx0XHRcdFx0XHRcdGFkZFdvcmQobmV3V29yZCwgW10pO1xuXHRcdFx0XHRcdFx0XHRcblx0XHRcdFx0XHRcdFx0aWYgKHJ1bGUuY29tYmluZWFibGUpIHtcblx0XHRcdFx0XHRcdFx0XHRmb3IgKHZhciBrID0gaiArIDE7IGsgPCBfamxlbjsgaysrKSB7XG5cdFx0XHRcdFx0XHRcdFx0XHR2YXIgY29tYmluZUNvZGUgPSBydWxlQ29kZXNBcnJheVtrXTtcblx0XHRcdFx0XHRcdFx0XHRcdFxuXHRcdFx0XHRcdFx0XHRcdFx0dmFyIGNvbWJpbmVSdWxlID0gdGhpcy5ydWxlc1tjb21iaW5lQ29kZV07XG5cdFx0XHRcdFx0XHRcdFx0XHRcblx0XHRcdFx0XHRcdFx0XHRcdGlmIChjb21iaW5lUnVsZSkge1xuXHRcdFx0XHRcdFx0XHRcdFx0XHRpZiAoY29tYmluZVJ1bGUuY29tYmluZWFibGUgJiYgKHJ1bGUudHlwZSAhPSBjb21iaW5lUnVsZS50eXBlKSkge1xuXHRcdFx0XHRcdFx0XHRcdFx0XHRcdHZhciBvdGhlck5ld1dvcmRzID0gdGhpcy5fYXBwbHlSdWxlKG5ld1dvcmQsIGNvbWJpbmVSdWxlKTtcblx0XHRcdFx0XHRcdFx0XHRcdFx0XHRcblx0XHRcdFx0XHRcdFx0XHRcdFx0XHRmb3IgKHZhciBpaWkgPSAwLCBfaWlpbGVuID0gb3RoZXJOZXdXb3Jkcy5sZW5ndGg7IGlpaSA8IF9paWlsZW47IGlpaSsrKSB7XG5cdFx0XHRcdFx0XHRcdFx0XHRcdFx0XHR2YXIgb3RoZXJOZXdXb3JkID0gb3RoZXJOZXdXb3Jkc1tpaWldO1xuXHRcdFx0XHRcdFx0XHRcdFx0XHRcdFx0YWRkV29yZChvdGhlck5ld1dvcmQsIFtdKTtcblx0XHRcdFx0XHRcdFx0XHRcdFx0XHR9XG5cdFx0XHRcdFx0XHRcdFx0XHRcdH1cblx0XHRcdFx0XHRcdFx0XHRcdH1cblx0XHRcdFx0XHRcdFx0XHR9XG5cdFx0XHRcdFx0XHRcdH1cblx0XHRcdFx0XHRcdH1cblx0XHRcdFx0XHR9XG5cdFx0XHRcdFx0XG5cdFx0XHRcdFx0aWYgKGNvZGUgaW4gdGhpcy5jb21wb3VuZFJ1bGVDb2Rlcykge1xuXHRcdFx0XHRcdFx0dGhpcy5jb21wb3VuZFJ1bGVDb2Rlc1tjb2RlXS5wdXNoKHdvcmQpO1xuXHRcdFx0XHRcdH1cblx0XHRcdFx0fVxuXHRcdFx0fVxuXHRcdFx0ZWxzZSB7XG5cdFx0XHRcdGFkZFdvcmQod29yZC50cmltKCksIFtdKTtcblx0XHRcdH1cblx0XHR9XG5cdFx0XG5cdFx0cmV0dXJuIGRpY3Rpb25hcnlUYWJsZTtcblx0fSxcblx0XG5cdFxuXHQvKipcblx0ICogUmVtb3ZlcyBjb21tZW50IGxpbmVzIGFuZCB0aGVuIGNsZWFucyB1cCBibGFuayBsaW5lcyBhbmQgdHJhaWxpbmcgd2hpdGVzcGFjZS5cblx0ICpcblx0ICogQHBhcmFtIHtTdHJpbmd9IGRhdGEgVGhlIGRhdGEgZnJvbSBhIC5kaWMgZmlsZS5cblx0ICogQHJldHVybiB7U3RyaW5nfSBUaGUgY2xlYW5lZC11cCBkYXRhLlxuXHQgKi9cblx0XG5cdF9yZW1vdmVEaWNDb21tZW50cyA6IGZ1bmN0aW9uIChkYXRhKSB7XG5cdFx0Ly8gSSBjYW4ndCBmaW5kIGFueSBvZmZpY2lhbCBkb2N1bWVudGF0aW9uIG9uIGl0LCBidXQgYXQgbGVhc3QgdGhlIGRlX0RFXG5cdFx0Ly8gZGljdGlvbmFyeSB1c2VzIHRhYi1pbmRlbnRlZCBsaW5lcyBhcyBjb21tZW50cy5cblx0XHRcblx0XHQvLyBSZW1vdmUgY29tbWVudHNcblx0XHRkYXRhID0gZGF0YS5yZXBsYWNlKC9eXFx0LiokL21nLCBcIlwiKTtcblx0XHRcblx0XHRyZXR1cm4gZGF0YTtcblx0fSxcblx0XG5cdHBhcnNlUnVsZUNvZGVzIDogZnVuY3Rpb24gKHRleHRDb2Rlcykge1xuXHRcdGlmICghdGV4dENvZGVzKSB7XG5cdFx0XHRyZXR1cm4gW107XG5cdFx0fVxuXHRcdGVsc2UgaWYgKCEoXCJGTEFHXCIgaW4gdGhpcy5mbGFncykpIHtcblx0XHRcdHJldHVybiB0ZXh0Q29kZXMuc3BsaXQoXCJcIik7XG5cdFx0fVxuXHRcdGVsc2UgaWYgKHRoaXMuZmxhZ3MuRkxBRyA9PT0gXCJsb25nXCIpIHtcblx0XHRcdHZhciBmbGFncyA9IFtdO1xuXHRcdFx0XG5cdFx0XHRmb3IgKHZhciBpID0gMCwgX2xlbiA9IHRleHRDb2Rlcy5sZW5ndGg7IGkgPCBfbGVuOyBpICs9IDIpIHtcblx0XHRcdFx0ZmxhZ3MucHVzaCh0ZXh0Q29kZXMuc3Vic3RyKGksIDIpKTtcblx0XHRcdH1cblx0XHRcdFxuXHRcdFx0cmV0dXJuIGZsYWdzO1xuXHRcdH1cblx0XHRlbHNlIGlmICh0aGlzLmZsYWdzLkZMQUcgPT09IFwibnVtXCIpIHtcblx0XHRcdHJldHVybiB0ZXh0Q29kZXMuc3BsaXQoXCIsXCIpO1xuXHRcdH1cblx0fSxcblx0XG5cdC8qKlxuXHQgKiBBcHBsaWVzIGFuIGFmZml4IHJ1bGUgdG8gYSB3b3JkLlxuXHQgKlxuXHQgKiBAcGFyYW0ge1N0cmluZ30gd29yZCBUaGUgYmFzZSB3b3JkLlxuXHQgKiBAcGFyYW0ge09iamVjdH0gcnVsZSBUaGUgYWZmaXggcnVsZS5cblx0ICogQHJldHVybnMge1N0cmluZ1tdfSBUaGUgbmV3IHdvcmRzIGdlbmVyYXRlZCBieSB0aGUgcnVsZS5cblx0ICovXG5cdFxuXHRfYXBwbHlSdWxlIDogZnVuY3Rpb24gKHdvcmQsIHJ1bGUpIHtcblx0XHR2YXIgZW50cmllcyA9IHJ1bGUuZW50cmllcztcblx0XHR2YXIgbmV3V29yZHMgPSBbXTtcblx0XHRcblx0XHRmb3IgKHZhciBpID0gMCwgX2xlbiA9IGVudHJpZXMubGVuZ3RoOyBpIDwgX2xlbjsgaSsrKSB7XG5cdFx0XHR2YXIgZW50cnkgPSBlbnRyaWVzW2ldO1xuXHRcdFx0XG5cdFx0XHRpZiAoIWVudHJ5Lm1hdGNoIHx8IHdvcmQubWF0Y2goZW50cnkubWF0Y2gpKSB7XG5cdFx0XHRcdHZhciBuZXdXb3JkID0gd29yZDtcblx0XHRcdFx0XG5cdFx0XHRcdGlmIChlbnRyeS5yZW1vdmUpIHtcblx0XHRcdFx0XHRuZXdXb3JkID0gbmV3V29yZC5yZXBsYWNlKGVudHJ5LnJlbW92ZSwgXCJcIik7XG5cdFx0XHRcdH1cblx0XHRcdFx0XG5cdFx0XHRcdGlmIChydWxlLnR5cGUgPT09IFwiU0ZYXCIpIHtcblx0XHRcdFx0XHRuZXdXb3JkID0gbmV3V29yZCArIGVudHJ5LmFkZDtcblx0XHRcdFx0fVxuXHRcdFx0XHRlbHNlIHtcblx0XHRcdFx0XHRuZXdXb3JkID0gZW50cnkuYWRkICsgbmV3V29yZDtcblx0XHRcdFx0fVxuXHRcdFx0XHRcblx0XHRcdFx0bmV3V29yZHMucHVzaChuZXdXb3JkKTtcblx0XHRcdFx0XG5cdFx0XHRcdGlmIChcImNvbnRpbnVhdGlvbkNsYXNzZXNcIiBpbiBlbnRyeSkge1xuXHRcdFx0XHRcdGZvciAodmFyIGogPSAwLCBfamxlbiA9IGVudHJ5LmNvbnRpbnVhdGlvbkNsYXNzZXMubGVuZ3RoOyBqIDwgX2psZW47IGorKykge1xuXHRcdFx0XHRcdFx0dmFyIGNvbnRpbnVhdGlvblJ1bGUgPSB0aGlzLnJ1bGVzW2VudHJ5LmNvbnRpbnVhdGlvbkNsYXNzZXNbal1dO1xuXHRcdFx0XHRcdFx0XG5cdFx0XHRcdFx0XHRpZiAoY29udGludWF0aW9uUnVsZSkge1xuXHRcdFx0XHRcdFx0XHRuZXdXb3JkcyA9IG5ld1dvcmRzLmNvbmNhdCh0aGlzLl9hcHBseVJ1bGUobmV3V29yZCwgY29udGludWF0aW9uUnVsZSkpO1xuXHRcdFx0XHRcdFx0fVxuXHRcdFx0XHRcdFx0Lypcblx0XHRcdFx0XHRcdGVsc2Uge1xuXHRcdFx0XHRcdFx0XHQvLyBUaGlzIHNob3VsZG4ndCBoYXBwZW4sIGJ1dCBpdCBkb2VzLCBhdCBsZWFzdCBpbiB0aGUgZGVfREUgZGljdGlvbmFyeS5cblx0XHRcdFx0XHRcdFx0Ly8gSSB0aGluayB0aGUgYXV0aG9yIG1pc3Rha2VubHkgc3VwcGxpZWQgbG93ZXItY2FzZSBydWxlIGNvZGVzIGluc3RlYWQgXG5cdFx0XHRcdFx0XHRcdC8vIG9mIHVwcGVyLWNhc2UuXG5cdFx0XHRcdFx0XHR9XG5cdFx0XHRcdFx0XHQqL1xuXHRcdFx0XHRcdH1cblx0XHRcdFx0fVxuXHRcdFx0fVxuXHRcdH1cblx0XHRcblx0XHRyZXR1cm4gbmV3V29yZHM7XG5cdH0sXG5cdFxuXHQvKipcblx0ICogQ2hlY2tzIHdoZXRoZXIgYSB3b3JkIG9yIGEgY2FwaXRhbGl6YXRpb24gdmFyaWFudCBleGlzdHMgaW4gdGhlIGN1cnJlbnQgZGljdGlvbmFyeS5cblx0ICogVGhlIHdvcmQgaXMgdHJpbW1lZCBhbmQgc2V2ZXJhbCB2YXJpYXRpb25zIG9mIGNhcGl0YWxpemF0aW9ucyBhcmUgY2hlY2tlZC5cblx0ICogSWYgeW91IHdhbnQgdG8gY2hlY2sgYSB3b3JkIHdpdGhvdXQgYW55IGNoYW5nZXMgbWFkZSB0byBpdCwgY2FsbCBjaGVja0V4YWN0KClcblx0ICpcblx0ICogQHNlZSBodHRwOi8vYmxvZy5zdGV2ZW5sZXZpdGhhbi5jb20vYXJjaGl2ZXMvZmFzdGVyLXRyaW0tamF2YXNjcmlwdCByZTp0cmltbWluZyBmdW5jdGlvblxuXHQgKlxuXHQgKiBAcGFyYW0ge1N0cmluZ30gYVdvcmQgVGhlIHdvcmQgdG8gY2hlY2suXG5cdCAqIEByZXR1cm5zIHtCb29sZWFufVxuXHQgKi9cblx0XG5cdGNoZWNrIDogZnVuY3Rpb24gKGFXb3JkKSB7XG5cdFx0aWYgKCF0aGlzLmxvYWRlZCkge1xuXHRcdFx0dGhyb3cgXCJEaWN0aW9uYXJ5IG5vdCBsb2FkZWQuXCI7XG5cdFx0fVxuXHRcdFxuXHRcdC8vIFJlbW92ZSBsZWFkaW5nIGFuZCB0cmFpbGluZyB3aGl0ZXNwYWNlXG5cdFx0dmFyIHRyaW1tZWRXb3JkID0gYVdvcmQucmVwbGFjZSgvXlxcc1xccyovLCAnJykucmVwbGFjZSgvXFxzXFxzKiQvLCAnJyk7XG5cdFx0XG5cdFx0aWYgKHRoaXMuY2hlY2tFeGFjdCh0cmltbWVkV29yZCkpIHtcblx0XHRcdHJldHVybiB0cnVlO1xuXHRcdH1cblx0XHRcblx0XHQvLyBUaGUgZXhhY3Qgd29yZCBpcyBub3QgaW4gdGhlIGRpY3Rpb25hcnkuXG5cdFx0aWYgKHRyaW1tZWRXb3JkLnRvVXBwZXJDYXNlKCkgPT09IHRyaW1tZWRXb3JkKSB7XG5cdFx0XHQvLyBUaGUgd29yZCB3YXMgc3VwcGxpZWQgaW4gYWxsIHVwcGVyY2FzZS5cblx0XHRcdC8vIENoZWNrIGZvciBhIGNhcGl0YWxpemVkIGZvcm0gb2YgdGhlIHdvcmQuXG5cdFx0XHR2YXIgY2FwaXRhbGl6ZWRXb3JkID0gdHJpbW1lZFdvcmRbMF0gKyB0cmltbWVkV29yZC5zdWJzdHJpbmcoMSkudG9Mb3dlckNhc2UoKTtcblx0XHRcdFxuXHRcdFx0aWYgKHRoaXMuaGFzRmxhZyhjYXBpdGFsaXplZFdvcmQsIFwiS0VFUENBU0VcIikpIHtcblx0XHRcdFx0Ly8gQ2FwaXRhbGl6YXRpb24gdmFyaWFudHMgYXJlIG5vdCBhbGxvd2VkIGZvciB0aGlzIHdvcmQuXG5cdFx0XHRcdHJldHVybiBmYWxzZTtcblx0XHRcdH1cblx0XHRcdFxuXHRcdFx0aWYgKHRoaXMuY2hlY2tFeGFjdChjYXBpdGFsaXplZFdvcmQpKSB7XG5cdFx0XHRcdC8vIFRoZSBhbGwtY2FwcyB3b3JkIGlzIGEgY2FwaXRhbGl6ZWQgd29yZCBzcGVsbGVkIGNvcnJlY3RseS5cblx0XHRcdFx0cmV0dXJuIHRydWU7XG5cdFx0XHR9XG5cblx0XHRcdGlmICh0aGlzLmNoZWNrRXhhY3QodHJpbW1lZFdvcmQudG9Mb3dlckNhc2UoKSkpIHtcblx0XHRcdFx0Ly8gVGhlIGFsbC1jYXBzIGlzIGEgbG93ZXJjYXNlIHdvcmQgc3BlbGxlZCBjb3JyZWN0bHkuXG5cdFx0XHRcdHJldHVybiB0cnVlO1xuXHRcdFx0fVxuXHRcdH1cblx0XHRcblx0XHR2YXIgdW5jYXBpdGFsaXplZFdvcmQgPSB0cmltbWVkV29yZFswXS50b0xvd2VyQ2FzZSgpICsgdHJpbW1lZFdvcmQuc3Vic3RyaW5nKDEpO1xuXHRcdFxuXHRcdGlmICh1bmNhcGl0YWxpemVkV29yZCAhPT0gdHJpbW1lZFdvcmQpIHtcblx0XHRcdGlmICh0aGlzLmhhc0ZsYWcodW5jYXBpdGFsaXplZFdvcmQsIFwiS0VFUENBU0VcIikpIHtcblx0XHRcdFx0Ly8gQ2FwaXRhbGl6YXRpb24gdmFyaWFudHMgYXJlIG5vdCBhbGxvd2VkIGZvciB0aGlzIHdvcmQuXG5cdFx0XHRcdHJldHVybiBmYWxzZTtcblx0XHRcdH1cblx0XHRcdFxuXHRcdFx0Ly8gQ2hlY2sgZm9yIGFuIHVuY2FwaXRhbGl6ZWQgZm9ybVxuXHRcdFx0aWYgKHRoaXMuY2hlY2tFeGFjdCh1bmNhcGl0YWxpemVkV29yZCkpIHtcblx0XHRcdFx0Ly8gVGhlIHdvcmQgaXMgc3BlbGxlZCBjb3JyZWN0bHkgYnV0IHdpdGggdGhlIGZpcnN0IGxldHRlciBjYXBpdGFsaXplZC5cblx0XHRcdFx0cmV0dXJuIHRydWU7XG5cdFx0XHR9XG5cdFx0fVxuXHRcdFxuXHRcdHJldHVybiBmYWxzZTtcblx0fSxcblx0XG5cdC8qKlxuXHQgKiBDaGVja3Mgd2hldGhlciBhIHdvcmQgZXhpc3RzIGluIHRoZSBjdXJyZW50IGRpY3Rpb25hcnkuXG5cdCAqXG5cdCAqIEBwYXJhbSB7U3RyaW5nfSB3b3JkIFRoZSB3b3JkIHRvIGNoZWNrLlxuXHQgKiBAcmV0dXJucyB7Qm9vbGVhbn1cblx0ICovXG5cdFxuXHRjaGVja0V4YWN0IDogZnVuY3Rpb24gKHdvcmQpIHtcblx0XHRpZiAoIXRoaXMubG9hZGVkKSB7XG5cdFx0XHR0aHJvdyBcIkRpY3Rpb25hcnkgbm90IGxvYWRlZC5cIjtcblx0XHR9XG5cblx0XHR2YXIgcnVsZUNvZGVzID0gdGhpcy5kaWN0aW9uYXJ5VGFibGVbd29yZF07XG5cdFx0XG5cdFx0dmFyIGksIF9sZW47XG5cdFx0XG5cdFx0aWYgKHR5cGVvZiBydWxlQ29kZXMgPT09ICd1bmRlZmluZWQnKSB7XG5cdFx0XHQvLyBDaGVjayBpZiB0aGlzIG1pZ2h0IGJlIGEgY29tcG91bmQgd29yZC5cblx0XHRcdGlmIChcIkNPTVBPVU5ETUlOXCIgaW4gdGhpcy5mbGFncyAmJiB3b3JkLmxlbmd0aCA+PSB0aGlzLmZsYWdzLkNPTVBPVU5ETUlOKSB7XG5cdFx0XHRcdGZvciAoaSA9IDAsIF9sZW4gPSB0aGlzLmNvbXBvdW5kUnVsZXMubGVuZ3RoOyBpIDwgX2xlbjsgaSsrKSB7XG5cdFx0XHRcdFx0aWYgKHdvcmQubWF0Y2godGhpcy5jb21wb3VuZFJ1bGVzW2ldKSkge1xuXHRcdFx0XHRcdFx0cmV0dXJuIHRydWU7XG5cdFx0XHRcdFx0fVxuXHRcdFx0XHR9XG5cdFx0XHR9XG5cdFx0fVxuXHRcdGVsc2UgaWYgKHJ1bGVDb2RlcyA9PT0gbnVsbCkge1xuXHRcdFx0Ly8gYSBudWxsIChidXQgbm90IHVuZGVmaW5lZCkgdmFsdWUgZm9yIGFuIGVudHJ5IGluIHRoZSBkaWN0aW9uYXJ5IHRhYmxlXG5cdFx0XHQvLyBtZWFucyB0aGF0IHRoZSB3b3JkIGlzIGluIHRoZSBkaWN0aW9uYXJ5IGJ1dCBoYXMgbm8gZmxhZ3MuXG5cdFx0XHRyZXR1cm4gdHJ1ZTtcblx0XHR9XG5cdFx0ZWxzZSBpZiAodHlwZW9mIHJ1bGVDb2RlcyA9PT0gJ29iamVjdCcpIHsgLy8gdGhpcy5kaWN0aW9uYXJ5WydoYXNPd25Qcm9wZXJ0eSddIHdpbGwgYmUgYSBmdW5jdGlvbi5cblx0XHRcdGZvciAoaSA9IDAsIF9sZW4gPSBydWxlQ29kZXMubGVuZ3RoOyBpIDwgX2xlbjsgaSsrKSB7XG5cdFx0XHRcdGlmICghdGhpcy5oYXNGbGFnKHdvcmQsIFwiT05MWUlOQ09NUE9VTkRcIiwgcnVsZUNvZGVzW2ldKSkge1xuXHRcdFx0XHRcdHJldHVybiB0cnVlO1xuXHRcdFx0XHR9XG5cdFx0XHR9XG5cdFx0fVxuXG5cdFx0cmV0dXJuIGZhbHNlO1xuXHR9LFxuXHRcblx0LyoqXG5cdCAqIExvb2tzIHVwIHdoZXRoZXIgYSBnaXZlbiB3b3JkIGlzIGZsYWdnZWQgd2l0aCBhIGdpdmVuIGZsYWcuXG5cdCAqXG5cdCAqIEBwYXJhbSB7U3RyaW5nfSB3b3JkIFRoZSB3b3JkIGluIHF1ZXN0aW9uLlxuXHQgKiBAcGFyYW0ge1N0cmluZ30gZmxhZyBUaGUgZmxhZyBpbiBxdWVzdGlvbi5cblx0ICogQHJldHVybiB7Qm9vbGVhbn1cblx0ICovXG5cdCBcblx0aGFzRmxhZyA6IGZ1bmN0aW9uICh3b3JkLCBmbGFnLCB3b3JkRmxhZ3MpIHtcblx0XHRpZiAoIXRoaXMubG9hZGVkKSB7XG5cdFx0XHR0aHJvdyBcIkRpY3Rpb25hcnkgbm90IGxvYWRlZC5cIjtcblx0XHR9XG5cblx0XHRpZiAoZmxhZyBpbiB0aGlzLmZsYWdzKSB7XG5cdFx0XHRpZiAodHlwZW9mIHdvcmRGbGFncyA9PT0gJ3VuZGVmaW5lZCcpIHtcblx0XHRcdFx0d29yZEZsYWdzID0gQXJyYXkucHJvdG90eXBlLmNvbmNhdC5hcHBseShbXSwgdGhpcy5kaWN0aW9uYXJ5VGFibGVbd29yZF0pO1xuXHRcdFx0fVxuXHRcdFx0XG5cdFx0XHRpZiAod29yZEZsYWdzICYmIHdvcmRGbGFncy5pbmRleE9mKHRoaXMuZmxhZ3NbZmxhZ10pICE9PSAtMSkge1xuXHRcdFx0XHRyZXR1cm4gdHJ1ZTtcblx0XHRcdH1cblx0XHR9XG5cdFx0XG5cdFx0cmV0dXJuIGZhbHNlO1xuXHR9LFxuXHRcblx0LyoqXG5cdCAqIFJldHVybnMgYSBsaXN0IG9mIHN1Z2dlc3Rpb25zIGZvciBhIG1pc3NwZWxsZWQgd29yZC5cblx0ICpcblx0ICogQHNlZSBodHRwOi8vd3d3Lm5vcnZpZy5jb20vc3BlbGwtY29ycmVjdC5odG1sIGZvciB0aGUgYmFzaXMgb2YgdGhpcyBzdWdnZXN0b3IuXG5cdCAqIFRoaXMgc3VnZ2VzdG9yIGlzIHByaW1pdGl2ZSwgYnV0IGl0IHdvcmtzLlxuXHQgKlxuXHQgKiBAcGFyYW0ge1N0cmluZ30gd29yZCBUaGUgbWlzc3BlbGxpbmcuXG5cdCAqIEBwYXJhbSB7TnVtYmVyfSBbbGltaXQ9NV0gVGhlIG1heGltdW0gbnVtYmVyIG9mIHN1Z2dlc3Rpb25zIHRvIHJldHVybi5cblx0ICogQHJldHVybnMge1N0cmluZ1tdfSBUaGUgYXJyYXkgb2Ygc3VnZ2VzdGlvbnMuXG5cdCAqL1xuXHRcblx0YWxwaGFiZXQgOiBcIlwiLFxuXHRcblx0c3VnZ2VzdCA6IGZ1bmN0aW9uICh3b3JkLCBsaW1pdCkge1xuXHRcdGlmICghdGhpcy5sb2FkZWQpIHtcblx0XHRcdHRocm93IFwiRGljdGlvbmFyeSBub3QgbG9hZGVkLlwiO1xuXHRcdH1cblxuXHRcdGxpbWl0ID0gbGltaXQgfHwgNTtcblxuXHRcdGlmICh0aGlzLm1lbW9pemVkLmhhc093blByb3BlcnR5KHdvcmQpKSB7XG5cdFx0XHR2YXIgbWVtb2l6ZWRMaW1pdCA9IHRoaXMubWVtb2l6ZWRbd29yZF1bJ2xpbWl0J107XG5cblx0XHRcdC8vIE9ubHkgcmV0dXJuIHRoZSBjYWNoZWQgbGlzdCBpZiBpdCdzIGJpZyBlbm91Z2ggb3IgaWYgdGhlcmUgd2VyZW4ndCBlbm91Z2ggc3VnZ2VzdGlvbnNcblx0XHRcdC8vIHRvIGZpbGwgYSBzbWFsbGVyIGxpbWl0LlxuXHRcdFx0aWYgKGxpbWl0IDw9IG1lbW9pemVkTGltaXQgfHwgdGhpcy5tZW1vaXplZFt3b3JkXVsnc3VnZ2VzdGlvbnMnXS5sZW5ndGggPCBtZW1vaXplZExpbWl0KSB7XG5cdFx0XHRcdHJldHVybiB0aGlzLm1lbW9pemVkW3dvcmRdWydzdWdnZXN0aW9ucyddLnNsaWNlKDAsIGxpbWl0KTtcblx0XHRcdH1cblx0XHR9XG5cdFx0XG5cdFx0aWYgKHRoaXMuY2hlY2sod29yZCkpIHJldHVybiBbXTtcblx0XHRcblx0XHQvLyBDaGVjayB0aGUgcmVwbGFjZW1lbnQgdGFibGUuXG5cdFx0Zm9yICh2YXIgaSA9IDAsIF9sZW4gPSB0aGlzLnJlcGxhY2VtZW50VGFibGUubGVuZ3RoOyBpIDwgX2xlbjsgaSsrKSB7XG5cdFx0XHR2YXIgcmVwbGFjZW1lbnRFbnRyeSA9IHRoaXMucmVwbGFjZW1lbnRUYWJsZVtpXTtcblx0XHRcdFxuXHRcdFx0aWYgKHdvcmQuaW5kZXhPZihyZXBsYWNlbWVudEVudHJ5WzBdKSAhPT0gLTEpIHtcblx0XHRcdFx0dmFyIGNvcnJlY3RlZFdvcmQgPSB3b3JkLnJlcGxhY2UocmVwbGFjZW1lbnRFbnRyeVswXSwgcmVwbGFjZW1lbnRFbnRyeVsxXSk7XG5cdFx0XHRcdFxuXHRcdFx0XHRpZiAodGhpcy5jaGVjayhjb3JyZWN0ZWRXb3JkKSkge1xuXHRcdFx0XHRcdHJldHVybiBbIGNvcnJlY3RlZFdvcmQgXTtcblx0XHRcdFx0fVxuXHRcdFx0fVxuXHRcdH1cblx0XHRcblx0XHR2YXIgc2VsZiA9IHRoaXM7XG5cdFx0c2VsZi5hbHBoYWJldCA9IFwiYWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXpcIjtcblx0XHRcblx0XHQvKlxuXHRcdGlmICghc2VsZi5hbHBoYWJldCkge1xuXHRcdFx0Ly8gVXNlIHRoZSBhbHBoYWJldCBhcyBpbXBsaWNpdGx5IGRlZmluZWQgYnkgdGhlIHdvcmRzIGluIHRoZSBkaWN0aW9uYXJ5LlxuXHRcdFx0dmFyIGFscGhhSGFzaCA9IHt9O1xuXHRcdFx0XG5cdFx0XHRmb3IgKHZhciBpIGluIHNlbGYuZGljdGlvbmFyeVRhYmxlKSB7XG5cdFx0XHRcdGZvciAodmFyIGogPSAwLCBfbGVuID0gaS5sZW5ndGg7IGogPCBfbGVuOyBqKyspIHtcblx0XHRcdFx0XHRhbHBoYUhhc2hbaVtqXV0gPSB0cnVlO1xuXHRcdFx0XHR9XG5cdFx0XHR9XG5cdFx0XHRcblx0XHRcdGZvciAodmFyIGkgaW4gYWxwaGFIYXNoKSB7XG5cdFx0XHRcdHNlbGYuYWxwaGFiZXQgKz0gaTtcblx0XHRcdH1cblx0XHRcdFxuXHRcdFx0dmFyIGFscGhhQXJyYXkgPSBzZWxmLmFscGhhYmV0LnNwbGl0KFwiXCIpO1xuXHRcdFx0YWxwaGFBcnJheS5zb3J0KCk7XG5cdFx0XHRzZWxmLmFscGhhYmV0ID0gYWxwaGFBcnJheS5qb2luKFwiXCIpO1xuXHRcdH1cblx0XHQqL1xuXHRcdFxuXHRcdC8qKlxuXHRcdCAqIFJldHVybnMgYSBoYXNoIGtleWVkIGJ5IGFsbCBvZiB0aGUgc3RyaW5ncyB0aGF0IGNhbiBiZSBtYWRlIGJ5IG1ha2luZyBhIHNpbmdsZSBlZGl0IHRvIHRoZSB3b3JkIChvciB3b3JkcyBpbikgYHdvcmRzYFxuXHRcdCAqIFRoZSB2YWx1ZSBvZiBlYWNoIGVudHJ5IGlzIHRoZSBudW1iZXIgb2YgdW5pcXVlIHdheXMgdGhhdCB0aGUgcmVzdWx0aW5nIHdvcmQgY2FuIGJlIG1hZGUuXG5cdFx0ICpcblx0XHQgKiBAYXJnIG1peGVkIHdvcmRzIEVpdGhlciBhIGhhc2gga2V5ZWQgYnkgd29yZHMgb3IgYSBzdHJpbmcgd29yZCB0byBvcGVyYXRlIG9uLlxuXHRcdCAqIEBhcmcgYm9vbCBrbm93bl9vbmx5IFdoZXRoZXIgdGhpcyBmdW5jdGlvbiBzaG91bGQgaWdub3JlIHN0cmluZ3MgdGhhdCBhcmUgbm90IGluIHRoZSBkaWN0aW9uYXJ5LlxuXHRcdCAqL1xuXHRcdGZ1bmN0aW9uIGVkaXRzMSh3b3Jkcywga25vd25fb25seSkge1xuXHRcdFx0dmFyIHJ2ID0ge307XG5cdFx0XHRcblx0XHRcdHZhciBpLCBqLCBfaWlsZW4sIF9sZW4sIF9qbGVuLCBfZWRpdDtcblxuXHRcdFx0dmFyIGFscGhhYmV0TGVuZ3RoID0gc2VsZi5hbHBoYWJldC5sZW5ndGg7XG5cdFx0XHRcblx0XHRcdGlmICh0eXBlb2Ygd29yZHMgPT0gJ3N0cmluZycpIHtcblx0XHRcdFx0dmFyIHdvcmQgPSB3b3Jkcztcblx0XHRcdFx0d29yZHMgPSB7fTtcblx0XHRcdFx0d29yZHNbd29yZF0gPSB0cnVlO1xuXHRcdFx0fVxuXG5cdFx0XHRmb3IgKHZhciB3b3JkIGluIHdvcmRzKSB7XG5cdFx0XHRcdGZvciAoaSA9IDAsIF9sZW4gPSB3b3JkLmxlbmd0aCArIDE7IGkgPCBfbGVuOyBpKyspIHtcblx0XHRcdFx0XHR2YXIgcyA9IFsgd29yZC5zdWJzdHJpbmcoMCwgaSksIHdvcmQuc3Vic3RyaW5nKGkpIF07XG5cdFx0XHRcdFxuXHRcdFx0XHRcdC8vIFJlbW92ZSBhIGxldHRlci5cblx0XHRcdFx0XHRpZiAoc1sxXSkge1xuXHRcdFx0XHRcdFx0X2VkaXQgPSBzWzBdICsgc1sxXS5zdWJzdHJpbmcoMSk7XG5cblx0XHRcdFx0XHRcdGlmICgha25vd25fb25seSB8fCBzZWxmLmNoZWNrKF9lZGl0KSkge1xuXHRcdFx0XHRcdFx0XHRpZiAoIShfZWRpdCBpbiBydikpIHtcblx0XHRcdFx0XHRcdFx0XHRydltfZWRpdF0gPSAxO1xuXHRcdFx0XHRcdFx0XHR9XG5cdFx0XHRcdFx0XHRcdGVsc2Uge1xuXHRcdFx0XHRcdFx0XHRcdHJ2W19lZGl0XSArPSAxO1xuXHRcdFx0XHRcdFx0XHR9XG5cdFx0XHRcdFx0XHR9XG5cdFx0XHRcdFx0fVxuXHRcdFx0XHRcdFxuXHRcdFx0XHRcdC8vIFRyYW5zcG9zZSBsZXR0ZXJzXG5cdFx0XHRcdFx0Ly8gRWxpbWluYXRlIHRyYW5zcG9zaXRpb25zIG9mIGlkZW50aWNhbCBsZXR0ZXJzXG5cdFx0XHRcdFx0aWYgKHNbMV0ubGVuZ3RoID4gMSAmJiBzWzFdWzFdICE9PSBzWzFdWzBdKSB7XG5cdFx0XHRcdFx0XHRfZWRpdCA9IHNbMF0gKyBzWzFdWzFdICsgc1sxXVswXSArIHNbMV0uc3Vic3RyaW5nKDIpO1xuXG5cdFx0XHRcdFx0XHRpZiAoIWtub3duX29ubHkgfHwgc2VsZi5jaGVjayhfZWRpdCkpIHtcblx0XHRcdFx0XHRcdFx0aWYgKCEoX2VkaXQgaW4gcnYpKSB7XG5cdFx0XHRcdFx0XHRcdFx0cnZbX2VkaXRdID0gMTtcblx0XHRcdFx0XHRcdFx0fVxuXHRcdFx0XHRcdFx0XHRlbHNlIHtcblx0XHRcdFx0XHRcdFx0XHRydltfZWRpdF0gKz0gMTtcblx0XHRcdFx0XHRcdFx0fVxuXHRcdFx0XHRcdFx0fVxuXHRcdFx0XHRcdH1cblxuXHRcdFx0XHRcdGlmIChzWzFdKSB7XG5cdFx0XHRcdFx0XHQvLyBSZXBsYWNlIGEgbGV0dGVyIHdpdGggYW5vdGhlciBsZXR0ZXIuXG5cblx0XHRcdFx0XHRcdHZhciBsZXR0ZXJjYXNlID0gKHNbMV0uc3Vic3RyaW5nKDAsMSkudG9VcHBlckNhc2UoKSA9PT0gc1sxXS5zdWJzdHJpbmcoMCwxKSkgPyAndXBwZXJjYXNlJyA6ICdsb3dlcmNhc2UnO1xuXG5cdFx0XHRcdFx0XHRmb3IgKGogPSAwOyBqIDwgYWxwaGFiZXRMZW5ndGg7IGorKykge1xuXHRcdFx0XHRcdFx0XHR2YXIgcmVwbGFjZW1lbnRMZXR0ZXIgPSBzZWxmLmFscGhhYmV0W2pdO1xuXG5cdFx0XHRcdFx0XHRcdC8vIFNldCB0aGUgY2FzZSBvZiB0aGUgcmVwbGFjZW1lbnQgbGV0dGVyIHRvIHRoZSBzYW1lIGFzIHRoZSBsZXR0ZXIgYmVpbmcgcmVwbGFjZWQuXG5cdFx0XHRcdFx0XHRcdGlmICggJ3VwcGVyY2FzZScgPT09IGxldHRlcmNhc2UgKSB7XG5cdFx0XHRcdFx0XHRcdFx0cmVwbGFjZW1lbnRMZXR0ZXIgPSByZXBsYWNlbWVudExldHRlci50b1VwcGVyQ2FzZSgpO1xuXHRcdFx0XHRcdFx0XHR9XG5cblx0XHRcdFx0XHRcdFx0Ly8gRWxpbWluYXRlIHJlcGxhY2VtZW50IG9mIGEgbGV0dGVyIGJ5IGl0c2VsZlxuXHRcdFx0XHRcdFx0XHRpZiAocmVwbGFjZW1lbnRMZXR0ZXIgIT0gc1sxXS5zdWJzdHJpbmcoMCwxKSl7XG5cdFx0XHRcdFx0XHRcdFx0X2VkaXQgPSBzWzBdICsgcmVwbGFjZW1lbnRMZXR0ZXIgKyBzWzFdLnN1YnN0cmluZygxKTtcblxuXHRcdFx0XHRcdFx0XHRcdGlmICgha25vd25fb25seSB8fCBzZWxmLmNoZWNrKF9lZGl0KSkge1xuXHRcdFx0XHRcdFx0XHRcdFx0aWYgKCEoX2VkaXQgaW4gcnYpKSB7XG5cdFx0XHRcdFx0XHRcdFx0XHRcdHJ2W19lZGl0XSA9IDE7XG5cdFx0XHRcdFx0XHRcdFx0XHR9XG5cdFx0XHRcdFx0XHRcdFx0XHRlbHNlIHtcblx0XHRcdFx0XHRcdFx0XHRcdFx0cnZbX2VkaXRdICs9IDE7XG5cdFx0XHRcdFx0XHRcdFx0XHR9XG5cdFx0XHRcdFx0XHRcdFx0fVxuXHRcdFx0XHRcdFx0XHR9XG5cdFx0XHRcdFx0XHR9XG5cdFx0XHRcdFx0fVxuXG5cdFx0XHRcdFx0aWYgKHNbMV0pIHtcblx0XHRcdFx0XHRcdC8vIEFkZCBhIGxldHRlciBiZXR3ZWVuIGVhY2ggbGV0dGVyLlxuXHRcdFx0XHRcdFx0Zm9yIChqID0gMDsgaiA8IGFscGhhYmV0TGVuZ3RoOyBqKyspIHtcblx0XHRcdFx0XHRcdFx0Ly8gSWYgdGhlIGxldHRlcnMgb24gZWFjaCBzaWRlIGFyZSBjYXBpdGFsaXplZCwgY2FwaXRhbGl6ZSB0aGUgcmVwbGFjZW1lbnQuXG5cdFx0XHRcdFx0XHRcdHZhciBsZXR0ZXJjYXNlID0gKHNbMF0uc3Vic3RyaW5nKC0xKS50b1VwcGVyQ2FzZSgpID09PSBzWzBdLnN1YnN0cmluZygtMSkgJiYgc1sxXS5zdWJzdHJpbmcoMCwxKS50b1VwcGVyQ2FzZSgpID09PSBzWzFdLnN1YnN0cmluZygwLDEpKSA/ICd1cHBlcmNhc2UnIDogJ2xvd2VyY2FzZSc7XG5cblx0XHRcdFx0XHRcdFx0dmFyIHJlcGxhY2VtZW50TGV0dGVyID0gc2VsZi5hbHBoYWJldFtqXTtcblxuXHRcdFx0XHRcdFx0XHRpZiAoICd1cHBlcmNhc2UnID09PSBsZXR0ZXJjYXNlICkge1xuXHRcdFx0XHRcdFx0XHRcdHJlcGxhY2VtZW50TGV0dGVyID0gcmVwbGFjZW1lbnRMZXR0ZXIudG9VcHBlckNhc2UoKTtcblx0XHRcdFx0XHRcdFx0fVxuXG5cdFx0XHRcdFx0XHRcdF9lZGl0ID0gc1swXSArIHJlcGxhY2VtZW50TGV0dGVyICsgc1sxXTtcblxuXHRcdFx0XHRcdFx0XHRpZiAoIWtub3duX29ubHkgfHwgc2VsZi5jaGVjayhfZWRpdCkpIHtcblx0XHRcdFx0XHRcdFx0XHRpZiAoIShfZWRpdCBpbiBydikpIHtcblx0XHRcdFx0XHRcdFx0XHRcdHJ2W19lZGl0XSA9IDE7XG5cdFx0XHRcdFx0XHRcdFx0fVxuXHRcdFx0XHRcdFx0XHRcdGVsc2Uge1xuXHRcdFx0XHRcdFx0XHRcdFx0cnZbX2VkaXRdICs9IDE7XG5cdFx0XHRcdFx0XHRcdFx0fVxuXHRcdFx0XHRcdFx0XHR9XG5cdFx0XHRcdFx0XHR9XG5cdFx0XHRcdFx0fVxuXHRcdFx0XHR9XG5cdFx0XHR9XG5cdFx0XHRcblx0XHRcdHJldHVybiBydjtcblx0XHR9XG5cblx0XHRmdW5jdGlvbiBjb3JyZWN0KHdvcmQpIHtcblx0XHRcdC8vIEdldCB0aGUgZWRpdC1kaXN0YW5jZS0xIGFuZCBlZGl0LWRpc3RhbmNlLTIgZm9ybXMgb2YgdGhpcyB3b3JkLlxuXHRcdFx0dmFyIGVkMSA9IGVkaXRzMSh3b3JkKTtcblx0XHRcdHZhciBlZDIgPSBlZGl0czEoZWQxLCB0cnVlKTtcblx0XHRcdFxuXHRcdFx0Ly8gU29ydCB0aGUgZWRpdHMgYmFzZWQgb24gaG93IG1hbnkgZGlmZmVyZW50IHdheXMgdGhleSB3ZXJlIGNyZWF0ZWQuXG5cdFx0XHR2YXIgd2VpZ2h0ZWRfY29ycmVjdGlvbnMgPSBlZDI7XG5cdFx0XHRcblx0XHRcdGZvciAodmFyIGVkMXdvcmQgaW4gZWQxKSB7XG5cdFx0XHRcdGlmICghc2VsZi5jaGVjayhlZDF3b3JkKSkge1xuXHRcdFx0XHRcdGNvbnRpbnVlO1xuXHRcdFx0XHR9XG5cblx0XHRcdFx0aWYgKGVkMXdvcmQgaW4gd2VpZ2h0ZWRfY29ycmVjdGlvbnMpIHtcblx0XHRcdFx0XHR3ZWlnaHRlZF9jb3JyZWN0aW9uc1tlZDF3b3JkXSArPSBlZDFbZWQxd29yZF07XG5cdFx0XHRcdH1cblx0XHRcdFx0ZWxzZSB7XG5cdFx0XHRcdFx0d2VpZ2h0ZWRfY29ycmVjdGlvbnNbZWQxd29yZF0gPSBlZDFbZWQxd29yZF07XG5cdFx0XHRcdH1cblx0XHRcdH1cblx0XHRcdFxuXHRcdFx0dmFyIGksIF9sZW47XG5cblx0XHRcdHZhciBzb3J0ZWRfY29ycmVjdGlvbnMgPSBbXTtcblx0XHRcdFxuXHRcdFx0Zm9yIChpIGluIHdlaWdodGVkX2NvcnJlY3Rpb25zKSB7XG5cdFx0XHRcdGlmICh3ZWlnaHRlZF9jb3JyZWN0aW9ucy5oYXNPd25Qcm9wZXJ0eShpKSkge1xuXHRcdFx0XHRcdHNvcnRlZF9jb3JyZWN0aW9ucy5wdXNoKFsgaSwgd2VpZ2h0ZWRfY29ycmVjdGlvbnNbaV0gXSk7XG5cdFx0XHRcdH1cblx0XHRcdH1cblxuXHRcdFx0ZnVuY3Rpb24gc29ydGVyKGEsIGIpIHtcblx0XHRcdFx0dmFyIGFfdmFsID0gYVsxXTtcblx0XHRcdFx0dmFyIGJfdmFsID0gYlsxXTtcblx0XHRcdFx0aWYgKGFfdmFsIDwgYl92YWwpIHtcblx0XHRcdFx0XHRyZXR1cm4gLTE7XG5cdFx0XHRcdH0gZWxzZSBpZiAoYV92YWwgPiBiX3ZhbCkge1xuXHRcdFx0XHRcdHJldHVybiAxO1xuXHRcdFx0XHR9XG5cdFx0XHRcdC8vIEB0b2RvIElmIGEgYW5kIGIgYXJlIGVxdWFsbHkgd2VpZ2h0ZWQsIGFkZCBvdXIgb3duIHdlaWdodCBiYXNlZCBvbiBzb21ldGhpbmcgbGlrZSB0aGUga2V5IGxvY2F0aW9ucyBvbiB0aGlzIGxhbmd1YWdlJ3MgZGVmYXVsdCBrZXlib2FyZC5cblx0XHRcdFx0cmV0dXJuIGJbMF0ubG9jYWxlQ29tcGFyZShhWzBdKTtcblx0XHRcdH1cblx0XHRcdFxuXHRcdFx0c29ydGVkX2NvcnJlY3Rpb25zLnNvcnQoc29ydGVyKS5yZXZlcnNlKCk7XG5cblx0XHRcdHZhciBydiA9IFtdO1xuXG5cdFx0XHR2YXIgY2FwaXRhbGl6YXRpb25fc2NoZW1lID0gXCJsb3dlcmNhc2VcIjtcblx0XHRcdFxuXHRcdFx0aWYgKHdvcmQudG9VcHBlckNhc2UoKSA9PT0gd29yZCkge1xuXHRcdFx0XHRjYXBpdGFsaXphdGlvbl9zY2hlbWUgPSBcInVwcGVyY2FzZVwiO1xuXHRcdFx0fVxuXHRcdFx0ZWxzZSBpZiAod29yZC5zdWJzdHIoMCwgMSkudG9VcHBlckNhc2UoKSArIHdvcmQuc3Vic3RyKDEpLnRvTG93ZXJDYXNlKCkgPT09IHdvcmQpIHtcblx0XHRcdFx0Y2FwaXRhbGl6YXRpb25fc2NoZW1lID0gXCJjYXBpdGFsaXplZFwiO1xuXHRcdFx0fVxuXHRcdFx0XG5cdFx0XHR2YXIgd29ya2luZ19saW1pdCA9IGxpbWl0O1xuXG5cdFx0XHRmb3IgKGkgPSAwOyBpIDwgTWF0aC5taW4od29ya2luZ19saW1pdCwgc29ydGVkX2NvcnJlY3Rpb25zLmxlbmd0aCk7IGkrKykge1xuXHRcdFx0XHRpZiAoXCJ1cHBlcmNhc2VcIiA9PT0gY2FwaXRhbGl6YXRpb25fc2NoZW1lKSB7XG5cdFx0XHRcdFx0c29ydGVkX2NvcnJlY3Rpb25zW2ldWzBdID0gc29ydGVkX2NvcnJlY3Rpb25zW2ldWzBdLnRvVXBwZXJDYXNlKCk7XG5cdFx0XHRcdH1cblx0XHRcdFx0ZWxzZSBpZiAoXCJjYXBpdGFsaXplZFwiID09PSBjYXBpdGFsaXphdGlvbl9zY2hlbWUpIHtcblx0XHRcdFx0XHRzb3J0ZWRfY29ycmVjdGlvbnNbaV1bMF0gPSBzb3J0ZWRfY29ycmVjdGlvbnNbaV1bMF0uc3Vic3RyKDAsIDEpLnRvVXBwZXJDYXNlKCkgKyBzb3J0ZWRfY29ycmVjdGlvbnNbaV1bMF0uc3Vic3RyKDEpO1xuXHRcdFx0XHR9XG5cdFx0XHRcdFxuXHRcdFx0XHRpZiAoIXNlbGYuaGFzRmxhZyhzb3J0ZWRfY29ycmVjdGlvbnNbaV1bMF0sIFwiTk9TVUdHRVNUXCIpICYmIHJ2LmluZGV4T2Yoc29ydGVkX2NvcnJlY3Rpb25zW2ldWzBdKSA9PSAtMSkge1xuXHRcdFx0XHRcdHJ2LnB1c2goc29ydGVkX2NvcnJlY3Rpb25zW2ldWzBdKTtcblx0XHRcdFx0fVxuXHRcdFx0XHRlbHNlIHtcblx0XHRcdFx0XHQvLyBJZiBvbmUgb2YgdGhlIGNvcnJlY3Rpb25zIGlzIG5vdCBlbGlnaWJsZSBhcyBhIHN1Z2dlc3Rpb24gLCBtYWtlIHN1cmUgd2Ugc3RpbGwgcmV0dXJuIHRoZSByaWdodCBudW1iZXIgb2Ygc3VnZ2VzdGlvbnMuXG5cdFx0XHRcdFx0d29ya2luZ19saW1pdCsrO1xuXHRcdFx0XHR9XG5cdFx0XHR9XG5cblx0XHRcdHJldHVybiBydjtcblx0XHR9XG5cdFx0XG5cdFx0dGhpcy5tZW1vaXplZFt3b3JkXSA9IHtcblx0XHRcdCdzdWdnZXN0aW9ucyc6IGNvcnJlY3Qod29yZCksXG5cdFx0XHQnbGltaXQnOiBsaW1pdFxuXHRcdH07XG5cblx0XHRyZXR1cm4gdGhpcy5tZW1vaXplZFt3b3JkXVsnc3VnZ2VzdGlvbnMnXTtcblx0fVxufTtcbn0pKCk7XG5cbi8vIFN1cHBvcnQgZm9yIHVzZSBhcyBhIG5vZGUuanMgbW9kdWxlLlxuaWYgKHR5cGVvZiBtb2R1bGUgIT09ICd1bmRlZmluZWQnKSB7XG5cdG1vZHVsZS5leHBvcnRzID0gVHlwbztcbn1cbiIsIlwidXNlIHN0cmljdFwiO1xuXG52YXIgVHlwbyA9IHJlcXVpcmUoXCJ0eXBvLWpzXCIpO1xuXG5mdW5jdGlvbiBDb2RlTWlycm9yU3BlbGxDaGVja2VyKG9wdGlvbnMpIHtcblx0b3B0aW9ucyA9IG9wdGlvbnMgfHwge307XG5cblx0aWYoXG5cdFx0dHlwZW9mIG9wdGlvbnMuY29kZU1pcnJvckluc3RhbmNlICE9PSBcImZ1bmN0aW9uXCIgfHxcblx0XHR0eXBlb2Ygb3B0aW9ucy5jb2RlTWlycm9ySW5zdGFuY2UuZGVmaW5lTW9kZSAhPT0gXCJmdW5jdGlvblwiXG5cdCkge1xuXHRcdGNvbnNvbGUubG9nKFxuXHRcdFx0XCJDb2RlTWlycm9yIFNwZWxsIENoZWNrZXI6IFlvdSBtdXN0IHByb3ZpZGUgYW4gaW5zdGFuY2Ugb2YgQ29kZU1pcnJvciB2aWEgdGhlIG9wdGlvbiBgY29kZU1pcnJvckluc3RhbmNlYFwiXG5cdFx0KTtcblx0XHRyZXR1cm47XG5cdH1cblxuXHQvLyBCZWNhdXNlIHNvbWUgYnJvd3NlcnMgZG9uJ3Qgc3VwcG9ydCB0aGlzIGZ1bmN0aW9uYWxpdHkgeWV0XG5cdGlmKCFTdHJpbmcucHJvdG90eXBlLmluY2x1ZGVzKSB7XG5cdFx0U3RyaW5nLnByb3RvdHlwZS5pbmNsdWRlcyA9IGZ1bmN0aW9uKCkge1xuXHRcdFx0XCJ1c2Ugc3RyaWN0XCI7XG5cdFx0XHRyZXR1cm4gU3RyaW5nLnByb3RvdHlwZS5pbmRleE9mLmFwcGx5KHRoaXMsIGFyZ3VtZW50cykgIT09IC0xO1xuXHRcdH07XG5cdH1cblxuXHQvLyBEZWZpbmUgdGhlIG5ldyBtb2RlXG5cdG9wdGlvbnMuY29kZU1pcnJvckluc3RhbmNlLmRlZmluZU1vZGUoXCJzcGVsbC1jaGVja2VyXCIsIGZ1bmN0aW9uKGNvbmZpZykge1xuXHRcdC8vIExvYWQgQUZGL0RJQyBkYXRhXG5cdFx0aWYoIUNvZGVNaXJyb3JTcGVsbENoZWNrZXIuYWZmX2xvYWRpbmcpIHtcblx0XHRcdENvZGVNaXJyb3JTcGVsbENoZWNrZXIuYWZmX2xvYWRpbmcgPSB0cnVlO1xuXHRcdFx0dmFyIHhocl9hZmYgPSBuZXcgWE1MSHR0cFJlcXVlc3QoKTtcblx0XHRcdHhocl9hZmYub3Blbihcblx0XHRcdFx0XCJHRVRcIixcblx0XHRcdFx0XCJodHRwczovL2Nkbi5qc2RlbGl2ci5uZXQvbnBtL2h1bnNwZWxsLWRpY3QtZW4tdXNAMC4xLjAvZW4tdXMuYWZmXCIsXG5cdFx0XHRcdHRydWVcblx0XHRcdCk7XG5cdFx0XHR4aHJfYWZmLm9ubG9hZCA9IGZ1bmN0aW9uKCkge1xuXHRcdFx0XHRpZih4aHJfYWZmLnJlYWR5U3RhdGUgPT09IDQgJiYgeGhyX2FmZi5zdGF0dXMgPT09IDIwMCkge1xuXHRcdFx0XHRcdENvZGVNaXJyb3JTcGVsbENoZWNrZXIuYWZmX2RhdGEgPSB4aHJfYWZmLnJlc3BvbnNlVGV4dDtcblx0XHRcdFx0XHRDb2RlTWlycm9yU3BlbGxDaGVja2VyLm51bV9sb2FkZWQrKztcblxuXHRcdFx0XHRcdGlmKENvZGVNaXJyb3JTcGVsbENoZWNrZXIubnVtX2xvYWRlZCA9PSAyKSB7XG5cdFx0XHRcdFx0XHRDb2RlTWlycm9yU3BlbGxDaGVja2VyLnR5cG8gPSBuZXcgVHlwbyhcblx0XHRcdFx0XHRcdFx0XCJlbl9VU1wiLFxuXHRcdFx0XHRcdFx0XHRDb2RlTWlycm9yU3BlbGxDaGVja2VyLmFmZl9kYXRhLFxuXHRcdFx0XHRcdFx0XHRDb2RlTWlycm9yU3BlbGxDaGVja2VyLmRpY19kYXRhLCB7XG5cdFx0XHRcdFx0XHRcdFx0cGxhdGZvcm06IFwiYW55XCIsXG5cdFx0XHRcdFx0XHRcdH1cblx0XHRcdFx0XHRcdCk7XG5cdFx0XHRcdFx0fVxuXHRcdFx0XHR9XG5cdFx0XHR9O1xuXHRcdFx0eGhyX2FmZi5zZW5kKG51bGwpO1xuXHRcdH1cblxuXHRcdGlmKCFDb2RlTWlycm9yU3BlbGxDaGVja2VyLmRpY19sb2FkaW5nKSB7XG5cdFx0XHRDb2RlTWlycm9yU3BlbGxDaGVja2VyLmRpY19sb2FkaW5nID0gdHJ1ZTtcblx0XHRcdHZhciB4aHJfZGljID0gbmV3IFhNTEh0dHBSZXF1ZXN0KCk7XG5cdFx0XHR4aHJfZGljLm9wZW4oXG5cdFx0XHRcdFwiR0VUXCIsXG5cdFx0XHRcdFwiaHR0cHM6Ly9jZG4uanNkZWxpdnIubmV0L25wbS9odW5zcGVsbC1kaWN0LWVuLXVzQDAuMS4wL2VuLXVzLmRpY1wiLFxuXHRcdFx0XHR0cnVlXG5cdFx0XHQpO1xuXHRcdFx0eGhyX2RpYy5vbmxvYWQgPSBmdW5jdGlvbigpIHtcblx0XHRcdFx0aWYoeGhyX2RpYy5yZWFkeVN0YXRlID09PSA0ICYmIHhocl9kaWMuc3RhdHVzID09PSAyMDApIHtcblx0XHRcdFx0XHRDb2RlTWlycm9yU3BlbGxDaGVja2VyLmRpY19kYXRhID0geGhyX2RpYy5yZXNwb25zZVRleHQ7XG5cdFx0XHRcdFx0Q29kZU1pcnJvclNwZWxsQ2hlY2tlci5udW1fbG9hZGVkKys7XG5cblx0XHRcdFx0XHRpZihDb2RlTWlycm9yU3BlbGxDaGVja2VyLm51bV9sb2FkZWQgPT0gMikge1xuXHRcdFx0XHRcdFx0Q29kZU1pcnJvclNwZWxsQ2hlY2tlci50eXBvID0gbmV3IFR5cG8oXG5cdFx0XHRcdFx0XHRcdFwiZW5fVVNcIixcblx0XHRcdFx0XHRcdFx0Q29kZU1pcnJvclNwZWxsQ2hlY2tlci5hZmZfZGF0YSxcblx0XHRcdFx0XHRcdFx0Q29kZU1pcnJvclNwZWxsQ2hlY2tlci5kaWNfZGF0YSwge1xuXHRcdFx0XHRcdFx0XHRcdHBsYXRmb3JtOiBcImFueVwiLFxuXHRcdFx0XHRcdFx0XHR9XG5cdFx0XHRcdFx0XHQpO1xuXHRcdFx0XHRcdH1cblx0XHRcdFx0fVxuXHRcdFx0fTtcblx0XHRcdHhocl9kaWMuc2VuZChudWxsKTtcblx0XHR9XG5cblx0XHR2YXIgd29yZFJlZ2V4ID0gL15bXiFcIiMkJSYoKSorLFxcLS4vOjs8PT4/QFtcXFxcXFxdXl9ge3x9flxcc10rLztcblxuXHRcdGlmKG9wdGlvbnMubWF0Y2hSZWdleCAmJiBvcHRpb25zLm1hdGNoUmVnZXggaW5zdGFuY2VvZiBSZWdFeHApIHtcblx0XHRcdHdvcmRSZWdleCA9IG9wdGlvbnMubWF0Y2hSZWdleDtcblx0XHR9XG5cblx0XHR2YXIgcmVnZXhJZ25vcmUgPSAvWzAtOSdfLV0rLztcblxuXHRcdGlmKG9wdGlvbnMuaWdub3JlUmVnZXggJiYgb3B0aW9ucy5pZ25vcmVSZWdleCBpbnN0YW5jZW9mIFJlZ0V4cCkge1xuXHRcdFx0cmVnZXhJZ25vcmUgPSBvcHRpb25zLmlnbm9yZVJlZ2V4O1xuXHRcdH1cblxuXHRcdHZhciBjdXN0b21Xb3JkcyA9IFtdO1xuXG5cdFx0aWYob3B0aW9ucy5jdXN0b21Xb3Jkcykge1xuXHRcdFx0aWYob3B0aW9ucy5jdXN0b21Xb3JkcyBpbnN0YW5jZW9mIEZ1bmN0aW9uKSB7XG5cdFx0XHRcdGN1c3RvbVdvcmRzID0gb3B0aW9ucy5jdXN0b21Xb3JkcygpO1xuXHRcdFx0fSBlbHNlIHtcblx0XHRcdFx0Y3VzdG9tV29yZHMgPSBvcHRpb25zLmN1c3RvbVdvcmRzO1xuXHRcdFx0fVxuXHRcdH1cblxuXHRcdGNvbnNvbGUubG9nKHJlZ2V4SWdub3JlLCBvcHRpb25zKTtcblxuXHRcdC8vIENvZGVtaXJyb3IgbW9kZSBvdmVybGF5XG5cdFx0dmFyIG92ZXJsYXkgPSB7XG5cdFx0XHR0b2tlbjogZnVuY3Rpb24oc3RyZWFtKSB7XG5cdFx0XHRcdHZhciB3b3JkID0gc3RyZWFtLm1hdGNoKHdvcmRSZWdleCwgdHJ1ZSk7XG5cblx0XHRcdFx0aWYod29yZCkge1xuXHRcdFx0XHRcdHdvcmQgPSB3b3JkWzBdOyAvLyByZWdleCBtYXRjaCBib2R5XG5cdFx0XHRcdFx0aWYoXG5cdFx0XHRcdFx0XHQhd29yZC5tYXRjaChyZWdleElnbm9yZSkgJiZcblx0XHRcdFx0XHRcdENvZGVNaXJyb3JTcGVsbENoZWNrZXIudHlwbyAmJlxuXHRcdFx0XHRcdFx0IUNvZGVNaXJyb3JTcGVsbENoZWNrZXIudHlwby5jaGVjayh3b3JkKSAmJlxuXHRcdFx0XHRcdFx0IX5jdXN0b21Xb3Jkcy5pbmRleE9mKHdvcmQpXG5cdFx0XHRcdFx0KVxuXHRcdFx0XHRcdFx0cmV0dXJuIFwic3BlbGwtZXJyb3JcIjsgLy8gQ1NTIGNsYXNzOiBjbS1zcGVsbC1lcnJvclxuXHRcdFx0XHR9IGVsc2Uge1xuXHRcdFx0XHRcdHN0cmVhbS5uZXh0KCk7IC8vIHNraXAgbm9uLXdvcmQgY2hhcmFjdGVyXG5cdFx0XHRcdH1cblxuXHRcdFx0XHRyZXR1cm4gbnVsbDtcblx0XHRcdH0sXG5cdFx0fTtcblxuXHRcdHZhciBtb2RlID0gb3B0aW9ucy5jb2RlTWlycm9ySW5zdGFuY2UuZ2V0TW9kZShcblx0XHRcdGNvbmZpZyxcblx0XHRcdGNvbmZpZy5iYWNrZHJvcCB8fCBcInRleHQvcGxhaW5cIlxuXHRcdCk7XG5cblx0XHRyZXR1cm4gb3B0aW9ucy5jb2RlTWlycm9ySW5zdGFuY2Uub3ZlcmxheU1vZGUobW9kZSwgb3ZlcmxheSwgdHJ1ZSk7XG5cdH0pO1xufVxuXG5Db2RlTWlycm9yU3BlbGxDaGVja2VyLm51bV9sb2FkZWQgPSAwO1xuQ29kZU1pcnJvclNwZWxsQ2hlY2tlci5hZmZfbG9hZGluZyA9IGZhbHNlO1xuQ29kZU1pcnJvclNwZWxsQ2hlY2tlci5kaWNfbG9hZGluZyA9IGZhbHNlO1xuQ29kZU1pcnJvclNwZWxsQ2hlY2tlci5hZmZfZGF0YSA9IFwiXCI7XG5Db2RlTWlycm9yU3BlbGxDaGVja2VyLmRpY19kYXRhID0gXCJcIjtcbkNvZGVNaXJyb3JTcGVsbENoZWNrZXIudHlwbztcblxubW9kdWxlLmV4cG9ydHMgPSBDb2RlTWlycm9yU3BlbGxDaGVja2VyOyJdfQ==
