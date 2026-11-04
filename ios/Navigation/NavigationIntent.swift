import Foundation

struct NavigationIntent {
    let destination: String
    let walking: Bool
    static func parse(_ text: String) -> NavigationIntent? {
        let text = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let range = text.range(of: #"^(?:(?:hey )?jarvis[, ]+)?(?:take me to|navigate to|directions to|route to|walk(?: me)? to|drive(?: me)? to)\s+"#, options: [.regularExpression, .caseInsensitive]) else { return nil }
        let destination = String(text[range.upperBound...]).trimmingCharacters(in: .whitespacesAndNewlines)
        guard !destination.isEmpty, destination.count <= 200 else { return nil }
        return NavigationIntent(destination: destination, walking: text.range(of: #"\bwalk(?: me)? to\b"#, options: [.regularExpression, .caseInsensitive]) != nil)
    }
    static func link(_ url: URL) -> NavigationIntent? {
        guard url.scheme == "relay-navigation", url.host == "navigate", let c = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let destination = c.queryItems?.first(where: { $0.name == "destination" })?.value?.trimmingCharacters(in: .whitespacesAndNewlines),
              !destination.isEmpty, destination.count <= 200 else { return nil }
        return NavigationIntent(destination: destination, walking: c.queryItems?.first(where: { $0.name == "transport" })?.value == "walking")
    }
}
