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
    @State private var pendingIntent: NavigationIntent?

    var body: some View {
        Group {
            if let coordinate = location.coordinate {
                NavigationView(model: model, origin: coordinate, refreshLocation: { model.cancel(); location.request() })
                    .task(id: coordinate.latitude.description + coordinate.longitude.description) {
                        if let intent = pendingIntent { pendingIntent = nil; model.query = intent.destination; model.walking = intent.walking; await model.search(for: intent.destination, near: coordinate) }
                    }
            } else {
                VStack(spacing: 16) {
                    Text("JARVIS NAVIGATION").font(.headline).foregroundStyle(.cyan)
                    Text(location.status)
                    Button("Use my location") { location.request() }
                }.padding().foregroundStyle(.white).frame(maxWidth: .infinity, maxHeight: .infinity).background(.black)
            }
        }
        .onOpenURL { url in
            guard let intent = NavigationIntent.link(url) else { return }
            model.cancel(); model.query = intent.destination; model.walking = intent.walking
            if let coordinate = location.coordinate { Task { await model.search(for: intent.destination, near: coordinate) } }
            else { pendingIntent = intent }
        }
    }
}


@preconcurrency import Speech
@preconcurrency import AVFoundation

@MainActor
final class NavigationVoice: ObservableObject {
    @Published private(set) var listening = false
    @Published private(set) var status = "Voice input is on-device; Apple Maps search and routing use Apple services."
    private let engine = AVAudioEngine()
    private let speaker = AVSpeechSynthesizer()
    private var recognition: SFSpeechRecognitionTask?
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var timer: Timer?
    private var deadlineTimer: Timer?
    private var transcript = ""
    private var complete: (@MainActor @Sendable (String) -> Void)?
    private var hasTap = false
    private var generation = UUID()
    var usedVoice = false

    func start(complete: @escaping @MainActor @Sendable (String) -> Void) {
        stop(); silence()
        let id = UUID(); generation = id
        SFSpeechRecognizer.requestAuthorization { authorization in
            Task { @MainActor in
                guard self.generation == id else { return }
                guard authorization == .authorized else { self.status = "Allow speech recognition in iPhone Settings, or type a destination."; return }
                AVAudioApplication.requestRecordPermission { allowed in
                    Task { @MainActor in
                        guard self.generation == id else { return }
                        guard allowed else { self.status = "Microphone permission is unavailable. Type a destination."; return }
                        self.begin(complete: complete)
                    }
                }
            }
        }
    }
    private func begin(complete: @escaping @MainActor @Sendable (String) -> Void) {
        guard let recognizer = SFSpeechRecognizer(locale: .current), recognizer.isAvailable, recognizer.supportsOnDeviceRecognition else { status = "On-device recognition is unavailable for this language. Type a destination; audio will not be sent to a cloud recognizer."; return }
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.record, mode: .measurement, options: .duckOthers)
            try session.setActive(true)
            let request = SFSpeechAudioBufferRecognitionRequest()
            request.requiresOnDeviceRecognition = true
            request.shouldReportPartialResults = true
            self.request = request; self.complete = complete; transcript = ""
            let node = engine.inputNode
            node.installTap(onBus: 0, bufferSize: 1024, format: node.outputFormat(forBus: 0)) { buffer, _ in request.append(buffer) }
            hasTap = true
            let activeID = generation
            recognition = recognizer.recognitionTask(with: request) { result, error in
                let text = result?.bestTranscription.formattedString
                let final = result?.isFinal ?? false, failed = error != nil
                Task { @MainActor in
                    guard self.listening && self.generation == activeID else { return }
                    if let text { self.transcript = text; self.status = text; self.timer?.invalidate(); self.timer = Timer.scheduledTimer(withTimeInterval: 1.4, repeats: false) { _ in Task { @MainActor in self.stop(send: true) } } }
                    if final { self.stop(send: true) } else if failed { self.stop(); self.status = "Speech stopped. Try again or type." }
                }
            }
            try engine.start(); listening = true;
            deadlineTimer = Timer.scheduledTimer(withTimeInterval: 30, repeats: false) { _ in Task { @MainActor in self.stop(send: true) } }; usedVoice = true; status = "Listening — say take me to a place. Pause or tap Send."
        } catch { stop(); status = "Could not start the microphone. Type a destination." }
    }
    func stop(send: Bool = false) {
        generation = UUID(); timer?.invalidate(); timer = nil; deadlineTimer?.invalidate(); deadlineTimer = nil
        engine.stop(); if hasTap { engine.inputNode.removeTap(onBus: 0); hasTap = false }
        request?.endAudio(); recognition?.cancel(); recognition = nil; request = nil
        listening = false
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        let callback = complete, text = transcript.trimmingCharacters(in: .whitespacesAndNewlines)
        complete = nil; transcript = ""
        if send && !text.isEmpty { callback?(text); status = "Searching for \(text)…" }
    }
    func say(_ text: String) {
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio, options: .duckOthers)
        try? AVAudioSession.sharedInstance().setActive(true)
        let speech = AVSpeechUtterance(string: text)
        speech.voice = AVSpeechSynthesisVoice.speechVoices().first(where: { $0.language == "en-GB" && $0.gender == .male }) ?? AVSpeechSynthesisVoice(language: "en-GB")
        speaker.speak(speech)
    }
    func silence() { speaker.stopSpeaking(at: .immediate); try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation) }
}
