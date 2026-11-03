import CoreLocation
import MapKit
import SwiftUI

// A route preview, not turn-by-turn guidance. The caller supplies a location
// obtained with the app's location permission and an explicit user request.
@MainActor
final class NavigationModel: ObservableObject {
    @Published private(set) var route: MKRoute?
    @Published private(set) var destination: MKMapItem?
    @Published private(set) var matches: [MKMapItem] = []
    @Published private(set) var status = "Choose a destination."
    @Published private(set) var loading = false
    private var requestID = UUID()
    private var searchRequest: MKLocalSearch?
    private var directionsRequest: MKDirections?
    @Published var walking = false
    @Published var query = ""
    @Published var routeReady = UUID()

    func cancel() {
        requestID = UUID()
        searchRequest?.cancel(); directionsRequest?.cancel()
        loading = false
        route = nil
        destination = nil
        matches = []
        status = "Choose a destination."
    }

    func search(for query: String, near origin: CLLocationCoordinate2D) async {
        let destinationText = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !destinationText.isEmpty else { status = "Enter a destination."; return }
        searchRequest?.cancel(); directionsRequest?.cancel()
        let id = UUID()
        requestID = id
        loading = true
        route = nil
        destination = nil
        matches = []
        status = "Searching for places…"
        defer { if requestID == id { loading = false } }
        do {
            let search = MKLocalSearch.Request()
            search.naturalLanguageQuery = destinationText
            search.region = MKCoordinateRegion(center: origin, latitudinalMeters: 50_000, longitudinalMeters: 50_000)
            let pending = MKLocalSearch(request: search)
            searchRequest = pending
            let results = try await pending.start()
            guard requestID == id else { return }
            matches = Array(results.mapItems.prefix(10))
            status = matches.isEmpty ? "No matching place found." : "Choose a destination."
        } catch {
            guard requestID == id else { return }
            status = "Could not search for places. Check your connection and try again."
        }
    }

    func route(to place: MKMapItem, from origin: CLLocationCoordinate2D) async {
        searchRequest?.cancel(); directionsRequest?.cancel()
        let id = UUID()
        requestID = id
        loading = true
        route = nil
        destination = nil
        status = "Finding a route…"
        defer { if requestID == id { loading = false } }
        do {
            let request = MKDirections.Request()
            request.source = MKMapItem(placemark: MKPlacemark(coordinate: origin))
            request.destination = place
            request.transportType = walking ? .walking : .automobile
            let pending = MKDirections(request: request)
            directionsRequest = pending
            let response = try await pending.calculate()
            guard requestID == id else { return }
            guard let found = response.routes.first else { status = "No driving route found."; return }
            destination = place
            route = found
            matches = []
            status = "Route preview ready."
            routeReady = UUID()
        } catch {
            guard requestID == id else { return }
            status = "Could not find a route. Check your connection and try again."
        }
    }
}
