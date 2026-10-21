// Requests about the last request: "undo that", "do it again".
const { normalize } = require('./commands');

const UNDO = /^(?:undo|undo (?:that|it|this)|undo the last (?:thing|action|request|one)|take (?:that|it) back|revert (?:that|it)|reverse (?:that|it)|put (?:that|it) back|cancel that|undo what you just did)$/;
const AGAIN = /^(?:again|do (?:it|that|this) again|repeat (?:that|it|this)|one more time|same again|same thing again|run (?:it|that) again|try (?:it|that) again)$/;

const isUndo = (text) => UNDO.test(normalize(text));
const isAgain = (text) => AGAIN.test(normalize(text));

module.exports = { isUndo, isAgain };
