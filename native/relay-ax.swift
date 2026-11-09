// relay-ax: fast accessibility lookups and on-screen text finding for Relay.
// One-shot command line tool (no daemon). Usage:
//   relay-ax find  <app> <name> [seconds]   prints "x|y|w|h|role" in global points, or "not found"
//   relay-ax list  <app> [seconds]          prints "Role | name" lines
//   relay-ax press <app> <name> [seconds]   presses the element: "pressed" | "not found" | "failed"
//   relay-ax tabs  <app> [seconds]          prints one line per browser tab: "1|title" for the selected one, "0|title" for the rest
//   relay-ax focused                        prints the front app's name, then the text of the focused text field (not a password field)
//   relay-ax text  <png>                    prints every line of text in a picture
//   relay-ax ocr   <png> <text> [accurate]  finds text in a picture: "nx|ny|nw|nh|text" (0..1, top-left origin) or "not found"
// System Events' "entire contents" takes tens of seconds on big or Electron apps; this walks the tree directly with a
// time limit, asks Chromium/Electron apps to build their tree, and reads text with Apple's Vision framework.
import Cocoa
import ApplicationServices
import Vision
import LocalAuthentication

setvbuf(stdout, nil, _IOLBF, 0)

func fail(_ msg: String) -> Never {
    FileHandle.standardError.write((msg + "\n").data(using: .utf8)!)
    exit(1)
}

func runningApp(named name: String) -> NSRunningApplication? {
    let want = name.lowercased()
    let apps = NSWorkspace.shared.runningApplications.filter { $0.activationPolicy != .prohibited }
    return apps.first { ($0.localizedName ?? "").lowercased() == want }
        ?? apps.first { ($0.bundleIdentifier ?? "").lowercased() == want }
        ?? apps.first { ($0.localizedName ?? "").lowercased().contains(want) }
}

func attr(_ e: AXUIElement, _ k: String) -> CFTypeRef? {
    var v: CFTypeRef?
    return AXUIElementCopyAttributeValue(e, k as CFString, &v) == .success ? v : nil
}

func text(_ e: AXUIElement, _ k: String) -> String? {
    guard let v = attr(e, k) else { return nil }
    if let s = v as? String {
        let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
        return t.isEmpty ? nil : t
    }
    return nil
}

func frame(_ e: AXUIElement) -> CGRect? {
    guard let p = attr(e, kAXPositionAttribute as String), let s = attr(e, kAXSizeAttribute as String) else { return nil }
    var pt = CGPoint.zero, sz = CGSize.zero
    guard AXValueGetValue(p as! AXValue, .cgPoint, &pt), AXValueGetValue(s as! AXValue, .cgSize, &sz) else { return nil }
    return CGRect(origin: pt, size: sz)
}

// Every name an element can be known by, first the one ui_list shows.
func names(_ e: AXUIElement) -> [String] {
    var out: [String] = []
    for k in [kAXTitleAttribute, kAXDescriptionAttribute, kAXValueAttribute, kAXHelpAttribute, kAXPlaceholderValueAttribute, "AXLabel", kAXIdentifierAttribute] {
        if let t = text(e, k as String), t.count <= 200 { out.append(t) }
    }
    return out
}

struct Node { let el: AXUIElement; let role: String; let names: [String]; let frame: CGRect? }

// Breadth first over the windows, the focused window first, stopping at the deadline or the node limit.
func walk(_ app: AXUIElement, deadline: Date, limit: Int = 6000, visit: (Node) -> Bool) {
    var roots: [AXUIElement] = []
    if let f = attr(app, kAXFocusedWindowAttribute as String) { roots.append(f as! AXUIElement) }
    if let ws = attr(app, kAXWindowsAttribute as String) as? [AXUIElement] {
        for w in ws where !roots.contains(where: { CFEqual($0, w) }) { roots.append(w) }
    }
    if let mb = attr(app, kAXMenuBarAttribute as String) { roots.append(mb as! AXUIElement) }
    var queue = roots
    var i = 0
    var seen = 0
    while i < queue.count, seen < limit, Date() < deadline {
        let e = queue[i]; i += 1; seen += 1
        let role = text(e, kAXRoleAttribute as String) ?? ""
        if visit(Node(el: e, role: role, names: names(e), frame: frame(e))) { return }
        if let kids = attr(e, kAXChildrenAttribute as String) as? [AXUIElement] { queue.append(contentsOf: kids) }
    }
}

