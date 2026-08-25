#!/usr/bin/env swift

import AppKit
import Foundation

guard CommandLine.arguments.count == 3 else {
    fputs("Usage: generate-icns.swift <source.png> <output.icns>\n", stderr)
    exit(2)
}

let sourceURL = URL(fileURLWithPath: CommandLine.arguments[1])
let outputURL = URL(fileURLWithPath: CommandLine.arguments[2])
guard let source = NSImage(contentsOf: sourceURL) else {
    fputs("Could not read source icon.\n", stderr)
    exit(1)
}

func png(size: Int) -> Data? {
    guard let bitmap = NSBitmapImageRep(
        bitmapDataPlanes: nil,
        pixelsWide: size,
        pixelsHigh: size,
        bitsPerSample: 8,
        samplesPerPixel: 4,
        hasAlpha: true,
        isPlanar: false,
        colorSpaceName: .deviceRGB,
        bitmapFormat: [],
        bytesPerRow: 0,
        bitsPerPixel: 0
    ), let context = NSGraphicsContext(bitmapImageRep: bitmap) else { return nil }

    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = context
    context.imageInterpolation = .high
    context.cgContext.clear(CGRect(x: 0, y: 0, width: size, height: size))
    source.draw(
        in: NSRect(x: 0, y: 0, width: size, height: size),
        from: NSRect(origin: .zero, size: source.size),
        operation: .copy,
        fraction: 1
    )
    NSGraphicsContext.restoreGraphicsState()
    return bitmap.representation(using: .png, properties: [:])
}

extension Data {
    mutating func appendBigEndian(_ value: UInt32) {
        var number = value.bigEndian
        Swift.withUnsafeBytes(of: &number) { append(contentsOf: $0) }
    }
}

let representations: [(String, Int)] = [
    ("icp4", 16),
    ("icp5", 32),
    ("icp6", 64),
    ("ic07", 128),
    ("ic08", 256),
    ("ic09", 512),
    ("ic10", 1024),
    ("ic11", 32),
    ("ic12", 64),
    ("ic13", 256),
    ("ic14", 512),
]

var chunks = Data()
for (type, size) in representations {
    guard let payload = png(size: size), let typeData = type.data(using: .ascii) else {
        fputs("Could not render \(size)x\(size) icon.\n", stderr)
        exit(1)
    }
    chunks.append(typeData)
    chunks.appendBigEndian(UInt32(payload.count + 8))
    chunks.append(payload)
}

var output = Data("icns".utf8)
output.appendBigEndian(UInt32(chunks.count + 8))
output.append(chunks)

do {
    try output.write(to: outputURL, options: .atomic)
} catch {
    fputs("Could not write ICNS: \(error)\n", stderr)
    exit(1)
}
