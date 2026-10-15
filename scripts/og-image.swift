// Renders public/og-image.png, the 1200×630 Open Graph card, with system fonts and CoreGraphics.
// macOS only: swift scripts/og-image.swift public/og-image.png
import CoreGraphics
import CoreText
import Foundation
import ImageIO
import UniformTypeIdentifiers

let W: CGFloat = 1200
let H: CGFloat = 630
let space = CGColorSpace(name: CGColorSpace.sRGB)!
let ctx = CGContext(
  data: nil, width: Int(W), height: Int(H), bitsPerComponent: 8, bytesPerRow: 0, space: space,
  bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
ctx.setShouldAntialias(true)
ctx.setAllowsFontSmoothing(true)

func hex(_ value: UInt32, _ alpha: CGFloat = 1) -> CGColor {
  CGColor(
    srgbRed: CGFloat((value >> 16) & 0xff) / 255, green: CGFloat((value >> 8) & 0xff) / 255,
    blue: CGFloat(value & 0xff) / 255, alpha: alpha)
}
let paper = hex(0xf4ead8), light = hex(0xfffaf0), ink = hex(0x282822), muted = hex(0x625b4e)
let orange = hex(0xff4f00), orangeInk = hex(0xb23700), shadow = hex(0xe5daca)

/// Top-left coordinates, like the page and the SVG source.
func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: x, y: H - y) }
func rect(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat) -> CGRect {
  CGRect(x: x, y: H - y - h, width: w, height: h)
}
func font(_ name: String, _ size: CGFloat) -> CTFont {
  let font = CTFontCreateWithName(name as CFString, size, nil)
  let actual = CTFontCopyPostScriptName(font) as String
  precondition(actual == name, "Missing font \(name); got \(actual)")
  return font
}
@discardableResult
func text(
  _ string: String, _ font: CTFont, _ color: CGColor, x: CGFloat, baseline: CGFloat,
  tracking: CGFloat = 0
) -> CGFloat {
  let attributes: [NSAttributedString.Key: Any] = [
    NSAttributedString.Key(kCTFontAttributeName as String): font,
    NSAttributedString.Key(kCTForegroundColorAttributeName as String): color,
    NSAttributedString.Key(kCTKernAttributeName as String): tracking,
  ]
  let line = CTLineCreateWithAttributedString(
    NSAttributedString(string: string, attributes: attributes))
  ctx.textPosition = p(x, baseline)
  CTLineDraw(line, ctx)
  return CGFloat(CTLineGetTypographicBounds(line, nil, nil, nil))
}

let serif = font("IowanOldStyle-Roman", 104)
let serifItalic = font("IowanOldStyle-Italic", 104)
let sansBold = font("AvenirNext-Bold", 27)
let sansDemi = font("AvenirNext-DemiBold", 14)
let sansBand = font("AvenirNext-DemiBold", 17)
let sansBody = font("AvenirNext-Regular", 23)
let sansTag = font("AvenirNext-Bold", 13)

// Paper and the page's faint grid.
ctx.setFillColor(paper)
ctx.fill(CGRect(x: 0, y: 0, width: W, height: H))
ctx.setStrokeColor(hex(0x3a2a16, 0.06))
ctx.setLineWidth(1)
for x in stride(from: CGFloat(0), through: W, by: 42) {
  ctx.move(to: p(x + 0.5, 0)); ctx.addLine(to: p(x + 0.5, H))
}
for y in stride(from: CGFloat(0), through: H, by: 42) {
  ctx.move(to: p(0, y + 0.5)); ctx.addLine(to: p(W, y + 0.5))
}
ctx.strokePath()

// Brand: the reticle mark and wordmark from the site header.
let markX: CGFloat = 64, markY: CGFloat = 54
ctx.setStrokeColor(ink)
ctx.setLineWidth(2.5)
ctx.stroke(rect(markX, markY, 34, 34))
ctx.setLineWidth(2.2)
for (dx, dy, sx, sy) in [(8.0, 8.0, 1.0, 1.0), (26.0, 8.0, -1.0, 1.0), (8.0, 26.0, 1.0, -1.0), (26.0, 26.0, -1.0, -1.0)] {
  ctx.move(to: p(markX + dx, markY + dy))
  ctx.addLine(to: p(markX + dx + 5 * sx, markY + dy + 5 * sy))
}
ctx.strokePath()
ctx.setFillColor(orange)
ctx.fillEllipse(in: rect(markX + 11.5, markY + 11.5, 11, 11))
var cursor = markX + 50
cursor += text("image", sansBold, ink, x: cursor, baseline: markY + 26, tracking: -1.1)
cursor += text("/", sansBold, orangeInk, x: cursor, baseline: markY + 26, tracking: -1.1)
text("workbench", sansBold, ink, x: cursor, baseline: markY + 26, tracking: -1.1)

