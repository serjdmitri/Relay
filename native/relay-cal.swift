// relay-cal: reads and writes Calendar events and Reminders straight from the Mac's calendar database (EventKit), so the Calendar and Reminders apps never have to be open (or in the Dock).
// One-shot command line tool. Usage:
//   relay-cal events <days>                     "Title | Saturday, November 8, 2026 at 3:00:00 PM" lines for today and the next days
//   relay-cal event-create <title> <start> [end] start/end as YYYY-MM-DD or YYYY-MM-DDTHH:MM (a date alone means 9:00; no end means one hour)
//   relay-cal rem-list                          names of open reminders
//   relay-cal rem-due                           open reminders due by the end of today (or overdue): "name | date"
//   relay-cal rem-add <title> [due] [list]      adds a reminder
//   relay-cal rem-add-id <title> [due]          adds a reminder with an alert at the due time and prints its id
//   relay-cal rem-delete <id>
//   relay-cal rem-complete <title>
import Foundation
import EventKit

setvbuf(stdout, nil, _IOLBF, 0)
func fail(_ msg: String) -> Never { FileHandle.standardError.write((msg + "\n").data(using: .utf8)!); exit(1) }

let store = EKEventStore()
let args = Array(CommandLine.arguments.dropFirst())
guard let cmd = args.first else { fail("usage: relay-cal events|event-create|rem-list|rem-due|rem-add|rem-add-id|rem-delete|rem-complete") }

func allowed(_ entity: EKEntityType) {
    let sem = DispatchSemaphore(value: 0)
    var ok = false
    let done: (Bool, Error?) -> Void = { g, _ in ok = g; sem.signal() }
    if entity == .event { store.requestFullAccessToEvents(completion: done) } else { store.requestFullAccessToReminders(completion: done) }
    _ = sem.wait(timeout: .now() + 120)
    if !ok { fail("\(entity == .event ? "Calendar" : "Reminders") access was not allowed. Allow Relay under System Settings > Privacy & Security > \(entity == .event ? "Calendars" : "Reminders").") }
}

let shown: DateFormatter = { let f = DateFormatter(); f.locale = Locale(identifier: "en_US"); f.dateFormat = "EEEE, MMMM d, yyyy 'at' h:mm:ss a"; return f }()

func parse(_ s: String) -> Date {
    let p = try! NSRegularExpression(pattern: "^(\\d{4})-(\\d{2})-(\\d{2})(?:[T ](\\d{2}):(\\d{2}))?")
    let r = NSRange(s.startIndex..., in: s)
    guard let m = p.firstMatch(in: s, range: r) else { fail("Bad date \"\(s)\". Use YYYY-MM-DD or YYYY-MM-DDTHH:MM.") }
    func n(_ i: Int, _ d: Int) -> Int { let x = m.range(at: i); return x.location == NSNotFound ? d : Int(String(s[Range(x, in: s)!]))! }
    var c = DateComponents(); c.year = n(1, 0); c.month = n(2, 0); c.day = n(3, 0); c.hour = n(4, 9); c.minute = n(5, 0)
    return Calendar.current.date(from: c)!
}

func reminders(_ done: @escaping ([EKReminder]) -> Void) {
    let sem = DispatchSemaphore(value: 0)
    var out: [EKReminder] = []
    store.fetchReminders(matching: store.predicateForIncompleteReminders(withDueDateStarting: nil, ending: nil, calendars: nil)) { out = $0 ?? []; sem.signal() }
    _ = sem.wait(timeout: .now() + 60)
    done(out)
}

func dueDate(_ r: EKReminder) -> Date? { r.dueDateComponents.flatMap { Calendar.current.date(from: $0) } }
func comps(_ d: Date) -> DateComponents { Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: d) }

func newReminder(_ title: String, _ due: String?, list: String?, alarm: Bool) -> EKReminder {
    let r = EKReminder(eventStore: store)
    r.title = title
    if let name = list, let l = store.calendars(for: .reminder).first(where: { $0.title == name }) { r.calendar = l } else { r.calendar = store.defaultCalendarForNewReminders() }
    if let d = due { let when = parse(d); r.dueDateComponents = comps(when); if alarm { r.addAlarm(EKAlarm(absoluteDate: when)) } }
    do { try store.save(r, commit: true) } catch { fail("Could not save the reminder: \(error.localizedDescription)") }
    return r
}

