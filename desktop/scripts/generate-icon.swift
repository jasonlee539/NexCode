#!/usr/bin/env swift

import AppKit
import CoreGraphics
import Foundation

guard CommandLine.arguments.count == 2 else {
    fputs("Usage: generate-icon.swift <output.png>\n", stderr)
    exit(2)
}

let side = 1024
guard let bitmap = NSBitmapImageRep(
    bitmapDataPlanes: nil,
    pixelsWide: side,
    pixelsHigh: side,
    bitsPerSample: 8,
    samplesPerPixel: 4,
    hasAlpha: true,
    isPlanar: false,
    colorSpaceName: .deviceRGB,
    bitmapFormat: [],
    bytesPerRow: 0,
    bitsPerPixel: 0
), let context = NSGraphicsContext(bitmapImageRep: bitmap) else {
    fputs("Could not create icon bitmap.\n", stderr)
    exit(1)
}

NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = context
let canvas = NSRect(x: 0, y: 0, width: side, height: side)
context.cgContext.clear(canvas)

let tile = NSBezierPath(roundedRect: NSRect(x: 48, y: 48, width: 928, height: 928), xRadius: 226, yRadius: 226)
let background = NSGradient(colorsAndLocations:
    (NSColor(calibratedRed: 0.025, green: 0.075, blue: 0.105, alpha: 1), 0),
    (NSColor(calibratedRed: 0.025, green: 0.20, blue: 0.22, alpha: 1), 0.55),
    (NSColor(calibratedRed: 0.035, green: 0.42, blue: 0.40, alpha: 1), 1)
)!
background.draw(in: tile, angle: 38)

let halo = NSBezierPath(ovalIn: NSRect(x: 552, y: 536, width: 390, height: 390))
NSColor(calibratedRed: 0.18, green: 0.98, blue: 0.78, alpha: 0.11).setFill()
halo.fill()

let mark = NSBezierPath()
mark.move(to: NSPoint(x: 278, y: 260))
mark.line(to: NSPoint(x: 278, y: 744))
mark.move(to: NSPoint(x: 278, y: 744))
mark.line(to: NSPoint(x: 746, y: 278))
mark.move(to: NSPoint(x: 746, y: 278))
mark.line(to: NSPoint(x: 746, y: 744))
mark.lineWidth = 104
mark.lineCapStyle = .round
mark.lineJoinStyle = .round
NSColor(calibratedRed: 0.91, green: 1.0, blue: 0.97, alpha: 1).setStroke()
mark.stroke()

let node = NSBezierPath(ovalIn: NSRect(x: 675, y: 675, width: 142, height: 142))
NSColor(calibratedRed: 0.20, green: 0.96, blue: 0.73, alpha: 1).setFill()
node.fill()
let core = NSBezierPath(ovalIn: NSRect(x: 714, y: 714, width: 64, height: 64))
NSColor(calibratedRed: 0.02, green: 0.18, blue: 0.19, alpha: 1).setFill()
core.fill()

NSGraphicsContext.restoreGraphicsState()

guard let png = bitmap.representation(using: .png, properties: [:]) else {
    fputs("Could not encode icon PNG.\n", stderr)
    exit(1)
}

do {
    try png.write(to: URL(fileURLWithPath: CommandLine.arguments[1]), options: .atomic)
} catch {
    fputs("Could not write icon: \(error)\n", stderr)
    exit(1)
}
