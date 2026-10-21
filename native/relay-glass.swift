// relay-glass: the see-through "liquid glass" behind Relay's pill. A borderless, click-through panel holding
// a real NSGlassEffectView (macOS 26) that follows a rectangle the app tells it about. The pill's text is drawn
// by the app's own transparent window just above it.
//
// Commands (JSON lines on stdin; rectangles are screen points with the origin at the top left):
//   {"cmd":"show","rect":{x,y,w,h},"notch":{x,y,w,h},"radius":27}  drop out of the notch into rect
//   {"cmd":"frame","rect":{x,y,w,h},"radius":27}                    morph to a new rectangle
//   {"cmd":"hide","notch":{x,y,w,h}}                                 retract into the notch and disappear
//   {"cmd":"tint","alpha":0.45}                                      how dark the glass is
//   {"cmd":"quit"}

import AppKit

struct R {
  var x: Double, y: Double, w: Double, h: Double
  init?(_ d: Any?) {
    guard let d = d as? [String: Any], let x = (d["x"] as? NSNumber)?.doubleValue, let y = (d["y"] as? NSNumber)?.doubleValue,
      let w = (d["w"] as? NSNumber)?.doubleValue, let h = (d["h"] as? NSNumber)?.doubleValue else { return nil }
    self.x = x; self.y = y; self.w = w; self.h = h
  }
}

final class GlassPanel: NSPanel {
  override var canBecomeKey: Bool { false }
  override var canBecomeMain: Bool { false }
  // Let the drop start above the top edge of the screen, behind the notch.
  override func constrainFrameRect(_ frameRect: NSRect, to screen: NSScreen?) -> NSRect { frameRect }
}

final class Controller {
  let panel: GlassPanel
  let glass: NSView
  var tintAlpha: CGFloat = 0.45

  init() {
    panel = GlassPanel(contentRect: NSRect(x: 0, y: 0, width: 200, height: 56), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
    panel.isOpaque = false
    panel.backgroundColor = .clear
    panel.hasShadow = true
    panel.isReleasedWhenClosed = false
    panel.ignoresMouseEvents = true
    panel.level = NSWindow.Level(rawValue: 999) // just below the app's own pill window (1000)
    panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
    if #available(macOS 26.0, *) {
      let g = NSGlassEffectView()
      g.cornerRadius = 27
      g.style = .regular
      glass = g
    } else {
      let v = NSVisualEffectView()
      v.material = .hudWindow
      v.blendingMode = .behindWindow
      v.state = .active
      v.wantsLayer = true
      v.layer?.cornerRadius = 27
      v.layer?.masksToBounds = true
      glass = v
    }
    glass.frame = panel.contentView!.bounds
    glass.autoresizingMask = [.width, .height]
    panel.contentView!.addSubview(glass)
    applyTint()
  }

  func applyTint() {
    if #available(macOS 26.0, *), let g = glass as? NSGlassEffectView {
      // Dark glass, so the white text stays readable over a bright wallpaper.
      g.tintColor = NSColor(calibratedWhite: 0.04, alpha: tintAlpha)
    }
  }

  func radius(_ r: Double) {
    if #available(macOS 26.0, *), let g = glass as? NSGlassEffectView { g.cornerRadius = CGFloat(r) }
    else { glass.layer?.cornerRadius = CGFloat(r) }
  }

  // The app's coordinates have their origin at the top left of the main display; AppKit's at the bottom left.
  func ns(_ r: R) -> NSRect {
    let height = NSScreen.screens.first?.frame.height ?? 0
    return NSRect(x: r.x, y: height - r.y - r.h, width: r.w, height: r.h)
  }

  func animate(to r: R, duration: Double, alpha: CGFloat, done: (() -> Void)? = nil) {
    NSAnimationContext.runAnimationGroup({ ctx in
      ctx.duration = duration
      ctx.timingFunction = CAMediaTimingFunction(controlPoints: 0.2, 1.12, 0.3, 1.0)
      ctx.allowsImplicitAnimation = true
      panel.animator().setFrame(ns(r), display: true)
      panel.animator().alphaValue = alpha
    }, completionHandler: done)
  }

  func handle(_ m: [String: Any]) {
    switch m["cmd"] as? String {
    case "show":
      guard let rect = R(m["rect"]), let notch = R(m["notch"]) else { return }
      radius(m["radius"] as? Double ?? 27)
      panel.alphaValue = 0
      panel.setFrame(ns(notch), display: false)
      panel.orderFrontRegardless()
      animate(to: rect, duration: 0.5, alpha: 1)
    case "frame":
      guard let rect = R(m["rect"]) else { return }
      radius(m["radius"] as? Double ?? 27)
      animate(to: rect, duration: 0.36, alpha: 1)
    case "hide":
      guard let notch = R(m["notch"]) else { panel.orderOut(nil); return }
      animate(to: notch, duration: 0.28, alpha: 0) { [weak self] in
        if (self?.panel.alphaValue ?? 0) < 0.05 { self?.panel.orderOut(nil) }
      }
    case "tint":
      tintAlpha = CGFloat((m["alpha"] as? Double) ?? 0.45)
      applyTint()
    case "quit":
      exit(0)
    default:
      break
    }
  }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let controller = Controller()

Thread.detachNewThread {
  while let line = readLine(strippingNewline: true) {
    guard let data = line.data(using: .utf8), let msg = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { continue }
    DispatchQueue.main.async { controller.handle(msg) }
  }
  exit(0) // the app closed its end: nothing left to draw for
}

FileHandle.standardOutput.write(Data("{\"event\":\"ready\"}\n".utf8))
app.run()