switch cmd {
case "events":
    allowed(.event)
    let days = Int(args.count > 1 ? args[1] : "1") ?? 1
    let start = Calendar.current.startOfDay(for: Date())
    let end = Calendar.current.date(byAdding: .day, value: days, to: start)!
    let evs = store.events(matching: store.predicateForEvents(withStart: start, end: end, calendars: nil)).sorted { $0.startDate < $1.startDate }
    print(evs.map { "\($0.title ?? "(no title)") | \(shown.string(from: $0.startDate))" }.joined(separator: "\n"))
case "calendars":
    // Which calendar accounts this Mac has (Google, iCloud, Exchange...), so Relay can tell you when your Google calendar is already here. Names only.
    allowed(.event)
    print(store.calendars(for: .event).filter { $0.type != .subscription && $0.type != .birthday }.map { "\($0.source.title)|\($0.title)|\($0.allowsContentModifications ? "writable" : "read-only")" }.joined(separator: "\n"))
case "event-create":
    guard args.count >= 3 else { fail("event-create <title> <start> [end]") }
    allowed(.event)
    let s = parse(args[2]); let e = args.count > 3 && !args[3].isEmpty ? parse(args[3]) : s.addingTimeInterval(3600)
    let ev = EKEvent(eventStore: store); ev.title = args[1]; ev.startDate = s; ev.endDate = e
    if let c = store.defaultCalendarForNewEvents, c.allowsContentModifications { ev.calendar = c }
    else if let c = store.calendars(for: .event).first(where: { $0.allowsContentModifications }) { ev.calendar = c }
    else { fail("No calendar that can be changed.") }
    do { try store.save(ev, span: .thisEvent, commit: true) } catch { fail("Could not save the event: \(error.localizedDescription)") }
    print(ev.eventIdentifier ?? "") // so the caller can undo it
case "event-delete":
    guard args.count >= 2 else { fail("event-delete <id>") }
    allowed(.event)
    guard let ev = store.event(withIdentifier: args[1]) else { fail("No event with that id.") }
    do { try store.remove(ev, span: .thisEvent, commit: true) } catch { fail("Could not delete: \(error.localizedDescription)") }
case "rem-list":
    allowed(.reminder)
    reminders { print($0.map { $0.title ?? "" }.joined(separator: "\n")) }
case "rem-due":
    allowed(.reminder)
    let tomorrow = Calendar.current.date(byAdding: .day, value: 1, to: Calendar.current.startOfDay(for: Date()))!
    reminders { rs in print(rs.compactMap { r -> String? in if let d = dueDate(r), d < tomorrow { return "\(r.title ?? "") | \(shown.string(from: d))" }; return nil }.joined(separator: "\n")) }
case "rem-add":
    guard args.count >= 2 else { fail("rem-add <title> [due] [list]") }
    allowed(.reminder)
    print(newReminder(args[1], args.count > 2 && !args[2].isEmpty ? args[2] : nil, list: args.count > 3 && !args[3].isEmpty ? args[3] : nil, alarm: false).calendarItemIdentifier) // so the caller can undo it
case "rem-add-id":
    guard args.count >= 2 else { fail("rem-add-id <title> [due]") }
    allowed(.reminder)
    print(newReminder(args[1], args.count > 2 && !args[2].isEmpty ? args[2] : nil, list: nil, alarm: true).calendarItemIdentifier)
case "rem-delete":
    guard args.count >= 2 else { fail("rem-delete <id>") }
    allowed(.reminder)
    guard let r = store.calendarItem(withIdentifier: args[1]) as? EKReminder else { fail("No reminder with that id.") }
    do { try store.remove(r, commit: true) } catch { fail("Could not delete: \(error.localizedDescription)") }
case "rem-complete":
    guard args.count >= 2 else { fail("rem-complete <title>") }
    allowed(.reminder)
    reminders { rs in
        guard let r = rs.first(where: { $0.title == args[1] }) else { print("No open reminder with that exact name."); return }
        r.isCompleted = true
        do { try store.save(r, commit: true); print("Completed.") } catch { fail("Could not complete: \(error.localizedDescription)") }
    }
default: fail("unknown command \(cmd)")
}
