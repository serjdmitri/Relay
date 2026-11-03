import MapKit
import SwiftUI

@available(iOS 17.0, *)
struct NavigationView: View {
    @ObservedObject var model: NavigationModel
    let origin: CLLocationCoordinate2D
    @StateObject private var voice = NavigationVoice()
    @Environment(\.scenePhase) private var scenePhase
    let refreshLocation: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("JARVIS NAVIGATION").font(.headline).foregroundStyle(.cyan)
            HStack {
                TextField("Destination", text: $model.query).textFieldStyle(.roundedBorder)
                Button("Search") { Task { await model.search(for: model.query, near: origin) } }
                    .disabled(model.loading)
            }
            Picker("Travel mode", selection: $model.walking) { Text("Driving").tag(false); Text("Walking").tag(true) }.pickerStyle(.segmented)
            HStack {
                Button(voice.listening ? "Send voice command" : "Speak destination") {
                    if voice.listening { voice.stop(send: true) } else { voice.start { text in
                        let intent = NavigationIntent.parse(text)
                        model.query = intent?.destination ?? text
                        if let intent { model.walking = intent.walking }
                        Task { await model.search(for: model.query, near: origin) }
                    } }
                }
                Button("Refresh location", action: refreshLocation)
                if voice.listening { Button("Cancel voice") { voice.stop() } }
            }.font(.caption)
            Text(voice.status).font(.caption).accessibilityLabel(voice.status)
            Map {
                Marker("You", coordinate: origin).tint(.cyan)
                if let destination = model.destination {
                    Marker(item: destination).tint(.cyan)
                }
                if let route = model.route {
                    MapPolyline(route.polyline).stroke(.cyan, lineWidth: 5)
                }
            }
            .mapControls { MapCompass(); MapScaleView() }
            .overlay(Rectangle().stroke(.cyan.opacity(0.6), lineWidth: 1))
            if let route = model.route {
                Text("Route to \(model.destination?.name ?? model.query)").font(.subheadline)
                Text("\(Int((route.expectedTravelTime / 60).rounded())) min • \(route.distance / 1609.344, specifier: "%.1f") mi")
                ScrollView {
                    VStack(alignment: .leading, spacing: 6) {
                        ForEach(Array(route.steps.filter { !$0.instructions.isEmpty }.enumerated()), id: \.offset) { _, step in
                            Text(step.instructions).font(.caption)
                        }
                    }.frame(maxWidth: .infinity, alignment: .leading)
                }
                .frame(maxHeight: 140)
                Text("Preview only; live guidance is not active.").font(.caption)
                Button("End route") { model.cancel() }
            } else {
                Text(model.status).font(.caption)
                if !model.matches.isEmpty {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 10) {
                            ForEach(Array(model.matches.enumerated()), id: \.offset) { _, place in
                                Button {
                                    Task { await model.route(to: place, from: origin) }
                                } label: {
                                    VStack(alignment: .leading) {
                                        Text(place.name ?? "Unnamed place")
                                        if let address = place.placemark.title { Text(address).font(.caption) }
                                    }.frame(maxWidth: .infinity, alignment: .leading)
                                }.disabled(model.loading)
                            }
                        }
                    }.frame(maxHeight: 160)
                }
                if model.loading { Button("Cancel") { model.cancel() } }
            }
        }
        .padding()
        .foregroundStyle(.white)
        .background(.black)
        .onChange(of: model.routeReady) { _, _ in
            if voice.usedVoice, let route = model.route { voice.say("Your route to \(model.destination?.name ?? model.query) is ready, Sir. About \(Int(ceil(route.expectedTravelTime / 60))) minutes. This is a route preview.") }
        }
        .onChange(of: scenePhase) { _, phase in if phase != .active { voice.stop(); voice.silence() } }
        .onDisappear { voice.stop(); voice.silence() }
    }
}