// Eyebrow.
ctx.setFillColor(orange)
ctx.fillEllipse(in: rect(66, 160, 10, 10))
let eyebrowWidth = text("A CLOUD-NATIVE IMAGE LAB", sansDemi, muted, x: 88, baseline: 170, tracking: 2.2)
text("/ OPEN SOURCE", sansDemi, orangeInk, x: 88 + eyebrowWidth + 12, baseline: 170, tracking: 2.2)

// Headline, as on the page.
text("One image.", serif, ink, x: 58, baseline: 290, tracking: -6.4)
text("Every angle.", serifItalic, orangeInk, x: 58, baseline: 392, tracking: -6.4)

// Summary.
text("Cloudflare Images recipes, AI-guided crops,", sansBody, hex(0x504c42), x: 64, baseline: 458)
text("and an auditable Workers pipeline.", sansBody, hex(0x504c42), x: 64, baseline: 492)

// The source frame: offset shadow, light card, and a heading strip.
let frame = (x: CGFloat(716), y: CGFloat(96), w: CGFloat(420), h: CGFloat(410))
ctx.setFillColor(shadow)
ctx.fill(rect(frame.x + 12, frame.y + 12, frame.w, frame.h))
ctx.setFillColor(light)
ctx.fill(rect(frame.x, frame.y, frame.w, frame.h))
ctx.setStrokeColor(ink)
ctx.setLineWidth(2)
ctx.stroke(rect(frame.x, frame.y, frame.w, frame.h))
ctx.setLineWidth(1)
ctx.move(to: p(frame.x, frame.y + 36)); ctx.addLine(to: p(frame.x + frame.w, frame.y + 36))
ctx.strokePath()
let tagFont = font("AvenirNext-DemiBold", 11)
text("THE SOURCE / 01", tagFont, muted, x: frame.x + 14, baseline: frame.y + 23, tracking: 1.6)
ctx.setFillColor(orange)
ctx.fillEllipse(in: rect(frame.x + frame.w - 128, frame.y + 14, 8, 8))
text("FOCAL POINT", tagFont, muted, x: frame.x + frame.w - 114, baseline: frame.y + 23, tracking: 1.6)

// A simplified version of the page's golden-hour city illustration.
let image = rect(frame.x + 14, frame.y + 50, frame.w - 28, frame.h - 64)
let ix = frame.x + 14, iy = frame.y + 50, iw = frame.w - 28, ih = frame.h - 64
ctx.saveGState()
ctx.clip(to: image)
let sky = CGGradient(
  colorsSpace: space, colors: [hex(0xc9d8dc), hex(0xe9d9c2), hex(0xf6d6a9)] as CFArray,
  locations: [0, 0.56, 1])!
ctx.drawLinearGradient(sky, start: p(0, iy), end: p(0, iy + ih * 0.62), options: [.drawsAfterEndLocation])
ctx.setFillColor(hex(0xfbf2d9, 0.85))
ctx.fillEllipse(in: rect(ix + iw * 0.66, iy + 34, 66, 66))
func ridge(_ color: CGColor, _ points: [(CGFloat, CGFloat)]) {
  ctx.setFillColor(color)
  ctx.move(to: p(ix, iy + ih))
  for (fx, fy) in points { ctx.addLine(to: p(ix + iw * fx, iy + ih * fy)) }
  ctx.addLine(to: p(ix + iw, iy + ih))
  ctx.closePath()
  ctx.fillPath()
}
ridge(hex(0x768c89, 0.55), [(0, 0.44), (0.09, 0.37), (0.18, 0.45), (0.3, 0.33), (0.39, 0.45), (0.47, 0.39), (0.62, 0.45), (0.76, 0.36), (0.86, 0.47), (0.95, 0.39), (1, 0.42)])
ridge(hex(0x4e6665, 0.78), [(0, 0.5), (0.11, 0.44), (0.22, 0.53), (0.36, 0.46), (0.49, 0.56), (0.63, 0.49), (0.73, 0.58), (0.88, 0.46), (1, 0.53)])
// Buildings: the editorial subject the crops are framed around.
let wall = CGGradient(colorsSpace: space, colors: [hex(0xdcc6a4), hex(0xad8b66)] as CFArray, locations: [0, 1])!
for (bx, bw, top) in [(0.18, 0.17, 0.5), (0.36, 0.2, 0.38), (0.57, 0.16, 0.47)] as [(CGFloat, CGFloat, CGFloat)] {
  let x = ix + iw * bx, w = iw * bw, y = iy + ih * top, h = ih * 0.86 - y + iy
  ctx.saveGState()
  ctx.clip(to: rect(x, y, w, h))
  ctx.drawLinearGradient(wall, start: p(x, y), end: p(x + w, y + h), options: [])
  ctx.restoreGState()
  ctx.setFillColor(hex(0x8f4f35))
  ctx.move(to: p(x - 6, y)); ctx.addLine(to: p(x + w / 2, y - w * 0.32)); ctx.addLine(to: p(x + w + 6, y))
  ctx.closePath(); ctx.fillPath()
  ctx.setFillColor(hex(0x3f4f4e, 0.72))
  for row in 0..<3 {
    for column in 0..<2 {
      ctx.fill(rect(x + w * (0.2 + 0.38 * CGFloat(column)), y + 16 + CGFloat(row) * 30, w * 0.22, 17))
    }
  }
}
ctx.setFillColor(hex(0xe9d3a9))
ctx.fill(rect(ix, iy + ih * 0.86, iw, ih * 0.05))
ctx.setFillColor(hex(0x526868))
ctx.fill(rect(ix, iy + ih * 0.91, iw, ih * 0.09))
ctx.restoreGState()

