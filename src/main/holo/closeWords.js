// What you say to put the holograms away (nothing else is taken for it: "close the door" is not).
const CLOSE_HOLOS = /^(?:ok(?:ay)?[, ]+)?(?:please )?(?:close|dismiss|hide|clear|remove|put away|get rid of)(?: (?:it|them|that|this|all|everything|the (?:holograms?|model|models|3d model)|all (?:the )?holograms?))?(?: please)?[.!]?$|^(?:that'?s all|i'?m done|all done|go away)[.!]?$/i;

module.exports = { CLOSE_HOLOS };
