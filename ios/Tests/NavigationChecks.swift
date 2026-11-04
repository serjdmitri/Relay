import Foundation
import MapKit

// Developer smoke check using public London coordinates, never device location.
// Compile with NavigationIntent.swift and NavigationModel.swift; --live queries Apple.
@main
struct NavigationChecks {
    @MainActor static func main() async {
        let cases: [(String, String, Bool)] = [
            ("take me to London", "London", false),
            ("Hey Jarvis, walk me to Trafalgar Square", "Trafalgar Square", true),
            ("drive me to home", "home", false),
            ("route to Paris", "Paris", false)
        ]
        for (text, destination, walking) in cases {
            guard let intent = NavigationIntent.parse(text), intent.destination == destination, intent.walking == walking else { fatalError("Navigation command mismatch") }
        }
        assert(NavigationIntent.parse("take me to ") == nil)
        assert(NavigationIntent.link(URL(string: "relay-navigation://navigate?destination=London&transport=walking")!)?.walking == true)
        assert(NavigationIntent.link(URL(string: "https://example.com/navigate?destination=London")!) == nil)
        let model = NavigationModel()
        model.cancel()
        assert(!model.loading && model.route == nil && model.matches.isEmpty)
        print("8 navigation checks passed")
        guard CommandLine.arguments.contains("--live") else { return }
        let origin = CLLocationCoordinate2D(latitude: 51.5074, longitude: -0.1278)
        await model.search(for: "Trafalgar Square, London", near: origin)
        guard let place = model.matches.first(where: { $0.name?.contains("Trafalgar") == true && abs($0.placemark.coordinate.latitude - origin.latitude) < 0.1 }) else {
            print("LIVE CHECK UNVERIFIED: \(model.status)"); exit(2)
        }
        for walking in [true, false] {
            model.walking = walking
            await model.route(to: place, from: origin)
            guard let route = model.route, route.distance > 0, route.expectedTravelTime > 0, route.polyline.pointCount > 1 else {
                print("LIVE CHECK UNVERIFIED: \(model.status)"); exit(2)
            }
            print("Live \(walking ? "walking" : "driving") route: \(Int(route.distance))m, \(route.steps.count) steps")
        }
        model.cancel()
        assert(model.destination == nil && model.route == nil && !model.loading)
        print("Live route search, both modes and cancellation passed")
    }
}
