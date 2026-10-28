// relay-embed: on-device text embeddings (Apple NaturalLanguage) and PDF text, for "ask my notes". Nothing leaves the Mac.
//   relay-embed info            prints {"dim":N} and exits 0, or exits 2 when this Mac has no sentence embedding
//   relay-embed embed           reads a JSON array of strings on stdin, prints a JSON array of vectors (an empty vector where none could be made)
//   relay-embed pdf FILE        prints the text of a PDF (nothing for a scanned one without text)
import Foundation
import NaturalLanguage
import PDFKit

func fail(_ code: Int32) -> Never { exit(code) }

let args = CommandLine.arguments
guard args.count >= 2 else { fail(64) }

switch args[1] {
case "info":
    guard let e = NLEmbedding.sentenceEmbedding(for: .english) else { fail(2) }
    print("{\"dim\":\(e.dimension)}")
case "embed":
    guard let e = NLEmbedding.sentenceEmbedding(for: .english) else { fail(2) }
    let data = FileHandle.standardInput.readDataToEndOfFile()
    guard let texts = try? JSONSerialization.jsonObject(with: data) as? [String] else { fail(65) }
    var out: [[Double]] = []
    for t in texts {
        if let v = e.vector(for: t) { out.append(v.map { ($0 * 10000).rounded() / 10000 }) } else { out.append([]) }
    }
    let json = try JSONSerialization.data(withJSONObject: out)
    FileHandle.standardOutput.write(json)
case "pdf":
    guard args.count >= 3, let doc = PDFDocument(url: URL(fileURLWithPath: args[2])) else { fail(66) }
    print(doc.string ?? "")
default:
    fail(64)
}