func openApp(_ name: String) -> AXUIElement {
    guard AXIsProcessTrusted() else { fail("Accessibility is not allowed for Relay.") }
    guard let ra = runningApp(named: name) else { fail("\(name) is not running.") }
    let el = AXUIElementCreateApplication(ra.processIdentifier)
    AXUIElementSetMessagingTimeout(el, 0.5)
    // Chromium and Electron apps build their accessibility tree only when asked.
    AXUIElementSetAttributeValue(el, "AXManualAccessibility" as CFString, kCFBooleanTrue)
    return el
}

func find(_ appName: String, _ name: String, seconds: Double) -> Node? {
    let app = openApp(appName)
    let want = name.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    let deadline = Date().addingTimeInterval(seconds)
    var exact: Node? = nil
    var partial: Node? = nil
    for attempt in 0..<2 {
        walk(app, deadline: deadline) { n in
            guard let f = n.frame, f.width > 1, f.height > 1 else { return false }
            let lower = n.names.map { $0.lowercased() }
            if lower.contains(want) { exact = n; return true }
            if partial == nil, want.count >= 3, lower.contains(where: { $0.contains(want) }) { partial = n }
            return false
        }
        if exact != nil || partial != nil || attempt == 1 || Date() >= deadline { break }
        Thread.sleep(forTimeInterval: 0.3) // a freshly asked Electron app needs a moment
    }
    return exact ?? partial
}

func num(_ v: CGFloat) -> String { String(format: "%.1f", Double(v)) }

let args = CommandLine.arguments
guard args.count >= 2 else { fail("usage: relay-ax find|list|press <app> ... | ocr <png> <text> | focused") }

switch args[1] {
case "authenticate-owner":
    let context = LAContext()
    var error: NSError?
    guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error) else { fail("Mac owner authentication is unavailable") }
    context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: "Manage Jarvis authorized face profiles") { success, _ in
        print(success ? "authenticated" : "cancelled")
        exit(success ? 0 : 1)
    }
    RunLoop.main.run()
case "border-geometry":
    // Only geometry is returned; window titles and screen contents never leave this process.
    let mainTop = NSScreen.screens.first?.frame.maxY ?? 0
    var notches: [[String: Double]] = []
    if #available(macOS 12.0, *) {
        for s in NSScreen.screens {
            guard s.safeAreaInsets.top > 0, let left = s.auxiliaryTopLeftArea, let right = s.auxiliaryTopRightArea else { continue }
            let width = right.minX - left.maxX
            if width > 0 {
                notches.append(["x": left.maxX, "y": mainTop - s.frame.maxY, "width": width, "height": s.safeAreaInsets.top])
            }
        }
    }
    let windows = (CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]]) ?? []
    let tuckr = windows.compactMap { w -> [String: Double]? in
        guard let owner = w[kCGWindowOwnerName as String] as? String, owner.lowercased().contains("tuckr"),
              let b = w[kCGWindowBounds as String] as? [String: Any],
              let x = (b["X"] as? NSNumber)?.doubleValue, let y = (b["Y"] as? NSNumber)?.doubleValue,
              let width = (b["Width"] as? NSNumber)?.doubleValue, let height = (b["Height"] as? NSNumber)?.doubleValue,
              width > 60, height > 30 else { return nil }
        return ["x": x, "y": y, "width": width, "height": height]
    }
    let result: [String: Any] = ["notches": notches, "tuckr": tuckr]
    if let data = try? JSONSerialization.data(withJSONObject: result), let json = String(data: data, encoding: .utf8) { print(json) }
