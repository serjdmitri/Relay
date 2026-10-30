import Foundation

// Preserve short peaks between the UI's 50 ms level updates.
struct LevelWindow {
  private var lastEmission: TimeInterval?
  private var peak: Float = 0

  mutating func push(rms: Float, now: TimeInterval) -> Float? {
    guard rms.isFinite, now.isFinite else { return nil }
    peak = max(peak, min(1, max(0, rms * 6)))
    if let last = lastEmission, now - last < 0.05 { return nil }
    let level = peak
    peak = 0
    lastEmission = now
    return level
  }
}
