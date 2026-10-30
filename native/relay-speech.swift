// relay-speech: on-device dictation for Relay, using Apple's SpeechAnalyzer (macOS 26+).
// Talks to the Electron main process with JSON lines: commands on stdin, events on stdout.
//
// Commands: {"cmd":"prepare","locale":"en-US"} {"cmd":"start"} {"cmd":"stop"} {"cmd":"cancel"}
//           {"cmd":"devices"} {"cmd":"permissions"} {"cmd":"request-permissions"} {"cmd":"locales"} {"cmd":"quit"}
// Events:   ready, status, preparing, prepared, listening, partial, level, final, devices, permissions, locales, error
// Test:     relay-speech --file speech.aiff   (prints the transcript of an audio file and exits)

import AVFoundation
import CoreAudio
import Foundation
import Speech

// MARK: - output

let outLock = NSLock()
func emit(_ obj: [String: Any]) {
  guard let data = try? JSONSerialization.data(withJSONObject: obj, options: []) else { return }
  outLock.lock()
  FileHandle.standardOutput.write(data)
  FileHandle.standardOutput.write(Data([0x0A]))
  outLock.unlock()
}

let debugOn = ProcessInfo.processInfo.environment["RELAY_SPEECH_DEBUG"] != nil
func debug(_ m: String) { if debugOn { FileHandle.standardError.write(Data(("[speech] " + m + "\n").utf8)) } }

func fail(_ message: String, code: String = "error") {
  emit(["event": "error", "code": code, "message": message])
}

// MARK: - permissions

func micStatus() -> String {
  switch AVCaptureDevice.authorizationStatus(for: .audio) {
  case .authorized: return "granted"
  case .denied, .restricted: return "denied"
  case .notDetermined: return "undetermined"
  @unknown default: return "undetermined"
  }
}

func speechStatus() -> String { "granted" }

// SpeechAnalyzer needs only the microphone; it does not use the older Speech Recognition permission.
func requestPermissions() async {
  if AVCaptureDevice.authorizationStatus(for: .audio) == .notDetermined {
    _ = await AVCaptureDevice.requestAccess(for: .audio)
  }
}

// MARK: - audio devices

func deviceName(_ id: AudioDeviceID) -> String {
  var addr = AudioObjectPropertyAddress(
    mSelector: kAudioObjectPropertyName, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
  var name: Unmanaged<CFString>?
  var size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
  let status = AudioObjectGetPropertyData(id, &addr, 0, nil, &size, &name)
  if status == noErr, let name { return name.takeRetainedValue() as String }
  return "Microphone"
}

struct InputDevice {
  let id: AudioDeviceID
  let uid: String
  let name: String
  let builtIn: Bool
  let bluetooth: Bool
}

func stringProp(_ id: AudioObjectID, _ selector: AudioObjectPropertySelector) -> String? {
  var addr = AudioObjectPropertyAddress(mSelector: selector, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
  var value: Unmanaged<CFString>?
  var size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
  guard AudioObjectGetPropertyData(id, &addr, 0, nil, &size, &value) == noErr, let value else { return nil }
  return value.takeRetainedValue() as String
}

func allInputDevices() -> [InputDevice] {
  var addr = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyDevices, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
  var size: UInt32 = 0
  guard AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size) == noErr else { return [] }
  var ids = [AudioDeviceID](repeating: 0, count: Int(size) / MemoryLayout<AudioDeviceID>.size)
  guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size, &ids) == noErr else { return [] }
  return ids.compactMap { id in
    var sa = AudioObjectPropertyAddress(mSelector: kAudioDevicePropertyStreams, mScope: kAudioObjectPropertyScopeInput, mElement: kAudioObjectPropertyElementMain)
    var ssize: UInt32 = 0
    guard AudioObjectGetPropertyDataSize(id, &sa, 0, nil, &ssize) == noErr, ssize > 0 else { return nil }
    guard let uid = stringProp(id, kAudioDevicePropertyDeviceUID) else { return nil }
    var ta = AudioObjectPropertyAddress(mSelector: kAudioDevicePropertyTransportType, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
    var transport: UInt32 = 0
    var tsize = UInt32(MemoryLayout<UInt32>.size)
    _ = AudioObjectGetPropertyData(id, &ta, 0, nil, &tsize, &transport)
    return InputDevice(id: id, uid: uid, name: deviceName(id), builtIn: transport == kAudioDeviceTransportTypeBuiltIn,
      bluetooth: transport == kAudioDeviceTransportTypeBluetooth || transport == kAudioDeviceTransportTypeBluetoothLE)
  }
}

func defaultInputID() -> AudioDeviceID? {
  var addr = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyDefaultInputDevice, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
  var id = AudioDeviceID(0)
  var size = UInt32(MemoryLayout<AudioDeviceID>.size)
  guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size, &id) == noErr, id != 0 else { return nil }
  return id
}

