import Foundation

@main struct LevelWindowTests {
  static func main() {
    var window = LevelWindow()
    precondition(window.push(rms: 0.01, now: 1.0)! > 0)
    precondition(window.push(rms: 0.15, now: 1.01) == nil)
    precondition(window.push(rms: 0.01, now: 1.02) == nil)
    precondition(window.push(rms: 0.01, now: 1.06)! > 0.8, "short peak must be preserved")
    precondition(window.push(rms: 0, now: 1.12) == 0, "peak must reset after emission")
    precondition(window.push(rms: .nan, now: 1.2) == nil)
    print("Level window preserves short peaks and resets.")
  }
}
