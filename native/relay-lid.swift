// relay-lid: streams the MacBook's lid angle, for "lid flick" (a quick small flick of the lid sends something to your phone).
// Apple silicon MacBooks have a lid angle sensor (a built-in HID device: usage page 0x20, usage 0x8A, vendor 0x05AC, product 0x8104).
// Reading it needs no entitlement and no privacy permission. Feature report 1 holds the angle in degrees as 16 bits, little endian.
//
// Output (JSON lines on stdout; t is wall-clock milliseconds, so a sleep shows up as a gap):
//   {"ready":true,"angle":99,"t":1700000000000}   once, when the sensor was opened
//   {"angle":101,"t":1700000000050}                whenever the angle changes, and at least once a second
//   {"error":"no-sensor"}                          this Mac has no lid angle sensor (exit code 2)
//   {"error":"open-failed","code":-536870174}      the sensor could not be opened (exit code 3)
// The sensor is read about 20 times a second, and about 100 times a second for a moment after the lid moves, so a flick is seen.
// The helper quits when its stdin closes (Relay quit) and with --once prints one reading and exits.

import Foundation
import IOKit
import IOKit.hid

setvbuf(stdout, nil, _IOLBF, 0)

func emit(_ obj: [String: Any]) {
  guard let data = try? JSONSerialization.data(withJSONObject: obj), let line = String(data: data, encoding: .utf8) else { return }
  print(line)
}

func nowMs() -> Int { Int((Date().timeIntervalSince1970 * 1000).rounded()) }

let manager = IOHIDManagerCreate(kCFAllocatorDefault, IOOptionBits(kIOHIDOptionsTypeNone))
let match: [String: Any] = [kIOHIDPrimaryUsagePageKey: 0x20, kIOHIDPrimaryUsageKey: 0x8A, kIOHIDVendorIDKey: 0x05AC]
IOHIDManagerSetDeviceMatching(manager, match as CFDictionary)
_ = IOHIDManagerOpen(manager, IOOptionBits(kIOHIDOptionsTypeNone))

guard let devices = IOHIDManagerCopyDevices(manager) as? Set<IOHIDDevice>, let device = devices.first else {
  emit(["error": "no-sensor"])
  exit(2)
}
let opened = IOHIDDeviceOpen(device, IOOptionBits(kIOHIDOptionsTypeNone))
if opened != kIOReturnSuccess {
  emit(["error": "open-failed", "code": Int(opened)])
  exit(3)
}

// The angle in degrees, or nil when the sensor did not answer (asleep, or a report of the wrong shape).
func readAngle() -> Int? {
  var buf = [UInt8](repeating: 0, count: 8)
  var len = buf.count
  let r = IOHIDDeviceGetReport(device, kIOHIDReportTypeFeature, 1, &buf, &len)
  guard r == kIOReturnSuccess, len >= 3, buf[0] == 1 else { return nil }
  let angle = Int(buf[1]) | (Int(buf[2]) << 8)
  return angle <= 360 ? angle : nil
}

if CommandLine.arguments.contains("--once") {
  if let a = readAngle() { emit(["angle": a, "t": nowMs()]); exit(0) }
  emit(["error": "no-reading"]); exit(4)
}

// Quit when Relay goes away (stdin closes).
let stdinSource = DispatchSource.makeReadSource(fileDescriptor: STDIN_FILENO, queue: .main)
stdinSource.setEventHandler {
  var scratch = [UInt8](repeating: 0, count: 256)
  if read(STDIN_FILENO, &scratch, scratch.count) <= 0 { exit(0) }
}
stdinSource.resume()

var last: Int? = nil
var lastEmit = 0
var lastMove = 0
if let a = readAngle() { last = a; lastEmit = nowMs(); emit(["ready": true, "angle": a, "t": lastEmit]) } else { emit(["ready": true, "t": nowMs()]) }

let timer = DispatchSource.makeTimerSource(queue: .main)
func schedule(_ ms: Int) { timer.schedule(deadline: .now() + .milliseconds(ms), leeway: .milliseconds(2)) }
timer.setEventHandler {
  let t = nowMs()
  if let a = readAngle() {
    if a != last { lastMove = t }
    if a != last || t - lastEmit >= 1000 { emit(["angle": a, "t": t]); lastEmit = t }
    last = a
  }
  schedule(t - lastMove < 700 ? 10 : 50)
}
schedule(50)
timer.resume()
dispatchMain()