// pref: "auto" (built-in mic when the default is a Bluetooth headset), "default", or a device UID.
// Bluetooth headsets drop into a low-quality call mode, with a delay, as soon as their mic opens.
func resolveInput(_ pref: String?) -> InputDevice? {
  let all = allInputDevices()
  let pref = pref ?? "auto"
  if pref != "auto" && pref != "default", let d = all.first(where: { $0.uid == pref }) { return d }
  let def = defaultInputID().flatMap { id in all.first(where: { $0.id == id }) }
  if pref == "auto", let def, def.bluetooth, let builtIn = all.first(where: { $0.builtIn }) { return builtIn }
  return def
}

func defaultInputName() -> String? {
  var addr = AudioObjectPropertyAddress(
    mSelector: kAudioHardwarePropertyDefaultInputDevice, mScope: kAudioObjectPropertyScopeGlobal,
    mElement: kAudioObjectPropertyElementMain)
  var id = AudioDeviceID(0)
  var size = UInt32(MemoryLayout<AudioDeviceID>.size)
  let status = AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size, &id)
  guard status == noErr, id != 0 else { return nil }
  return deviceName(id)
}

// MARK: - microphone capture

// Delivers the samples of an AVCaptureSession as PCM buffers. Used to listen to one particular microphone (the built-in one)
// while a Bluetooth headset is the default: AVAudioEngine ties input and output to one device and fails with -10868 there,
// whereas a capture session takes the chosen microphone on its own and leaves the headset's speakers alone.
final class CaptureDelegate: NSObject, AVCaptureAudioDataOutputSampleBufferDelegate {
  var handler: ((AVAudioPCMBuffer) -> Void)?
  func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
    guard let fd = CMSampleBufferGetFormatDescription(sampleBuffer),
      let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(fd),
      let format = AVAudioFormat(streamDescription: asbd) else { return }
    let frames = AVAudioFrameCount(CMSampleBufferGetNumSamples(sampleBuffer))
    guard frames > 0, let pcm = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames) else { return }
    pcm.frameLength = frames
    let status = CMSampleBufferCopyPCMDataIntoAudioBufferList(sampleBuffer, at: 0, frameCount: Int32(frames), into: pcm.mutableAudioBufferList)
    if status == noErr { handler?(pcm) }
  }
}

final class Mic: @unchecked Sendable {
  private var captureSession: AVCaptureSession?
  private var captureDelegate: CaptureDelegate?
  private let captureQueue = DispatchQueue(label: "relay.mic.capture")
  private var engine = AVAudioEngine()
  private var converter: AVAudioConverter?
  private var converterInput: AVAudioFormat?
  private let output: AVAudioFormat
  private let continuation: AsyncStream<AnalyzerInput>.Continuation
  private let device: AudioDeviceID?
  private var levelWindow = LevelWindow()
  private var observer: NSObjectProtocol?
  private var running = false
  private var useDefault = false // set when the chosen device would not start
  private let lock = NSLock()

  init(output: AVAudioFormat, continuation: AsyncStream<AnalyzerInput>.Continuation, device: AudioDeviceID?) {
    self.output = output
    self.continuation = continuation
    self.device = device
  }

  private func selectDevice() {
    // Re-selecting the device that is already the default changes nothing but makes macOS announce a change.
    guard !useDefault, let device, device != defaultInputID(), let unit = engine.inputNode.audioUnit else { return }
    var d = device
    AudioUnitSetProperty(unit, kAudioOutputUnitProperty_CurrentDevice, kAudioUnitScope_Global, 0, &d, UInt32(MemoryLayout<AudioDeviceID>.size))
  }

