// relay-ax: fast accessibility lookups and on-screen text finding for Relay.
// One-shot command line tool (no daemon). Usage:
//   relay-ax find  <app> <name> [seconds]   prints "x|y|w|h|role" in global points, or "not found"
//   relay-ax list  <app> [seconds]          prints "Role | name" lines
//   relay-ax press <app> <name> [seconds]   presses the element: "pressed" | "not found" | "failed"
//   relay-ax ocr   <png> <text> [accurate]  finds text in a picture: "nx|ny|nw|nh|text" (0..1, top-left origin) or "not found"
// System Events' "entire contents" takes tens of seconds on big or Electron apps; this walks the tree directly with a
// time limit, asks Chromium/Electron apps to build their tree, and reads text with Apple's Vision framework.
import Cocoa
import ApplicationServices
import Vision

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
guard args.count >= 3 else { fail("usage: relay-ax find|list|press <app> ... | ocr <png> <text>") }

switch args[1] {
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
