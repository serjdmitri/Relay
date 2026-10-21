// Draws the menu bar status icons: assets/trayListening-1/2(.png, @2x) and assets/trayWorking(.png, @2x).
// Run: swiftc -O scripts/make-status-icons.swift -o /tmp/mk && /tmp/mk assets
import AppKit

func render(_ name: String, color: NSColor, draw: (CGFloat) -> Void) {
  for scale in [1, 2] {
    let px = 18 * scale
    let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: px, pixelsHigh: px, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    rep.size = NSSize(width: 18, height: 18)
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    NSColor.clear.setFill()
    NSRect(x: 0, y: 0, width: 18, height: 18).fill()
    color.setFill()
    NSBezierPath(roundedRect: NSRect(x: 0.5, y: 2.5, width: 17, height: 13), xRadius: 5, yRadius: 5).fill()
    NSColor.white.setFill()
    draw(CGFloat(scale))
    NSGraphicsContext.restoreGraphicsState()
    let file = CommandLine.arguments[1] + "/" + name + (scale == 2 ? "@2x" : "") + ".png"
    try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: file))
  }
}

// Sound bars, centred in the badge. heights are in points.
func bars(_ heights: [CGFloat]) -> (CGFloat) -> Void {
  return { _ in
    let w: CGFloat = 1.8, gap: CGFloat = 1.5
    let total = CGFloat(heights.count) * w + CGFloat(heights.count - 1) * gap
    var x = (18 - total) / 2
    for h in heights {
      NSBezierPath(roundedRect: NSRect(x: x, y: 9 - h / 2, width: w, height: h), xRadius: w / 2, yRadius: w / 2).fill()
      x += w + gap
    }
  }
}

let red = NSColor(calibratedRed: 1.0, green: 0.27, blue: 0.23, alpha: 1)
let blue = NSColor(calibratedRed: 0.23, green: 0.51, blue: 0.96, alpha: 1)
render("trayListening-1", color: red, draw: bars([3, 6, 9, 6, 3]))
render("trayListening-2", color: red, draw: bars([6, 9, 5, 9, 6]))
render("trayWorking", color: blue) { _ in
  for i in 0..<3 {
    NSBezierPath(ovalIn: NSRect(x: 4.2 + CGFloat(i) * 4.0, y: 7.6, width: 2.8, height: 2.8)).fill()
  }
}
print("wrote status icons to", CommandLine.arguments[1])