  private func startCapture(uid: String) throws {
    guard let dev = AVCaptureDevice(uniqueID: uid) else { throw NSError(domain: "relay", code: 2, userInfo: [NSLocalizedDescriptionKey: "That microphone is not available."]) }
    let session = AVCaptureSession()
    let input = try AVCaptureDeviceInput(device: dev)
    guard session.canAddInput(input) else { throw NSError(domain: "relay", code: 3, userInfo: [NSLocalizedDescriptionKey: "That microphone cannot be used."]) }
    session.addInput(input)
    let out = AVCaptureAudioDataOutput()
    out.audioSettings = [AVFormatIDKey: kAudioFormatLinearPCM, AVLinearPCMBitDepthKey: 32, AVLinearPCMIsFloatKey: true, AVLinearPCMIsBigEndianKey: false, AVLinearPCMIsNonInterleaved: true]
    let delegate = CaptureDelegate()
    delegate.handler = { [weak self] buffer in self?.receive(buffer) }
    out.setSampleBufferDelegate(delegate, queue: captureQueue)
    guard session.canAddOutput(out) else { throw NSError(domain: "relay", code: 4, userInfo: [NSLocalizedDescriptionKey: "That microphone cannot be read."]) }
    session.addOutput(out)
    session.startRunning()
    guard session.isRunning else { throw NSError(domain: "relay", code: 5, userInfo: [NSLocalizedDescriptionKey: "That microphone did not start."]) }
    captureSession = session
    captureDelegate = delegate
    debug("capturing from \(dev.localizedName) with a capture session")
  }

  func start() throws {
    // Another microphone than the default (the built-in one while AirPods are the default): a capture session handles it.
    if let device, device != defaultInputID(), let uid = stringProp(device, kAudioDevicePropertyDeviceUID) {
      do {
        try startCapture(uid: uid)
        lock.lock(); running = true; lock.unlock()
        return
      } catch {
        debug("capture session failed: \(error.localizedDescription)")
        captureSession?.stopRunning()
        captureSession = nil
      }
    }
    do {
      try startOnce()
    } catch {
      // The microphone that was asked for cannot run next to the current speakers (a Bluetooth headset in call mode and the
      // built-in microphone, for example: AVAudioEngine answers with -10868). Use the default input instead of failing.
      guard device != nil, !useDefault else { throw error }
      debug("falling back to the default input after: \(error.localizedDescription)")
      useDefault = true
      engine.inputNode.removeTap(onBus: 0)
      engine = AVAudioEngine()
      converter = nil
      try startOnce()
    }
  }

  private func startOnce() throws {
    selectDevice()
    let format = engine.inputNode.inputFormat(forBus: 0)
    guard format.sampleRate > 0, format.channelCount > 0 else {
      throw NSError(domain: "relay", code: 1, userInfo: [NSLocalizedDescriptionKey: "No microphone input is available."])
    }
    try begin()
    lock.lock(); running = true; lock.unlock()
  }

  private func begin() throws {
    let input = engine.inputNode
    input.removeTap(onBus: 0)
    // A nil format means the bus's live format. Passing one captured earlier can crash when a
    // Bluetooth headset switches profile as the mic opens.
    input.installTap(onBus: 0, bufferSize: 1024, format: nil) { [weak self] buffer, _ in
      self?.receive(buffer)
    }
    if let observer { NotificationCenter.default.removeObserver(observer) }
    observer = NotificationCenter.default.addObserver(
      forName: .AVAudioEngineConfigurationChange, object: engine, queue: nil
    ) { [weak self] _ in self?.recover() }
    engine.prepare()
    try engine.start()
    debug("engine started, running=\(engine.isRunning)")
  }

  // AVAudioEngine stops itself when the audio route changes (AirPods switching profile). Rebuild it.
  private var rebuilds = 0
  private func recover() {
    debug("configuration change, engine running=\(engine.isRunning)")
    lock.lock(); let on = running; lock.unlock()
    guard on else { return }
    // macOS also announces changes while the engine is still fine (right after it starts, for example).
    // Only rebuild an engine that has actually stopped, and give up rather than loop.
    if engine.isRunning { return }
    rebuilds += 1
    if rebuilds > 4 { fail("The microphone keeps changing. Try choosing a microphone in Speech settings."); return }
    engine.inputNode.removeTap(onBus: 0)
    engine = AVAudioEngine()
    converter = nil
    selectDevice()
    do { try begin() } catch { fail("The microphone stopped: \(error.localizedDescription)") }
  }