// Crop overlays around one focal point.
let focus = p(ix + iw * 0.46, iy + ih * 0.5)
func crop(_ label: String, _ w: CGFloat, _ h: CGFloat, color: CGColor, dash: [CGFloat], labelFill: CGColor, labelInk: CGColor) {
  let x = min(max(focus.x - w / 2, ix + 4), ix + iw - w - 4)
  let yTop = min(max((H - focus.y) - h / 2, iy + 4), iy + ih - h - 4)
  ctx.setStrokeColor(color)
  ctx.setLineWidth(2.5)
  ctx.setLineDash(phase: 0, lengths: dash)
  ctx.stroke(rect(x, yTop, w, h))
  ctx.setLineDash(phase: 0, lengths: [])
  let tagWidth = CGFloat(label.count) * 9 + 14
  ctx.setFillColor(labelFill)
  ctx.fill(rect(x, yTop, tagWidth, 20))
  text(label, sansTag, labelInk, x: x + 7, baseline: yTop + 15, tracking: 0.6)
}
crop("16:9", iw - 8, (iw - 8) * 9 / 16, color: light, dash: [9, 6], labelFill: light, labelInk: ink)
crop("4:5", 176, 220, color: ink, dash: [6, 5], labelFill: ink, labelInk: light)
crop("1:1", 150, 150, color: orange, dash: [], labelFill: orange, labelInk: light)
// Focal reticle.
ctx.setStrokeColor(orange)
ctx.setLineWidth(2.5)
ctx.strokeEllipse(in: CGRect(x: focus.x - 15, y: focus.y - 15, width: 30, height: 30))
ctx.setLineWidth(2)
for (dx, dy) in [(-1.0, 0.0), (1.0, 0.0), (0.0, -1.0), (0.0, 1.0)] as [(CGFloat, CGFloat)] {
  ctx.move(to: CGPoint(x: focus.x + dx * 20, y: focus.y + dy * 20))
  ctx.addLine(to: CGPoint(x: focus.x + dx * 30, y: focus.y + dy * 30))
}
ctx.strokePath()
ctx.setFillColor(orange)
ctx.fillEllipse(in: CGRect(x: focus.x - 3.5, y: focus.y - 3.5, width: 7, height: 7))

// Ticker band.
ctx.setFillColor(ink)
ctx.fill(rect(0, 556, W, 74))
let products = ["WORKERS", "IMAGES", "R2", "QUEUES", "WORKFLOWS", "D1", "WORKERS AI"]
let bandFont = sansBand
var widths: [CGFloat] = []
for product in products {
  let attributes: [NSAttributedString.Key: Any] = [
    NSAttributedString.Key(kCTFontAttributeName as String): bandFont,
    NSAttributedString.Key(kCTKernAttributeName as String): CGFloat(2.4),
  ]
  let line = CTLineCreateWithAttributedString(NSAttributedString(string: product, attributes: attributes))
  widths.append(CGFloat(CTLineGetTypographicBounds(line, nil, nil, nil)))
}
let gap: CGFloat = 46
let total = widths.reduce(0, +) + gap * CGFloat(products.count - 1)
var x = (W - total) / 2
for (index, product) in products.enumerated() {
  text(product, bandFont, light, x: x, baseline: 599, tracking: 2.4)
  x += widths[index]
  if index < products.count - 1 {
    text("✳", font("AvenirNext-Bold", 17), orange, x: x + gap / 2 - 7, baseline: 599)
  }
  x += gap
}

let output = URL(fileURLWithPath: CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "public/og-image.png")
let destination = CGImageDestinationCreateWithURL(output as CFURL, UTType.png.identifier as CFString, 1, nil)!
CGImageDestinationAddImage(destination, ctx.makeImage()!, nil)
precondition(CGImageDestinationFinalize(destination), "Could not write \(output.path)")
print("Wrote \(output.path)")