case "hand-drag":
    let trustOptions = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
    guard AXIsProcessTrustedWithOptions(trustOptions) else { fail("Allow Relay’s hand-drag helper in System Settings > Privacy & Security > Accessibility, then try again.") }
    var held = false
    var last = CGPoint.zero
    func emit(_ type: CGEventType, _ point: CGPoint) {
        guard let event = CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: point, mouseButton: .left) else { return }
        event.post(tap: .cghidEventTap)
    }
    func eligible(_ point: CGPoint) -> Bool {
        guard let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else { return false }
        for w in windows {
            guard (w[kCGWindowLayer as String] as? Int) == 0,
                  let bounds = w[kCGWindowBounds as String] as? [String: Any],
                  let rect = CGRect(dictionaryRepresentation: bounds as CFDictionary), rect.contains(point) else { continue }
            let owner = (w[kCGWindowOwnerName as String] as? String ?? "").lowercased()
            if owner == "relay" || owner == "finder" && rect.height < 100 { return false }
            return point.y <= rect.minY + min(110, rect.height * 0.3)
        }
        return false
    }
    let browserIds: Set<String> = ["org.mozilla.firefox", "org.mozilla.firefoxdeveloperedition", "org.mozilla.nightly", "com.apple.Safari", "com.apple.SafariTechnologyPreview", "com.google.Chrome", "com.google.Chrome.canary", "company.thebrowser.Browser", "com.brave.Browser", "com.microsoft.edgemac", "org.chromium.Chromium", "com.vivaldi.Vivaldi", "com.operasoftware.Opera"]
    func frontIsBrowser() -> Bool {
        guard let id = NSWorkspace.shared.frontmostApplication?.bundleIdentifier else { return false }
        return browserIds.contains(id)
    }
    // Key codes of 1 to 9 on a Mac keyboard. Command+1 to 8 is "tab N" and Command+9 is "the last tab" in every browser above.
    let digitKeys: [Int: CGKeyCode] = [1: 18, 2: 19, 3: 20, 4: 21, 5: 23, 6: 22, 7: 26, 8: 28, 9: 25]
    func pressCommand(_ key: CGKeyCode) {
        for down in [true, false] {
            guard let e = CGEvent(keyboardEventSource: nil, virtualKey: key, keyDown: down) else { continue }
            e.flags = .maskCommand
            e.post(tap: .cghidEventTap)
        }
    }
    func relayOwnsTop(_ point: CGPoint) -> Bool {
        guard let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else { return false }
        for w in windows {
            guard (w[kCGWindowLayer as String] as? Int) == 0,
                  let bounds = w[kCGWindowBounds as String] as? [String: Any],
                  let rect = CGRect(dictionaryRepresentation: bounds as CFDictionary), rect.contains(point) else { continue }
            return (w[kCGWindowOwnerName as String] as? String ?? "").lowercased() == "relay"
        }
        return false
    }
    var lastClickAt = Date.distantPast
    var lastClickPoint = CGPoint.zero
    var lastClickCount = 0
    // Two pinch taps close together on the same spot make a double click, three a triple.
    func emitClick(_ point: CGPoint) {
        let now = Date()
        let again = now.timeIntervalSince(lastClickAt) < 0.45 && hypot(point.x - lastClickPoint.x, point.y - lastClickPoint.y) < 8
        let count = again ? min(lastClickCount + 1, 3) : 1
        lastClickAt = now; lastClickPoint = point; lastClickCount = count
        for type in [CGEventType.leftMouseDown, CGEventType.leftMouseUp] {
            guard let event = CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: point, mouseButton: .left) else { continue }
            event.setIntegerValueField(.mouseEventClickState, value: Int64(count))
            event.post(tap: .cghidEventTap)
        }
    }
    print("ready")
    while let line = readLine() {
        guard let data = line.data(using: .utf8), let m = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let op = m["op"] as? String else { continue }
        // Questions that need no position: is a web browser in front, and press Command+number in it (the browser's own "go to tab N").
        if op == "front" { print(frontIsBrowser() ? "front:browser" : "front:other"); continue }
        if op == "tab" {
            if let n = m["n"] as? Int, let key = digitKeys[n], frontIsBrowser() { pressCommand(key); print("tab:\(n)") } else { print("tab:declined") }
            continue
        }
        guard let x = m["x"] as? Double, let y = m["y"] as? Double,
              x.isFinite, y.isFinite, abs(x) < 100000, abs(y) < 100000 else { continue }
        let point = CGPoint(x: x, y: y)
        switch op {
        case "click":
            // A pinch tap: one ordinary click where the hand points, never on Relay's own windows (those get their clicks another way).
            if held || relayOwnsTop(point) { print("click-declined") }
            else { emit(.mouseMoved, point); emitClick(point); print("clicked") }
        case "down":
            if !held && eligible(point) { emit(.mouseMoved, point); emit(.leftMouseDown, point); held = true; last = point; print("down") }
            else { print("not-draggable") }
        case "move":
            if held { emit(.leftMouseDragged, point); last = point }
        case "up":
            if held { emit(.leftMouseUp, point); held = false; last = point; print("up") }
        default: break
        }
    }
    if held { emit(.leftMouseUp, last) }