  private var seen = 0
  private func receive(_ buffer: AVAudioPCMBuffer) {
    seen += 1
    if seen == 1 || seen % 50 == 0 { debug("buffer #\(seen) frames=\(buffer.frameLength) format=\(buffer.format)") }
    // Measure every buffer so brief claps are not lost between level updates.
    if let ch = buffer.floatChannelData?[0] {
      var sum: Float = 0
      let n = Int(buffer.frameLength)
      for i in 0..<n { sum += ch[i] * ch[i] }
      let rms = n > 0 ? (sum / Float(n)).squareRoot() : 0
      if let level = levelWindow.push(rms: rms, now: Date.timeIntervalSinceReferenceDate) {
        emit(["event": "level", "value": level])
      }
    }

    if converter == nil || converterInput != buffer.format {
      converter = AVAudioConverter(from: buffer.format, to: output)
      converterInput = buffer.format
    }
    guard let converter else { return }
    let ratio = output.sampleRate / buffer.format.sampleRate
    let capacity = AVAudioFrameCount(Double(buffer.frameLength) * ratio) + 64
    guard let out = AVAudioPCMBuffer(pcmFormat: output, frameCapacity: capacity) else { return }
    var supplied = false
    var err: NSError?
    converter.convert(to: out, error: &err) { _, status in
      if supplied { status.pointee = .noDataNow; return nil }
      supplied = true
      status.pointee = .haveData
      return buffer
    }
    if err == nil, out.frameLength > 0 { continuation.yield(AnalyzerInput(buffer: out)) }
  }

  func stop() {
    lock.lock(); running = false; lock.unlock()
    if let observer { NotificationCenter.default.removeObserver(observer) }
    observer = nil
    captureSession?.stopRunning()
    captureSession = nil
    captureDelegate = nil
    engine.inputNode.removeTap(onBus: 0)
    engine.stop()
  }
}

// MARK: - display brightness

// The built-in display's brightness goes through Apple's DisplayServices framework (a private API that
// brightness utilities have long used). It does not work for external monitors.
typealias BrightnessGet = @convention(c) (UInt32, UnsafeMutablePointer<Float>) -> Int32
typealias BrightnessSet = @convention(c) (UInt32, Float) -> Int32

func displayServices() -> (get: BrightnessGet, set: BrightnessSet)? {
  guard let h = dlopen("/System/Library/PrivateFrameworks/DisplayServices.framework/DisplayServices", RTLD_NOW),
    let g = dlsym(h, "DisplayServicesGetBrightness"), let s = dlsym(h, "DisplayServicesSetBrightness")
  else { return nil }
  return (unsafeBitCast(g, to: BrightnessGet.self), unsafeBitCast(s, to: BrightnessSet.self))
}

func brightness(set value: Double?) -> [String: Any] {
  guard let ds = displayServices() else { return ["event": "brightness", "ok": false, "error": "Brightness control is not available."] }
  let display = CGMainDisplayID()
  var v: Float = 0
  guard ds.get(display, &v) == 0 else { return ["event": "brightness", "ok": false, "error": "This display's brightness cannot be read."] }
  let before = Double(v)
  if let value {
    guard ds.set(display, Float(max(0, min(1, value)))) == 0 else { return ["event": "brightness", "ok": false, "error": "This display's brightness cannot be changed."] }
    _ = ds.get(display, &v)
  }
  return ["event": "brightness", "ok": true, "before": before, "value": Double(v)]
}

// MARK: - speech engine

struct Prepared: @unchecked Sendable {
  let locale: Locale
  let transcriber: SpeechTranscriber
  let analyzer: SpeechAnalyzer
  let format: AVAudioFormat
}

struct Accumulator {
  var finalized = ""
  var volatile = ""
  mutating func receive(_ text: String, isFinal: Bool) {
    if isFinal { finalized += text; volatile = "" } else { volatile = text }
  }
  var text: String { finalized + volatile }
}

