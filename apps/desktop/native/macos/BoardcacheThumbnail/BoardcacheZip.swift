import Foundation

/// Reads `thumbnail.png` out of a `.boardcache` zip without inflating
/// anything. Fast path: the first local header. Fallback: the central
/// directory. Returns nil for anything unusual; the OS then draws the
/// generic document icon.
enum BoardcacheZip {
    private static let localSig: UInt32 = 0x0403_4b50
    private static let centralSig: UInt32 = 0x0201_4b50
    private static let eocdSig: UInt32 = 0x0605_4b50
    private static let entryName = "thumbnail.png"
    private static let maxPng = 8 * 1024 * 1024
    private static let maxFile = 2 * 1024 * 1024 * 1024

    static func thumbnail(in data: Data) -> Data? {
        guard data.count >= 30, data.count < maxFile else { return nil }
        if let png = fromFirstLocalHeader(data) { return png }
        return fromCentralDirectory(data)
    }

    private static func u16(_ d: Data, _ at: Int) -> Int? {
        guard at >= 0, at + 2 <= d.count else { return nil }
        return Int(d[d.startIndex + at]) | (Int(d[d.startIndex + at + 1]) << 8)
    }

    private static func u32(_ d: Data, _ at: Int) -> UInt32? {
        guard at >= 0, at + 4 <= d.count else { return nil }
        var v: UInt32 = 0
        for i in 0..<4 { v |= UInt32(d[d.startIndex + at + i]) << (8 * UInt32(i)) }
        return v
    }

    private static func name(_ d: Data, _ at: Int, _ len: Int) -> String? {
        guard at >= 0, len > 0, at + len <= d.count else { return nil }
        return String(data: d.subdata(in: (d.startIndex + at)..<(d.startIndex + at + len)), encoding: .utf8)
    }

    /// Local header: sig(4) ver(2) flag(2) method(2) time(2) date(2) crc(4)
    /// csize(4) usize(4) nameLen(2) extraLen(2) name extra data.
    private static func storedBytes(atLocalHeader off: Int, in d: Data, knownSize: Int?) -> Data? {
        guard u32(d, off) == localSig,
              let flag = u16(d, off + 6),
              let method = u16(d, off + 8),
              let csize = u32(d, off + 18),
              let nameLen = u16(d, off + 26),
              let extraLen = u16(d, off + 28),
              name(d, off + 30, nameLen) == entryName,
              method == 0
        else { return nil }
        // Bit 3 = sizes live in a trailing data descriptor; use the central
        // directory's size when we have it, else give up.
        let size = (flag & 0x8) != 0 ? knownSize : Int(csize)
        guard let n = size, n > 0, n <= maxPng else { return nil }
        let start = off + 30 + nameLen + extraLen
        guard start + n <= d.count else { return nil }
        return d.subdata(in: (d.startIndex + start)..<(d.startIndex + start + n))
    }

    private static func fromFirstLocalHeader(_ d: Data) -> Data? {
        storedBytes(atLocalHeader: 0, in: d, knownSize: nil)
    }

    private static func fromCentralDirectory(_ d: Data) -> Data? {
        // EOCD is within the last 64 KB + 22 bytes; scan backwards for it.
        let tail = max(0, d.count - 65_557)
        var eocd = -1
        var i = d.count - 22
        while i >= tail {
            if u32(d, i) == eocdSig { eocd = i; break }
            i -= 1
        }
        guard eocd >= 0,
              let count = u16(d, eocd + 10),
              let cdOffset = u32(d, eocd + 16)
        else { return nil }
        var p = Int(cdOffset)
        for _ in 0..<min(count, 10_000) {
            // Central header: sig(4) … method@10 csize@20 nameLen@28 extraLen@30
            // commentLen@32 … localOffset@42 name@46.
            guard u32(d, p) == centralSig,
                  let method = u16(d, p + 10),
                  let csize = u32(d, p + 20),
                  let nameLen = u16(d, p + 28),
                  let extraLen = u16(d, p + 30),
                  let commentLen = u16(d, p + 32),
                  let local = u32(d, p + 42)
            else { return nil }
            if name(d, p + 46, nameLen) == entryName {
                guard method == 0 else { return nil }
                return storedBytes(atLocalHeader: Int(local), in: d, knownSize: Int(csize))
            }
            p += 46 + nameLen + extraLen + commentLen
        }
        return nil
    }
}
