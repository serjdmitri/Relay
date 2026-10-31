import CoreLocation
import SwiftUI

// Location is requested only after the person taps the button. A native app
// target must provide NSLocationWhenInUseUsageDescription in its Info.plist.
@MainActor
final class NavigationLocation: NSObject, ObservableObject, @preconcurrency CLLocationManagerDelegate {
    @Published private(set) var coordinate: CLLocationCoordinate2D?
    @Published private(set) var status = "Location is needed to preview a route."
    private let manager = CLLocationManager()
    private var pending = false

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
    }

    func request() {
        pending = true
        coordinate = nil
        switch manager.authorizationStatus {
        case .notDetermined:
            status = "Waiting for location permission…"
            manager.requestWhenInUseAuthorization()
        case .authorizedAlways, .authorizedWhenInUse:
            status = "Finding your location…"
            manager.requestLocation()
        case .denied, .restricted:
            pending = false
            status = "Location is unavailable. Allow location access in iPhone Settings."
        @unknown default:
            pending = false
            status = "Location is unavailable."
        }
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        guard pending else { return }
        switch manager.authorizationStatus {
        case .authorizedAlways, .authorizedWhenInUse:
            status = "Finding your location…"
            manager.requestLocation()
        case .denied, .restricted:
            pending = false
            status = "Location is unavailable. Allow location access in iPhone Settings."
        default: break
        }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard pending else { return }
        pending = false
        guard let location = locations.last, location.horizontalAccuracy >= 0,
              abs(location.timestamp.timeIntervalSinceNow) < 120 else {
            status = "Could not get a recent location. Try again."
            return
        }
        coordinate = location.coordinate
        status = "Location ready."
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        guard pending else { return }
        pending = false
        status = "Could not get your location. Try again."
    }
}

@available(iOS 17.0, *)
struct NavigationEntryView: View {
    @StateObject private var location = NavigationLocation()
    @StateObject private var model = NavigationModel()

    var body: some View {
        Group {
            if let coordinate = location.coordinate {
                NavigationView(model: model, origin: coordinate)
            } else {
                VStack(spacing: 16) {
                    Text("JARVIS NAVIGATION").font(.headline).foregroundStyle(.cyan)
                    Text(location.status)
                    Button("Use my location") { location.request() }
                }.padding().foregroundStyle(.white).frame(maxWidth: .infinity, maxHeight: .infinity).background(.black)
            }
        }
    }
}