actor Engine {
  private var localeID = "en-US"
  private var prepared: Prepared?
  private var building: Task<Prepared, Error>?
  private var reserved: Locale?
  private var vocabulary: [String] = []

  private var mic: Mic?
  private var continuation: AsyncStream<AnalyzerInput>.Continuation?
  private var resultTask: Task<String, Error>?
  private var activeAnalyzer: SpeechAnalyzer?
  private var latest = ""

  func setVocabulary(_ words: [String]) { vocabulary = words }

  func locales() async -> [[String: String]] {
    let supported = await SpeechTranscriber.supportedLocales
    return supported
      .map { ["id": $0.identifier(.bcp47), "name": Locale.current.localizedString(forIdentifier: $0.identifier) ?? $0.identifier] }
      .sorted { ($0["name"] ?? "") < ($1["name"] ?? "") }
  }

  func prepare(localeID id: String?) async throws {
    if let id, !id.isEmpty, id != localeID {
      localeID = id
      prepared = nil
      building?.cancel()
      building = nil
    }
    _ = try await ensurePrepared()
  }

  private func ensurePrepared() async throws -> Prepared {
    if let prepared { return prepared }
    if let building { return try await building.value }
    let id = localeID
    let task = Task { try await self.build(id) }
    building = task
    do {
      let p = try await task.value
      if prepared == nil { prepared = p }
      building = nil
      return prepared ?? p
    } catch {
      building = nil
      throw error
    }
  }

  private func build(_ id: String) async throws -> Prepared {
    guard SpeechTranscriber.isAvailable else {
      throw NSError(domain: "relay", code: 2, userInfo: [NSLocalizedDescriptionKey: "Apple Speech is not available on this Mac."])
    }
    guard let locale = await SpeechTranscriber.supportedLocale(equivalentTo: Locale(identifier: id)) else {
      throw NSError(domain: "relay", code: 3, userInfo: [NSLocalizedDescriptionKey: "Apple Speech does not support the language \(id)."])
    }
    if reserved != locale {
      if let old = reserved { await AssetInventory.release(reservedLocale: old) }
      _ = try? await AssetInventory.reserve(locale: locale)
      reserved = locale
    }
    let transcriber = SpeechTranscriber(locale: locale, preset: .progressiveTranscription)
    if let request = try await AssetInventory.assetInstallationRequest(supporting: [transcriber]) {
      emit(["event": "preparing", "fraction": 0.0])
      let progress = request.progress
      let ticker = Task {
        while !Task.isCancelled {
          try? await Task.sleep(nanoseconds: 300_000_000)
          emit(["event": "preparing", "fraction": progress.fractionCompleted])
        }
      }
      defer { ticker.cancel() }
      try await request.downloadAndInstall()
    }
    let modules: [any SpeechModule] = [transcriber]
    guard let format = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: modules) else {
      throw NSError(domain: "relay", code: 4, userInfo: [NSLocalizedDescriptionKey: "Apple Speech gave no usable audio format."])
    }
    let analyzer = SpeechAnalyzer(modules: modules, options: .init(priority: .high, modelRetention: .lingering))
    if !vocabulary.isEmpty {
      let context = AnalysisContext()
      context.contextualStrings[.general] = vocabulary
      try? await analyzer.setContext(context)
    }
    try await analyzer.prepareToAnalyze(in: format)
    return Prepared(locale: locale, transcriber: transcriber, analyzer: analyzer, format: format)
  }

  func start(device pref: String?) async throws {
    guard mic == nil else { return }
    let p = try await ensurePrepared()
    prepared = nil
    let (stream, continuation) = AsyncStream.makeStream(of: AnalyzerInput.self, bufferingPolicy: .bufferingNewest(64))
    self.continuation = continuation
    latest = ""
    resultTask = Task {
      var acc = Accumulator()
      for try await result in p.transcriber.results {
        acc.receive(String(result.text.characters), isFinal: result.isFinal)
        emit(["event": "partial", "text": acc.text])
        await self.setLatest(acc.text)
      }
      return acc.text
    }
    activeAnalyzer = p.analyzer
    let mic = Mic(output: p.format, continuation: continuation, device: resolveInput(pref)?.id)
    self.mic = mic
    do {
      // Capture first: Bluetooth inputs can take a moment, and the stream keeps early buffers.
      try mic.start()
      emit(["event": "listening"])
      try await p.analyzer.start(inputSequence: stream)
    } catch {
      await teardown(cancel: true)
      throw error
    }
  }

  private func setLatest(_ t: String) { latest = t }

  func stop() async throws -> String {
    guard let mic, let continuation, let analyzer = activeAnalyzer, let resultTask else { return "" }
    self.mic = nil
    mic.stop()
    continuation.finish()
    var text = latest
    do {
      try await analyzer.finalizeAndFinishThroughEndOfInput()
      text = try await resultTask.value
    } catch {
      resultTask.cancel()
    }
    self.continuation = nil
    self.resultTask = nil
    self.activeAnalyzer = nil
    Task { try? await self.prepare(localeID: nil) }
    return text
  }

  func cancel() async { await teardown(cancel: true) }

  private func teardown(cancel: Bool) async {
    mic?.stop()
    mic = nil
    continuation?.finish()
    continuation = nil
    if let a = activeAnalyzer { await a.cancelAndFinishNow() }
    activeAnalyzer = nil
    resultTask?.cancel()
    resultTask = nil
    Task { try? await self.prepare(localeID: nil) }
  }

  // Transcribes an audio file through the same pipeline. Used for testing without a microphone.
  func transcribe(file path: String) async throws -> String {
    let p = try await ensurePrepared()
    prepared = nil
    let audio = try AVAudioFile(forReading: URL(fileURLWithPath: path))
    let (stream, continuation) = AsyncStream.makeStream(of: AnalyzerInput.self)
    let results = Task { () -> String in
      var acc = Accumulator()
      for try await r in p.transcriber.results { acc.receive(String(r.text.characters), isFinal: r.isFinal) }
      return acc.text
    }
    let converter = AVAudioConverter(from: audio.processingFormat, to: p.format)!
    try await p.analyzer.start(inputSequence: stream)
    let frames: AVAudioFrameCount = 4096
    while audio.framePosition < audio.length {
      guard let buf = AVAudioPCMBuffer(pcmFormat: audio.processingFormat, frameCapacity: frames) else { break }
      try audio.read(into: buf, frameCount: frames)
      if buf.frameLength == 0 { break }
      let ratio = p.format.sampleRate / audio.processingFormat.sampleRate
      guard let out = AVAudioPCMBuffer(pcmFormat: p.format, frameCapacity: AVAudioFrameCount(Double(buf.frameLength) * ratio) + 64) else { break }
      var supplied = false
      var err: NSError?
      converter.convert(to: out, error: &err) { _, status in
        if supplied { status.pointee = .noDataNow; return nil }
        supplied = true
        status.pointee = .haveData
        return buf
      }
      if out.frameLength > 0 { continuation.yield(AnalyzerInput(buffer: out)) }
    }
    continuation.finish()
    try await p.analyzer.finalizeAndFinishThroughEndOfInput()
    return try await results.value
  }
}

