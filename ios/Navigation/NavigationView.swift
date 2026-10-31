import MapKit
import SwiftUI

@available(iOS 17.0, *)
struct NavigationView: View {
    @ObservedObject var model: NavigationModel
    let origin: CLLocationCoordinate2D
    @State private var destinationText = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("JARVIS NAVIGATION").font(.headline).foregroundStyle(.cyan)
            HStack {
                TextField("Destination", text: $destinationText).textFieldStyle(.roundedBorder)
                Button("Search") { Task { await model.search(for: destinationText, near: origin) } }
                    .disabled(model.loading)
            }
            Map {
                Marker("You", coordinate: origin).tint(.cyan)
                if let destination = model.destination {
                    Marker(item: destination).tint(.cyan)
                }
                if let route = model.route {
                    MapPolyline(route.polyline).stroke(.cyan, lineWidth: 5)
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: 16))
            if let route = model.route {
                Text("Route to \(model.destination?.name ?? destinationText)").font(.subheadline)
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
    }
}