case "find":
    guard args.count >= 4 else { fail("usage: relay-ax find <app> <name> [seconds]") }
    let secs = args.count > 4 ? Double(args[4]) ?? 2.5 : 2.5
    if let n = find(args[2], args[3], seconds: secs), let f = n.frame {
        print("\(num(f.origin.x))|\(num(f.origin.y))|\(num(f.width))|\(num(f.height))|\(n.role)")
    } else { print("not found") }
case "list":
    let secs = args.count > 3 ? Double(args[3]) ?? 2.5 : 2.5
    let app = openApp(args[2])
    var lines: [String] = []
    var seen = Set<String>()
    for attempt in 0..<2 {
        walk(app, deadline: Date().addingTimeInterval(secs)) { n in
            if let f = n.frame, f.width > 1, f.height > 1, let first = n.names.first {
                let line = "\(n.role) | \(first)"
                if seen.insert(line).inserted { lines.append(line) }
            }
            return lines.count >= 150
        }
        if !lines.isEmpty || attempt == 1 { break }
        Thread.sleep(forTimeInterval: 0.3)
    }
    print(lines.isEmpty ? "No named UI elements found." : lines.joined(separator: "\n"))
case "press":
    guard args.count >= 4 else { fail("usage: relay-ax press <app> <name> [seconds]") }
    let secs = args.count > 4 ? Double(args[4]) ?? 2.5 : 2.5
    if let n = find(args[2], args[3], seconds: secs) {
        print(AXUIElementPerformAction(n.el, kAXPressAction as CFString) == .success ? "pressed" : "failed")
    } else { print("not found") }
case "tabs":
    // Browser tabs are radio buttons in the tab strip (Firefox and Safari expose them; Chromium browsers do too once asked).
    let tsecs = args.count > 3 ? Double(args[3]) ?? 2.5 : 2.5
    let tapp = openApp(args[2])
    var tabLines: [String] = []
    for attempt in 0..<2 {
        walk(tapp, deadline: Date().addingTimeInterval(tsecs)) { n in
            if n.role == "AXRadioButton", let f = n.frame, f.width > 20, let title = n.names.first {
                let v = attr(n.el, kAXValueAttribute as String)
                let on = (v as? NSNumber)?.intValue == 1
                tabLines.append("\(on ? 1 : 0)|\(title)")
            }
            return false
        }
        if !tabLines.isEmpty || attempt == 1 { break }
        Thread.sleep(forTimeInterval: 0.3)
    }
    print(tabLines.joined(separator: "\n"))