// MARK: - main

@main
struct RelaySpeech {
  static func main() async {
    guard #available(macOS 26.0, *) else {
      fail("Dictation needs macOS 26 or later.", code: "unsupported")
      return
    }
    setvbuf(stdout, nil, _IOLBF, 0)
    let engine = Engine()
    let args = CommandLine.arguments

    if let i = args.firstIndex(of: "--file"), i + 1 < args.count {
      do {
        let text = try await engine.transcribe(file: args[i + 1])
        print(text)
      } catch {
        FileHandle.standardError.write(Data("error: \(error)\n".utf8))
        exit(1)
      }
      return
    }

    emit(["event": "ready"])

    // Read commands one at a time, in order.
    let lines = AsyncStream<String> { cont in
      Thread.detachNewThread {
        while let line = readLine(strippingNewline: true) { cont.yield(line) }
        cont.finish()
      }
    }

    for await line in lines {
      guard let data = line.data(using: .utf8),
        let msg = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
        let cmd = msg["cmd"] as? String
      else { continue }
      switch cmd {
      case "prepare":
        if let words = msg["vocabulary"] as? [String] { await engine.setVocabulary(words) }
        do {
          try await engine.prepare(localeID: msg["locale"] as? String)
          emit(["event": "prepared"])
        } catch { fail(error.localizedDescription, code: "prepare") }
      case "start":
        do { try await engine.start(device: msg["device"] as? String) } catch { fail(error.localizedDescription, code: "start") }
      case "stop":
        do {
          let text = try await engine.stop()
          emit(["event": "final", "text": text])
        } catch { fail(error.localizedDescription, code: "stop") }
      case "cancel":
        await engine.cancel()
        emit(["event": "cancelled"])
      case "devices":
        let list = allInputDevices().map { ["uid": $0.uid, "name": $0.name, "builtIn": $0.builtIn, "bluetooth": $0.bluetooth] as [String: Any] }
        emit(["event": "devices", "default": defaultInputName() ?? NSNull(), "using": resolveInput(msg["pref"] as? String)?.name ?? NSNull(), "list": list])
      case "permissions":
        emit(["event": "permissions", "mic": micStatus(), "speech": speechStatus()])
      case "request-permissions":
        await requestPermissions()
        emit(["event": "permissions", "mic": micStatus(), "speech": speechStatus()])
      case "locales":
        emit(["event": "locales", "list": await engine.locales()])
      case "brightness":
        emit(brightness(set: msg["set"] as? Double))
      case "quit":
        await engine.cancel()
        exit(0)
      default:
        break
      }
    }
  }
}
