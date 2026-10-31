import CoreLocation
import MapKit
import SwiftUI

// A route preview, not turn-by-turn guidance. The caller supplies a location
// obtained with the app's location permission and an explicit user request.
@MainActor
final class NavigationModel: ObservableObject {
    @Published private(set) var route: MKRoute?
    @Published private(set) var destination: MKMapItem?
    @Published private(set) var status = "Choose a destination."
    @Published private(set) var loading = false
    private var requestID = UUID()

    func cancel() {
        requestID = UUID()
        loading = false
        route = nil
        destination = nil
        status = "Choose a destination."
    }

    func findRoute(to query: String, from origin: CLLocationCoordinate2D) async {
        let destinationText = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !destinationText.isEmpty else { status = "Enter a destination."; return }
        let id = UUID()
        requestID = id
        loading = true
        route = nil
        destination = nil
        status = "Finding a route…"
        defer { if requestID == id { loading = false } }
        do {
            let search = MKLocalSearch.Request()
            search.naturalLanguageQuery = destinationText
            search.region = MKCoordinateRegion(center: origin, latitudinalMeters: 50_000, longitudinalMeters: 50_000)
            let results = try await MKLocalSearch(request: search).start()
            guard requestID == id else { return }
            guard let place = results.mapItems.first else { status = "No matching place found."; return }
            let request = MKDirections.Request()
            request.source = MKMapItem(placemark: MKPlacemark(coordinate: origin))
            request.destination = place
            request.transportType = .automobile
            let response = try await MKDirections(request: request).calculate()
            guard requestID == id else { return }
            guard let found = response.routes.first else { status = "No driving route found."; return }
            destination = place
            route = found
            status = "Route preview ready."
        } catch {
            guard requestID == id else { return }
            status = "Could not find a route. Check your connection and try again."
        }
    }
}