case "focused":
    // For learning from corrections: the text in the field you are typing in. Password fields are never read.
    let front = NSWorkspace.shared.frontmostApplication?.localizedName ?? ""
    // Ask the front app itself: the system-wide element is not always answered.
    var focus: CFTypeRef? = nil
    if let pid = NSWorkspace.shared.frontmostApplication?.processIdentifier { focus = attr(AXUIElementCreateApplication(pid), kAXFocusedUIElementAttribute as String) }
    if focus == nil { focus = attr(AXUIElementCreateSystemWide(), kAXFocusedUIElementAttribute as String) }
    guard let f = focus else { print("\(front)\nnone"); break }
    let el = f as! AXUIElement
    if (attr(el, kAXSubroleAttribute as String) as? String) == "AXSecureTextField" { print("\(front)\nnone"); break }
    if let v = attr(el, kAXValueAttribute as String) as? String, v.count <= 40000 { print("\(front)\n\(v)") } else { print("\(front)\nnone") }
case "text":
    guard args.count >= 3, let timg = NSImage(contentsOfFile: args[2]), let tcg = timg.cgImage(forProposedRect: nil, context: nil, hints: nil) else { fail("Could not read the picture.") }
    let treq = VNRecognizeTextRequest()
    treq.recognitionLevel = .accurate
    treq.usesLanguageCorrection = true
    do { try VNImageRequestHandler(cgImage: tcg, options: [:]).perform([treq]) } catch { fail("Text recognition failed: \(error.localizedDescription)") }
    let ordered = (treq.results ?? []).sorted { $0.boundingBox.origin.y > $1.boundingBox.origin.y }
    print(ordered.compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n"))
case "ocr":
    guard args.count >= 4 else { fail("usage: relay-ax ocr <png> <text>") }
    guard let img = NSImage(contentsOfFile: args[2]), let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else { fail("Could not read the picture.") }
    let want = args[3].trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    // Full retina pictures are slow to read; shrinking to about 1800 px wide keeps normal UI text readable and is far faster.
    var pic = cg
    if cg.width > 1800, let ctx = CGContext(data: nil, width: 1800, height: cg.height * 1800 / cg.width, bitsPerComponent: 8, bytesPerRow: 0,
                                            space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) {
        ctx.interpolationQuality = .high
        ctx.draw(cg, in: CGRect(x: 0, y: 0, width: ctx.width, height: ctx.height))
        if let small = ctx.makeImage() { pic = small }
    }
    let req = VNRecognizeTextRequest()
    req.recognitionLevel = args.count > 4 && args[4] == "accurate" ? .accurate : .fast
    req.usesLanguageCorrection = false
    do { try VNImageRequestHandler(cgImage: pic, options: [:]).perform([req]) } catch { fail("Text recognition failed: \(error.localizedDescription)") }
    var best: (VNRecognizedTextObservation, String, Int)? = nil // lower is better: 0 exact, else extra characters
    for o in req.results ?? [] {
        guard let c = o.topCandidates(1).first else { continue }
        let t = c.string.trimmingCharacters(in: .whitespacesAndNewlines)
        let l = t.lowercased()
        var score = -1
        if l == want { score = 0 } else if l.contains(want) { score = l.count - want.count + 1 }
        if score >= 0, best == nil || score < best!.2 {
            // The box of just the matched words when the line holds more.
            best = (o, t, score)
        }
    }
    if let (o, t, _) = best {
        var box = o.boundingBox
        if let c = o.topCandidates(1).first, let r = c.string.lowercased().range(of: want), t.lowercased() != want,
           let sub = try? c.boundingBox(for: r) { box = sub.boundingBox }
        print("\(box.origin.x)|\(1 - box.origin.y - box.height)|\(box.width)|\(box.height)|\(t)")
    } else { print("not found") }
default:
    fail("unknown command \(args[1])")
}
